import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walkProjectFiles, JS_EXTENSIONS } from './lib/files.mjs';
import { ARTIFACT_DIRECTORIES, ARTIFACT_FILES, ARTIFACT_EXCLUDE_DIRS, ARTIFACT_EXCLUDE_SUFFIXES } from './lib/artifact.mjs';
import { commitHash } from '../src/lib/git.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The commit stamped into the packaged HTML for CSS cache-busting. src/pages.js
// stamps the same value into the server-rendered pages from the same module, so
// the build and the live page cannot name different stylesheet versions. It used
// to be a second, byte-identical copy of the git call.
const commit = commitHash(root);
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
const required = ['package.json', 'src/server.js', 'src/app.js', 'src/store.js', 'src/r2.js', 'src/paypal.js', 'src/paypal-environment.js', 'src/payments.js', 'src/rates.js', 'src/geo.js', 'src/indexnow.js', 'src/pages.js', 'src/reviews.js', 'src/format.js', 'src/config.js', 'src/notify.js', 'src/supabase-http.js', 'src/refuse.js', 'src/robots.js', 'src/rate-limit.js', 'src/admin-auth.js', 'public/index.html', 'public/i18n.js', 'public/styles.css', 'public/format.js', 'public/order-client.js', 'public/app.js', 'public/admin.html', 'public/admin.js', 'public/paypal-return.html', 'public/paypal-return.js', 'public/lookup.html', 'public/lookup.js', 'public/order.html', 'public/order.js', 'public/terms.html', 'public/privacy.html', 'public/refund.html', 'public/404.html', 'public/about.html', 'public/related.js', 'public/favicon.svg', 'public/favicon.ico', 'public/mask-icon.png', 'public/apple-touch-icon.png', 'public/logo-1024.png', 'public/logo-ink-64.png', 'public/logo-mint-512.png', 'public/icon-16.png', 'public/icon-32.png', 'public/icon-192.png', 'public/icon-512.png', 'public/img/sonvudev.logo.png', 'public/og.png', 'scripts/production-check.mjs', 'scripts/audit-web.mjs', 'scripts/case-check.mjs', 'scripts/seo-check.mjs', 'scripts/r2-cors.mjs', 'scripts/run-tests.mjs', 'scripts/provenance.mjs', 'scripts/prune-logs.mjs', 'scripts/backup.mjs', 'scripts/lib/artifact.mjs', 'scripts/lib/cors.mjs', 'scripts/lib/files.mjs', 'cloudflare/r2-cors.json', 'Dockerfile', 'render.yaml'];
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

// Chữ hoa/thường chỉ chết trên Linux (nơi deploy), Windows không thấy.
// Chạy ở đây chứ không để CI mới báo, vì import sai mà lọt vào artifact
// thì bản deploy đó hỏng toàn bộ route liên quan.
const caseCheck = spawnSync(process.execPath, [path.join(root, 'scripts', 'case-check.mjs')], { encoding: 'utf8' });
if (caseCheck.status !== 0) throw new Error(`Case check failed:\n${caseCheck.stdout}${caseCheck.stderr}`);
const caseSummary = (caseCheck.stdout.match(/\[case\].*/g) || []).pop() || '';

// A pass or a fail at a point in time. The metrics step is what answers whether
// this week was better than last week: it compares test count, route count,
// dependency count and duplicate-helper count against a committed baseline and
// fails if one moved the wrong way. Cheap, and it is the difference between a
// project that is measured and one that is only verified.
const metrics = spawnSync(process.execPath, [path.join(root, 'scripts', 'metrics.mjs')], { encoding: 'utf8' });
if (metrics.status !== 0) throw new Error(`Metrics regressed:\n${metrics.stdout}${metrics.stderr}`);
const metricsSummary = (metrics.stdout.match(/\[metrics\].*/g) || []).pop() || '';
// Provenance + SBOM nội bộ: ai build cái gì bằng gì. Chạy trước khi đóng gói để
// build-reports/provenance.json nói về đúng cây nguồn vừa pass audit/metrics.
const provenance = spawnSync(process.execPath, [path.join(root, 'scripts', 'provenance.mjs')], { encoding: 'utf8' });
if (provenance.status !== 0) throw new Error(`Provenance failed:\n${provenance.stdout}${provenance.stderr}`);
const provenanceSummary = (provenance.stdout.match(/\[provenance\].*/g) || []).pop() || '';
// The artifact is the single definition of what ships, and deploy/deploy.sh
// deploys this directory and nothing else. It used to be written here and then
// ignored: the deploy script copied the entire working tree instead, so the
// existence gate and the audit re-run were certifying a directory no release
// path consumed, while the directory that was actually deployed was never
// checked at all — and it carried .env.backup-*, the build tool's secret cache
// and the full .git history with it.
//
// What is copied is read from scripts/lib/artifact.mjs, the same module
// test/artifact.test.js checks package.json "files" against.
const publishRoot = path.join(root, 'publish-output', 'node');

await rm(publishRoot, { recursive: true, force: true });
await mkdir(publishRoot, { recursive: true });
for (const directory of ARTIFACT_DIRECTORIES) {
  await cp(path.join(root, directory), path.join(publishRoot, directory), { recursive: true, force: true });
}
for (const file of ARTIFACT_FILES) {
  await cp(path.join(root, file), path.join(publishRoot, file), { force: true });
}
// Prune tool scratch that lives inside artifact directories (notably
// cloudflare/keep-awake/.wrangler). cp is recursive over whole directories,
// so without this a local `wrangler deploy` or gbuild run ships its cache.
for (const dir of ARTIFACT_EXCLUDE_DIRS) {
  await rm(path.join(publishRoot, 'cloudflare', 'keep-awake', dir), { recursive: true, force: true });
  for (const top of ARTIFACT_DIRECTORIES) {
    await rm(path.join(publishRoot, top, dir), { recursive: true, force: true });
}
  }

await mkdir(path.join(root, 'build-reports'), { recursive: true });
const artifactFiles = (await walkProjectFiles(publishRoot)).map((file) => path.relative(root, file).replaceAll('\\', '/'));

// Inject cache-busting version into CSS links in all HTML files
const cssVersion = commit.slice(0, 8);
for (const htmlFile of artifactFiles.filter((f) => f.endsWith('.html'))) {
  const abs = path.join(root, htmlFile);
  let content = await readFile(abs, 'utf8');
  content = content.replace(/(href=["'])\/styles\.css(["'])/g, `$1/styles.css?v=${cssVersion}$2`);
  content = content.replace(/(href=["'])styles\.css(["'])/g, `$1styles.css?v=${cssVersion}$2`);
  await writeFile(abs, content, 'utf8');
}

const shippedScratch = artifactFiles.filter((file) => {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return ARTIFACT_EXCLUDE_DIRS.some((d) => file.includes(`/${d}/`) || base === d)
    || ARTIFACT_EXCLUDE_SUFFIXES.some((s) => base.endsWith(s));
});
if (shippedScratch.length) {
  throw new Error(`Artifact chứa file scratch của tool, không được deploy:\n  ${shippedScratch.join('\n  ')}`);
}

// Nothing that can hold a secret may leave the machine inside the artifact.
//
// The copy above is recursive over whole directories, so a .env, a .env.local or a
// .env.backup-* sitting in src/ or public/ would be deployed without anything
// noticing: the existence gate only checks that required files are *present*, never
// that forbidden ones are absent, and deploy/deploy.sh's refusal runs on the host
// after the secret has already travelled. This scans what was actually written, so
// the answer is about the bytes that ship rather than about a list someone maintains.
//
// .env.example is the one exception, by name rather than by pattern: it is
// documentation the deploy needs and it holds no values.
const shippedEnv = artifactFiles.filter((file) => {
  const name = file.slice(file.lastIndexOf('/') + 1);
  return name === '.env' || (name.startsWith('.env.') && name !== '.env.example');
});
if (shippedEnv.length) {
  throw new Error(`Artifact chứa file biến môi trường, không được deploy:\n  ${shippedEnv.join('\n  ')}\n.env.example là file duy nhất được phép.`);
}
const report = { application: 'SonVuDev Store', mode: 'web-node', generatedAt: new Date().toISOString(), javascriptFilesChecked: jsFiles.length, requiredFilesChecked: required.length, audit: auditSummary, caseCheck: caseSummary, metrics: metricsSummary, provenance: provenanceSummary, artifactFiles: artifactFiles.length, artifactPath: 'publish-output/node', status: 'passed' };
await writeFile(path.join(root, 'build-reports', 'web-build.json'), JSON.stringify(report, null, 2));
console.log(`[build] PASS: ${required.length} required files, ${jsFiles.length} JavaScript files checked, ${auditSummary}, ${caseSummary}, ${metricsSummary}, ${provenanceSummary}, ${artifactFiles.length} deploy files packaged into publish-output/node.`);
