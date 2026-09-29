import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, mkdir } from "node:fs/promises";
import dotenv from "dotenv";

// Sends the real order emails so the sender address, the domain and the
// templates can all be checked from a real inbox, without deploying anything.
// `npm run email:check -- ban@example.com [created|expiring|cancelled|paid]`

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), override: true });

const to = (process.argv[2] || "").trim();
const which = (process.argv[3] || "created").trim();
const TEMPLATES = ["created", "expiring", "cancelled", "paid"];

if (!to) {
  console.error("Cần địa chỉ nhận: npm run email:check -- ban@example.com [created|expiring|cancelled|paid]");
  process.exit(1);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.error(`Địa chỉ không hợp lệ: ${to}`);
  process.exit(1);
}
if (!TEMPLATES.includes(which)) {
  console.error(`Loại thư không hợp lệ. Chọn một trong: ${TEMPLATES.join(", ")}`);
  process.exit(1);
}

const { env, isConfigured } = await import("../src/config.js");
const { notifyMode, outboxPath, notifyOrder, previewMessage } = await import("../src/notify.js");

if (!isConfigured.email) {
  console.error("Chưa có RESEND_API_KEY trong .env nên không thể gửi thật.");
  console.error(`Thư vẫn được ghi ra: ${outboxPath}`);
  process.exit(1);
}

// A realistic order, because the templates fill in amounts, deadlines and the
// lookup code. An empty placeholder would hide exactly the mistakes this script
// exists to catch.
const now = new Date();
// A fresh order id per run. The send is protected by an idempotency key of
// order id plus template, so reusing one id would make Resend reject the second
// run as a duplicate with a changed body, which reads as a failure but is not
// one.
const stamp = Date.now().toString(36).toUpperCase();
const order = {
  id: `SVD-TEST-${stamp}`,
  status: which === "paid" ? "paid" : "pending_transfer",
  customerEmail: to,
  customerName: "Nguyễn Văn Test",
  amount: 199000,
  currency: "VND",
  paidAt: which === "paid" ? now.toISOString() : null,
  expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  items: [{ name: "Sản phẩm Test", version: "1.0.0" }],
  notifications: {},
};

// The same bytes that went out, saved so the layout can be opened in a browser.
const message = previewMessage(order, which);
const previewDir = path.join(root, "data", "email-preview");
await mkdir(previewDir, { recursive: true });
const file = path.join(previewDir, `${which}.html`);
await writeFile(file, message.html, "utf8");
await writeFile(file.replace(/\.html$/, ".txt"), message.text, "utf8");

const result = await notifyOrder(order, which, `test-${which}`);
if (!result.sent) {
  console.error(`Không gửi được (${result.reason}). Kiểm tra key và domain đã verify chưa.`);
  process.exit(1);
}

console.log(`Đã gửi thư "${which}" tới ${to}.`);
console.log(`Tiêu đề : ${message.subject}`);
console.log(`Từ      : ${env.email.from}`);
console.log(`Trả lời : ${env.email.supportEmail}`);
console.log(`Xem HTML: ${file}`);
console.log("Theo dõi: https://resend.com/emails");
