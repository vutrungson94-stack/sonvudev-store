import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';
import { closeTest } from './helpers/teardown.mjs';

process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-revenue-'));
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
process.env.PAYPAL_CURRENCY = 'USD';
process.env.ORDER_PAYMENT_WINDOW_HOURS = '24';
// These tests mark orders paid, which sends mail. A real key in .env would send
// real email to a real inbox on every run.
process.env.RESEND_API_KEY = '';
// A real IndexNow key in .env would make every product created in these
// tests fire a real ping at api.indexnow.org. Same trap as the mail key above.
process.env.INDEXNOW_KEY = '';

const { createApp } = await import('../src/app.js');
const { createOrder, getOrder, updateOrder } = await import('../src/store.js');
const { markOrderDelivered, markOrderPaid } = await import('../src/orders.js');

let server;
let base;
let tool;
let suite;
const auth = () => ({ 'x-admin-token': 'test-admin-token' });
const jsonHeaders = { 'content-type': 'application/json', ...auth() };
const revenue = () => fetch(`${base}/api/admin/revenue`, { headers: auth() }).then((r) => r.json());

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const created = await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ name: 'Capacity Tester', price: 99000, currency: 'VND', fileKey: 'products/c/1.0.0/c.exe', status: 'active' }),
  });
  tool = (await created.json()).product;
  const suiteCreated = await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ name: 'SonVu Suite', price: 699000, currency: 'VND', fileKey: 'products/s/1.0.0/s.exe', status: 'active' }),
  });
  suite = (await suiteCreated.json()).product;
});
test.after(async () => { await closeTest(server, tempDir); });

let counter = 0;
const order = (overrides = {}) => {
  const id = `SVD-REV-${++counter}`;
  return {
    id, orderNumber: id, accessTokenHash: 'h', customerEmail: 'buyer@example.com', customerName: 'Buyer',
    status: 'pending_transfer', paymentProvider: 'bank_transfer', providerOrderId: null,
    amount: 99000, currency: 'VND', items: [{ productId: tool.id, name: tool.name, version: '1.0.0' }],
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400e3).toISOString(), updatedAt: new Date().toISOString(), ...overrides,
  };
};

test('endpoint doanh thu đòi admin token', async () => {
  const response = await fetch(`${base}/api/admin/revenue`);
  assert.equal(response.status, 401);
});

test('chưa bán gì thì doanh thu bằng không, không lỗi', async () => {
  const data = await revenue();
  assert.deepEqual(data.products, []);
  assert.equal(data.paidOrders, 0);
});

test('một đơn chuyển khoản đã thu tính vào doanh thu sản phẩm', async () => {
  const o = order();
  await createOrder(o);
  await markOrderPaid(await getOrder(o.id), { source: 'admin' });
  const data = await revenue();
  const row = data.products.find((p) => p.productId === tool.id);
  assert.equal(row.units, 1);
  assert.equal(row.orders, 1);
  assert.equal(row.revenue, 99000);
  assert.equal(row.avg, 99000);
  assert.equal(data.gross.VND, 99000);
});

test('đơn đã giao vẫn còn trong doanh thu', async () => {
  // Closing an order after download resets status to pending. Revenue that
  // disappears the day a customer downloads is worse than useless.
  const o = order();
  await createOrder(o);
  await markOrderPaid(await getOrder(o.id), { source: 'admin' });
  await markOrderDelivered(await getOrder(o.id));
  assert.equal((await getOrder(o.id)).status, 'pending', 'đơn phải về trạng thái đơn mới');
  const data = await revenue();
  const row = data.products.find((p) => p.productId === tool.id);
  assert.equal(row.units, 2, 'đơn đã giao vẫn phải được tính');
  assert.equal(data.gross.VND, 198000);
});

test('đơn PayPal ghi tiền thực nhận theo USD, không cộng chung với VND', async () => {
  // Same product bought twice in two currencies. Reading the currency bucket off
  // the product row instead of the order would drop the VND total entirely.
  const o = order({ paymentProvider: 'paypal', providerOrderId: 'PAYPAL-1', items: [{ productId: tool.id, name: tool.name, version: '1.0.0', paypalAmount: 3.81, paypalCurrency: 'USD' }] });
  await createOrder(o);
  await markOrderPaid(await getOrder(o.id), { source: 'webhook', providerAmount: 3.81, providerCurrency: 'USD' });
  const data = await revenue();
  assert.equal(data.gross.USD, 3.81, 'tiền USD phải nằm riêng');
  assert.equal(data.gross.VND, 198000, 'tiền VND của đơn chuyển khoản cùng sản phẩm không được mất');
  const row = data.products.find((p) => p.productId === tool.id);
  assert.equal(row.provider, 3.81, 'phải có cột thực nhận PayPal');
  assert.equal(row.revenue, 297000, 'cột VND là tổng giá niêm yết của cả ba đơn');
});

test('tách theo từng sản phẩm, sắp xếp theo số lượng bán', async () => {
  const o = order({ items: [{ productId: suite.id, name: suite.name, version: '1.0.0' }], amount: 699000 });
  await createOrder(o);
  await markOrderPaid(await getOrder(o.id), { source: 'admin' });
  const data = await revenue();
  assert.equal(data.products.length, 2, 'phải có hai sản phẩm');
  const [top, second] = data.products;
  assert.equal(top.productId, tool.id, 'sản phẩm bán nhiều hơn phải lên đầu');
  assert.equal(top.units, 3);
  assert.equal(second.productId, suite.id);
  assert.equal(second.units, 1);
  assert.equal(second.revenue, 699000);
  // Average is per unit, not per order, or a bundle looks like a rip-off.
  assert.equal(second.avg, 699000);
});

test('đơn quá hạn không tính vào tiền đang chờ thu', async () => {
  const fresh = order();
  await createOrder(fresh);
  const stale = order({ expiresAt: new Date(Date.now() - 3600e3).toISOString() });
  await createOrder(stale);
  const data = await revenue();
  // Bucketed by currency, not a bare number. An unpaid order inside its window
  // is not necessarily priced in VND — a PayPal order waiting for capture is
  // unpaid too, and its amount is in PAYPAL_CURRENCY. Summing those together and
  // labelling the result "VND" put a live dollar amount into a dong column on
  // the panel the owner reconciles against a bank statement with.
  assert.equal(data.outstanding.VND, 99000, 'chỉ tính đơn còn trong hạn, và ghi theo đúng tiền tệ');
});

test('tiền đang chờ thu tách bạch theo tiền tệ, không cộng chung', async () => {
  // Measured as a delta, not an absolute. Every test in this file creates orders
  // in the same store, so the VND total keeps growing from test to test — an
  // absolute assertion here would pass or fail depending on the order the runner
  // happened to use, which is the flaky-test pattern this whole file avoids.
  const before = (await revenue()).outstanding;
  const vnd = order();
  await createOrder(vnd);
  const usd = order({ currency: 'USD', amount: 9 });
  await createOrder(usd);
  const after = (await revenue()).outstanding;

  assert.equal((after.VND || 0) - (before.VND || 0), 99000,
    'đơn VND chưa thanh toán phải tăng bucket VND đúng số tiền');
  assert.equal((after.USD || 0) - (before.USD || 0), 9,
    'đơn USD chưa thanh toán phải nằm ở bucket USD — không cộng vào VND, không cộng vào USD của đơn khác');
});

test('đơn đã hủy không tính vào doanh thu lẫn tiền đang chờ', async () => {
  const o = order({ status: 'cancelled', cancelledAt: new Date().toISOString() });
  await createOrder(o);
  const data = await revenue();
  assert.equal(data.outstanding.VND, 198000, 'đơn hủy không phải tiền đang chờ');
  assert.equal(data.products.find((p) => p.productId === tool.id).units, 3, 'đơn hủy không phải doanh thu');
});

test('báo cáo ghi thời điểm lập để chủ cửa hàng biết số liệu lúc nào', async () => {
  const data = await revenue();
  assert.ok(data.generatedAt, 'phải có thời điểm lập báo cáo');
  assert.equal(Number.isNaN(Date.parse(data.generatedAt)), false);
});

test('thanh toán trùng không làm doanh thu nhân đôi', async () => {
  const o = order();
  await createOrder(o);
  const paid = await markOrderPaid(await getOrder(o.id), { source: 'admin' });
  await markOrderPaid(paid, { source: 'webhook' });
  const data = await revenue();
  assert.equal(data.paidOrders, 5, 'một lần thu tiền phải tính đúng một lần');
});

// ---------------------------------------------------------------------------
// The Postgres projection is a contract, and nothing else in this file can check
// it.
//
// Every test here runs against the local JSON backend, which returns whole rows.
// So the assertion at line 119 — the one that proves USD is bucketed separately —
// passes on local and would have passed with `paid_provider_currency` missing from
// the projection too, because local never uses the projection at all. The column
// was absent from `listOrdersForRevenue` for as long as this test existed, and on a
// deployed Postgres every PayPal sale was booked at its VND shelf price under
// gross.VND. Nothing went red: the suite, the audit, the case check and the build
// all passed on a shop whose revenue report was wrong in the currency the owner
// reconciles against a PayPal statement with.
//
// So the contract is asserted directly: every order field the revenue handler reads
// has to be either a projected column or an alias fromOrder knows how to fill. A
// column dropped from the projection reads as null, which is how a missing value
// becomes a wrong number instead of a visible failure.
// ---------------------------------------------------------------------------
test('mọi trường đơn mà báo cáo đọc đều phải có trong projection của Postgres', async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const readSource = (relative) => fs.readFile(path.join(__dirname, '..', relative), 'utf8');
  const store = await readSource('src/store.js');
  const app = await readSource('src/app.js');

  const projection = store.match(/const columns = "([^"]*)"/)[1].split(',').map((c) => c.trim());
  const fromOrder = store.match(/const fromOrder = \(row\) => row \? \{[\s\S]*?\} : null;/)[0];
  // Fields fromOrder knows how to fill in, whichever spelling the row uses.
  const aliased = new Set([...fromOrder.matchAll(/([a-zA-Z][\w]*): row\./g)].map((m) => m[1]));

  const handler = app.slice(app.indexOf('/api/admin/revenue'), app.indexOf('/api/admin/orders/:id'));
  const read_ = [...new Set([...handler.matchAll(/order\.([a-zA-Z][\w]*)/g)].map((m) => m[1]))];

  // `items` arrives as a JSON column and is spread field by field, so its own
  // fields are not order columns and must not be required of the projection.
  const itemFields = new Set(['items']);
  const missing = read_.filter((field) => !itemFields.has(field)
    && !projection.includes(field)
    && !aliased.has(field));

  assert.deepEqual(missing, [],
    `báo cáo đọc ${read_.join(', ')} nhưng projection thiếu: ${missing.join(', ')}`);
  assert.ok(projection.includes('paid_provider_currency'),
    'paid_provider_currency phải được chọn: báo cáo nhóm gross theo nó, thiếu thì mọi đơn PayPal rơi vào bucket VND');
});
