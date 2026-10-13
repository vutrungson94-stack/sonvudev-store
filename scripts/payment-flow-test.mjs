// Walks a real order through its whole life against a real server, and reports what
// actually happened.
//
// This exists because the only real test of a payment is paying, and paying needs
// money. The steps after the money moves are the ones that break: the mail that
// carries the download link, the token that unlocks the file, the delivery that
// closes the order, the review that only a fulfilled order may leave. None of them
// have anything to do with PayPal, and all of them can be exercised for free.
//
// What it does NOT prove, and this is said here so nobody mistakes the green for
// more than it is: that PayPal called the webhook back. That hop is PayPal's
// network, and only a real payment exercises it. There is no free way around that
// one.
//
//   npm run test:flow            against a throwaway local store, nothing external
//   npm run test:flow -- <url>   against a live server; writes nothing that costs
//
// Usage:
//   node scripts/payment-flow-test.mjs               local
//   node scripts/payment-flow-test.mjs https://...   live site, needs an admin token
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] || "";
const live = /^https?:\/\//.test(target);
const adminToken = (process.env.ADMIN_API_TOKEN || "").trim();

const steps = [];
const step = (name, ok, detail) => {
  steps.push({ name, ok: Boolean(ok), detail: detail || "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// Everything external is stubbed only where the step under test is not the thing
// being checked. R2 still answers, because "the storefront hides every product
// without it" is a failure this test exists to be able to see.
process.env.NODE_ENV = "test";
process.env.DATA_DIR = live ? process.env.DATA_DIR : await fs.mkdtemp(path.join(os.tmpdir(), "sonvudev-flow-"));
if (!live) {
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  process.env.ADMIN_API_TOKEN = "flow-test-admin-token";
  process.env.BANK_NAME = "Flow Test Bank";
  process.env.BANK_ACCOUNT_NAME = "Flow Tester";
  process.env.BANK_ACCOUNT_NUMBER = "0123456789";
  process.env.BANK_BIN = "970436";
  process.env.RESEND_API_KEY = "";
  process.env.INDEXNOW_KEY = "";
  process.env.SUPPORT_EMAIL = "flow@example.com";
  process.env.ORDER_PAYMENT_WINDOW_HOURS = "24";
}

// A Windows absolute path is not a valid ESM specifier, so the modules are loaded
// by file URL. Without this the script runs everywhere except the machine it was
// written on, which is the whole reason to bother running it locally.
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
const { createApp } = await load("app.js");
const { getOrder } = await load("store.js");
const { markOrderDelivered, markOrderPaid, voidPayment } = await load("orders.js");
const { outboxPath } = await load("notify.js");

// The boot is inside a try like the rest.
//
// Loading the modules, building the app and opening the socket all sat *above* the
// try block, so a failure in any of them — a port already in use, a config file that
// will not parse, a missing dependency — rejected out of the module as a raw stack
// trace with none of the step reporting this script is built on. Every failure the
// script does handle produces a line like `FAIL <step> — <reason>`; this produced
// none.
let app = null;
let server = null;
let base = target.replace(/\/$/, "");
const token = live ? adminToken : "flow-test-admin-token";
const stamp = Date.now();
const admin = (extra = {}) => ({ "content-type": "application/json", "x-admin-token": token, ...extra });
const email = `flow-${stamp}@example.com`;

// Every request gets the same deadline.
//
// None of them had one. Against a live host eight requests with no `signal` means
// the script hangs until the operating system gives up on the TCP connection — which
// on Windows is a couple of minutes per socket, with no output, so a deploy host
// that stopped responding produced a silent terminal rather than a failed check.
// Generous, because the sleep after a payment is real: a waking instance can take a
// minute to answer. Bounded, because a check that can hang forever is not a check.
const REQUEST_TIMEOUT_MS = 90_000;
const call = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

try {
  if (!live && !adminToken) console.log("Chạy bỏ qua máy chủ, không dùng tiền thật.\n");

  // Boot, inside the try, so its failures are reported like every other one.
  const { createApp } = await load("app.js");
  const { getOrder } = await load("store.js");
  const { markOrderDelivered, markOrderPaid, voidPayment } = await load("orders.js");
  const { outboxPath } = await load("notify.js");
  app = await createApp();
  server = app.listen(0);
  if (!live) base = `http://127.0.0.1:${server.address().port}`;

  // 1. A product that a buyer can actually see and buy.
  const slug = `flow-test-${stamp}`;
  const created = await call(`${base}/api/admin/products`, {
    method: "POST",
    headers: admin(),
    body: JSON.stringify({ name: "Flow Test Tool", slug, price: 49000, version: "1.0", platform: "Windows", fileKey: `products/${slug}/1.0/x.exe`, status: "active", description: "Cong cu kiem tra luong don hanh va vong doi thu muc tin cay." }),
  });
  const product = (await created.json()).product;
  step("tạo sản phẩm", created.status === 201 && product?.id, product?.slug || `HTTP ${created.status}`);

  // 2. The storefront actually lists it. Without R2 connected the storefront hides
  //    every product, so this is where a missing bucket shows up.
  const catalogue = await (await call(`${base}/api/products`)).json();
  step("sản phẩm xuất hiện trên cửa hàng", (catalogue.products || []).some((p) => p.id === product.id));

  // 3. Checkout, and the order it created.
  const checkout = await call(`${base}/api/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: product.id, email, customerName: "Flow Tester", paymentMethod: "bank_transfer", acceptPolicy: true }),
  });
  const placed = await checkout.json();
  const orderId = placed.order?.id;
  const accessToken = placed.accessToken;
  step("đặt hàng", checkout.status === 200 && Boolean(orderId), orderId || `HTTP ${checkout.status}`);

  // 4. The window the buyer is shown has to be the window the server enforces.
  //    The checkout response carries the deadline; the options endpoint carries the
  //    hours the storefront prints. They are built from different places, which is
  //    why this compares them rather than trusting either.
  const options = await (await call(`${base}/api/checkout/options`)).json();
  const window = Number(options.paymentWindowHours);
  const deadline = new Date(placed.expiresAt).getTime() - new Date(placed.order.createdAt).getTime();
  step("cửa sổ thanh toán đúng số giờ cấu hình",
    Number.isFinite(window) && Math.abs(deadline - window * 3600 * 1000) < 60_000,
    `${window}h, han ${new Date(placed.expiresAt).toISOString()}`);
  step("đơn có hạn chót và đồng hồ máy chủ", Boolean(placed.expiresAt && placed.serverTime), `hạn ${new Date(placed.expiresAt).toISOString()}`);

  // 5. An unpaid order cannot download.
  const early = await call(`${base}/api/orders/${orderId}/download?token=${accessToken}`, { headers: { "x-order-token": accessToken } });
  step("đơn chưa thanh toán không tải được", early.status !== 200, `HTTP ${early.status}`);

  // 6. The mail. Written to the outbox rather than sent, so the whole step is free
  //    and cannot reach a real inbox. The file name carries the order id and the
  //    template so a folder of them reads as a list of what the store told buyers.
  const paid = await markOrderPaid(await getOrder(orderId), { source: "flow-test" });
  step("xác nhận đã thanh toán", paid?.status === "paid", `status=${paid?.status}`);

  const outbox = (await fs.readdir(outboxPath)).filter((name) => name.includes(orderId));
  step("email gửi ra có ghi lại", outbox.length > 0, `${outbox.length} tệp: ${outbox.join(", ") || "không có"}`);
  const mail = outbox.length
    ? await fs.readFile(path.join(outboxPath, outbox.find((n) => n.endsWith(".txt")) || outbox[0]), "utf8")
    : "";
  step("email có mã tra cứu và link tải", mail.includes(orderId) && /https?:\/\//.test(mail), `${mail.length} ký tự`);

  // 7. A wrong token is refused, with the same wording as a missing order, so the
  //    endpoint cannot be used to discover which ids exist.
  const wrong = await call(`${base}/api/orders/${orderId}/download?token=sai`, { headers: { "x-order-token": "sai" } });
  const missing = await call(`${base}/api/orders/SVD-KHONG-CO-XXXX/download?token=sai`, { headers: { "x-order-token": "sai" } });
  step("token sai bị từ chối", wrong.status === 404, `HTTP ${wrong.status}`);
  step("không lộ không tồn tại qua lỗi", wrong.status === missing.status, `${wrong.status} vs ${missing.status}`);

  // 8. Delivery. R2 is not reachable from here, so the signed URL is the part that
  //    is exercised: it proves the order is allowed to be delivered at all.
  const delivered = await markOrderDelivered(await getOrder(orderId));
  step("giao file và khóa đơn", Boolean(delivered?.deliveredAt) && delivered.status !== "paid", `status=${delivered?.status}`);

  // 9. A delivered order can still be refunded — the case that used to be
  //    impossible, because delivery resets the status to pending.
  const refunded = await voidPayment(await getOrder(orderId), "flow-test");
  step("đơn đã giao vẫn hoàn tiền được", refunded?.status === "refunded", `status=${refunded?.status}`);

  // 10. The review gate. Prose only, and only from a fulfilled, unrefunded order.
  const review = await call(`${base}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, accessToken, productId: product.id, body: "Dung de kiem tra luong don, chay tot va cac buoc sau hon." }),
  });
  step("đơn đã hoàn không viết được đánh giá", review.status === 409, `HTTP ${review.status}`);
} catch (error) {
  step("chạy xong không lỗi", false, error.message);
} finally {
  // Awaited. close() is asynchronous: without this the summary below could be printed
  // and then truncated by the process exiting, which turns a failure report into a
  // partial one. Null when the boot failed before a socket existed.
  if (server) await new Promise((resolve) => server.close(resolve));
  if (!live && process.env.DATA_DIR) await fs.rm(process.env.DATA_DIR, { recursive: true, force: true }).catch(() => {});
}

const failed = steps.filter((s) => !s.ok);
console.log(`\n${steps.length - failed.length}/${steps.length} buoc qua.`);
if (live) {
  console.log("Bước trên chạy trên server thật và có ghi dữ liệu. Một đơn sẽ được tạo.\nNếu bạn chỉ muốn xem có gì sai, dùng lệnh không có tham số.");
}
if (failed.length) {
  console.error("\nFAIL — phần chưa xác nhận được:");
  for (const f of failed) console.error(`  ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  process.exit(1);
}
console.log("\nPASS.\nChưa kiểm chứng được: PayPal có gọi webhook về không. Chỉ một khoản thanh toán thật mới trả lời được, và bước đó không có bằng cách miễn phí.");