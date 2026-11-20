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
const evidence = path.join(logs, 'last-availability.json');

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

test('full window still reports ok', async () => {
  await write({ availability: 99.8, samples: 5000, coverageDays: 30, windowDays: 30 });
  const m = (await measureSLOs(root, [availability])).availability;
  assert.equal(m.status, 'ok');
  assert.equal(m.partialWindow, false);
});

test('missing evidence is unknown with a null value', async () => {
  await fs.rm(evidence, { force: true });
  const m = (await measureSLOs(root, [availability])).availability;
  assert.equal(m.value, null);
  assert.equal(m.status, 'unknown');
});
