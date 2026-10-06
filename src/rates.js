import { env } from "./config.js";

const SOURCES = env.rates.sourceUrls;

const cache = { rate: 0, fetchedAt: 0, inflight: null };
const isFresh = (ttlMs) => cache.rate > 0 && Date.now() - cache.fetchedAt < ttlMs;
const valid = (rate) => Number.isFinite(rate) && rate > 1000 && rate < 1000000;

async function fetchFrom(source) {
  const response = await fetch(source, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`rate source ${source} returned ${response.status}`);
  const payload = await response.json();
  const rate = Number(payload?.rates?.VND);
  if (!valid(rate)) throw new Error(`rate source ${source} returned no usable VND rate`);
  return rate;
}

async function refresh() {
  let lastError = null;
  for (const source of SOURCES) {
    try {
      const rate = await fetchFrom(source);
      cache.rate = rate;
      cache.fetchedAt = Date.now();
      return rate;
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Không lấy được tỷ giá");
}

/**
 * VND per 1 USD. Uses a live rate when PAYPAL_VND_TO_USD_RATE is set to "live",
 * otherwise the fixed number from config. Falls back to the fixed number so a
 * rate outage can never block checkout.
 */
export async function vndPerUsd() {
  if (env.paypal.vndToUsdRate !== "live") {
    return { rate: env.paypal.vndToUsdRate, source: "config" };
  }
  const ttlMs = Math.max(60, env.paypal.rateTtlSeconds) * 1000;
  if (isFresh(ttlMs)) return { rate: cache.rate, source: "cache" };
  cache.inflight ||= refresh().finally(() => { cache.inflight = null; });
  try {
    return { rate: await cache.inflight, source: "live" };
  } catch (error) {
    if (cache.rate > 0) return { rate: cache.rate, source: "stale-cache" };
    console.error(`[rates] live lookup failed, using fallback: ${error.message}`);
    return { rate: env.paypal.rateFallback, source: "fallback" };
  }
}

/** Applies the optional safety margin so rounding never eats the seller's revenue. */
export const rateForCharge = (rate) => rate * (1 + env.paypal.rateMarginPercent / 100);
