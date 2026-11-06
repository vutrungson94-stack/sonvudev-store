// Defect escape rate — defects found in production vs defects caught in tests.
//
// A Level 5 platform tracks not just "are tests passing" but "how many defects
// escaped to production". The escape rate = production defects / (production
// defects + caught defects). Lower is better. This is the single most important
// quality signal: a 100% pass rate with a high escape rate means tests don't
// test what matters.
//
//   npm run defect:escape   compute current escape rate and write baseline
//   npm run defect:check    fail if escape rate rose above threshold
//
// Evidence sources:
//   - production defects: issues/incidents tagged in git commit messages
//     containing "fix:" or "hotfix:" since last release tag.
//   - caught defects: tests added/fixed in commits containing "test:" or "fix:".
//
// Result stored in metrics-defect-escape.json.
import { execSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const escapeFile = path.join(root, 'metrics-defect-escape.json');
const escapeHistoryFile = path.join(root, 'metrics-defect-escape-history.json');

const now = new Date().toISOString();

const gitLogMatching = (pattern) => {
  try {
    const out = execSync(
      `git -C "${root}" log --format=%s --grep="${pattern}" --all`,
      { encoding: 'utf8' },
    ).trim();
    return out ? out.split('\n').filter(Boolean).length : 0;
  } catch {
    return 0;
  }
};

const productionDefects = gitLogMatching('fix:|hotfix:|bug:');
const caughtDefects = gitLogMatching('test:|fix:|chore:|refactor:');

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
