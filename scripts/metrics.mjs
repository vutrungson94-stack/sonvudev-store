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
const update = process.argv.includes('--update');

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
  // Five do not: about.html and the three legal pages are Vietnamese-only with no
  // language switch, and admin.html is Vietnamese on purpose — it is the owner's
  // console, not a shopfront, and it deliberately does not load the dictionary (see
  // the note at the top of public/i18n.js).
  //
  // The comment used to name the 404 as one of the five. The 404 has carried
  // <script src="i18n.js"> and a working language toggle for some time, and
  // public/related.js still claimed in a comment that it could not read the shared
  // dictionary because the 404 has no switch — both facts false, and both about the
  // page that is the last thing a visitor sees. The count of 5 was right; the page
  // list was not, which is the worse half — a list someone reads to decide what to
  // work on next.
  //
  // This is a real gap and it was invisible — nothing counted it, so closing it was
  // neither possible to notice nor possible to hold. The direction is "up", so a page
  // that loses its dictionary is a regression the same way a deleted test is.
  //
  // What this number is not: a claim that the shop is translated. It says how much of
  // it is. Reaching the remaining pages means translating their prose, which is
  // work for someone who can be held to the legal wording — not something a
  // placeholder or a machine should decide.
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
if (update) {
  await writeFile(baselineFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), measurements }, null, 2)}\n`);
  console.log('[metrics] baseline updated');
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
