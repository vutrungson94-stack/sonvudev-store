// Read-only edge-cache monitor. No Cloudflare token, no writes to Cloudflare.
//
// Cloudflare's `cf-cache-status` is the only honest answer to "is the edge
// actually caching us?": origin headers can say `public, max-age=31536000`
// while the edge still reports DYNAMIC on every request. This reads the live
// site twice per path so a first MISS followed by a HIT is recorded as such,
// and writes the result to metrics-cache-hit.json for the daily series.
//
// Usage: npm run cache:check [-- --strict]
// `--strict` exits 1 while any reading is not HIT; the default only measures.
import "dotenv/config";
import process from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const appUrl = (process.env.APP_URL || "").trim();
if (!appUrl) {
  console.error("[cache:check] APP_URL is required; the origin host is never typed into source.");
  process.exit(1);
}
const origin = appUrl.replace(/\/+$/, "");

// The product slug comes from the catalogue, not from a string kept here: the
// first active product is enough of a canary and cannot drift when the shop changes.
let productPath = null;
try {
  const catalog = JSON.parse(await readFile(path.join(root, "data", "products.json"), "utf8"));
  const product = (Array.isArray(catalog) ? catalog : catalog.products || []).find(
    (p) => p && p.status === "active" && p.slug,
  );
  if (product) productPath = `/product/${product.slug}`;
} catch {
  // No catalogue available: measure the pages that do not depend on it.
}

const targets = ["/", "/en/", "/styles.min.css", ...(productPath ? [productPath] : [])];
const results = [];
for (const target of targets) {
  const readings = [];
  for (let i = 0; i < 2; i += 1) {
    const response = await fetch(new URL(target, origin), {
      signal: AbortSignal.timeout(20000),
    });
    await response.arrayBuffer();
    readings.push({
      cache: response.headers.get("cf-cache-status") || "missing",
      age: response.headers.get("age") || null,
      cacheControl: response.headers.get("cache-control") || null,
      ray: response.headers.get("cf-ray") || null,
      status: response.status,
    });
  }
  results.push({ path: target, readings });
  console.log(`[cache:check] ${target}: ${readings.map((r) => r.cache).join(" -> ")}`);
}

const hits = results.reduce((n, r) => n + r.readings.filter((x) => x.cache === "HIT").length, 0);
const total = results.reduce((n, r) => n + r.readings.length, 0);
// The first request primes the edge: a MISS then HIT is a working cache, not a
// broken one. Counting only the second read answers the question the SLO asks
// ("does a repeat visitor get a cached response"), while the raw hitRate above
// stays in the file so the priming cost remains visible.
const steady = results.map((r) => r.readings[r.readings.length - 1]);
const steadyHits = steady.filter((x) => x.cache === "HIT").length;
const snapshot = {
  generatedAt: new Date().toISOString(),
  origin,
  hitRate: Number((hits / total).toFixed(3)),
  hits,
  total,
  steadyStateHitRate: Number((steadyHits / steady.length).toFixed(3)),
  steadyStateHits: steadyHits,
  steadyStateTotal: steady.length,
  results,
};
await writeFile(path.join(root, "metrics-cache-hit.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(
  `[cache:check] HIT ${hits}/${total} (cold reads included); `
  + `steady-state ${steadyHits}/${steady.length} (${(snapshot.steadyStateHitRate) * 100}%) -> metrics-cache-hit.json`,
);

if (process.argv.includes("--strict") && hits < total) process.exit(1);
