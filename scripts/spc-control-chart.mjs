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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trendsFile = path.join(root, 'metrics-trends.json');
const spcFile = path.join(root, 'metrics-spc.json');

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stdev = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + Math.pow(b - m, 2), 0) / xs.length);
};

// Detect runs: 8 consecutive points on one side of the mean.
const hasRunSameSide = (values, meanValue) => {
  let run = 0;
  for (const v of values) {
    if (v >= meanValue) run++;
    else run = 0;
    if (run >= 8) return true;
  }
  run = 0;
  for (const v of values) {
    if (v <= meanValue) run++;
    else run = 0;
    if (run >= 8) return true;
  }
  return false;
};

// Detect trend: 7 steadily increasing or decreasing points.
const hasSteadyTrend = (values) => {
  if (values.length < 7) return false;
  let inc = 0, dec = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) { inc++; dec = 0; }
    else if (values[i] < values[i - 1]) { dec++; inc = 0; }
    else { inc = 0; dec = 0; }
    if (inc >= 7 || dec >= 7) return true;
  }
  return false;
};

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
  };
}

const outOfControl = Object.values(spc.metrics).filter((m) => !m.inControl);

await mkdir(path.dirname(spcFile), { recursive: true });
await writeFile(spcFile, JSON.stringify(spc, null, 2) + '\n', 'utf8');

let exitCode = 0;
if (outOfControl.length > 0) {
  console.log(
    `[spc] OUT OF CONTROL: ${outOfControl.length} metric(s) showing special-cause variation: ${outOfControl.map((m) => m.key).join(', ')}`,
  );
  exitCode = 1;
} else {
  console.log(`[spc] OK: all ${Object.keys(spc.metrics).length} metrics in statistical control`);
}

process.exit(exitCode);
