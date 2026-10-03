import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walkProjectFiles, JS_EXTENSIONS } from './lib/files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The build refuses to package without each of these. Every one was added because
// the site worked but something on it was quietly broken: og.png because every
// platform that renders a link preview refuses SVG, related.js because the strict
// Content-Security-Policy refuses to run an inline script, about.html because a
// page that exists only in someone's head is not a page.
// Everything a deploy is not allowed to be missing.
//
// The list is explicit on purpose. A file referenced by a page but absent from
// disk breaks that one page, in production only, and nothing in the test suite
// would notice — so the file's existence is checked before packaging rather than
// discovered by a buyer. public/order-client.js is here for the same reason as
// the rest: four pages load it, and it holds the access token and the download
// handshake they all share.
const required = ['package.json', 'src/server.js', 'src/app.js', 'src/store.js', 'src/r2.js', 'src/paypal.js', 'src/paypal-environment.js', 'src/payments.js', 'src/rates.js', 'src/geo.js', 'src/indexnow.js', 'src/pages.js', 'src/reviews.js', 'src/format.js', 'src/config.js', 'src/notify.js', 'src/supabase-http.js', 'src/refuse.js', 'public/index.html', 'public/i18n.js', 'public/styles.css', 'public/format.js', 'public/order-client.js', 'public/app.js', 'public/admin.html', 'public/admin.js', 'public/paypal-return.html', 'public/paypal-return.js', 'public/lookup.html', 'public/lookup.js', 'public/order.html', 'public/order.js', 'public/terms.html', 'public/privacy.html', 'public/refund.html', 'public/404.html', 'public/about.html', 'public/related.js', 'public/favicon.svg', 'public/og.png', 'scripts/production-check.mjs', 'scripts/audit-web.mjs', 'scripts/seo-check.mjs', 'scripts/r2-cors.mjs', 'scripts/run-tests.mjs', 'scripts/lib/cors.mjs', 'scripts/lib/files.mjs', 'cloudflare/r2-cors.json', 'render.yaml'];
// One walk, shared with lint and metrics, so all three measure the same source.
// This used to keep a private copy of the directory list that did not exclude
// publish-output, which meant the build re-checked the artifact it had just
// written and reported 122 JavaScript files where the project has 81.
const jsFiles = await walkProjectFiles(root, { extensions: JS_EXTENSIONS });
for (const file of required) await access(path.join(root, file), constants.R_OK);
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.type !== 'module') throw new Error('package.json must use type=module');
if (!manifest.scripts?.build) throw new Error('Missing npm build script');
if (!manifest.scripts?.lint) throw new Error('Missing npm lint script');
for (const file of jsFiles) { const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); if (result.status !== 0) throw new Error(`Syntax check failed: ${path.relative(root, file)}\n${result.stderr}`); }
// A syntax check only proves the file parses. The audit is what stops a broken
// internal link, a duplicated route or a value written into two places from
// reaching a deploy, so it runs here rather than being a step somebody remembers.
const audit = spawnSync(process.execPath, [path.join(root, 'scripts', 'audit-web.mjs')], { encoding: 'utf8' });
if (audit.status !== 0) throw new Error(`Audit failed:\n${audit.stdout}${audit.stderr}`);
const auditSummary = (audit.stdout.match(/\[audit\] .*/g) || []).pop() || '';

// A pass or a fail at a point in time. The metrics step is what answers whether
// this week was better than last week: it compares test count, route count,
// dependency count and duplicate-helper count against a committed baseline and
// fails if one moved the wrong way. Cheap, and it is the difference between a
// project that is measured and one that is only verified.
const metrics = spawnSync(process.execPath, [path.join(root, 'scripts', 'metrics.mjs')], { encoding: 'utf8' });
if (metrics.status !== 0) throw new Error(`Metrics regressed:\n${metrics.stdout}${metrics.stderr}`);
const metricsSummary = (metrics.stdout.match(/\[metrics\].*/g) || []).pop() || '';
// The artifact is the single definition of what ships, and deploy/deploy.sh
// deploys this directory and nothing else. It used to be written here and then
// ignored: the deploy script copied the entire working tree instead, so the
// existence gate and the audit re-run were certifying a directory no release
// path consumed, while the directory that was actually deployed was never
// checked at all — and it carried .env.backup-*, the build tool's secret cache
// and the full .git history with it.
//
// The list below is also what package.json "files" has to agree with, which
// test/artifact.test.js enforces. Two places that must name the same files is
// one more than this project needs.
const publishRoot = path.join(root, 'publish-output', 'node');
const ARTIFACT_DIRECTORIES = ['src', 'public', 'scripts', 'supabase', 'cloudflare', 'deploy'];
const ARTIFACT_FILES = ['package.json', 'package-lock.json', '.env.example', 'README.md', 'render.yaml'];

await rm(publishRoot, { recursive: true, force: true });
await mkdir(publishRoot, { recursive: true });
for (const directory of ARTIFACT_DIRECTORIES) {
  await cp(path.join(root, directory), path.join(publishRoot, directory), { recursive: true, force: true });
}
for (const file of ARTIFACT_FILES) {
  await cp(path.join(root, file), path.join(publishRoot, file), { force: true });
}
await mkdir(path.join(root, 'build-reports'), { recursive: true });
const artifactFiles = (await walkProjectFiles(publishRoot)).map((file) => path.relative(root, file).replaceAll('\\', '/'));
const report = { application: 'SonVuDev Store', mode: 'web-node', generatedAt: new Date().toISOString(), javascriptFilesChecked: jsFiles.length, requiredFilesChecked: required.length, audit: auditSummary, metrics: metricsSummary, artifactFiles: artifactFiles.length, artifactPath: 'publish-output/node', status: 'passed' };
await writeFile(path.join(root, 'build-reports', 'web-build.json'), JSON.stringify(report, null, 2));
console.log(`[build] PASS: ${required.length} required files, ${jsFiles.length} JavaScript files checked, ${auditSummary}, ${metricsSummary}, ${artifactFiles.length} deploy files packaged into publish-output/node.`);
