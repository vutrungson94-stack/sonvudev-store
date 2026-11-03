import { promises as fs } from "node:fs";
import path from "node:path";
import { env, isConfigured } from "./config.js";
import { projectRoot, updateOrder } from "./store.js";
import { esc as escapeHtml, money } from "./format.js";

// Order mail is the only outbound mail the store sends. Resend is used because
// it is a plain REST API: no dependency, no SMTP server, and its free tier
// covers a store this size. Without a key every message is written to
// data/outbox instead, so the whole flow can be exercised before an account
// exists and a missing key can never break a checkout.
//
// projectRoot comes from the store, which resolved it the same way. The second
// copy of that expression could only agree for as long as nobody edited one.
const outboxDir = path.join(projectRoot, "data", "outbox");

// A mail that keeps failing must not be retried on every sweep tick, but a
// single failure (a provider timeout, a rate limit) must not silently drop the
// only message the buyer ever gets.
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [0, 60_000, 600_000];

const text = (error) => String(error?.message || error || "").slice(0, 300);

// The block copy is written once and used for both versions of the message, so
// the HTML and the plain text have to strip the markup differently: the HTML
// keeps it, the text version drops it. A buyer reading a plain-text client
// should not see the letters b and slash-b.
const stripTags = (value) => String(value).replace(/<\/?b>/g, "");

// escapeHtml and money are imported from format.js. They were written out here
// as well, identical to the character, which meant the price a buyer reads in
// their bank confirmation and the price on the page they bought from were two
// independent implementations of the same format.

const stamp = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const item = (order) => (order.items || [])[0] || {};

/** Details every buyer-facing message repeats, so each template stays short. */
function context(order) {
  const product = item(order);
  const lang = String(order.lang || "").toLowerCase();
  const isVi = lang === "vi" || !lang;
  const isEn = lang === "en";
  return {
    id: order.id,
    product: product.name || env.brand.name,
    version: product.version || "",
    amount: money(order.amount, order.currency),
    currency: order.currency || "VND",
    windowHours: env.orders.paymentWindowHours,
    deadline: stamp(order.expiresAt),
    paidAt: stamp(order.paidAt),
    refundReason: order.refundReason || "không rõ",
    transferNote: `${env.bank.notePrefix} ${order.id}`.trim(),
    lookupUrl: `${env.appUrl}/lookup`,
    support: env.email.supportEmail,
    lang,
    isVi,
    isEn,
  };
}

// Buyer-facing copy. The order now stores the language the buyer used on the
// checkout form, so guessing bilingual is no longer necessary: we send the
// message in the language they actually read.
const TEMPLATES = {
  created: (c) => {
    const subject = c.isVi
      ? `Đơn ${c.id} đã được tạo`
      : `Order ${c.id} created`;
    const heading = c.isVi ? "Đơn hàng đã được tạo" : "Your order was created";
    const lines = c.isVi
      ? [
          `Bạn cần thanh toán trước ${c.deadline}. Đơn chưa thanh toán sẽ tự động bị hủy sau ${c.windowHours} giờ.`,
        ]
      : [
          `Pay before ${c.deadline}. Unpaid orders are cancelled automatically after ${c.windowHours} hours.`,
        ];
    const blocks = c.isVi
      ? [
          `Thanh toán đúng số tiền và ghi nội dung chuyển khoản là <b>${c.transferNote}</b> để chúng tôi đối soát.`,
          `Mã tra cứu đơn hàng được lưu trong trình duyệt của bạn. Nếu mất, mở ${c.lookupUrl} và nhập mã đơn cùng email này để lấy lại.`,
          `Bạn chỉ bị tính phí khi thanh toán thành công. Cần trợ giúp: ${c.support}.`,
        ]
      : [
          `Pay the exact amount and write <b>${c.transferNote}</b> as the transfer note so we can reconcile it.`,
          `Your order lookup code is saved in your browser. If you lost it, open ${c.lookupUrl} and enter the order id plus this email to recover it.`,
          `You are only charged once the payment clears. Need help? ${c.support}.`,
        ];
    return { subject, heading, lines, blocks };
  },
  expiring: (c) => {
    const subject = c.isVi
      ? `Đơn ${c.id} sắp hết hạn`
      : `Order ${c.id} expires soon`;
    const heading = c.isVi ? "Đơn hàng sắp hết hạn" : "Your order expires soon";
    const lines = c.isVi
      ? [
          `Đơn ${c.id} chưa được thanh toán và sẽ bị hủy sau ${c.deadline}.`,
        ]
      : [
          `Order ${c.id} is still unpaid and will be cancelled after ${c.deadline}.`,
        ];
    const blocks = c.isVi
      ? [
          `Thanh toán ngay tại ${c.lookupUrl} bằng mã đơn và email này.`,
          `Cần trợ giúp: ${c.support}.`,
        ]
      : [
          `Pay now at ${c.lookupUrl} using the order id and this email.`,
          `Need help? ${c.support}.`,
        ];
    return { subject, heading, lines, blocks };
  },
  cancelled: (c) => {
    const subject = c.isVi
      ? `Đơn ${c.id} đã bị hủy`
      : `Order ${c.id} cancelled`;
    const heading = c.isVi ? "Đơn hàng đã bị hủy" : "Your order was cancelled";
    const lines = c.isVi
      ? [
          `Đơn ${c.id} không được thanh toán trong ${c.windowHours} giờ nên đã bị hủy tự động.`,
        ]
      : [
          `Order ${c.id} was not paid within ${c.windowHours} hours and has been cancelled automatically.`,
        ];
    const blocks = c.isVi
      ? [
          `Bạn vẫn có thể đặt đơn mới bất cứ lúc nào. Nếu bạn đã chuyển khoản, hãy gửi ảnh biên lai để chúng tôi đối soát hoặc hoàn lại.`,
          `Liên hệ: ${c.support}.`,
        ]
      : [
          `You can place a new order at any time. If you already transferred the money, send us the receipt so we can reconcile or refund it.`,
          `Contact: ${c.support}.`,
        ];
    return { subject, heading, lines, blocks };
  },
  paid: (c) => {
    const subject = c.isVi
      ? `Thanh toán thành công`
      : `Payment received`;
    const heading = c.isVi
      ? "Cảm ơn bạn, thanh toán đã thành công"
      : "Payment received";
    const lines = c.isVi
      ? [
          `Chúng tôi đã nhận đủ ${c.amount} cho đơn ${c.id}. Nút tải sản phẩm đã được mở khóa.`,
        ]
      : [
          `We received ${c.amount} for order ${c.id}. The download button is now unlocked.`,
        ];
    const blocks = c.isVi
      ? [
          `Mở ${c.lookupUrl} và nhập mã đơn <b>${c.id}</b> cùng email này để tải sản phẩm. Liên kết tải có thời hạn ngắn, nhưng bạn luôn có thể tạo lại.`,
          `Cần trợ giúp: ${c.support}.`,
        ]
      : [
          `Go to ${c.lookupUrl} with order ${c.id} and this email to download. Download links are short lived, but you can always generate a new one.`,
          `Need help? ${c.support}.`,
        ];
    return { subject, heading, lines, blocks };
  },
  refunded: (c) => {
    const subject = c.isVi
      ? `Đã hoàn tiền`
      : `Order ${c.id} refunded`;
    const heading = c.isVi
      ? "Đơn hàng đã được hoàn tiền"
      : "Your order was refunded";
    const lines = c.isVi
      ? [
          `Chúng tôi đã hoàn lại ${c.amount} cho đơn ${c.id}. Lý do: ${c.refundReason}`,
        ]
      : [
          `We refunded ${c.amount} for order ${c.id}. Reason: ${c.refundReason}`,
        ];
    const blocks = c.isVi
      ? [
          `Quyền tải sản phẩm của đơn này đã bị thu hồi. Nếu bạn cho rằng đây là nhầm lẫn, hãy trả lời thư này hoặc liên hệ ${c.support} kèm mã đơn.`,
        ]
      : [
          `Access to this release has been revoked. If you think this is a mistake, reply to this email or contact ${c.support} with the order id.`,
        ];
    return { subject, heading, lines, blocks };
  },
};

function body(order, template) {
  const c = context(order);
  const spec = TEMPLATES[template](c);
  const product = `${c.product}${c.version ? ` v${c.version}` : ""}`;
  const text = [
    spec.heading,
    "",
    ...spec.lines,
    "",
    `Sản phẩm / Product: ${product}`,
    `Số tiền / Amount: ${c.amount}`,
    `Mã đơn / Order: ${c.id}`,
    ...spec.blocks.map(stripTags),
  ].join("\n");
  const html = `<!doctype html><html lang="${c.isVi ? 'vi' : 'en'}"><body style="margin:0;padding:24px;background:#f1f6f3;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16302a">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dbe7e0;border-radius:14px;padding:28px">
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr>
<td style="padding:0 10px 0 0;vertical-align:middle"><img src="${escapeHtml(env.appUrl)}/icon-64.png" alt="${escapeHtml(env.brand.name)}" width="34" height="34" style="display:block;border:0;border-radius:7px"></td>
<td style="padding:0;vertical-align:middle;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#3f8f68">${escapeHtml(env.brand.name)}</td>
</tr></table>
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3">${escapeHtml(spec.heading)}</h1>
${spec.lines.map((l) => `<p style="margin:0 0 10px;font-size:14px;line-height:1.6">${escapeHtml(l)}</p>`).join("")}
<table style="margin:18px 0;border-collapse:collapse;font-size:14px">
<tr><td style="padding:4px 16px 4px 0;color:#6b7d76">${c.isVi ? 'Sản phẩm' : 'Product'}</td><td style="padding:4px 0;font-weight:600">${escapeHtml(product)}</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#6b7d76">${c.isVi ? 'Số tiền' : 'Amount'}</td><td style="padding:4px 0;font-weight:600">${escapeHtml(c.amount)}</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#6b7d76">${c.isVi ? 'Mã đơn' : 'Order'}</td><td style="padding:4px 0;font-weight:600">${escapeHtml(c.id)}</td></tr>
</table>
${spec.blocks.map((b) => `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#3d514a">${b.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#247653">$1</a>')}</p>`).join("")}
<hr style="border:0;border-top:1px solid #e6eee9;margin:22px 0">
<p style="margin:0;font-size:11px;color:#8b9893">© ${new Date().getFullYear()} ${escapeHtml(env.brand.name)}</p>
</div></body></html>`;
  return { subject: spec.subject, text, html };
}

async function deliver(to, message, order, key) {
  if (isConfigured.email) {
    const response = await fetch(env.notify.resendApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.email.resendKey}`,
        "Content-Type": "application/json",
        // The order id plus the notification key is a stable name for this one
        // message. Resend keeps it for 24 hours, so a request that was accepted
        // but whose response was lost is not re-sent as a second email.
        // The key has to be the notification key, not the template: a second
        // confirmed payment on the same order is paid:2 and must be a different
        // message, not a duplicate Resend would quietly drop.
        "Idempotency-Key": `${order.id}-${key}`.slice(0, 256),
      },
      body: JSON.stringify({
        from: env.email.from,
        to: [to],
        // A buyer who needs help replies to this, so the reply has to land
        // somewhere. Without it it goes to no-reply@ and disappears.
        reply_to: env.email.supportEmail,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Resend ${response.status} ${await response.text()}`);
    return { via: "resend" };
  }
  // Writing the outbox can fail for a reason that has nothing to do with the order:
  // on a host with a read-only filesystem — which is every serverless platform,
  // since the code ships as a bundle and not as a checkout — there is nowhere to
  // write. It used to throw, and because the order flow awaits this, a missing
  // Resend key on such a host took down the request that created the order. The
  // customer was charged and got a 500.
  //
  // A store that cannot send mail is already in trouble; it is not in so much
  // trouble that it should also refuse to take the money. So the failure is
  // reported, and it is reported as a failure.
  //
  // This used to return { via: "outbox-unavailable" }, which notifyOrder read as a
  // successful delivery and recorded on the order as status "sent". The retry
  // ladder never engaged, /api/health still said the mailer was healthy, and a
  // buyer who had been charged got no confirmation, no expiry warning and no paid
  // notice — with the order row asserting that every one of them had been sent.
  // Returning the reason instead of a via lets the caller record what happened.
  try {
    await fs.mkdir(outboxDir, { recursive: true });
    // The order id is in the name so a folder of outbox files can be read as a
    // list of what the store tried to tell buyers.
    const safe = (value) => String(value || "").replace(/[^\w.@-]/g, "_").slice(0, 60);
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safe(order.id)}-${safe(key)}`;
    await fs.writeFile(path.join(outboxDir, `${name}.html`), message.html);
    await fs.writeFile(path.join(outboxDir, `${name}.txt`), message.text);
    return { via: "outbox" };
  } catch (error) {
    console.error(
      `[notify] Không ghi được outbox (${error.code || error.message}). `
      + "Dat RESEND_API_KEY de gui email that; neu khong, don hàng se khong co email nao gui cho khach.",
    );
    throw error;
  }
}

const readNotes = (order) => (order && order.notifications && typeof order.notifications === "object") ? order.notifications : {};

/**
 * Sends one message per order per template, exactly once.
 *
 * The record lives on the order row, so a crash, a retry or the webhook and the
 * capture endpoint racing each other cannot produce a second email. A failed
 * attempt is retried on a later sweep with a widening backoff, then parked so a
 * permanently broken address cannot loop forever.
 */
/**
 * Renders a message without sending it. Used by the local test script so the
 * exact bytes a buyer would receive can be opened in a browser, which is the
 * only reliable way to spot broken layout in an email.
 */
export const previewMessage = (order, template) => body(order, template);

/**
 * Writes the delivery record, and never throws.
 *
 * Recording is bookkeeping: it decides whether a message is retried later, not
 * whether the order stands. Every call to it sits either before or inside the
 * failure path of a send, and the one in the catch used to be able to throw — the
 * database being unavailable is exactly when a send fails — which turned a
 * delivered-with-failure into an exception. That exception travelled out through
 * markOrderPaid to the PayPal capture route, which answered 502 to a buyer whose
 * money had already been captured.
 *
 * A record that could not be written is a lost retry, not a lost order, and it is
 * said out loud rather than swallowed.
 */
const record = async (order, notes, key, entry) => {
  try {
    await updateOrder(order.id, { notifications: { ...notes, [key]: entry } });
    return true;
  } catch (error) {
    console.error(`[notify] could not record "${key}" on ${order.id}: ${text(error)}`);
    return false;
  }
};

export async function notifyOrder(order, template, key = template) {
  if (!order || !TEMPLATES[template] || !order.customerEmail) return { sent: false, reason: "not-applicable" };
  const notes = readNotes(order);
  const previous = notes[key] || {};
  if (previous.status === "sent") return { sent: false, reason: "already-sent" };
  if (previous.status === "failed" && previous.attempts >= MAX_ATTEMPTS) return { sent: false, reason: "gave-up" };
  const attempts = (previous.attempts || 0) + 1;
  if (RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length - 1)] > 0) {
    const waited = Date.now() - new Date(previous.at || 0).getTime();
    if (waited < RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length - 1)]) return { sent: false, reason: "backoff" };
  }
  const stampIso = new Date().toISOString();
  // Recorded before the send, not after: a provider that accepts the request
  // and then times out the response would otherwise be retried forever.
  await record(order, notes, key, { at: stampIso, status: "sending", attempts });
  try {
    const { via } = await deliver(order.customerEmail, body(order, template), order, key);
    await record(order, notes, key, { at: stampIso, status: "sent", attempts });
    console.log(`[notify] ${template} -> ${order.id} (${via})`);
    return { sent: true, via };
  } catch (error) {
    await record(order, notes, key, { at: stampIso, status: "failed", attempts, error: text(error) });
    console.error(`[notify] ${template} failed for ${order.id} (attempt ${attempts}/${MAX_ATTEMPTS}): ${error.message}`);
    return { sent: false, reason: "failed" };
  }
}

export const notifyMode = () => (isConfigured.email ? "resend" : "outbox");
export const outboxPath = outboxDir;
