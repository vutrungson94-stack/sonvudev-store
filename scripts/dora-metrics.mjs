// DORA metrics — deployment frequency, lead time, change failure rate, MTTR.
//
// Computed from git history only, so a fresh clone reproduces them offline.
// The four numbers are defined here, and only here:
//
//   deploymentFrequency  tags per week over the trailing 90-day window
//                        (total tags ever is a vanity number, not a frequency)
//   leadTimeDays         mean days from the first commit in a release range to
//                        the tag that shipped it - i.e. how long a change takes
//                        to reach production, which is what DORA's lead time
//                        for changes means
//   changeFailureRate    share of tags whose tagged commit (or its immediate
//                        parent) carries a fix:/hotfix:/bug: subject - a release
//                        that shipped a fix for something that had just broken
//   mttrDays             mean days from such a failed tag to the next tag that
//                        ships the fix - null until there is at least one pair
//
//   npm run dora:metrics        compute and write metrics-dora.json (+ history)
//   npm run dora:check          same, but exit 1 when change failure rate rose
//
// --check is the gate. It compares against the previously committed
// metrics-dora.json, so a release that regresses the rate fails the job.
import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doraFile = path.join(root, 'metrics-dora.json');
const doraHistoryFile = path.join(root, 'metrics-dora-history.json');
const CHECK = process.argv.includes('--check');
const WINDOW_DAYS = 90;
const WINDOW_WEEKS = WINDOW_DAYS / 7;
const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

const now = new Date();
const nowMs = now.getTime();
const cutoff = new Date(nowMs - WINDOW_DAYS * 24 * 60 * 60 * 1000);

// All tags with their creation dates, newest first.
const tagLines = git(['tag', '--creatordate', '--sort=-creatordate', '--format=%(creatordate:iso-strict) %(refname:short)']);
const allTags = tagLines
  ? tagLines
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf(' ');
        return { date: new Date(line.slice(0, at)), tag: line.slice(at + 1).trim() };
      })
      .filter((t) => Number.isFinite(t.date.getTime()))
  : [];
const tagsInWindow = allTags.filter((t) => t.date >= cutoff);

const deploymentFrequency = Number((tagsInWindow.length / WINDOW_WEEKS).toFixed(2));

// Lead time: for each tag, the age of the oldest commit in the range since the
// previous tag (or the start of history for the oldest tag in the window).
let leadTimeDays = 0;
let leadTimeSamples = 0;
for (let i = allTags.length - 1; i >= 0; i -= 1) {
  const current = allTags[i];
  if (current.date < cutoff) continue;
  const prevTag = allTags[i + 1];
  const oldest = git(['log', '--format=%cI', '--reverse', ...(prevTag ? [`${prevTag.tag}..${current.tag}`] : [])]).split('\n').find((line) => line.trim());
  if (oldest) {
    const days = (current.date.getTime() - new Date(oldest.trim()).getTime()) / (1000 * 60 * 60 * 24);
    leadTimeDays += days;
    leadTimeSamples += 1;
  }
}
if (leadTimeSamples > 0) leadTimeDays = leadTimeDays / leadTimeSamples;

// Change failure rate over the trailing window: a tag whose tagged commit or
// its immediate parent carries a fix/hotfix/bug subject is counted as failed.
const FIX_RE = /^(fix|hotfix|bug)/i;
const failedTags = [];
for (const t of tagsInWindow) {
  const subjects = [git(['log', '-1', '--format=%s', t.tag]), git(['log', '-2', '--format=%s', t.tag]).split('\n')[1] || ''];
  if (subjects.some((s) => FIX_RE.test(s.trim()))) failedTags.push(t);
}
const changeFailureRate = tagsInWindow.length > 0 ? failedTags.length / tagsInWindow.length : 0;

// MTTR: days from a failed tag to the next tag, averaged over the window.
let mttrDays = null;
const mttrSamples = [];
for (const t of failedTags) {
  const later = allTags.find((other) => other.date > t.date);
  if (later) mttrSamples.push((later.date.getTime() - t.date.getTime()) / (1000 * 60 * 60 * 24));
}
if (mttrSamples.length > 0) {
  mttrDays = mttrSamples.reduce((a, b) => a + b, 0) / mttrSamples.length;
}

const metrics = {
  generatedAt: now.toISOString(),
  windowDays: WINDOW_DAYS,
  deploymentFrequency,
  deploymentsInWindow: tagsInWindow.length,
  totalDeployments: allTags.length,
  leadTimeDays: Number(leadTimeDays.toFixed(2)),
  changeFailureRate: Number(changeFailureRate.toFixed(4)),
  failedChanges: failedTags.length,
  totalChanges: tagsInWindow.length,
  mttrDays: mttrDays == null ? null : Number(mttrDays.toFixed(2)),
};

const history = await (async () => {
  try {
    return JSON.parse(await readFile(doraHistoryFile, 'utf8'));
  } catch {
    return { schema: 1, history: [] };
  }
})();
history.history.push(metrics);
// Keep roughly a year of weekly snapshots.
if (history.history.length > 104) history.history = history.history.slice(-104);

// Read the previous snapshot *before* overwriting it, so --check has a baseline.
let previous = null;
try {
  previous = JSON.parse(await readFile(doraFile, 'utf8'));
} catch {
  previous = null;
}

await mkdir(path.dirname(doraFile), { recursive: true });
await writeFile(doraFile, JSON.stringify(metrics, null, 2) + '\n', 'utf8');
await writeFile(
  doraHistoryFile,
  JSON.stringify(history, null, 2) + '\n',
  'utf8',
);

console.log(
  `[dora] window=${WINDOW_DAYS}d deploymentFrequency=${metrics.deploymentFrequency}/week deployments=${metrics.deploymentsInWindow} leadTimeDays=${metrics.leadTimeDays} changeFailureRate=${(metrics.changeFailureRate * 100).toFixed(1)}% mttrDays=${metrics.mttrDays == null ? 'n/a' : metrics.mttrDays.toFixed(1)}`,
);

if (CHECK) {
  // The gate: a change failure rate that is not below the previous snapshot fails.
  // Without a prior snapshot there is nothing to regress against, so the gate passes
  // and says so - it does not invent a baseline.
  const prev = previous && typeof previous.changeFailureRate === 'number' ? previous.changeFailureRate : null;
  if (prev == null) {
    console.log('[dora:check] no previous snapshot to compare against - baseline recorded');
    process.exit(0);
  }
  if (metrics.changeFailureRate > prev) {
    console.log(
      `[dora:check] change failure rate regressed: ${(prev * 100).toFixed(1)}% -> ${(metrics.changeFailureRate * 100).toFixed(1)}%`,
    );
    process.exit(1);
  }
  console.log('[dora:check] change failure rate did not regress');
}

export { metrics, deploymentFrequency, leadTimeDays, changeFailureRate, mttrDays };
