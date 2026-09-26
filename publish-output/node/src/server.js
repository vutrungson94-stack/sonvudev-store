import { createApp } from "./app.js";
import { env } from "./config.js";
import { persistenceMode } from "./store.js";

const app = await createApp();
const server = app.listen(env.port, env.host, () => {
  console.log(`SonVuDev Store running at ${env.appUrl}`);
  console.log(`Listening on ${env.host}:${env.port}`);
  console.log(`Persistence: ${persistenceMode}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Không thể khởi động: cổng ${env.port} đang được sử dụng.`);
    console.error(`Đóng tiến trình cũ hoặc đổi PORT trong ${"D:/SonVuDev-Upload/.env"}.`);
  } else {
    console.error("Không thể khởi động SonVuDev Store:", error.message);
  }
  process.exitCode = 1;
});

