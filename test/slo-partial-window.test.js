import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { measureSLOs, SLOS } from '../scripts/lib/slo.mjs';

// A window SLO measured from a 20-minute sample must not be reported as a pass.
// The evidence value stays visible, but its status is withdrawn until the full
// window is actually observed. This is a negative control for the 17/11 case
// where metrics-slo.json said "100%" with coverageDays=0.0139.

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-slo-partial-'));
const logs = path.join(root, 'logs');
await fs.mkdir(logs, { recursive: true });
const availability = SLOS.find((slo) => slo.id === 'availability');
const errorRateSlo = SLOS.find((slo) => slo.id === 'errorRate');
const evidence = path.join(logs, 'last-availability.json');
const errorEvidence = path.join(logs, 'last-error-report.json');

test.after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const write = (report) => fs.writeFile(evidence, JSON.stringify(report), 'utf8');

test('partial window keeps the value but withdraws the ok status', async () => {
  await write({
    availability: 100,
    samples: 20,
    coverageDays: 0.013888888888888888,
    windowDays: 30,
    observedFrom: '2026-11-17T10:25:00.000Z',
    observedTo: '2026-11-17T10:45:00.000Z',
  });
  const m = (await measureSLOs(root, [availability])).availability;
  assert.equal(m.value, 100, 'the sampled number is still evidence');
  assert.equal(m.sampleSize, 20);
  assert.equal(m.status, 'unknown', 'a 20-minute sample cannot certify a 30-day objective');
  assert.equal(m.breached, false, 'partial is not a breach');
  assert.equal(m.partialWindow, true);
  assert.equal(m.coverageDays < 1, true);
});

test('a short window with a bad value is a gap, not a 30-day breach', async () => {
  // The 20/11 Cloudflare ingest: 30d requested, 3.017d observed because the
  // edge was only switched on on 17/11. A number that bad over that little
  // evidence is a signal to investigate, not a certified 30-day breach — the
  // same rule that made a 20-minute 100% sample "unknown" must apply here.
  await write({
    availability: 83.14,
    samples: 10970,
    coverageDays: 3.017,
    windowDays: 30,
    observedFrom: '2026-11-17T10:25:00.000Z',
    observedTo: '2026-11-20T10:50:00.000Z',
  });
  const m = (await measureSLOs(root, [availability])).availability;
  assert.equal(m.value, 83.14, 'the sampled number is still evidence');
  assert.equal(m.status, 'unknown', '3 days cannot certify a 30-day objective');
  assert.equal(m.breached, false, 'partial is not a breach either way');
  assert.equal(m.partialWindow, true);

  await fs.writeFile(errorEvidence, JSON.stringify({
    errorRate: 16.86,
    samples: 10970,
    coverageDays: 3.017,
    windowDays: 30,
  }), 'utf8');
  const e = (await measureSLOs(root, [errorRateSlo])).errorRate;
  assert.equal(e.value, 16.86);
  assert.equal(e.status, 'unknown');
  assert.equal(e.breached, false);
  assert.equal(e.partialWindow, true);
});

test('full window still reports ok', async () => {
  await write({ availability: 99.8, samples: 5000, coverageDays: 30, windowDays: 30 });
  const m = (await measureSLOs(root, [availability])).availability;
  assert.equal(m.status, 'ok');
  assert.equal(m.partialWindow, false);
});

test('a near-full window is not partial', async () => {
  // A measured span ends at the last real request, so a complete month is a
  // few buckets short of exactly 30 days. The 95% tolerance keeps such a
  // window from being filed as a gap forever.
  await write({ availability: 99.8, samples: 5000, coverageDays: 29.9, windowDays: 30 });
  const m = (await measureSLOs(root, [availability])).availability;
  assert.equal(m.partialWindow, false);
  assert.equal(m.status, 'ok');
});

test('a full window with a bad value still breaches', async () => {
  // The gate is not weakened: only the evidence span changes the status, never
  // a target or a threshold. Once 30 days exist, 83.14% is a real breach.
  await write({ availability: 83.14, samples: 10970, coverageDays: 30, windowDays: 30 });
  const m = (await measureSLOs(root, [availability])).availability;
  assert.equal(m.status, 'breach');
  assert.equal(m.breached, true);
  assert.equal(m.partialWindow, false);
});

test('missing evidence is unknown with a null value', async () => {
  await fs.rm(evidence, { force: true });
  const m = (await measureSLOs(root, [availability])).availability;
  assert.equal(m.value, null);
  assert.equal(m.status, 'unknown');
});
