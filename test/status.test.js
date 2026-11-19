import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Test environment must be applied before anything imports src/. See helpers/env.mjs.
import './helpers/env.mjs';
import { closeTest } from './helpers/teardown.mjs';

// The public /status page: every number on it must be a measurement, never
// marketing copy, and neither the page nor /api/status may leak admin-only
// detail. This test exists because a status page that fails silently is worse
// than none - a visitor sees a green badge and buys from a shop whose origin
// is down.
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-status-'));
process.env.DATA_DIR = tempDir;

const { createApp } = await import('../src/app.js');
let server;
let base;

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await closeTest(server, tempDir); });

test('/status renders the measured-status page chrome', async () => {
  const response = await fetch(`${base}/status`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('status-live-text'), 'live region present');
  assert.ok(html.includes('/status.js'), 'client script wired');
});

test('/en/status is served as a real route (not a static 404)', async () => {
  const response = await fetch(`${base}/en/status`);
  assert.equal(response.status, 200);
});

test('/api/status answers with measured data and no admin detail', async () => {
  const response = await fetch(`${base}/api/status`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(typeof body.checkedAt === 'string' && !Number.isNaN(Date.parse(body.checkedAt)), 'checkedAt is a date');
  assert.ok(Number.isFinite(body.uptimeSec), 'uptime present');
  assert.ok(['up', 'down', 'skipped'].includes(body.probe?.state), 'probe state is one of up/down/skipped');
  assert.ok('slo' in body, 'slo block present');
  assert.ok('incidents' in body, 'incidents block present');
  // Never leak admin-only or payment secrets through the public page JSON.
  const raw = JSON.stringify(body);
  assert.equal(raw.includes('paypalWebhookId'), false);
  assert.equal(raw.includes('paypalEnvironment'), false);
  assert.equal(raw.includes('test-admin-token'), false);
  assert.equal(raw.includes('ADMIN_API_TOKEN'), false);
});

test('/api/status slo block is either measured or honestly absent', async () => {
  const response = await fetch(`${base}/api/status`);
  const body = await response.json();
  if (body.slo === null) return; // evidence not present on this host: page must say so, tested client-side
  assert.equal(typeof body.slo.windowDays, 'number');
  assert.ok(body.slo.availability === null || typeof body.slo.availability.value === 'number' || body.slo.availability.value === null);
});
