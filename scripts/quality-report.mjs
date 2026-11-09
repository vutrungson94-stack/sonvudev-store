// Summarize [quality] beacon lines emitted by POST /api/quality (src/app.js).
//
// Usage:
//   node scripts/quality-report.mjs < logfile.txt
//   node scripts/quality-report.mjs path/to/logfile.txt
//   render logs --tail 500 | node scripts/quality-report.mjs
//
// The endpoint logs one JSON object per beacon: metric numbers (lcp/cls/ttfb/
// fid/inp, ms except cls), pathname/url, and errorCount. No PII is logged.
// This script prints counts and simple aggregates (avg, p75 where useful) to
// help spot regressions; it does not replace a real RUM dashboard.
import fs from "node:fs";

function readInput(file) {
  if (file) return fs.readFileSync(file, "utf8");
  return fs.readFileSync(0, "utf8");
}

function parseQualityLines(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const idx = line.indexOf("[quality]");
    if (idx === -1) continue;
    const json = line.slice(idx + "[quality]".length).trim();
    if (!json) continue;
    try {
      rows.push(JSON.parse(json));
    } catch {
      // ignore malformed lines
    }
  }
  return rows;
}

function nums(rows, key) {
  return rows.map((r) => r[key]).filter((v) => typeof v === "number" && Number.isFinite(v));
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function fmt(v, digits = 0) {
  return typeof v === "number" ? v.toFixed(digits) : "n/a";
}

const input = readInput(process.argv[2]);
const rows = parseQualityLines(input);

if (!rows.length) {
  console.log("No [quality] lines found.");
  process.exit(0);
}

const metrics = ["lcp", "cls", "ttfb", "fid", "inp"];
console.log(`[quality-report] beacons=${rows.length}`);
for (const m of metrics) {
  const v = nums(rows, m);
  if (!v.length) continue;
  const digits = m === "cls" ? 3 : 0;
  console.log(`  ${m}: n=${v.length} avg=${fmt(avg(v), digits)} p75=${fmt(percentile(v, 75), digits)} max=${fmt(Math.max(...v), digits)}`);
}
const errRows = rows.filter((r) => typeof r.errorCount === "number" && r.errorCount > 0);
const totalErrors = rows.reduce((s, r) => s + (typeof r.errorCount === "number" ? r.errorCount : 0), 0);
console.log(`  js_errors: beacons_with_errors=${errRows.length} total=${totalErrors}`);

const byUrl = new Map();
for (const r of rows) {
  const u = typeof r.url === "string" && r.url ? r.url : "(unknown)";
  byUrl.set(u, (byUrl.get(u) || 0) + 1);
}
const top = [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
if (top.length) {
  console.log("  top_paths:");
  for (const [u, n] of top) console.log(`    ${n}  ${u}`);
}
