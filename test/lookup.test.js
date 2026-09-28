import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Order recovery by order id + email. This is what replaces sending the access
// token by email, so it decides whether a buyer can still reach their download
// after closing the tab.
process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-lookup-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.BANK_NAME = 'Test Bank';
process.env.BANK_ACCOUNT_NAME = 'SonVuDev Test';
process.env.BANK_ACCOUNT_NUMBER = '0123456789';
process.env.BANK_BIN = '970436';
process.env.ADMIN_API_TOKEN = 'test-admin-token';

const { createApp } = await import('../src/app.js');
let server;
let base;

test.before(async () => { server = (await createApp()).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server?.close(); await fs.rm(tempDir, { recursive: true, force: true }); });

// Publishes a product and returns the order created against it.
async function placeOrder(email) {
  const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };
  const created = await fetch(`${base}/api/admin/products`, { method: 'POST', headers, body: JSON.stringify({ name: 'Lookup Tester', category: 'Công cụ', platform: 'Windows', version: '1.0.0', price: 99000, currency: 'VND', fileKey: 'products/lookup/1.0.0/test.exe', status: 'active' }) });
  const product = (await created.json()).product;
  const response = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product.id, email, customerName: 'Buyer', paymentMethod: 'bank_transfer' }) });
  assert.equal(response.status, 200);
  return response.json();
}

const lookup = (orderId, email) => fetch(`${base}/api/orders/lookup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId, email }) });

test('lookup recovers the order with the matching order id and email', async () => {
  const order = await placeOrder('recover@example.com');
  const response = await lookup(order.order.id, 'recover@example.com');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.order.id, order.order.id);
  assert.equal(data.accessToken.length, 48);
  assert.equal(data.order.accessTokenHash, undefined);

  // The recovered token is what actually opens the order.
  const fetched = await fetch(`${base}/api/orders/${encodeURIComponent(order.order.id)}`, { headers: { 'x-order-token': data.accessToken } });
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).order.id, order.order.id);
});

test('lookup invalidates the previous token', async () => {
  const order = await placeOrder('rotate@example.com');
  const fresh = (await (await lookup(order.order.id, 'rotate@example.com')).json()).accessToken;
  const stale = await fetch(`${base}/api/orders/${encodeURIComponent(order.order.id)}`, { headers: { 'x-order-token': order.accessToken } });
  assert.equal(stale.status, 404, 'the token from checkout must stop working');
  const current = await fetch(`${base}/api/orders/${encodeURIComponent(order.order.id)}`, { headers: { 'x-order-token': fresh } });
  assert.equal(current.status, 200);
});

test('lookup refuses a wrong email without revealing the order exists', async () => {
  const order = await placeOrder('owner@example.com');
  const response = await lookup(order.order.id, 'attacker@example.com');
  assert.equal(response.status, 404);
  const wrongEmail = (await response.json()).error;
  const missing = await lookup('SVD-DOESNOTEXIST', 'owner@example.com');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, wrongEmail, 'both failures must be indistinguishable');
});

test('lookup rejects malformed input', async () => {
  for (const body of [{ orderId: '', email: 'a@b.com' }, { orderId: 'SVD-X', email: 'not-an-email' }]) {
    const response = await fetch(`${base}/api/orders/lookup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
  }
});

test('lookup stops answering after too many attempts from one client', async () => {
  // The limiter is per IP and the other tests in this file share 127.0.0.1, so
  // start from whatever budget is left rather than assuming this test runs first.
  let blocked = 0;
  for (let i = 0; i < 15 && blocked === 0; i += 1) {
    const response = await lookup('SVD-BRUTEFORCE', `probe${i}@b.com`);
    if (response.status === 429) blocked = i + 1;
  }
  assert.ok(blocked > 0, 'repeated attempts should eventually be refused');
  assert.ok(blocked <= 11, `refused after ${blocked} attempts, the limit should be about 10`);
  // Once blocked it stays blocked, even for the correct order id and email.
  const order = await placeOrder('blocked@example.com');
  const withOrder = await lookup(order.order.id, 'blocked@example.com');
  assert.equal(withOrder.status, 429);
});

test('the legal pages are published and linked from the storefront', async () => {
  for (const page of ['/terms', '/privacy', '/refund']) {
    const response = await fetch(`${base}${page}`);
    assert.equal(response.status, 200, page);
    const html = await response.text();
    assert.match(html, /<h1>/, page);
    assert.match(html, /mailto:hello@sonvudev\.com/, page);
  }
  const home = await (await fetch(`${base}/`)).text();
  for (const link of ['/terms', '/privacy', '/refund', '/lookup']) assert.ok(home.includes(`href="${link}"`), `footer should link ${link}`);
});

test('the sitemap lists the storefront and the legal pages but not the lookup', async () => {
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  for (const loc of ['<loc>https://sonvudev.com/</loc>', '<loc>https://sonvudev.com/terms</loc>', '<loc>https://sonvudev.com/privacy</loc>', '<loc>https://sonvudev.com/refund</loc>']) {
    assert.ok(sitemap.includes(loc), `sitemap should contain ${loc}`);
  }
  assert.ok(!sitemap.includes('/lookup'), 'the lookup page is not for search engines');
});

test('the order page and lookup page are served', async () => {
  assert.equal((await fetch(`${base}/lookup`)).status, 200);
  assert.equal((await fetch(`${base}/order/SVD-ANYTHING`)).status, 200);
  assert.equal((await fetch(`${base}/lookup.js`)).status, 200);
  assert.equal((await fetch(`${base}/order.js`)).status, 200);
});
