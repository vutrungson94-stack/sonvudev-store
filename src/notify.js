import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, isConfigured } from "./config.js";
import { updateOrder } from "./store.js";

// Order mail is the only outbound mail the store sends. Resend is used because
// it is a plain REST API: no dependency, no SMTP server, and its free tier
// covers a store this size. Without a key every message is written to
// data/outbox instead, so the whole flow can be exercised before an account
// exists and a missing key can never break a checkout.
const root = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outboxDir = path.join(root, "data", "outbox");

// A mail that keeps failing must not be retried on every sweep tick, but a
// single failure (a provider timeout, a rate limit) must not silently drop the
// only message the buyer ever gets.
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [0, 60_000, 600_000];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const text = (error) => String(error?.message || error || "").slice(0, 300);

// The block copy is written once and used for both versions of the message, so
// the HTML and the plain text have to strip the markup differently: the HTML
// keeps it, the text version drops it. A buyer reading a plain-text client
// should not see the letters b and slash-b.
const stripTags = (value) => String(value).replace(/<\/?b>/g, "");

const money = (amount, currency) => new Intl.NumberFormat(currency === "USD" ? "en-US" : "vi-VN", currency === "USD" ? { style: "currency", currency } : { maximumFractionDigits: 0 }).format(Number(amount) || 0);

const stamp = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const item = (order) => (order.items || [])[0] || {};

/** Details every buyer-facing message repeats, so each template stays short. */
function context(order) {
  const product = item(order);
  return {
    id: order.id,
    product: product.name || "SonVuDev",
    version: product.version || "",
    amount: money(order.amount, order.currency),
    currency: order.currency || "VND",
    deadline: stamp(order.expiresAt),
    paidAt: stamp(order.paidAt),
    refundReason: order.refundReason || "không rõ",
    lookupUrl: `${env.appUrl}/lookup`,
    support: env.email.supportEmail,
  };
}

// Bilingual on purpose. The checkout form carries a language switch, but the
// order row does not remember which one the buyer picked, and guessing wrong on
// a payment receipt is worse than a short English paragraph underneath.
const TEMPLATES = {
  created: (c) => ({
    subject: `Đơn ${c.id} đã được tạo · Order ${c.id} created`,
    heading: "Đơn hàng đã được tạo",
    headingEn: "Your order was created",
    lines: [
      `Bạn cần thanh toán trước ${c.deadline}. Đơn chưa thanh toán sẽ tự động bị hủy sau 24 giờ.`,
      `Pay before ${c.deadline}. Unpaid orders are cancelled automatically after 24 hours.`,
    ],
    blocks: [
      `Thanh toán đúng số tiền và ghi nội dung chuyển khoản là <b>SonVuDev ${c.id}</b> để chúng tôi đối soát.`,
      `Mã tra cứu đơn hàng được lưu trong trình duyệt của bạn. Nếu mất, mở ${c.lookupUrl} và nhập mã đơn cùng email này để lấy lại.`,
      `Bạn chỉ bị tính phí khi thanh toán thành công. Cần trợ giúp: ${c.support}.`,
    ],
  }),
  expiring: (c) => ({
    subject: `Đơn ${c.id} sắp hết hạn · Order ${c.id} expires soon`,
    heading: "Đơn hàng sắp hết hạn",
    headingEn: "Your order expires soon",
    lines: [
      `Đơn ${c.id} chưa được thanh toán và sẽ bị hủy sau ${c.deadline}.`,
      `Order ${c.id} is still unpaid and will be cancelled after ${c.deadline}.`,
    ],
    blocks: [
      `Thanh toán ngay tại ${c.lookupUrl} bằng mã đơn và email này.`,
      `Cần trợ giúp: ${c.support}.`,
    ],
  }),
  cancelled: (c) => ({
    subject: `Đơn ${c.id} đã bị hủy · Order ${c.id} cancelled`,
    heading: "Đơn hàng đã bị hủy",
    headingEn: "Your order was cancelled",
    lines: [
      `Đơn ${c.id} không được thanh toán trong 24 giờ nên đã bị hủy tự động.`,
      `Order ${c.id} was not paid within 24 hours and has been cancelled automatically.`,
    ],
    blocks: [
      `Bạn vẫn có thể đặt đơn mới bất cứ lúc nào. Nếu bạn đã chuyển khoản, hãy gửi ảnh biên lai để chúng tôi đối soát hoặc hoàn lại.`,
      `You can place a new order at any time. If you already transferred the money, send us the receipt so we can reconcile or refund it.`,
      `Liên hệ: ${c.support}.`,
    ],
  }),
  paid: (c) => ({
    subject: `Thanh toán thành công · Order ${c.id} paid`,
    heading: "Cảm ơn bạn, thanh toán đã thành công",
    headingEn: "Payment received",
    lines: [
      `Chúng tôi đã nhận đủ ${c.amount} cho đơn ${c.id}. Nút tải sản phẩm đã được mở khóa.`,
      `We received ${c.amount} for order ${c.id}. The download button is now unlocked.`,
    ],
    blocks: [
      `Mở ${c.lookupUrl} và nhập mã đơn <b>${c.id}</b> cùng email này để tải sản phẩm. Liên kết tải có thời hạn ngắn, nhưng bạn luôn có thể tạo lại.`,
      `Go to ${c.lookupUrl} with order ${c.id} and this email to download. Download links are short lived, but you can always generate a new one.`,
      `Cần trợ giúp: ${c.support}.`,
    ],
  }),
  refunded: (c) => ({
    subject: `Đã hoàn tiền · Order ${c.id} refunded`,
    heading: "Đơn hàng đã được hoàn tiền",
    headingEn: "Your order was refunded",
    lines: [
      `Chúng tôi đã hoàn lại ${c.amount} cho đơn ${c.id}. Lý do: ${c.refundReason}`,
      `We refunded ${c.amount} for order ${c.id}. Reason: ${c.refundReason}`,
    ],
    blocks: [
      `Quyền tải sản phẩm của đơn này đã bị thu hồi. Nếu bạn cho rằng đây là nhầm lẫn, hãy trả lời thư này hoặc liên hệ ${c.support} kèm mã đơn.`,
      `Access to this release has been revoked. If you think this is a mistake, reply to this email or contact ${c.support} with the order id.`,
    ],
  }),
};

function body(order, template) {
  const c = context(order);
  const spec = TEMPLATES[template](c);
  const product = `${c.product}${c.version ? ` v${c.version}` : ""}`;
  const text = [
    spec.heading, spec.headingEn, "",
    ...spec.lines, "",
    `Sản phẩm / Product: ${product}`,
    `Số tiền / Amount: ${c.amount}`,
    `Mã đơn / Order: ${c.id}`,
    ...spec.blocks.map(stripTags),
  ].join("\n");
  const html = `<!doctype html><html lang="vi"><body style="margin:0;padding:24px;background:#f1f6f3;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16302a">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dbe7e0;border-radius:14px;padding:28px">
<p style="margin:0 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#3f8f68">SonVuDev</p>
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3">${escapeHtml(spec.heading)}</h1>
<h2 style="margin:0 0 18px;font-size:16px;line-height:1.4;color:#4b6159">${escapeHtml(spec.headingEn)}</h2>
${spec.lines.map((l) => `<p style="margin:0 0 10px;font-size:14px;line-height:1.6">${escapeHtml(l)}</p>`).join("")}
<table style="margin:18px 0;border-collapse:collapse;font-size:14px">
<tr><td style="padding:4px 16px 4px 0;color:#6b7d76">Sản phẩm / Product</td><td style="padding:4px 0;font-weight:600">${escapeHtml(product)}</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#6b7d76">Số tiền / Amount</td><td style="padding:4px 0;font-weight:600">${escapeHtml(c.amount)}</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#6b7d76">Mã đơn / Order</td><td style="padding:4px 0;font-weight:600">${escapeHtml(c.id)}</td></tr>
</table>
${spec.blocks.map((b) => `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#3d514a">${b.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#247653">$1</a>')}</p>`).join("")}
<hr style="border:0;border-top:1px solid #e6eee9;margin:22px 0">
<p style="margin:0;font-size:11px;color:#8b9893">© 2026 SonVuDev.com</p>
</div></body></html>`;
  return { subject: spec.subject, text, html };
}

async function deliver(to, message, order, key) {
  if (isConfigured.email) {
    const response = await fetch("https://api.resend.com/emails", {
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
  await fs.mkdir(outboxDir, { recursive: true });
  // The order id is in the name so a folder of outbox files can be read as a
  // list of what the store tried to tell buyers.
  const safe = (value) => String(value || "").replace(/[^\w.@-]/g, "_").slice(0, 60);
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safe(order.id)}-${safe(key)}`;
  await fs.writeFile(path.join(outboxDir, `${name}.html`), message.html);
  await fs.writeFile(path.join(outboxDir, `${name}.txt`), message.text);
  return { via: "outbox" };
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
  await updateOrder(order.id, { notifications: { ...notes, [key]: { at: stampIso, status: "sending", attempts } } });
  try {
    const { via } = await deliver(order.customerEmail, body(order, template), order, key);
    await updateOrder(order.id, { notifications: { ...notes, [key]: { at: stampIso, status: "sent", attempts } } });
    console.log(`[notify] ${template} -> ${order.id} (${via})`);
    return { sent: true, via };
  } catch (error) {
    await updateOrder(order.id, { notifications: { ...notes, [key]: { at: stampIso, status: "failed", attempts, error: text(error) } } });
    console.error(`[notify] ${template} failed for ${order.id} (attempt ${attempts}/${MAX_ATTEMPTS}): ${error.message}`);
    return { sent: false, reason: "failed" };
  }
}

export const notifyMode = () => (isConfigured.email ? "resend" : "outbox");
export const outboxPath = outboxDir;
