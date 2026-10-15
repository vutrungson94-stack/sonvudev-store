import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';
import { closeTest } from './helpers/teardown.mjs';

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
// Never let a real key in .env turn a test run into real email.
process.env.RESEND_API_KEY = '';
// A real IndexNow key in .env would make these tests fire a real ping at
// api.indexnow.org. Same trap as the mail key above.
process.env.INDEXNOW_KEY = '';

const { createApp } = await import('../src/app.js');
let server;
let base;
let product;

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  // One product, reused. A slug is unique, so publishing "Lookup Tester" three
  // times is now a 409 rather than three rows that quietly shadow each other in
  // the storefront — which is what the local JSON store used to allow and Postgres
  // never did.
  const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };
  const created = await fetch(`${base}/api/admin/products`, { method: 'POST', headers, body: JSON.stringify({ name: 'Lookup Tester', category: 'Công cụ', platform: 'Windows', version: '1.0.0', price: 99000, currency: 'VND', fileKey: 'products/lookup/1.0.0/test.exe', status: 'active', shortDescriptionEn: 'Finds an order fast.', descriptionEn: 'Looks up an order and recovers its download link.', features: ['Tra cứu nhanh'], featuresEn: ['Finds an order fast'] }) });
  product = (await created.json()).product;
});
test.after(async () => { await closeTest(server, tempDir); });

// Places an order against the shared product and returns the checkout response.
async function placeOrder(email) {
  const response = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product.id, email, customerName: 'Buyer', acceptPolicy: 'on', paymentMethod: 'bank_transfer' }) });
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
    // Read from the configuration rather than the shop's real address. This used
    // to assert on a literal shop mailbox, which meant the test only
    // passed on one machine with one .env — and failed outright in CI, where
    // APP_URL and SUPPORT_EMAIL are deliberately set to fixture values.
    assert.ok(html.includes(`mailto:${process.env.SUPPORT_EMAIL}`), `${page} phải liên hệ bằng SUPPORT_EMAIL`);
    assert.ok(!html.includes('{{support}}'), `${page} con sot token chua thay`);
  }
  const home = await (await fetch(`${base}/`)).text();
  for (const link of ['/terms', '/privacy', '/refund', '/lookup']) assert.ok(home.includes(`href="${link}"`), `footer should link ${link}`);
});

test('the sitemap lists the storefront and the legal pages but not the lookup', async () => {
  const site = process.env.APP_URL.replace(/\/$/, '');
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  for (const loc of ['/', '/terms', '/privacy', '/refund', '/about']) {
    assert.ok(sitemap.includes(`<loc>${site}${loc}</loc>`), `sitemap should contain ${site}${loc}`);
  }
  // Matched exactly rather than as a substring: a product whose slug happens to
  // contain the word "lookup" is still a product and belongs in the sitemap.
  assert.ok(!sitemap.includes(`<loc>${site}/lookup</loc>`), 'the lookup page is not for search engines');
  assert.ok(sitemap.includes(`<loc>${site}/product/lookup-tester</loc>`), 'products belong in the sitemap');
  // Every product has two language URLs that point at each other, so a crawler
  // does not drop the English one as a duplicate of the Vietnamese.
  assert.ok(sitemap.includes(`<loc>${site}/en/product/lookup-tester</loc>`), 'ban tieng Anh phai co trong sitemap');
});

test('the order page and lookup page are served', async () => {
  assert.equal((await fetch(`${base}/lookup`)).status, 200);
  assert.equal((await fetch(`${base}/order/SVD-ANYTHING`)).status, 200);
  assert.equal((await fetch(`${base}/lookup.js`)).status, 200);
  assert.equal((await fetch(`${base}/order.js`)).status, 200);
});
