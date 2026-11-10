// Lighthouse as a gate.
//
// The Lighthouse numbers this repository used to react to came from a browser
// with extensions installed: the "unused JavaScript" finding was 443 KB of the
// Google Translate extension, which is not the shop's code and is not on the
// shopper's phone either. A finding nobody can act on is a finding that trains
// people to ignore the report.
//
// So the measurement runs in a clean, headless browser with extensions
// disabled, and the assertions are about **this** site: its own scores, its own
// metrics, and its own assets. Third-party bytes are reported, never failed on —
// the Cloudflare beacon is not ours to fix.
//
//   npm run lighthouse:check -- https://example.com
//   APP_URL=https://example.com npm run lighthouse:check
//
// Without a URL the check is skipped and exits 0, the way `npm run seo:check`
// behaves. That is safe only because CI checks for the missing secret itself
// before calling this — a gate that quietly inspects nothing and reports green
// is the failure this repository keeps having to undo.
//
// Lighthouse itself is NOT a dependency of this project. Adding it pulled in
// ~50 packages carrying licenses nobody in this project has read (MPL-2.0,
// FSL-1.1, BlueOak), and the license gate is right to stop on that. The tool is
// fetched at a pinned version instead, so the measurement is reproducible and
// the dependency surface of the storefront does not change.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = (process.argv[2] || process.env.APP_URL || "").trim();

if (!target) {
  console.log("[lighthouse] skipped: không có URL (truyền vào sau `npm run lighthouse:check -- <url>` hoặc đặt APP_URL).");
  process.exit(0);
}

const url = /^https?:\/\//i.test(target) ? target : `https://${target}`;
const LIGHTHOUSE_VERSION = "13.6.0";

// The thresholds. They start where the site actually is and are meant to be
// raised, not defended: a threshold that is never reached is a comment.
const THRESHOLDS = {
  scores: {
    performance: 0.85,
    accessibility: 0.9,
    "best-practices": 0.9,
    seo: 0.9,
  },
  metrics: {
    "largest-contentful-paint": 2500,
    "cumulative-layout-shift": 0.1,
    "total-blocking-time": 300,
  },
  // First-party assets. These are the site's own bytes and the site's own
  // promise about them.
  firstParty: {
    // The stylesheet is deliberately render-blocking (WORKFLOW.md 7.5: the
    // preload+defer pattern cost CLS 0.5), so a blocking stylesheet is not a
    // failure — but a webfont host coming back is.
    renderBlockingMs: 400,
    // Every first-party asset is versioned by content hash and cached for a
    // year. An asset that is not is a deploy that cannot reach the browser.
    cacheLifetimeMs: 31536000000,
    // app.js and i18n.js are minified by the build.
    minifyWastedBytes: 1024,
  },
};

const errors = [];
const warnings = [];
const notes = [];

// Run Lighthouse through its CLI at a pinned version and read the report it
// writes. The CLI is used rather than the Node API so that the tool is not a
// dependency of the storefront (see the note at the top of this file).
const reportPath = path.join(os.tmpdir(), `lighthouse-report-${process.pid}.json`);
const chromeFlags = [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  // The reason this gate exists: the extension that produced a 443 KB
  // "unused JavaScript" finding on a page that ships 180 KB of JavaScript.
  "--disable-extensions",
  "--disable-background-networking",
].join(" ");

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.on("error", reject);
  child.on("close", (code) => resolve({ code, stderr }));
});

// How to reach a pinned Lighthouse without making it a dependency.
//
// `npx` is a .cmd on Windows, and spawning a .cmd without a shell throws
// EINVAL — the check then fails on the machine that runs it and passes in CI,
// which is the worst kind of difference. So the npm CLI is run through node
// directly, which is the same npm, on every platform.
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const lighthouseArgs = [
  "--output=json",
  `--output-path=${reportPath}`,
  "--only-categories=performance,accessibility,best-practices,seo",
  "--preset=desktop",
  `--chrome-flags=${chromeFlags}`,
  "--quiet",
];

const lighthouseRun = existsSync(npmCli)
  ? await run(process.execPath, [npmCli, "exec", "--yes", `--package=lighthouse@${LIGHTHOUSE_VERSION}`, "--", "lighthouse", url, ...lighthouseArgs])
  : await run("npx", ["--yes", `lighthouse@${LIGHTHOUSE_VERSION}`, url, ...lighthouseArgs]);

let lhr = null;
try {
  lhr = JSON.parse(await readFile(reportPath, "utf8"));
} catch {
  // Fall through to the error below, with the CLI's own words attached.
}
await rm(reportPath, { force: true });

if (!lhr) {
  console.error(`[lighthouse] FAIL: không lấy được báo cáo từ ${url}`);
  console.error(lighthouseRun.stderr.trim().split("\n").slice(-8).join("\n"));
  process.exit(1);
}

// A report without categories is a report about a page that did not load —
// an unreachable URL, a redirect to nothing. It must never be read as "the
// scores were fine".
if (!lhr.categories || !lhr.categories.performance) {
  console.error(`[lighthouse] FAIL: không có điểm trong báo cáo — trang không tải được (${url}).`);
  process.exit(1);
}

const origin = new URL(lhr.finalDisplayedUrl || lhr.finalUrl || url).origin;
const isFirstParty = (itemUrl) => {
  if (!itemUrl) return false;
  try {
    return new URL(itemUrl, origin).origin === origin;
  } catch {
    return false;
  }
};

// Scores.
for (const [category, minimum] of Object.entries(THRESHOLDS.scores)) {
  const score = lhr.categories?.[category]?.score;
  const value = score == null ? null : score * 100;
  if (value == null) {
    errors.push(`${category}: không có điểm`);
  } else if (value < minimum * 100) {
    errors.push(`${category}: ${value.toFixed(0)} < ngưỡng ${(minimum * 100).toFixed(0)}`);
  } else {
    notes.push(`${category}: ${value.toFixed(0)} (ngưỡng ${(minimum * 100).toFixed(0)})`);
  }
}

// Metrics.
for (const [metric, limit] of Object.entries(THRESHOLDS.metrics)) {
  const audit = lhr.audits?.[metric];
  const value = audit?.numericValue;
  if (value == null) {
    warnings.push(`${metric}: không đo được`);
    continue;
  }
  if (value > limit) errors.push(`${metric}: ${value.toFixed(0)} > ngưỡng ${limit}`);
  else notes.push(`${metric}: ${value.toFixed(0)} (ngưỡng ${limit})`);
}

// Render-blocking resources: the site's own stylesheet is allowed to block;
// a third-party font host is not.
{
  const audit = lhr.audits?.["render-blocking-resources"];
  const items = audit?.details?.items || [];
  const blockingMs = items.reduce((sum, item) => sum + (item.wastedMs || 0), 0);
  const foreign = items.filter((item) => !isFirstParty(item.url));
  if (foreign.length > 0) {
    errors.push(`render-blocking: ${foreign.length} tài nguyên chặn render không thuộc origin này (${foreign.map((i) => i.url).join(", ")})`);
  }
  if (blockingMs > THRESHOLDS.firstParty.renderBlockingMs) {
    warnings.push(`render-blocking: ${blockingMs.toFixed(0)}ms > ${THRESHOLDS.firstParty.renderBlockingMs}ms`);
  } else {
    notes.push(`render-blocking: ${blockingMs.toFixed(0)}ms`);
  }
}

// Cache lifetime: every first-party asset must be cached for a year. The audit
// lists only the assets that FAIL the check, so an empty list is the good
// outcome — and an empty list must not be reported as "zero assets checked".
{
  const audit = lhr.audits?.["uses-long-cache-ttl"];
  const items = (audit?.details?.items || []).filter((item) => isFirstParty(item.url));
  const short = items.filter((item) => (item.cacheLifetimeMs || 0) < THRESHOLDS.firstParty.cacheLifetimeMs);
  if (short.length > 0) {
    errors.push(`cache: ${short.length} tài nguyên của site chưa cache 1 năm (${short.map((i) => i.url).join(", ")})`);
  } else {
    notes.push("cache: không tài nguyên nào của site bị báo cache ngắn hạn");
  }
}

// Minification: the two browser scripts the build minifies must be minified.
{
  const audit = lhr.audits?.["minify-javascript"];
  const items = (audit?.details?.items || []).filter((item) => isFirstParty(item.url));
  const wasteful = items.filter((item) => (item.wastedBytes || 0) > THRESHOLDS.firstParty.minifyWastedBytes);
  if (wasteful.length > 0) {
    errors.push(`minify: ${wasteful.map((i) => `${i.url} (-${i.wastedBytes}B)`).join(", ")}`);
  } else {
    notes.push("minify: không còn script của site nào bị chưa minify");
  }
}

// The two findings that are not the site's to fix, reported so they are not
// silently forgotten.
for (const [id, label] of [["legacy-javascript", "legacy JS"], ["unused-javascript", "unused JS"]]) {
  const audit = lhr.audits?.[id];
  const items = audit?.details?.items || [];
  const foreign = items.filter((item) => !isFirstParty(item.url));
  const mine = items.filter((item) => isFirstParty(item.url));
  if (foreign.length > 0) {
    notes.push(`${label}: ${foreign.length} mục của bên thứ ba (${foreign.map((i) => i.url).split("/").slice(0, 3).join("/")}).join(", ")}) — không phải của site`);
  }
  if (mine.length > 0) {
    // First-party unused JavaScript IS ours to fix: a script the page loads and
    // never uses is bytes the shopper waits for. The third-party ones above are
    // reported and left alone.
    warnings.push(`${label}: ${mine.length} mục thuộc site (${mine.map((i) => i.url).join(", ")}) — cần tách phần chỉ chạy khi khách tương tác, xem docs/CMMI-L5-ROADMAP.md`);
  }
}

// The fonts the page's own text needed.
//
// A Vietnamese page needs two subsets per family: latin and vietnamese. If the
// browser also fetches "latin-ext", then some character on the page falls
// outside both — a stray letter, a symbol nobody noticed — and the page pays
// 14-19 KB for it, late, on the critical path.
//
// The same finding appears in a browser with a translation extension, because
// the translated text is not the site's text any more. That is the extension's
// doing, not the site's, so the check below reads the fonts the page asked for
// and reports them; the failure it raises is the site's own.
{
  const requests = (lhr.audits?.["network-requests"]?.details?.items) || [];
  const fonts = [...new Set(requests.filter((item) => item.resourceType === "Font").map((item) => item.url.split("/").pop().split("?")[0]))];
  // The shop ships two subsets per family and no more. Any other font file the
  // page fetches is a subset that was added without anyone deciding whether it
  // is needed — and it is fetched late, on the critical path.
  const known = new Set([
    "be-vietnam-pro-latin.woff2",
    "be-vietnam-pro-vietnamese.woff2",
    "space-grotesk-latin.woff2",
    "space-grotesk-vietnamese.woff2",
  ]);
  const unexpected = fonts.filter((name) => !known.has(name));
  if (unexpected.length > 0) {
    errors.push(`font: trang tải subset không nằm trong danh sách (${unexpected.join(", ")}) — mỗi subset thừa là 14-19 KB tải muộn trên critical path`);
  } else {
    notes.push(`font: đúng 4 subset của shop (${fonts.length} file)`);
  }
}

// The report is kept: the next run compares against it, and a number that only
// exists in a log is a number nobody can trend.
const reportsDir = path.join(root, "build-reports");
await mkdir(reportsDir, { recursive: true });
const savedReportPath = path.join(reportsDir, `lighthouse-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(savedReportPath, JSON.stringify(lhr, null, 2), "utf8");

for (const note of notes) console.log(`[lighthouse] ${note}`);
for (const warning of warnings) console.warn(`[lighthouse] WARN ${warning}`);
for (const error of errors) console.error(`[lighthouse] FAIL ${error}`);
console.log(`[lighthouse] báo cáo: ${path.relative(root, savedReportPath)}`);

if (errors.length > 0) {
  console.error(`[lighthouse] FAIL: ${errors.length} vi phạm ngưỡng.`);
  process.exit(1);
}
console.log("[lighthouse] PASS");
process.exit(0);
