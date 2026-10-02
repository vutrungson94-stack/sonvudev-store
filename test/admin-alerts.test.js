import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';

// The admin badge poll. Losing a paid order because nobody noticed it sitting in
// a list is the failure this endpoint exists to prevent.
process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-alert-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.BANK_NAME = 'Test Bank';
process.env.BANK_ACCOUNT_NAME = 'SonVuDev Test';
process.env.BANK_ACCOUNT_NUMBER = '0123456789';
process.env.BANK_BIN = '970436';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
// Never let a real key in .env turn a test run into real email.
process.env.RESEND_API_KEY = '';
// A real IndexNow key in .env would make these tests fire a real ping at
// api.indexnow.org. Same trap as the mail key above.
process.env.INDEXNOW_KEY = '';

const { createApp } = await import('../src/app.js');
let server;
let base;

test.before(async () => { server = (await createApp()).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server?.close(); await fs.rm(tempDir, { recursive: true, force: true }); });

const auth = () => ({ 'x-admin-token': 'test-admin-token' });

async function publish(email) {
  const headers = { 'content-type': 'application/json', ...auth() };
  const created = await fetch(`${base}/api/admin/products`, { method: 'POST', headers, body: JSON.stringify({ name: 'Alert Tester', category: 'Công cụ', platform: 'Windows', version: '1.0.0', price: 99000, currency: 'VND', fileKey: 'products/alert/test.exe', status: 'active' }) });
  const product = (await created.json()).product;
  const response = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product.id, email, customerName: 'Buyer', paymentMethod: 'bank_transfer' }) });
  return (await response.json()).order;
}

test('the pending poll refuses callers without the admin token', async () => {
  const response = await fetch(`${base}/api/admin/orders/pending`);
  assert.equal(response.status, 401);
});

test('the pending poll reports no orders on an empty store', async () => {
  const response = await fetch(`${base}/api/admin/orders/pending`, { headers: auth() });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.pending, 0);
  assert.equal(data.latest, 0);
  assert.equal(data.newest, null);
});

test('a bank transfer order is counted as waiting and raises the latest stamp', async () => {
  const before = await (await fetch(`${base}/api/admin/orders/pending`, { headers: auth() })).json();
  const order = await publish('waiting@example.com');
  assert.equal(order.status, 'pending_transfer');

  const after = await (await fetch(`${base}/api/admin/orders/pending`, { headers: auth() })).json();
  assert.equal(after.pending, 1, 'the new transfer must show up as waiting');
  assert.ok(after.latest > before.latest, 'latest must move so the client can spot a new order');
  assert.equal(after.newest.id, order.id);
  assert.equal(after.newest.status, 'pending_transfer');
});

test('confirming the order clears the waiting count', async () => {
  const { pending, newest } = await (await fetch(`${base}/api/admin/orders/pending`, { headers: auth() })).json();
  assert.equal(pending, 1);
  await fetch(`${base}/api/admin/orders/${encodeURIComponent(newest.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...auth() }, body: JSON.stringify({ status: 'paid' }) });
  const after = await (await fetch(`${base}/api/admin/orders/pending`, { headers: auth() })).json();
  assert.equal(after.pending, 0, 'a paid order must stop nagging the owner');
});

test('the admin page ships the alert banner the poll drives', async () => {
  const html = await (await fetch(`${base}/admin.html`)).text();
  assert.match(html, /id="admin-alert"/);
  assert.match(html, /id="admin-alert-go"/);
  const script = await (await fetch(`${base}/admin.js`)).text();
  assert.match(script, /\/api\/admin\/orders\/pending/);
  assert.match(script, /startPolling\(\)/);
  assert.match(script, /stopPolling\(\)/);
});
