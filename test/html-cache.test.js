// Edge failover regression: public HTML carries a long shared cache with
// stale-if-error so Cloudflare can keep serving the storefront while the Render
// origin is suspended, while anything under /api/* stays no-store. This is the
// guard on the 2026-11-18 bandwidth incident — a regression to `max-age=300`
// silently restores 288 origin revalidations per page per day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers/env.mjs';
import { closeTest } from './helpers/teardown.mjs';

process.env.NODE_ENV = 'test';
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-cache-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET_NAME = 'test-private-bucket';
process.env.BANK_NAME = 'Test Bank';
process.env.BANK_ACCOUNT_NAME = 'SonVuDev Test';
process.env.BANK_ACCOUNT_NUMBER = '0123456789';
process.env.BANK_BIN = '970436';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';
process.env.ORDER_SWEEP_DISABLED = '1';
process.env.APP_URL = 'http://127.0.0.1:4183';

const { createApp } = await import('../src/app.js');

let server;
let base;
test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await closeTest(server, tempDir); });

test('public HTML is cacheable for a day and survives an origin error via stale-if-error', async () => {
  for (const route of ['/', '/en/', '/404.html']) {
    const response = await fetch(`${base}${route}`);
    const cc = response.headers.get('cache-control') || '';
    assert.match(cc, /public/, `${route} must be a shared cache`);
    assert.match(cc, /max-age=86400/, `${route} must cache for one day, not five minutes`);
    assert.match(cc, /stale-while-revalidate/, `${route} must refresh in the background`);
    assert.match(cc, /stale-if-error=2592000/, `${route} must serve cached HTML when the origin is suspended`);
    assert.match(cc, /no-transform/, `${route} must stop Cloudflare from injecting its JavaScript Detection script`);
  }
});

test('API responses stay no-store even though HTML is now long-cached', async () => {
  const response = await fetch(`${base}/api/health`);
  const cc = response.headers.get('cache-control') || '';
  assert.match(cc, /no-store/, 'order/token/health data must never be shared-cached');
});

test('CSP nonce is still per response so caching HTML does not freeze one nonce globally', async () => {
  const first = (await fetch(`${base}/`)).headers.get('content-security-policy') || '';
  const second = (await fetch(`${base}/`)).headers.get('content-security-policy') || '';
  const nonce = (csp) => (csp.match(/'nonce-([^']+)'/) || [])[1];
  assert.ok(nonce(first), 'CSP must carry a nonce');
  assert.notEqual(nonce(first), nonce(second), 'each origin response must get a fresh nonce');
});
