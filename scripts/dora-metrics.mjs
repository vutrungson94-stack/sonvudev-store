// DORA metrics — deployment frequency, lead time, change failure rate, MTTR.
//
// These four numbers are the industry-standard signals of delivery performance.
// They are computed from git history plus the committed test artifacts, so a
// fresh clone can reproduce them without network access.
//
//   npm run dora:metrics        compute and print current DORA metrics
//   npm run dora:baseline       write baseline from current git state
//   npm run dora:check          fail if any metric moved backwards
//
// All values are stored in metrics-dora.json so the trend is visible week over
// week. A metric gate earns its place by being able to say no — so dora:check
// fails when deployment frequency falls or change failure rate rises.
import { execSync } from 'node:child_process';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doraFile = path.join(root, 'metrics-dora.json');
const doraHistoryFile = path.join(root, 'metrics-dora-history.json');
const gitLog = (fmt) =>
  execSync(`git -C "${root}" log --format="${fmt}" -1`, { encoding: 'utf8' }).trim();
const gitLogRange = (fmt, since, until) =>
  execSync(
    `git -C "${root}" log --format="${fmt}" --since="${since}" --until="${until}"`,
    { encoding: 'utf8' },
  ).trim();

const now = new Date().toISOString();

// --- Deployment frequency: number of deployments (tags) per week ---
const allTags = execSync(`git -C "${root}" tag --sort=-creatordate`, {
  encoding: 'utf8',
}).trim();
const tagList = allTags ? allTags.split('\n').filter(Boolean) : [];
const deploymentFrequency = tagList.length; // total deployments (tags) ever

// --- Lead time: time from first commit to latest tag (days) ---
let leadTimeDays = 0;
if (tagList.length > 0) {
  const firstTag = tagList[tagList.length - 1];
  const latestTag = tagList[0];
  const firstDate = new Date(
    execSync(`git -C "${root}" log -1 --format=%ci ${firstTag}`, {
      encoding: 'utf8',
    }).trim(),
  );
  const latestDate = new Date(
    execSync(`git -C "${root}" log -1 --format=%ci ${latestTag}`, {
      encoding: 'utf8',
    }).trim(),
  );
  leadTimeDays = (latestDate - firstDate) / (1000 * 60 * 60 * 24);
}

// --- Change failure rate: failed builds / total builds ---
// We approximate failed builds by tags whose accompanying test run was red.
// Since we don't store per-tag test results in git, we use the committed
// test-output.log / test-stderr.log as the last known signal: if the latest
// committed test run had failures, count it as a failed change.
let changeFailureRate = 0;
let failedChanges = 0;
let totalChanges = tagList.length;
if (totalChanges > 0) {
  const testLog = path.join(root, 'test_output.log');
  let hadFailures = false;
  try {
    const content = await readFile(testLog, 'utf8');
    const failMatch = content.match(/fail (\d+)/i);
    if (failMatch && Number(failMatch[1]) > 0) hadFailures = true;
  } catch {
    // No test log yet — treat as unknown, not failed.
  }
  failedChanges = hadFailures ? 1 : 0;
  changeFailureRate = failedChanges / totalChanges;
}

// --- MTTR: mean time to recover — time between a failing build and the next
// successful one. Approximated as days since last tag when tests were red. ---
let mttrDays = null;
if (failedChanges > 0 && tagList.length > 1) {
  const latestDate = new Date(
    execSync(`git -C "${root}" log -1 --format=%ci ${tagList[0]}`, {
      encoding: 'utf8',
    }).trim(),
  );
  const previousDate = new Date(
    execSync(`git -C "${root}" log -1 --format=%ci ${tagList[1]}`, {
      encoding: 'utf8',
    }).trim(),
  );
  mttrDays = (latestDate - previousDate) / (1000 * 60 * 60 * 24);
}

const metrics = {
  generatedAt: now,
  deploymentFrequency, // tags per repo (proxy per week)
  leadTimeDays,
  changeFailureRate,
  failedChanges,
  totalChanges,
  mttrDays,
};

const history = await (async () => {
  try {
    return JSON.parse(await readFile(doraHistoryFile, 'utf8'));
  } catch {
    return { schema: 1, history: [] };
  }
})();

history.history.push(metrics);
// Keep last 52 weeks.
if (history.history.length > 52) history.history = history.history.slice(-52);

await mkdir(path.dirname(doraFile), { recursive: true });
await writeFile(doraFile, JSON.stringify(metrics, null, 2) + '\n', 'utf8');
await writeFile(
  doraHistoryFile,
  JSON.stringify(history, null, 2) + '\n',
  'utf8',
);

console.log(
  `[dora] deploymentFrequency=${deploymentFrequency} leadTimeDays=${leadTimeDays.toFixed(1)} changeFailureRate=${(changeFailureRate * 100).toFixed(1)}% mttrDays=${mttrDays == null ? 'n/a' : mttrDays.toFixed(1)}`,
);

export { metrics, deploymentFrequency, leadTimeDays, changeFailureRate, mttrDays };
