import { createApp } from "./app.js";
import { env } from "./config.js";
import { persistenceMode } from "./store.js";
import { startSweeper, stopSweeper } from "./orders.js";
import { notifyMode } from "./notify.js";

const mailMode = notifyMode();

const app = await createApp();
const server = app.listen(env.port, env.host, () => {
  console.log(`SonVuDev Store running at ${env.appUrl}`);
  console.log(`Listening on ${env.host}:${env.port}`);
  console.log(`Persistence: ${persistenceMode}`);
  console.log(`Unpaid orders are cancelled after ${env.orders.paymentWindowHours}h`);
  if (mailMode === "outbox") {
    // A store that accepts orders but sends no mail is not a store that can
    // recover an order after the buyer's device dies. This is the one line that
    // makes that visible instead of something discovered a month later.
    console.warn("");
    console.warn("  [CẢNH BÁO] RESEND_API_KEY chưa được cấu hình.");
    console.warn("  Email đơn hàng đang được ghi ra data/outbox, KHÔNG gửi tới khách.");
    console.warn("  Khách không nhận được xác nhận đơn, nhắc hết hạn, hay thông báo đã thanh toán.");
    console.warn("  Đặt RESEND_API_KEY rồi chạy: npm run render:sync -- --apply");
    console.warn("");
  } else {
    console.log(`Order mail: ${mailMode}`);
  }
  // Started on boot rather than on a timer that only exists once the process is
  // up, so a server that was down across a deadline still catches up.
  startSweeper();
});

const shutdown = () => {
  stopSweeper();
  server.close(() => process.exit(0));
  // A hung keep-alive connection must not block the restart forever.
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Không thể khởi động: cổng ${env.port} đang được sử dụng.`);
    console.error(`Đóng tiến trình cũ hoặc đổi PORT trong ${"D:/SonVuDev-Upload/.env"}.`);
  } else {
    console.error("Không thể khởi động SonVuDev Store:", error.message);
  }
  process.exitCode = 1;
});

