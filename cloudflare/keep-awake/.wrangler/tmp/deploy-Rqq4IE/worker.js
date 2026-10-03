var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var ICT_OFFSET_HOURS = 7;
function withinWindow(nowMs, fromHour, toHour) {
  const ict = new Date(nowMs + ICT_OFFSET_HOURS * 36e5);
  const hour = ict.getUTCHours();
  if (fromHour === toHour) return false;
  return fromHour < toHour ? hour >= fromHour && hour < toHour : hour >= fromHour || hour < toHour;
}
__name(withinWindow, "withinWindow");
async function ping(shopUrl, timeoutMs = 1e4) {
  const url = `${shopUrl.replace(/\/$/, "")}/api/health`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "sonvudev-keep-awake/1.0" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await response.json().catch(() => ({}));
    if (response.status !== 200) return { ok: false, status: response.status, detail: `HTTP ${response.status}` };
    if (body && body.ok === false) return { ok: false, status: 200, detail: `ok:false \u2014 ${JSON.stringify(body.checks)}` };
    return { ok: true, status: response.status, detail: "ok" };
  } catch (error) {
    return { ok: false, status: 0, detail: error.name === "TimeoutError" ? "timeout" : error.message || "error" };
  }
}
__name(ping, "ping");
var worker_default = {
  /**
   * Runs once a minute. Returns the outcome so it appears in Workers Logs without
   * needing console.log — a log nobody reads is the same as no log.
   *
   * `event.scheduledTime` is used rather than Date.now() because it is the time
   * the trigger was due, which is what makes the log line line up with the cron
   * entry when several are in flight.
   */
  async scheduled(event, env, context) {
    const shopUrl = (env.SHOP_URL || "").trim();
    if (!shopUrl) {
      if (!context.__warned) {
        console.error("[keep-awake] SHOP_URL chua duoc dat. Worker nay khong lam gi ca \u2014 ping mot dia chi rong.");
        context.__warned = true;
      }
      return { skipped: "no-shop-url" };
    }
    const fromHour = Number(env.AWAKEN_FROM ?? 5);
    const toHour = Number(env.AWAKEN_TO ?? 24);
    const at = event?.scheduledTime ?? Date.now();
    if (!withinWindow(at, fromHour, toHour)) {
      return { skipped: "outside-window", ictHour: new Date(at + ICT_OFFSET_HOURS * 36e5).getUTCHours() };
    }
    const result = await ping(shopUrl);
    if (!result.ok) {
      console.error(`[keep-awake] ${shopUrl} -> ${result.detail} (HTTP ${result.status})`);
    }
    return result;
  }
};
export {
  worker_default as default,
  ping,
  withinWindow
};
//# sourceMappingURL=worker.js.map
