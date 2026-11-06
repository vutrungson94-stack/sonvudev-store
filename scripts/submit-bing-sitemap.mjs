/**
 * Submit the sitemap to Bing Webmaster Tools after a deploy/content change.
 *
 * Usage:
 *   npm run ops:bing
 *
 * Skips cleanly when BING_API_KEY is unset (there is more than one way to have
 * Bing crawls without this API), so it can live in a scheduled workflow without
 * failing an unrelated change.
 */
import { env } from "../src/config.js";

const BING_API = "https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch";
const SITE_URL = (process.env.SITE_URL || env.appUrl || "").replace(/\/$/, "");
if (!SITE_URL) {
  console.log("[skip] SITE_URL/APP_URL not set, skipping Bing sitemap submission.");
  process.exit(0);
}
const SITEMAP_URL = `${SITE_URL}/sitemap.xml`;
const apiKey = process.env.BING_API_KEY || "";
if (!apiKey) {
  console.log("[skip] BING_API_KEY not set, skipping Bing sitemap submission.");
  process.exit(0);
}

const response = await fetch(`${BING_API}?apikey=${encodeURIComponent(apiKey)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ siteUrl: SITE_URL, urlList: [SITEMAP_URL] }),
  signal: AbortSignal.timeout(30000),
});
const bodyText = await response.text().catch(() => "");
console.log(`[bing] Status: ${response.status}`);
if (bodyText) console.log(`[bing] Response: ${bodyText}`);
if (!response.ok) process.exitCode = 1;
