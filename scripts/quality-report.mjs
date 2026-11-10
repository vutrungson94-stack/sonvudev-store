// The field data: what real visitors measured, and whether it is good.
//
// Usage:
//   node scripts/quality-report.mjs < logfile.txt
//   node scripts/quality-report.mjs path/to/logfile.txt
//   render logs --tail 5000 | node scripts/quality-report.mjs
//
// The endpoint logs one JSON object per beacon: metric numbers (lcp/cls/ttfb/
// fid/inp, ms except cls), pathname/url, and errorCount. No PII is logged.
// This script prints counts and simple aggregates (avg, p75 where useful) to
// help spot regressions; it does not replace a real RUM dashboard.
//
// WHY THIS EXISTS, next to a Lighthouse report that looks perfect
//
// Lighthouse measures a laboratory: one device, one network, one cold load.
// The number in the DevTools panel ("Local metrics") is that number, and the
// panel says so itself — "Simulating a device after the page loads can affect
// LCP. Reload the page for accurate LCP". The number that matters is the FIELD
// data: the 75th percentile over real visits, which is what a visitor actually
// gets and what Google ranks on.
//
// The site's own field data is the beacon in public/quality.js, posted to
// /api/quality on every page view. This script is how it is read: pipe the
// server log in, and the p75 of the real visitors comes out, next to the
// thresholds that decide whether it is good.
//
// The thresholds are the ones web.dev publishes for "good":
//   LCP <= 2500 ms, CLS <= 0.1, INP <= 200 ms, TTFB <= 800 ms
//
// Every run also appends a snapshot to metrics-quality-trends.json, so the
// field data becomes a series instead of a single reading. A series is what a
// control chart needs; a single reading is an anecdote.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trendsFile = path.join(root, "metrics-quality-trends.json");

// What "good" means, per web.dev. A field number is compared against these,
// not against the laboratory number.
const THRESHOLDS = {
  lcp: { limit: 2500, unit: "ms", label: "LCP" },
  cls: { limit: 0.1, unit: "", label: "CLS" },
  inp: { limit: 200, unit: "ms", label: "INP" },
  ttfb: { limit: 800, unit: "ms", label: "TTFB" },
};

function readInput(file) {
  if (file) return fs.readFileSync(file, "utf8");
  return fs.readFileSync(0, "utf8");
}

function parseQualityLines(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    // Two shapes of log line reach this script.
    //
    // A raw line, from `node src/server.js` writing to a file:
    //   [quality] {"url":"/","lcp":1200,...}
    //
    // And a JSON-wrapped line, which is what the host's log stream gives:
    //   {"level":"info","message":"[quality] {\"url\":\"/\",...}","timestamp":"..."}
    //
    // The wrapped shape is the one that matters — the host log is where the
    // field data actually is — and reading only the raw shape meant the report
    // found nothing in the very log it was written for.
    let candidates = [line];
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      try {
        const wrapped = JSON.parse(trimmed);
        if (typeof wrapped.message === "string") candidates = [wrapped.message];
      } catch {
        // Not a JSON line: fall back to the raw shape below.
      }
    }

    for (const candidate of candidates) {
      const idx = candidate.indexOf("[quality]");
      if (idx === -1) continue;
      const json = candidate.slice(idx + "[quality]".length).trim();
      if (!json) continue;
      try {
        rows.push(JSON.parse(json));
      } catch {
        // ignore malformed lines
      }
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
const snapshot = { generatedAt: new Date().toISOString(), beacons: rows.length, p75: {}, verdict: "unknown" };
let allGood = true;
let measured = 0;

for (const m of metrics) {
  const v = nums(rows, m);
  if (!v.length) continue;
  const digits = m === "cls" ? 3 : 0;
  const p75 = percentile(v, 75);
  console.log(`  ${m}: n=${v.length} avg=${fmt(avg(v), digits)} p75=${fmt(p75, digits)} max=${fmt(Math.max(...v), digits)}`);
  snapshot.p75[m] = Number(p75.toFixed(digits === 0 ? 0 : 3));

  // The verdict is about the FIELD number, against the published "good" line.
  const rule = THRESHOLDS[m];
  if (!rule) continue;
  measured += 1;
  const good = p75 <= rule.limit;
  if (!good) allGood = false;
  console.log(`      vs ${rule.label} <= ${rule.limit}${rule.unit}: ${good ? "GOOD" : "NEEDS WORK"}`);
}

if (measured > 0) snapshot.verdict = allGood ? "good" : "needs-work";
const errRows = rows.filter((r) => typeof r.errorCount === "number" && r.errorCount > 0);
const totalErrors = rows.reduce((s, r) => s + (typeof r.errorCount === "number" ? r.errorCount : 0), 0);
console.log(`  js_errors: beacons_with_errors=${errRows.length} total=${totalErrors}`);
snapshot.jsErrorBeacons = errRows.length;
snapshot.jsErrors = totalErrors;

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

// The series: one snapshot per run, so the field data can be charted and
// compared instead of read once and forgotten.
try {
  let history = { schema: 1, history: [] };
  try {
    history = JSON.parse(fs.readFileSync(trendsFile, "utf8"));
  } catch {
    // First run: the file does not exist yet.
  }
  if (!Array.isArray(history.history)) history.history = [];
  history.history.push(snapshot);
  if (history.history.length > 104) history.history = history.history.slice(-104);
  fs.writeFileSync(trendsFile, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  console.log(`  snapshot: metrics-quality-trends.json (${history.history.length} readings)`);
} catch (error) {
  console.log(`  snapshot not written: ${error.message}`);
}

process.exit(snapshot.verdict === "needs-work" ? 1 : 0);
