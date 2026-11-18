// SPC / Statistical Process Control charts.
//
// A Level 5 platform does not react to every up-and-down number; it reacts when
// the process goes out of statistical control. This module reads
// metrics-trends.json, computes the mean and 3-sigma control limits for each
// metric, and flags any point outside the limits as a special-cause signal.
//
//   npm run spc:check        compute control limits and flag out-of-control points
//   npm run spc:baseline     write baseline control limits
//
// Control limits: UCL = mean + 3*stdev, LCL = mean - 3*stdev.
// A point outside UCL/LCL, or 8 consecutive points on one side of the mean,
// or a run of 7 steadily increasing/decreasing points, is a signal.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mean, stdev, hasRunSameSide, hasSteadyTrend } from './lib/spc.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trendsFile = path.join(root, 'metrics-trends.json');
const spcFile = path.join(root, 'metrics-spc.json');
// The roadmap's L5 acceptance criterion: a control limit computed from fewer
// than 25 points is not stable enough to act on. The gate does not fail below
// this (a young repository would be red for weeks for something only time can
// fix) — it labels the snapshot as not yet sufficient so the number is never
// mistaken for a proven control limit.
const MIN_SAMPLE = 25;

const trends = JSON.parse(await readFile(trendsFile, 'utf8'));
const history = trends.history || [];

// Collect all metric keys from history.
const allKeys = new Set();
for (const h of history) {
  for (const k of Object.keys(h.measurements || {})) allKeys.add(k);
}

const spc = { generatedAt: new Date().toISOString(), metrics: {} };

for (const key of allKeys) {
  const values = history
    .map((h) => h.measurements?.[key])
    .filter((v) => typeof v === 'number');
  if (values.length < 3) continue; // need enough data for control limits

  const m = mean(values);
  const s = stdev(values);
  const ucl = m + 3 * s;
  const lcl = m - 3 * s;
  const latest = values[values.length - 1];

  const signals = [];
  if (latest > ucl) signals.push('above-upper-control-limit');
  if (latest < lcl) signals.push('below-lower-control-limit');
  if (hasRunSameSide(values, m)) signals.push('eight-points-one-side-of-mean');
  if (hasSteadyTrend(values)) signals.push('seven-point-steady-trend');

  spc.metrics[key] = {
    mean: Number(m.toFixed(4)),
    stdev: Number(s.toFixed(4)),
    ucl: Number(ucl.toFixed(4)),
    lcl: Number(lcl.toFixed(4)),
    latest,
    inControl: signals.length === 0,
    signals,
    n: values.length,
    sufficient: values.length >= MIN_SAMPLE,
  };
}

const outOfControl = Object.entries(spc.metrics)
  .filter(([, m]) => !m.inControl)
  .map(([key]) => key);
const notSufficient = Object.entries(spc.metrics)
  .filter(([, m]) => !m.sufficient)
  .map(([key]) => key);

spc.minSampleSize = MIN_SAMPLE;
spc.sampleSufficient = notSufficient.length === 0;

await mkdir(path.dirname(spcFile), { recursive: true });
await writeFile(spcFile, JSON.stringify(spc, null, 2) + '\n', 'utf8');

let exitCode = 0;
if (outOfControl.length > 0) {
  console.log(
    `[spc] OUT OF CONTROL: ${outOfControl.length} metric(s) showing special-cause variation: ${outOfControl.join(', ')}`,
  );
  exitCode = 1;
} else {
  console.log(`[spc] OK: all ${Object.keys(spc.metrics).length} metrics in statistical control`);
}
if (notSufficient.length > 0) {
  console.log(
    `[spc] WARNING: ${notSufficient.length} metric(s) have n < ${MIN_SAMPLE} — control limits are not yet stable enough to act on (L5 target ≥ ${MIN_SAMPLE} points): ${notSufficient.join(', ')}`,
  );
}

process.exit(exitCode);
