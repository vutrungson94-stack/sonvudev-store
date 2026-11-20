import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDom, runScript } from './helpers/dom.mjs';

// The public status page must not print "100%" for a 20-minute sample whose
// SLO status was withdrawn. It uses the same status.unknownMeasured string it
// already uses for a missing value, so no new translation keys are needed.

const source = await readFile(new URL('../public/status.js', import.meta.url), 'utf8');
const ids = [
  'status-dot', 'status-live-text',
  'status-availability', 'status-availability-note',
  'status-errorrate', 'status-errorrate-note',
  'status-p95', 'status-p95-note',
  'status-incidents', 'status-incidents-note',
  'status-commit', 'status-uptime', 'status-measured',
];

const payload = (status) => ({
  checkedAt: '2026-11-19T03:32:59.800Z',
  uptimeSec: 10,
  probe: { state: 'up' },
  commit: '675f979',
  slo: {
    availability: {
      value: 100, unit: '%', status, breached: false, sampleSize: 20,
      coverageDays: 0.013888888888888888, windowDays: 30, partialWindow: true,
      measuredAt: '2026-11-19T03:32:59.800Z',
    },
    errorRate: { value: null, status: 'unknown', breached: false },
    latencyP95: { value: null, status: 'unknown', breached: false },
  },
  incidents: null,
});

const render = async (status) => {
  const { document, nodes } = createDom(ids);
  const result = await runScript(source, {
    document,
    window: { I18N: { lang: 'vi', t: (key) => key } },
    fetch: async () => ({ ok: true, json: async () => payload(status) }),
  });
  return { nodes, result };
};

test('status unknown renders the honest string, not 100%', async () => {
  const { nodes, result } = await render('unknown');
  assert.deepEqual(result.errors, []);
  assert.equal(nodes.get('status-availability').textContent, 'status.unknownMeasured');
  assert.ok(nodes.get('status-availability-note').textContent.includes('status.coverage.partial'));
});

test('status ok is still rendered as a measured number', async () => {
  const { nodes, result } = await render('ok');
  assert.deepEqual(result.errors, []);
  assert.equal(nodes.get('status-availability').textContent, '100%');
});
