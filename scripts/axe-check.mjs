// Accessibility gate: axe-core against the real rendered shop.
//
// Lighthouse's accessibility score is a summary; this is the rule list behind
// it. The tool is fetched at a pinned version through npx, the same way
// lighthouse-check.mjs does, so axe-core is not a dependency and the license
// gate never has to review it. A URL argument or AXE_URL scans that URL;
// without one the gate boots the fixture shop and scans its own pages, so CI
// needs no deployed site to run it.
//
//   npm run axe:check
//   npm run axe:check -- <url>
//   AXE_URL=<url> npm run axe:check
//   AXE_FAIL_ON=serious npm run axe:check     # tighten the gate
//
// Default: fail on critical violations only. Serious/moderate are printed so a
// first run can be triaged without turning the gate red on day one.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { startFixtureServer, waitForHealth } from './lib/fixture-server.mjs';

const AXE_VERSION = '4.10.2';
const TAGS = 'wcag2a,wcag2aa,wcag21a,wcag21aa';
const IMPACT_ORDER = ['moderate', 'serious', 'critical'];
const failOn = (process.env.AXE_FAIL_ON || 'critical').toLowerCase();
const failIndex = IMPACT_ORDER.indexOf(failOn);
if (failIndex < 0) {
  console.error(`[axe] AXE_FAIL_ON phải là moderate|serious|critical (đang là "${failOn}")`);
  process.exit(2);
}

const findChrome = () => {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
};

// @axe-core/cli bundles a chromedriver from its own dependency tree, which can
// be newer than the browser on the machine. CI downloads a matched pair from
// Chrome for Testing and points both variables at it; locally the defaults are
// used. Passing a driver the CLI did not choose is the only way to make the
// pair agree when the runner image is mid-update.
const CHROMEDRIVER_PATH = process.env.CHROMEDRIVER_PATH && existsSync(process.env.CHROMEDRIVER_PATH)
  ? process.env.CHROMEDRIVER_PATH
  : null;

const runAxe = (url, chromePath) => new Promise((resolve) => {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const useNpmCli = existsSync(npmCli);
  const command = useNpmCli ? process.execPath : 'npx';
  const prefix = useNpmCli
    ? [npmCli, 'exec', '--yes', `--package=@axe-core/cli@${AXE_VERSION}`, '--', 'axe']
    : ['--yes', `@axe-core/cli@${AXE_VERSION}`];
  const args = [
    ...prefix,
    url,
    '--stdout',
    '--tags', TAGS,
    '--timeout', '60',
  ];
  if (chromePath) args.push('--chrome-path', chromePath);
  if (CHROMEDRIVER_PATH) args.push('--chromedriver-path', CHROMEDRIVER_PATH);
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', (error) => resolve({ ok: false, error: error.message, stderr }));
  child.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr }));
});

const parseReport = (stdout) => {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
};

const explicitUrl = process.argv.slice(2).find((arg) => /^https?:\/\//i.test(arg))
  || (process.env.AXE_URL || '').trim();
const chromePath = findChrome();

if (!chromePath) {
  if (/^(1|true|yes)$/i.test(process.env.AXE_REQUIRE_CHROME || '')) {
    console.error('[axe] Không tìm thấy Chrome; AXE_REQUIRE_CHROME=1 nên đây là lỗi gate, không phải skip.');
    process.exit(1);
  }
  console.log('[axe] skipped: không tìm thấy Chrome (đặt CHROME_PATH để chạy).');
  process.exit(0);
}

let fixture = null;
let urls;
if (explicitUrl) {
  urls = [explicitUrl];
} else {
  fixture = await startFixtureServer();
  const ready = await waitForHealth(fixture.baseUrl, fixture.adminToken);
  if (!ready) {
    console.error(`[axe] fixture shop không khởi động:\n${fixture.getLog().slice(-4000)}`);
    await fixture.stop();
    process.exit(1);
  }
  urls = [`${fixture.baseUrl}/`, `${fixture.baseUrl}/en/`, `${fixture.baseUrl}/blog`];
}

let failing = 0;
try {
  for (const url of urls) {
    const result = await runAxe(url, chromePath);
    if (!result.ok && !result.stdout) {
      console.error(`[axe] ${url} — không chạy được axe: ${result.error || result.stderr.slice(0, 300)}`);
      failing += 1;
      continue;
    }
    const report = parseReport(result.stdout);
    if (!report) {
      console.error(`[axe] ${url} — không đọc được báo cáo JSON.\n${result.stderr.slice(0, 500)}`);
      failing += 1;
      continue;
    }
    const violations = report.violations || [];
    if (violations.length === 0) {
      console.log(`[axe] PASS ${url} — 0 violations`);
      continue;
    }
    for (const violation of violations) {
      console.log(`[axe] ${url} ${violation.impact || 'unknown'} ${violation.id}: ${violation.help} (${violation.nodes?.length || 0} nodes)`);
    }
    const gateFailures = violations.filter((violation) => {
      const index = IMPACT_ORDER.indexOf(violation.impact);
      return index >= 0 && index >= failIndex;
    });
    if (gateFailures.length > 0) {
      console.error(`[axe] FAIL ${url} — ${gateFailures.length} violation(s) at ${failOn}+ impact`);
      failing += 1;
    } else {
      console.log(`[axe] OK ${url} — ${violations.length} below ${failOn} threshold`);
    }
  }
} finally {
  if (fixture) await fixture.stop();
}

process.exit(failing > 0 ? 1 : 0);