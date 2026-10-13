// Keeps the shop awake while anybody could plausibly be shopping, and lets it sleep
// otherwise.
//
// WHY THIS EXISTS
//
// Render's free tier puts a web service to sleep after 15 minutes without inbound
// traffic, and waking it takes about a minute. Nothing in the free tier can change
// that: there is no wake API, no minimum-instance setting, and no way to hold a
// free service open. A request wakes it — that is the entire mechanism — so
// anything that can make an HTTP request can keep it awake, and that is all this
// does.
//
// WHAT THE BUYER'S OWN BROWSER ALREADY DOES
//
// Most of this is already solved, by code that was written for a different reason
// and turned out to be the right answer here:
//
//   * Clicking "buy" IS the wake. It is an inbound request; nothing to build.
//
//   * Concurrency is already deduplicated. Ten people clicking buy during one cold
//     start produce one instance and ten queued requests, not ten wake-ups. There
//     is nothing to dedupe and nothing to rate-limit.
//
//   * The order page polls every 10 seconds and stops when the order is paid or
//     closed (public/order.js:114). That is already "stay awake until payment
//     finishes", implemented, costing nothing.
//
//   * The PayPal approval link navigates the same tab (public/app.js:286), and the
//     return page polls every 5 seconds. When the buyer approves, PayPal's webhook
//     POSTs to /api/paypal/webhook — also an inbound request, also a wake. So the
//     completion of a payment wakes the shop by itself.
//
// Nothing here is load-bearing for correctness. With this Worker deleted the shop
// still takes every order; the first visitor to a sleeping instance just waits
// about a minute for it to start. This only removes that wait, and only during the
// hours it is likely to happen.
//
// WHY A WORKER AND NOT THE EXISTING GITHUB ACTIONS CRON
//
// The cadence that would hold a Render service awake is under 15 minutes. On a
// private repository, GitHub Free includes 2,000 Actions minutes per month and
// bills a scheduled run as a whole minute: every 10 minutes is 4,320 runs, which
// exhausts the quota around the fourteenth of the month. Every 20 minutes fits the
// quota and is too slow to prevent the sleep. There is no interval that both fits
// 2,000 minutes and beats 15 minutes, which is why keep-awake.yml is on a 30
// minute cron and cannot be changed into a keeper.
//
// Cloudflare Workers cron triggers are free, run on one-minute granularity, and
// each invocation is one request against the 100,000/day free quota. This account
// already has Cloudflare for R2 and the domain, so it needs no new account and no
// card.
//
// WHY A WINDOW AND NOT ALWAYS ON
//
// A service never put to sleep consumes all 744 hours of a 31-day month against a
// 750-hour allowance — six hours of slack, with no margin for a deploy, a crash
// loop, or a month that has 31 days. Exceeding it does not overage-bill; Render
// suspends every free service in the workspace until the first of the next month,
// which for a shop means a month of downtime.
//
// So the window is the hours people actually shop in Asia/Ho_Chi_Minh: 05:00 to
// 24:00 ICT is 19 hours a day, 589 instance-hours in a 31-day month, leaving 161
// hours of margin — over a fifth of the allowance. Nights are spent asleep.
// Widen AWAKEN_FROM/AWAKEN_TO if your buyers are elsewhere — this is the one
// number here that is genuinely shop-specific, and it is the reason the window
// exists instead of a flat always-on.
//
// A buyer outside the window gets a cold start. That is the trade, and it is a
// minute of waiting rather than an order that fails.

// Asia/Ho_Chi_Minh has no daylight saving and has been UTC+7 since 2011, so the
// offset is a constant rather than something to look up on every invocation. If
// that ever changes, this is the one line to fix.
const ICT_OFFSET_HOURS = 7;

/**
 * Whether a given instant falls inside the waking window, in shop-local time.
 *
 * Split out from the fetch so it can be tested directly. The two ends are hours
 * in ICT, and the window is half-open — [from, to) — so that an end equal to the
 * start means "never" rather than "all day", which is what a naive inclusive
 * comparison would produce.
 *
 * @param {number} nowMs the instant to test
 * @param {number} fromHour first hour of the window, ICT, 0-23
 * @param {number} toHour hour the window closes, ICT, 0-23
 * @returns {boolean} true when the shop should be awake
 */
export function withinWindow(nowMs, fromHour, toHour) {
  const ict = new Date(nowMs + ICT_OFFSET_HOURS * 3600_000);
  const hour = ict.getUTCHours();
  if (fromHour === toHour) return false;
  // A window that wraps past midnight — 22 to 6, say — is expressed as from > to
  // rather than being rejected at configuration time, because late-night and
  // early-morning trading is a real thing for a shop that sells software.
  return fromHour < toHour ? hour >= fromHour && hour < toHour : hour >= fromHour || hour < toHour;
}

/**
 * One ping of the shop's health endpoint.
 *
 * Reports rather than throws. This Worker exists to keep a service warm, and a
 * Worker that throws on a slow response would retry on its own schedule and turn
 * one slow health check into a loop against a shop that is merely slow.
 *
 * @param {string} shopUrl the shop's base URL, without /api/health
 * @param {number} [timeoutMs] how long to wait before giving up on this ping
 * @returns {Promise<{ok: boolean, status: number, detail: string}>}
 */
export async function ping(shopUrl, timeoutMs = 10_000) {
  const url = `${shopUrl.replace(/\/$/, "")}/api/health`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'sonvudev-keep-awake/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json().catch(() => ({}));
    // `ok` is checked separately from the status code on purpose: the endpoint
    // answers 200 with ok:false when a dependency is down, and a keeper that only
    // looked at the number would report success on a shop that cannot take orders.
    if (response.status !== 200) return { ok: false, status: response.status, detail: `HTTP ${response.status}` };
    if (body && body.ok === false) return { ok: false, status: 200, detail: `ok:false — ${JSON.stringify(body.checks)}` };
    return { ok: true, status: response.status, detail: 'ok' };
  } catch (error) {
    return { ok: false, status: 0, detail: error.name === 'TimeoutError' ? 'timeout' : (error.message || 'error') };
  }
}

export default {
  /**
   * Runs once a minute. Returns the outcome so it appears in Workers Logs without
   * needing console.log — a log nobody reads is the same as no log.
   *
   * `event.scheduledTime` is used rather than Date.now() because it is the time
   * the trigger was due, which is what makes the log line line up with the cron
   * entry when several are in flight.
   */
  async scheduled(event, env, context) {
    const shopUrl = (env.SHOP_URL || '').trim();
    if (!shopUrl) {
      // A misconfigured keeper that pings nothing is worse than no keeper, because
      // it looks healthy from the dashboard. Said once, loudly, then silent.
      if (!context.__warned) {
        console.error('[keep-awake] SHOP_URL chưa được đặt. Worker này không làm gì cả — ping một địa chỉ rỗng.');
        context.__warned = true;
      }
      return { skipped: 'no-shop-url' };
    }

    const fromHour = Number(env.AWAKEN_FROM ?? 5);
    const toHour = Number(env.AWAKEN_TO ?? 24);
    const at = event?.scheduledTime ?? Date.now();
    if (!withinWindow(at, fromHour, toHour)) {
      return { skipped: 'outside-window', ictHour: new Date(at + ICT_OFFSET_HOURS * 3600_000).getUTCHours() };
    }

    const result = await ping(shopUrl);
    // Only the unhappy path is logged. A ping every minute for 17 hours is about a
    // thousand lines a day, and a log that is always full is a log nobody opens.
    if (!result.ok) {
      console.error(`[keep-awake] ${shopUrl} -> ${result.detail} (HTTP ${result.status})`);
    }
    return result;
  },
};