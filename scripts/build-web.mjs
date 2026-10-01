import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The build refuses to package without each of these. Every one was added because
// the site worked but something on it was quietly broken: og.png because every
// platform that renders a link preview refuses SVG, related.js because the strict
// Content-Security-Policy refuses to run an inline script, about.html because a
// page that exists only in someone's head is not a page.
const required = ['package.json', 'src/server.js', 'src/app.js', 'src/store.js', 'src/r2.js', 'src/paypal.js', 'src/payments.js', 'src/rates.js', 'src/geo.js', 'src/indexnow.js', 'src/pages.js', 'src/reviews.js', 'src/format.js', 'public/index.html', 'public/i18n.js', 'public/styles.css', 'public/app.js', 'public/admin.html', 'public/admin.js', 'public/paypal-return.html', 'public/paypal-return.js', 'public/lookup.html', 'public/lookup.js', 'public/order.html', 'public/order.js', 'public/404.html', 'public/about.html', 'public/related.js', 'public/favicon.svg', 'public/og.png', 'scripts/production-check.mjs', 'scripts/audit-web.mjs', 'scripts/seo-check.mjs', 'cloudflare/r2-cors.json'];
const ignored = new Set(['.git', '.gbuildcache', 'build-reports', 'logs']);
const jsFiles = [];
async function walk(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { if (ignored.has(entry.name) || entry.name === 'node_modules' || entry.name.startsWith('node_modules_stale_')) continue; const full = path.join(dir, entry.name); if (entry.isDirectory()) await walk(full); else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) jsFiles.push(full); } }
await walk(root);
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
const publishRoot = path.join(root, 'publish-output', 'node');
await rm(publishRoot, { recursive: true, force: true });
await mkdir(publishRoot, { recursive: true });
for (const directory of ['src', 'public', 'scripts', 'supabase', 'cloudflare', 'deploy']) {
  await cp(path.join(root, directory), path.join(publishRoot, directory), { recursive: true, force: true });
}
for (const file of ['package.json', 'package-lock.json', '.env.example', 'README.md']) {
  await cp(path.join(root, file), path.join(publishRoot, file), { force: true });
}
await mkdir(path.join(root, 'build-reports'), { recursive: true });
const artifactFiles = [];
async function collectArtifacts(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) await collectArtifacts(full); else artifactFiles.push(path.relative(root, full).replaceAll('\\', '/')); } }
await collectArtifacts(publishRoot);
const report = { application: 'SonVuDev Store', mode: 'web-node', generatedAt: new Date().toISOString(), javascriptFilesChecked: jsFiles.length, requiredFilesChecked: required.length, audit: auditSummary, metrics: metricsSummary, artifactFiles: artifactFiles.length, status: 'passed' };
await writeFile(path.join(root, 'build-reports', 'web-build.json'), JSON.stringify(report, null, 2));
console.log(`[build] PASS: ${required.length} required files, ${jsFiles.length} JavaScript files checked, ${auditSummary}, ${metricsSummary}, ${artifactFiles.length} deploy files packaged.`);
