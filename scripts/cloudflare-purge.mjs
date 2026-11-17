// Purge the edge cache once a deploy has been certified by the live sha gate.
//
// Why: /api/health is deliberately uncached, so a green deploy check says
// nothing about the HTML at the edge. A purge before the SEO audit makes that
// audit measure the commit it just verified. No token is a no-op: a missing
// secret must not turn a healthy deploy red.
//
// Requires CLOUDFLARE_API_TOKEN (Zone:Zone:Read + Zone:Cache Purge:Edit) and
// APP_URL. The zone is derived from APP_URL; the live hostname is never typed
// into source. Usage: npm run cache:purge
import "dotenv/config";
import process from "node:process";

const API = "https://api.cloudflare.com/client/v4";
const token = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
const appUrl = (process.env.APP_URL || "").trim();

if (!token) {
  console.log("[cache:purge] CLOUDFLARE_API_TOKEN not set — skipping edge purge.");
  process.exit(0);
}
if (!appUrl) {
  console.error("[cache:purge] APP_URL is required when a token is set.");
  process.exit(1);
}

let zone;
try {
  zone = new URL(appUrl).hostname.replace(/^www\./, "");
} catch {
  console.error("[cache:purge] APP_URL is not a valid URL.");
  process.exit(1);
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method || "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    const errors = (payload.errors || []).map((e) => e.message || String(e)).join("; ");
    throw new Error(`${options.method || "GET"} ${path}: HTTP ${response.status} ${errors}`);
  }
  return payload.result;
}

const zones = await api(`/zones?name=${encodeURIComponent(zone)}&per_page=50`);
const match = zones.find((item) => item.name === zone && item.status === "active");
if (!match) {
  console.error(`[cache:purge] zone ${zone} not found or not active in this account.`);
  process.exit(1);
}
await api(`/zones/${match.id}/purge_cache`, {
  method: "POST",
  body: { purge_everything: true },
});
console.log(`[cache:purge] edge cache purged for ${zone}`);
