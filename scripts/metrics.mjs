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
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineFile = path.join(root, 'metrics-baseline.json');
const update = process.argv.includes('--update');

const relative = (file) => path.relative(root, file).split(path.sep).join('/');
const read = (name) => readFile(path.join(root, name), 'utf8');
const exists = (file) => stat(file).then(() => true, () => false);

const walk = async (dir, out = []) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'publish-output') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
};

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
  ['tests', totalTests, 'up', 'so test co ten'],
  ['testFiles', testFiles.length, 'up', 'so file test'],
  ['routes', routes.size, 'up', 'route Express dang ky'],
  ['dependencies', dependencies.length, 'down', 'phu thuoc npm'],
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
// numbers exist to catch. Four of each are expected, each in a separate runtime:
// src/format.js (server), public/i18n.js and public/admin.js (browsers — admin
// deliberately does not load i18n.js), public/related.js (a standalone loader for
// the 404 page). The server used to have two escapes and two money formatters of
// its own.
['escCopies', [...srcText, ...publicText].reduce((n, s) => n + countCopies(s, /&quot;/g), 0), 'down', 'ban sao ham escape'],
['moneyCopies', [...srcText, ...publicText].reduce((n, s) => n + countCopies(s, /style:\s*['"]currency['"]/g), 0), 'down', 'ban sao ham dinh dang tien'],
  ['i18nKeys', countCopies(i18nText, /^\s{4}'[\w.]+':/gm), 'up', 'khoa i18n'],
  // A page that allows indexing is a page a crawler can be pointed at. Losing one
  // is a silent loss of traffic that no other check would notice.
  ['indexablePages', publicHtmlText.filter((body) => /index,follow/.test(body)).length, 'up', 'trang cho phep index'],
  ['productPageLocales', countCopies(appSource, /productPage\("(?:vi|en)"\)/g), 'up', 'ngon ngu trang san pham'],
  // One route serving two languages. It was one, then two pages with a renderer
  // between them that only ever spoke Vietnamese, and the English copy sat unused
  // in the database the whole time.
  ['productPageRenderers', countCopies(await read('src/pages.js'), /export function renderProductPage/g), 'down', 'bo render trang san pham'],
];

const measurements = Object.fromEntries(rows.map(([key, value, direction]) => [key, { value, direction }]));
const label = Object.fromEntries(rows.map(([key, , , note]) => [key, note]));

if (update || !(await exists(baselineFile))) {
  await writeFile(baselineFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), measurements }, null, 2)}\n`);
  console.log(update ? '[metrics] baseline updated' : '[metrics] chua co baseline, da ghi mot ban');
  for (const [key, entry] of Object.entries(measurements)) {
    console.log(`  ${key.padEnd(19)} ${String(entry.value).padStart(4)}   ${label[key]}`);
  }
  process.exit(0);
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
console.log('\n[metrics] PASS — khong co chi so nao lui ve.');
