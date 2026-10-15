import { createApp } from "./app.js";
import path from "node:path";
import { env } from "./config.js";
import { persistenceMode, projectRoot } from "./store.js";
import { startSweeper, stopSweeper } from "./orders.js";
import { notifyMode } from "./notify.js";

const mailMode = notifyMode();

// The last thing between a bad Tuesday and a shop that is simply gone.
//
// Express 4 attaches no .catch() to an async route handler, so a rejected promise
// inside one is not a failed request — it is an unhandled rejection, and Node's
// default for one is to terminate the process. Four public routes reach the store
// without a try/catch, and a search engine visits /sitemap.xml on its own schedule:
// one slow query, one timeout, one malformed row, and the whole storefront goes
// down because a crawler asked for a file. Every other route in the file wraps
// itself; these two handlers are what the ones that were missed had.
//
// Log and keep serving, rather than exit. A request that failed is already a
// failure the caller can see; taking the process with it turns one failed request
// into a failed shop, which is strictly worse than the error we started with.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason instanceof Error ? reason.stack : reason);
});
process.on("uncaughtException", (error) => {
  // Unlike the rejection case, the process state after this is unknown: something
  // threw outside a promise and the program may be mid-write. Log, then leave —
  // the orchestrator restarts on a non-zero exit, and doing it ourselves while a
  // request is in flight would cut the response off mid-sentence.
  console.error("[uncaughtException]", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 1000).unref();
});

const app = await createApp();
const server = app.listen(env.port, env.host, () => {
  console.log(`${env.brand.name} store running at ${env.appUrl}`);
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
    console.warn("  Đặt RESEND_API_KEY rồi chạy: npm run render:sync:deploy");
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
    // The path is worked out from the project root rather than written in. It used
    // to name one developer's machine, so on every other computer the advice
    // pointed at a file that does not exist.
    console.error(`Đóng tiến trình cũ hoặc đổi PORT trong ${path.join(projectRoot, ".env")}.`);
  } else {
    console.error(`Không thể khởi động ${env.brand.name} store:`, error.message);
  }
  process.exitCode = 1;
});

