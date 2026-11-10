// Generates the screenshots the web app manifest points at.
//
// Why they are pictures of the real site and not drawings of it: the richer
// PWA install UI shows these images in the install dialog, so an illustration
// would be a lie about what the shopper is installing.
//
// The screenshots are committed, like og.png and the launcher icons, and this
// script is how they are refreshed when the design changes:
//
//   node scripts/make-pwa-screenshots.mjs --url https://<your-domain>
//
// The domain comes from APP_URL (or --url), never from a literal: a script
// that carries the shop's address is a script that keeps pointing at the shop
// after the shop has moved.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "screenshots");

const urlFlag = process.argv.indexOf("--url");
const target = urlFlag !== -1 ? process.argv[urlFlag + 1] : process.env.APP_URL;
const site = target || "http://127.0.0.1:4173/";

// The two shapes the install UI needs: a wide one for a desktop and a narrow
// one for a phone. Chrome warns in DevTools when one of them is missing.
//
// The scale is 1 on purpose: the manifest declares the pixel size of the file,
// so a 2x phone screenshot would have to be declared as 780x1688 while the
// install dialog shows it at 390 logical pixels. One size, one number, no
// second place to be wrong.
const SHOTS = [
  { name: "desktop-1280x800.png", width: 1280, height: 800, mobile: false, scale: 1 },
  { name: "mobile-390x844.png", width: 390, height: 844, mobile: true, scale: 1 },
];

const BROWSERS = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const browser = BROWSERS.find((candidate) => existsSync(candidate));
if (!browser) {
  console.log("[pwa-screenshots] skipped: không tìm thấy Chrome/Edge (đặt CHROME_PATH để chạy). Ảnh đã commit vẫn dùng được.");
  process.exit(0);
}

const port = 9222 + Math.floor(Math.random() * 500);
const profile = path.join(root, ".gbuildcache", `pwa-shots-${process.pid}`);
mkdirSync(profile, { recursive: true });

const child = spawn(browser, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  "--disable-extensions",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cdpEndpoint() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const info = await response.json();
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    } catch {
      // The browser is still starting.
    }
    await sleep(250);
  }
  return null;
}

/** A DevTools protocol session on the browser target. */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    const events = new Map();

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve: done, reject: fail } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) fail(new Error(message.error.message));
        else done(message.result);
        return;
      }
      const listeners = events.get(message.method) || [];
      listeners.forEach((listener) => listener(message.params));
    });
    socket.addEventListener("error", reject);
    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}, sessionId) {
          const id = ++nextId;
          const payload = { id, method, params };
          if (sessionId) payload.sessionId = sessionId;
          socket.send(JSON.stringify(payload));
          return new Promise((done, fail) => pending.set(id, { resolve: done, reject: fail }));
        },
        on(method, listener) {
          const listeners = events.get(method) || [];
          listeners.push(listener);
          events.set(method, listeners);
        },
        close() { socket.close(); },
      });
    });
  });
}

try {
  const wsUrl = await cdpEndpoint();
  if (!wsUrl) throw new Error("không kết nối được với DevTools protocol");
  const client = await connect(wsUrl);

  for (const shot of SHOTS) {
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });

    await client.send("Page.enable", {}, sessionId);
    await client.send("Network.enable", {}, sessionId);
    // The shop sends a language redirect: a visitor whose browser asks for
    // English is sent to /en/. The screenshots are of the Vietnamese
    // storefront — this is a Vietnamese shop — so the request asks for
    // Vietnamese, the way a Vietnamese visitor's browser does.
    await client.send("Network.setExtraHTTPHeaders", {
      headers: { "Accept-Language": "vi-VN,vi;q=0.9" },
    }, sessionId);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: shot.width,
      height: shot.height,
      deviceScaleFactor: shot.scale,
      mobile: shot.mobile,
    }, sessionId);
    if (shot.mobile) {
      // A phone without a touch screen and without a mouse is a different
      // browser: this is what makes the layout collapse the way it does on a
      // real device.
      await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
      await client.send("Emulation.setUserAgentOverride", {
        userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
        acceptLanguage: "vi-VN,vi;q=0.9",
      }, sessionId);
    }

    const loaded = new Promise((resolve) => client.on("Page.loadEventFired", resolve));
    await client.send("Page.navigate", { url: site }, sessionId);
    await loaded;
    // The catalogue is fetched after load; the screenshot has to show products,
    // not three grey placeholder cards.
    await sleep(2500);

    const { data } = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, shot.name);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`[pwa-screenshots] ${shot.name} <- ${site} (${shot.width}x${shot.height}@${shot.scale}x)`);

    await client.send("Target.closeTarget", { targetId });
  }

  client.close();
} catch (error) {
  console.error(`[pwa-screenshots] FAIL: ${error.message}`);
  child.kill();
  process.exit(1);
} finally {
  child.kill();
}
