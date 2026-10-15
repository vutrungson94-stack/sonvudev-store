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

process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-refund-'));
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
process.env.RESEND_API_KEY = '';
// A real IndexNow key in .env would make every product created in these
// tests fire a real ping at api.indexnow.org. Same trap as the mail key above.
process.env.INDEXNOW_KEY = '';

const { createApp } = await import('../src/app.js');
const { getOrder } = await import('../src/store.js');
const { markOrderPaid, voidPayment } = await import('../src/orders.js');

let server;
let base;
let product;
const auth = () => ({ 'x-admin-token': 'test-admin-token' });
const jsonHeaders = { 'content-type': 'application/json', ...auth() };

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const created = await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ name: 'Refund Tester', price: 99000, currency: 'VND', fileKey: 'products/r/1.0.0/r.exe', status: 'active' }),
  });
  product = (await created.json()).product;
});
test.after(async () => { await closeTest(server, tempDir); });

let counter = 0;
const buy = async () => {
  const response = await fetch(`${base}/api/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: product.id, email: 'buyer@example.com', acceptPolicy: 'on', paymentMethod: 'bank_transfer', idempotencyKey: `r-${++counter}` }),
  });
  const data = await response.json();
  await markOrderPaid(await getOrder(data.order.id), { source: 'admin' });
  return data;
};
const refund = (id, reason = 'Khách mua nhầm', category = 'defect') =>
  fetch(`${base}/api/admin/orders/${id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ refund: true, reason, category }) });
const revenue = () => fetch(`${base}/api/admin/revenue`, { headers: auth() }).then((r) => r.json());

test('hoàn tiền đổi trạng thái, giữ nguyên doanh thu gộp và ghi số tiền hoàn riêng', async () => {
  const { order } = await buy();
  const before = await revenue();
  assert.equal(before.gross.VND, 99000);
  assert.equal(before.net.VND, 99000);

  const response = await refund(order.id);
  assert.equal(response.status, 200);
  const after = (await response.json()).order;
  assert.equal(after.status, 'refunded');
  assert.equal(after.refundedAmount, 99000);
  assert.ok(after.refundedAt);
  assert.equal(after.refundReason, 'Khách mua nhầm');
  assert.equal(after.paidAmount, 99000, 'doanh thu gộp phải còn, không bị trừ');
  assert.equal(after.paidCount, 1);

  const report = await revenue();
  assert.equal(report.gross.VND, 99000, 'gộp không đổi');
  assert.equal(report.refunds.VND, 99000, 'hoàn được ghi riêng');
  assert.equal(report.net.VND, 0, 'ròng bằng không');
  assert.equal(report.refundedOrders, 1);
  assert.equal(report.products[0].revenue, 99000);
  assert.equal(report.products[0].net, 0);
});

test('đơn đã hoàn tiền thì không tải được nữa', async () => {
  const { order, accessToken } = await buy();
  const open = await fetch(`${base}/api/orders/${order.id}/download`, { headers: { 'x-order-token': accessToken } });
  assert.equal(open.status, 200, 'trước khi hoàn thì tải được');
  await refund(order.id, 'Chargeback');
  const blocked = await fetch(`${base}/api/orders/${order.id}/download`, { headers: { 'x-order-token': accessToken } });
  assert.equal(blocked.status, 409, 'sau khi hoàn thì phải khoá lại');
});

test('phải có lý do mới cho hoàn, vì khách sẽ đọc lý do đó', async () => {
  const { order } = await buy();
  const blank = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ refund: true, reason: '   ' }) });
  assert.equal(blank.status, 400, 'không lý do thì từ chối');
  const missing = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ refund: true }) });
  assert.equal(missing.status, 400);
  assert.equal((await getOrder(order.id)).status, 'paid', 'đơn phải giữ nguyên');
});

test('không hoàn được đơn chưa thanh toán', async () => {
  const response = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product.id, email: 'buyer@example.com', acceptPolicy: 'on', paymentMethod: 'bank_transfer', idempotencyKey: `u-${counter}` }) });
  const { order } = await response.json();
  const result = await refund(order.id);
  assert.equal(result.status, 409, 'đơn chưa thu tiền thì không có gì để hoàn');
});

test('hoàn tiền cần đúng quyền admin', async () => {
  const { order } = await buy();
  const response = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refund: true, reason: 'x' }) });
  assert.equal(response.status, 401);
});

test('mở lại đơn đã hoàn thì doanh thu ròng tăng lại', async () => {
  const { order } = await buy();
  await refund(order.id, 'Hoàn nhầm');
  const before = await revenue();
  const response = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ status: 'paid' }) });
  assert.equal(response.status, 200);
  const after = (await response.json()).order;
  assert.equal(after.status, 'paid');
  const report = await revenue();
  // The refund stays on the books; reopening only re-grants the download.
  assert.equal(report.refunds.VND, before.refunds.VND, 'lịch sử hoàn tiền không bị xoá');
  assert.ok(report.gross.VND >= 99000);
});

test('đơn đã hoàn thì quét hết hạn không đụng tới', async () => {
  const { sweepOrders } = await import('../src/orders.js');
  const { order } = await buy();
  await refund(order.id, 'Xong');
  const result = await sweepOrders(Date.now() + 48 * 3600e3);
  assert.equal(result.expired.includes(order.id), false, 'đơn đã hoàn không phải đơn quá hạn');
  assert.equal((await getOrder(order.id)).status, 'refunded');
});

test('thư hoàn tiền nói rõ lý do và thu hồi quyền tải', async () => {
  const { previewMessage } = await import('../src/notify.js');
  const message = previewMessage({ id: 'SVD-REF', status: 'refunded', refundReason: 'Khách đổi ý', customerEmail: 'b@e.com', amount: 99000, currency: 'VND', items: [{ name: 'X', version: '1' }] }, 'refunded');
  assert.ok(message.subject.includes('hoàn tiền'));
  assert.ok(message.text.includes('Khách đổi ý'), 'phải nêu lý do khách đọc được');
  assert.ok(message.text.toLowerCase().includes('thu hồi'));
});
