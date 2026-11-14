// Defect escape rate — defects found in production vs defects caught in tests.
//
// A Level 5 platform tracks not just "are tests passing" but "how many defects
// escaped to production". The escape rate = production defects / (production
// defects + caught defects). Lower is better. This is the single most important
// quality signal: a 100% pass rate with a high escape rate means tests don't
// test what matters.
//
// THE SOURCE IS THE MEASUREMENT. The rate must come from a place where a real
// person labels a defect "escaped": an issue tracker with an `escaped` label, a
// support inbox, a postmortem file. This repo has none of those wired up.
//
// The old version counted commit subjects (`fix:`/`hotfix:`/`bug:` vs `test:`).
// That is not a measurement: anyone writing a commit message moves the number,
// and a defect repaired in a commit titled "update files" is invisible. So the
// metric is reported as `unknown`, and the prefix count is kept only as a
// clearly-labelled proxy — never as the metric.
//
//   npm run defect:escape   compute current escape rate and write baseline
//   npm run defect:check    same, but fail when the rate is above threshold
//
// Result stored in metrics-defect-escape.json.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const escapeFile = path.join(root, 'metrics-defect-escape.json');
const escapeHistoryFile = path.join(root, 'metrics-defect-escape-history.json');

const now = new Date().toISOString();

const countCommits = (pattern) => {
  try {
    const out = execFileSync('git', ['log', '-E', '--format=%s', `--grep=${pattern}`], { cwd: root, encoding: 'utf8' }).trim();
    return out ? out.split('\n').filter(Boolean).length : 0;
  } catch {
    return 0;
  }
};

// Labelled proxy, not the metric. Kept so the trend is visible while the real
// source is being wired up, and so nobody mistakes it for a measurement.
const proxyProduction = countCommits('^(fix|hotfix|bug):');
const proxyCaught = countCommits('^test:');
const proxyTotal = proxyProduction + proxyCaught;
const proxyRate = proxyTotal > 0 ? proxyProduction / proxyTotal : null;

// Real production-defect source (read-only, optional): GitHub issues labelled
// `escaped-defect`. A human decides what counts as escaped and applies the label,
// so the count is a measurement, not a heuristic over commit subjects.
//   gh issue list --state all --label escaped-defect --json number
// gh is not required for CI: if it is unavailable the metric stays unknown.
let githubEscaped = null;
try {
  const out = execFileSync(
    'gh',
    ['issue', 'list', '--state', 'all', '--label', 'escaped-defect', '--json', 'number', '--limit', '1000'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
  const issues = out ? JSON.parse(out) : [];
  githubEscaped = Array.isArray(issues) ? issues.length : 0;
} catch {
  githubEscaped = null;
}

const hasGithubSource = githubEscaped !== null;
const metrics = {
  generatedAt: now,
  status: hasGithubSource ? 'tracking' : 'unknown',
  source: hasGithubSource
    ? 'github-issues (label escaped-defect); caught-defect source not wired — escapeRate stays null until it is'
    : 'no defect tracker; commit subjects are not a measurement',
  productionDefects: hasGithubSource ? githubEscaped : null,
  caughtDefects: null,
  total: null,
  escapeRate: null,
  threshold: 0.05, // 5% escape rate target, applied when a real rate exists
  withinThreshold: null,
  proxy: {
    basis: 'git commit subjects: ^(fix|hotfix|bug): vs ^test:',
    productionDefects: proxyProduction,
    caughtDefects: proxyCaught,
    escapeRate: proxyRate,
    warning: 'proxy only — a commit message is not a defect record',
  },
};

const history = await (async () => {
  try {
    return JSON.parse(await readFile(escapeHistoryFile, 'utf8'));
  } catch {
    return { schema: 1, history: [] };
  }
})();

history.history.push(metrics);
if (history.history.length > 52) history.history = history.history.slice(-52);

await mkdir(path.dirname(escapeFile), { recursive: true });
await writeFile(escapeFile, JSON.stringify(metrics, null, 2) + '\n', 'utf8');
await writeFile(
  escapeHistoryFile,
  JSON.stringify(history, null, 2) + '\n',
  'utf8',
);

let exitCode = 0;
if (metrics.withinThreshold === false) {
  console.log(
    `[defect] ESCAPE RATE HIGH: ${(metrics.escapeRate * 100).toFixed(1)}% — above 5% target`,
  );
  exitCode = 1;
} else if (metrics.escapeRate == null) {
  if (metrics.productionDefects !== null) {
    console.log(`[defect] escaped defects (github label 'escaped-defect'): ${metrics.productionDefects}; escapeRate: unknown — the caught-defect source is not wired yet`);
  } else {
    console.log('[defect] escape rate: unknown — no defect tracker wired up. The commit-prefix count is a proxy, not the metric.');
  }
} else {
  console.log(`[defect] escape rate ${(metrics.escapeRate * 100).toFixed(1)}% — within 5% target`);
}

const { escapeRate, productionDefects, caughtDefects } = metrics;
export { metrics, escapeRate, productionDefects, caughtDefects };
process.exit(exitCode);
