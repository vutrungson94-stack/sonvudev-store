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
// An escape helper that was written twice and drifted is the exact failure these
// numbers exist to catch. Two of each remain, one per runtime: src/format.js
// (server) and public/format.js (browsers, loaded before every page that needs
// it). public/i18n.js, public/admin.js and public/related.js all call through
// window.SVDFormat instead of carrying their own.
['escCopies', [...srcText, ...publicText].reduce((n, s) => n + countCopies(s, /&quot;/g), 0), 'down', 'bản sao hàm escape'],
['moneyCopies', [...srcText, ...publicText].reduce((n, s) => n + countCopies(s, /style:\s*['"]currency['"]/g), 0), 'down', 'bản sao hàm định dạng tiền'],
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
  console.error(`[metrics] FAIL — khong co ${path.relative(root, baselineFile)} de so sanh.`);
  console.error('Không có gì để so sánh thì một dòng "PASS" không có nghĩa gì.');
  console.error('Ghi baseline mot lan co chu dich: npm run metrics:update');
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
  let trends = { history: [] };
  if (await exists(trendsFile)) {
    try {
      trends = JSON.parse(await readFile(trendsFile, 'utf8'));
    } catch {
      // ignore corrupt file
    }
  }

  const snapshot = {
    timestamp: new Date().toISOString(),
    measurements: Object.fromEntries(
      Object.entries(measurements).map(([key, entry]) => [key, entry.value])
    ),
  };

  trends.history.push(snapshot);
  if (trends.history.length > MAX_HISTORY) {
    trends.history = trends.history.slice(-MAX_HISTORY);
  }

  await writeFile(trendsFile, `${JSON.stringify(trends, null, 2)}\n`);

  console.log('\n[trends] Analyzing ' + trends.history.length + ' snapshots...');

  const alerts = [];
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
