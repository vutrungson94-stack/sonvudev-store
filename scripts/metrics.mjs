// Measures the things this project has been changing silently, and fails when one
// of them moves the wrong way.
//
// Every gate in this repository is a pass or a fail at a point in time, which is
// what a build needs and what a process cannot use. "All tests passing" says
// nothing about whether the last change added coverage or removed it. Neither does
// "the audit is clean" say whether a fourth copy of the escape helper appeared, or
// whether a dependency was added on top of the three there were.
//
// So this records the numbers, writes them to a baseline file, and compares the
// next run against it. The direction of each threshold is chosen deliberately:
//   - tests, routes, translation keys and indexable pages must not go down
//   - dependencies and duplicate helpers must not go up
//
//   npm run metrics              compare against the baseline
//   npm run metrics:update      accept the current numbers as the new baseline
//   npm run metrics:auto        update baseline ONLY if all metrics improved or stayed same (no regressions)
//
// It is not a quality score. It is the minimum instrumentation needed to say
// whether this week was better than last week, which until now nobody could
// answer from the repository alone.
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkProjectFiles } from './lib/files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineFile = path.join(root, 'metrics-baseline.json');
const trendsFile = path.join(root, 'metrics-trends.json');
const update = process.argv.includes('--update');
const autoUpdate = process.argv.includes('--auto-update');
const showTrends = process.argv.includes('--trends');

const relative = (file) => path.relative(root, file).split(path.sep).join('/');
const read = (name) => readFile(path.join(root, name), 'utf8');
const exists = (file) => stat(file).then(() => true, () => false);

const walk = (dir, out = []) => walkProjectFiles(dir).then((found) => {
  for (const file of found) out.push(file);
  return out;
});

const files = await walk(root);
const inSrc = (f) => f.includes(`${path.sep}src${path.sep}`);
const inPublic = (f) => f.includes(`${path.sep}public${path.sep}`);
const inTest = (f) => f.includes(`${path.sep}test${path.sep}`);

const srcFiles = files.filter((f) => inSrc(f) && f.endsWith('.js'));
const publicJs = files.filter((f) => inPublic(f) && f.endsWith('.js'));
const publicHtml = files.filter((f) => inPublic(f) && f.endsWith('.html'));
const testFiles = files.filter((f) => inTest(f) && f.endsWith('.test.js'));

const [srcText, publicText, testText, publicHtmlText] = await Promise.all([
  Promise.all(srcFiles.map((f) => readFile(f, 'utf8'))),
  Promise.all(publicJs.map((f) => readFile(f, 'utf8'))),
  Promise.all(testFiles.map((f) => readFile(f, 'utf8'))),
  Promise.all(publicHtml.map((f) => readFile(f, 'utf8'))),
]);

const appSource = srcText[srcFiles.findIndex((f) => relative(f) === 'src/app.js')] || '';
const i18nText = publicText[publicJs.findIndex((f) => relative(f) === 'public/i18n.js')] || '';

const countCopies = (text, pattern) => (text.match(pattern) || []).length;

// Shared-helper implementations are counted per file, never per occurrence: one
// file holding the marker twice is still one copy, and the money formatter holds
// it twice by design (USD styled, everything else grouped). See the note on the
// escCopies row for what counting occurrences cost the first time.
const filesWithMarker = (serverTexts, browserTexts, pattern) =>
  [...serverTexts, ...browserTexts].filter((text) => pattern.test(text)).length;
const totalTests = testText.reduce((sum, source) => sum + countCopies(source, /^test\(/gm), 0);
const routes = new Set([...appSource.matchAll(/app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g)]
  .map((match) => `${match[1].toUpperCase()} ${match[2]}`));

const manifest = JSON.parse(await read('package.json'));
const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

// Each row is [key, value, direction]. "up" means a fall is a regression; "down"
// means a rise is one.
const rows = [
  ['tests', totalTests, 'up', 'số test có tên'],
  ['testFiles', testFiles.length, 'up', 'số file test'],
  ['routes', routes.size, 'up', 'route Express dang ky'],
  ['dependencies', dependencies.length, 'down', 'phụ thuộc npm'],
  // Counts real implementations, not the aliases that call the shared one. An
  // escape function that was written twice and drifted is the exact failure this
  // number exists to catch, and it cannot be satisfied the way a test can — by
  // aliasing one function under two names.
  //
  // Four are expected and each is a separate runtime: src/format.js (server),
  // public/i18n.js and public/admin.js (browsers, and admin deliberately does not
  // load i18n.js), public/related.js (a standalone loader on the 404 page). The
  // server used to have two of them.
  // Counts implementations by a string only they contain, so it cannot be fooled by
// aliasing one function under two names and does not depend on what each file
// happened to call its local.
//
// An escape helper that was written twice and drifted is the exact failure this
// number exists to catch. One remains, one per runtime: src/format.js (server)
// and public/format.js (browsers, loaded before every page that needs it).
// public/i18n.js, public/admin.js and public/related.js all call through
// window.SVDFormat instead of carrying their own.
//
// Counted PER FILE, not per occurrence, and that correction is not cosmetic. The
// money formatter styles USD one way and everything else another, so a single
// implementation contains the marker twice — the counter used to report four
// for two implementations, and the number then rose by two when both runtimes
// gained the second branch while nothing was duplicated at all. A metric whose
// value moves for a reason unrelated to what it claims to count is worse than
// no metric: the builds read it, and one wrong direction is all a reader needs
// to stop trusting the rest of the list.
['escCopies', filesWithMarker(srcText, publicText, /&quot;/), 'down', 'bản sao hàm escape'],
['moneyCopies', filesWithMarker(srcText, publicText, /style:\s*['"]currency['"]/), 'down', 'bản sao hàm định dạng tiền'],
// The same counter for the two helpers that were shared across three call
// sites in two runtimes and counted nowhere: initials (the product icon) and
// the byte formatter (the release file size). Both existed as src/pages.js
// (server), public/app.js (browser card) and public/admin.js (panel) copies,
// and the panel's icon had already drifted — it took the first two characters
// of a name, so "Ram Cleaner" showed "RA" against the storefront's "RC".
//
// Counted the same way esc and money are: by a marker string only a real
// implementation contains, so a thunk that calls the shared one — the shape
// app.js and admin.js now use — does not count, and a third copy fails the
// build. Two are expected, one per runtime, held in step by the tests in
// test/shared-libs.test.js.
['initialsCopies', filesWithMarker(srcText, publicText, /["']SV["']/), 'down', 'bản sao hàm initials'],
['sizeCopies', filesWithMarker(srcText, publicText, /["']KB["']/), 'down', 'bản sao hàm định dạng byte'],
  ['i18nKeys', countCopies(i18nText, /^\s{4}'[\w.]+':/gm), 'up', 'khóa i18n'],
  // A page that allows indexing is a page a crawler can be pointed at. Losing one
  // is a silent loss of traffic that no other check would notice.
  ['indexablePages', publicHtmlText.filter((body) => /index,follow/.test(body)).length, 'up', 'trang cho phép index'],
  ['productPageLocales', countCopies(appSource, /productPage\("(?:vi|en)"\)/g), 'up', 'ngôn ngữ trang sản phẩm'],
  // How many pages carry the dictionary.
  //
  // One does not, and it is the right one: admin.html is Vietnamese on purpose. It is
  // the owner's console rather than a shopfront, it handles money, and the dictionary
  // deliberately does not load there (see the note at the top of public/i18n.js).
  // Nine of ten customer-facing pages are translated; the tenth is not a customer.
  //
  // The three legal pages and about.html were the ones missing until recently: no
  // dictionary, no toggle, every sentence a literal. They are the pages a buyer reads
  // before paying, so an English buyer who mistyped /terms was told in Vietnamese what
  // they had agreed to. Closing that was the point of counting it.
  //
  // The count moved from 5 to 9 while a note elsewhere in this file was still naming
  // the 404 as untranslated. The 404 has carried <script src="i18n.js"> and a working
  // toggle for some time, and public/related.js still claimed in a comment that it
  // could not read the shared dictionary because the 404 has no switch — both facts
  // false, and both about the page a visitor sees last. The number was right; the list
  // beside it was not, which is the worse half, because a list is what someone reads to
  // decide what to work on next. It now names admin.html and says why.
  //
  // The direction is "up", so a page that loses its dictionary is a regression the same
  // way a deleted test is. Nothing stops the count reaching 10 — that would mean the
  // admin console had been translated too, which is a decision for the owner and not
  // for a metric.
  ['localizedPages', publicHtmlText.filter((body) => /<script src="i18n\.js">/.test(body)).length, 'up', 'trang có từ điển'],
  // One route serving two languages. It was one, then two pages with a renderer
  // between them that only ever spoke Vietnamese, and the English copy sat unused
  // in the database the whole time.
  ['productPageRenderers', countCopies(await read('src/pages.js'), /export function renderProductPage/g), 'down', 'bộ render trang sản phẩm'],
];

const measurements = Object.fromEntries(rows.map(([key, value, direction]) => [key, { value, direction }]));
const label = Object.fromEntries(rows.map(([key, , , note]) => [key, note]));

// No baseline is a failure, not a free pass.
//
// This used to write one and exit 0 — so the very first build on any machine created
// the baseline and reported "no metric moved backwards", having compared nothing. A
// check that cannot fail on its first run is a check that has not run yet, and the
// report it produced was the most reassuring line in the build: eleven numbers, all
// green, no comparison. A metric gate earns its place by being able to say no.
//
// `npm run metrics:update` is the deliberate act of recording a new starting point,
// and the build has no way to perform it.
// `npm run metrics:auto` updates baseline only when all metrics improved or held —
// enabling continuous optimization without manual intervention.
if (update || autoUpdate) {
  const hasRegressions = autoUpdate && await hasRegressionsAgainstBaseline(measurements);
  if (hasRegressions) {
    console.error('[metrics:auto] FAIL — có hồi quy, từ chối cập nhật baseline tự động');
    process.exit(1);
  }
  await writeFile(baselineFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), measurements }, null, 2)}\n`);
  console.log(autoUpdate ? '[metrics:auto] baseline updated (all metrics improved or stable)' : '[metrics] baseline updated');
  for (const [key, entry] of Object.entries(measurements)) {
    console.log(`  ${key.padEnd(19)} ${String(entry.value).padStart(4)}   ${label[key]}`);
  }
  process.exit(0);
}
if (!(await exists(baselineFile))) {
  console.error(`[metrics] FAIL — không có ${path.relative(root, baselineFile)} để so sánh.`);
  console.error('Không có gì để so sánh thì một dòng "PASS" không có nghĩa gì.');
  console.error('Ghi baseline một lần có chủ đích: npm run metrics:update');
  process.exit(1);
}

const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
console.log(`[metrics] so voi baseline ${baseline.generatedAt}`);
const regressions = [];
for (const [key, entry] of Object.entries(measurements)) {
  const before = baseline.measurements[key];
  if (!before) {
    console.log(`  ${key.padEnd(19)}    ? -> ${String(entry.value).padStart(4)}   moi`);
    continue;
  }
  const delta = entry.value - before.value;
  const worse = entry.direction === 'up' ? delta < 0 : delta > 0;
  const arrow = delta === 0 ? '' : ` (${delta > 0 ? '+' : ''}${delta}${worse ? '  REGRESSION' : ''})`;
  console.log(`  ${key.padEnd(19)} ${String(before.value).padStart(4)} -> ${String(entry.value).padStart(4)}${arrow}   ${label[key]}`);
  if (worse) regressions.push(`${key}: ${before.value} -> ${entry.value} (${label[key]} ${delta < 0 ? 'giam' : 'tang'})`);
}

if (regressions.length) {
  console.error('\n[metrics] FAIL — chi so lui ve:');
  for (const line of regressions) console.error(`  ${line}`);
  console.error('\nNeu do la chu y dich, chay: npm run metrics:update');
  process.exit(1);
}
console.log('\n[metrics] PASS — không có chỉ số nào lùi về.');

  // Predictive causal analysis: trend tracking for CMMI Level 5
  if (showTrends) {
    await analyzeTrends(measurements);
  }

async function hasRegressionsAgainstBaseline(measurements) {
  if (!(await exists(baselineFile))) return true;
  const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
  for (const [key, entry] of Object.entries(measurements)) {
    const before = baseline.measurements[key];
    if (!before) continue;
    const delta = entry.value - before.value;
    const worse = entry.direction === 'up' ? delta < 0 : delta > 0;
    if (worse) return true;
  }
  return false;
}

async function analyzeTrends(measurements) {
  const MAX_HISTORY = 50;
  // Which instrument produced a snapshot. Bump this whenever a row's definition
  // changes — a series measured by two different instruments is not a series,
  // it is two short ones glued together, and every statistic below quietly
  // assumes they are comparable.
  //
  // This was not hypothetical: moneyCopies counted occurrences until the formatter
  // gained its second branch, at which point the number rose by two while the
  // amount of duplicated code fell, and the trend analysis reported a metric
  // "trending the wrong way" for a change that was an improvement. The fix is
  // counting per file; the reason this version exists is so the next change of
  // definition cannot spend weeks alerting on the mismatch before it works its
  // way out of the window.
  const SCHEMA = 3;
  let trends = { schema: SCHEMA, history: [] };
  let carriedOver = 0;
  if (await exists(trendsFile)) {
    try {
      const stored = JSON.parse(await readFile(trendsFile, 'utf8'));
      if (stored?.schema === SCHEMA && Array.isArray(stored.history)) {
        trends = stored;
      } else if (Array.isArray(stored?.history) && stored.history.length) {
        carriedOver = stored.history.length;
      }
    } catch {
      // A corrupt trends file is not a reason to fail a build over a cache: the
      // measurements are recomputed from source every run, and the next snapshot
      // starts a fresh series.
    }
  }

  const snapshot = {
    timestamp: new Date().toISOString(),
    measurements: Object.fromEntries(
      Object.entries(measurements).map(([key, entry]) => [key, entry.value])
    ),
  };

  trends.schema = SCHEMA;
  trends.history.push(snapshot);
  if (trends.history.length > MAX_HISTORY) {
    trends.history = trends.history.slice(-MAX_HISTORY);
  }

  await writeFile(trendsFile, `${JSON.stringify(trends, null, 2)}\n`);

  console.log('\n[trends] Analyzing ' + trends.history.length + ' snapshots...');
  if (carriedOver) {
    console.log(`[trends] Bỏ ${carriedOver} snapshot cũ: đo bằng định nghĩa chỉ số khác (schema ${SCHEMA}).`);
    console.log('[trends] Xem SCHEMA trong scripts/metrics.mjs — đổi định nghĩa một chỉ số là đổi thiết bị đo, chuỗi cũ không so được với chuỗi mới.');
  }

  const alerts = [];
  const outOfControl = [];
  for (const [key, entry] of Object.entries(measurements)) {
    const direction = entry.direction;
    const values = trends.history.map((h) => h.measurements[key]).filter((v) => v !== undefined);
    if (values.length < 3) continue;

    // Linear regression slope
    const n = values.length;
    const xSum = (n * (n - 1)) / 2;
    const ySum = values.reduce((a, b) => a + b, 0);
    const xySum = values.reduce((sum, y, i) => sum + i * y, 0);
    const x2Sum = values.reduce((sum, _, i) => sum + i * i, 0);
    const slope = (n * xySum - xSum * ySum) / (n * x2Sum - xSum * xSum);

    const recent = values.slice(-3);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const overallAvg = ySum / n;

    // Acceleration: slope is increasing in wrong direction
    const wrongDirection = direction === 'up' ? slope < -0.1 : slope > 0.1;
    const accelerating = direction === 'up'
      ? recentAvg < overallAvg * 0.95
      : recentAvg > overallAvg * 1.05;

    if (wrongDirection || accelerating) {
      alerts.push({
        key,
        label: label[key],
        current: entry.value,
        slope: slope.toFixed(3),
        recentAvg: recentAvg.toFixed(1),
        overallAvg: overallAvg.toFixed(1),
        warning: wrongDirection ? 'xu hướng ngược chiều' : 'tăng tốc sai chiều',
      });
    }

    // Statistical process control: a snapshot outside three sigma of the mean is
    // a special cause, not noise, and it is worth naming even when the value is
    // one the gate happily accepts. This is the half of CMMI Level 5 that
    // regression slopes cannot do on their own — a slope answers "which way is
    // this moving", a control limit answers "is this even stable enough for a
    // slope to mean anything".
    //
    // Reported and never made a failure: a metric that leaves the band is a
    // signal to look, not proof of a defect, and a build that goes red on
    // statistics gets bypassed rather than read.
    const mean = overallAvg;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
    const sigma = Math.sqrt(variance);
    // A run of identical values has sigma 0, where everything that differs is
    // infinitely far out. The gate direction already covers that case, so the
    // limit is only computed where the metric actually varies.
    if (sigma > 0) {
      const limit = 3 * sigma;
      const escapes = values
        .map((value, index) => ({ value, index }))
        .filter(({ value }) => Math.abs(value - mean) > limit);
      for (const { value, index } of escapes) {
        outOfControl.push({
          key,
          label: label[key],
          value,
          mean: mean.toFixed(1),
          sigma: sigma.toFixed(2),
          snapshot: index + 1,
        });
      }
    }
  }

  if (outOfControl.length) {
    console.error('\n[trends] NGOÀI KIỂM SOÁT THỐNG KÊ — snapshot lệch quá 3σ so với mean (nguyên nhân đặc biệt, không phải nhiễu):');
    for (const item of outOfControl) {
      console.error(
        `  ${item.key.padEnd(19)} snapshot #${item.snapshot} = ${String(item.value).padStart(4)} | mean=${String(item.mean).padStart(6)} | 3σ=${(3 * Number(item.sigma)).toFixed(2).padStart(7)}`,
      );
    }
    console.error('  Chỉ là tín hiệu để xem, không chặn build: một chỉ số ra khỏi dải kiểm soát là lời mời điều tra nguyên nhân gốc.');
  }

  if (alerts.length) {
    console.error('\n[trends] CẢNH BÁO DỰ BÁO — các chỉ số có xu hướng xấu:');
    for (const a of alerts) {
      console.error(
        `  ${a.key.padEnd(19)} ${String(a.current).padStart(4)} | slope=${a.slope.padStart(6)} | recent=${String(a.recentAvg).padStart(6)} | overall=${String(a.overallAvg).padStart(6)} | ${a.warning}`
      );
    }
    console.error('\nHành động: xem xét nguyên nhân gốc rễ (root cause) trước khi chỉ số thực sự lùi.');
  } else {
    console.log('[trends] Tốt — không có xu hướng tiêu cực rõ rệt trong ' + trends.history.length + ' lần đo.');
  }
}
