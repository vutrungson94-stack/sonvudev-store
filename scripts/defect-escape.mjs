// Defect escape rate — defects found in production vs defects caught in tests.
//
// A Level 5 platform tracks not just "are tests passing" but "how many defects
// escaped to production". The escape rate = production defects / (production
// defects + caught defects). Lower is better. This is the single most important
// quality signal: a 100% pass rate with a high escape rate means tests don't
// test what matters.
//
// The two counters never overlap:
//   - production defects: commits whose subject starts with fix:, hotfix: or
//     bug: (a defect was repaired - it shipped at some point)
//   - caught defects: commits whose subject starts with test: (someone added
//     or repaired a test - something that was caught before shipping)
// An earlier version counted fix: on BOTH sides, so every production defect
// was also counted as a caught defect and the rate was structurally ~50%.
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

const productionDefects = countCommits('^(fix|hotfix|bug):');
const caughtDefects = countCommits('^test:');

// Escape rate = production defects / (production + caught).
let escapeRate = null;
const total = productionDefects + caughtDefects;
if (total > 0) {
  escapeRate = productionDefects / total;
}

const metrics = {
  generatedAt: now,
  productionDefects,
  caughtDefects,
  total,
  escapeRate,
  threshold: 0.05, // 5% escape rate target
  withinThreshold: escapeRate == null || escapeRate <= 0.05,
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
    `[defect] ESCAPE RATE HIGH: ${(escapeRate * 100).toFixed(1)}% (${productionDefects} production / ${total} total) — above 5% target`,
  );
  exitCode = 1;
} else if (escapeRate == null) {
  console.log(`[defect] no defect data available yet — skipping`);
} else {
  console.log(
    `[defect] escape rate ${(escapeRate * 100).toFixed(1)}% — within 5% target`,
  );
}

export { metrics, escapeRate, productionDefects, caughtDefects };
process.exit(exitCode);
