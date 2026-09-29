import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
test.after(async () => { server?.close(); await fs.rm(tempDir, { recursive: true, force: true }); });

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
  assert.equal(data.total.VND, 99000);
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
  assert.equal(data.total.VND, 198000);
});

test('đơn PayPal ghi tiền thực nhận theo USD, không cộng chung với VND', async () => {
  // Same product bought twice in two currencies. Reading the currency bucket off
  // the product row instead of the order would drop the VND total entirely.
  const o = order({ paymentProvider: 'paypal', providerOrderId: 'PAYPAL-1', items: [{ productId: tool.id, name: tool.name, version: '1.0.0', paypalAmount: 3.81, paypalCurrency: 'USD' }] });
  await createOrder(o);
  await markOrderPaid(await getOrder(o.id), { source: 'webhook', providerAmount: 3.81, providerCurrency: 'USD' });
  const data = await revenue();
  assert.equal(data.total.USD, 3.81, 'tiền USD phải nằm riêng');
  assert.equal(data.total.VND, 198000, 'tiền VND của đơn chuyển khoản cùng sản phẩm không được mất');
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
  assert.equal(data.outstanding, 99000, 'chỉ tính đơn còn trong hạn');
});

test('đơn đã hủy không tính vào doanh thu lẫn tiền đang chờ', async () => {
  const o = order({ status: 'cancelled', cancelledAt: new Date().toISOString() });
  await createOrder(o);
  const data = await revenue();
  assert.equal(data.outstanding, 99000, 'đơn hủy không phải tiền đang chờ');
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
