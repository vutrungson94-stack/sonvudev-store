import { env } from "./config.js";

// Tells the search engines that support IndexNow that a URL changed, at the
// moment it changed.
//
// Without this, a new product or a new price sits unseen until the next crawl,
// which on a small store can be days. IndexNow is a free plain POST, needs no
// API account, and is honoured by Bing, Yandex, Naver, Seznam and several
// others. Google does not support it yet, so this complements the sitemap
// rather than replacing it: the sitemap is what Google reads.
//
// The key file is the whole proof of ownership. Bing fetches /<key>.txt from
// the site root and compares the body with the key it was issued, so the file
// has to be reachable over plain HTTPS on the same host as the URLs submitted.

const ENDPOINT = env.indexNow.endpoint;
const TIMEOUT_MS = 8000;
const KEY_PATTERN = /^[a-z0-9-]{8,128}$/i;

/** The key becomes part of a public URL, so anything else is refused up front. */
export const isValidIndexNowKey = (key) => KEY_PATTERN.test(String(key || "").trim());

export const isIndexNowConfigured = () => isValidIndexNowKey(env.site.indexNowKey);

/** Same-origin absolute URL for anything the store owns. */
export const siteUrl = (path = "/") => {
  const base = env.appUrl.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
};

/**
 * Announces that these paths changed. Never throws and never blocks on the
 * caller's result: a product edit must not fail because a search engine is slow
 * or down, and a lost ping costs one crawl cycle, not a sale.
 */
export async function pingIndexNow(paths = [], { fetchImpl = fetch } = {}) {
  if (!isIndexNowConfigured()) return { sent: false, reason: "not-configured" };
  const host = (() => {
    try { return new URL(env.appUrl).host; } catch { return ""; }
  })();
  if (!host) return { sent: false, reason: "bad-app-url" };
  const urls = [...new Set(paths.filter((item) => typeof item === "string" && item.startsWith("/")))].map(siteUrl);
  if (!urls.length) return { sent: false, reason: "nothing-to-send" };
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key: env.site.indexNowKey, keyLocation: siteUrl(`/${env.site.indexNowKey}.txt`), urlList: urls }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return { sent: true, count: urls.length };
    // 422 means the key file is not where it should be. That is a setup problem
    // the owner can fix, so it is worth saying out loud rather than dropping.
    console.warn(`[indexnow] HTTP ${response.status} for ${urls.join(", ")}`);
    return { sent: false, reason: `http-${response.status}` };
  } catch (error) {
    console.warn(`[indexnow] not delivered: ${error.message}`);
    return { sent: false, reason: error.name === "TimeoutError" ? "timeout" : "network" };
  }
}
