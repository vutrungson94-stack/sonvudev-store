import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-order-'));
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
// Keep the clock out of the real 24h window so the sweep can be driven by hand.
process.env.ORDER_PAYMENT_WINDOW_HOURS = '24';
process.env.ORDER_EXPIRY_WARN_HOURS = '1';
// A real key in .env must never turn a test run into real email to a real
// inbox, and this file asserts on the outbox path anyway.
process.env.RESEND_API_KEY = '';

const { createApp } = await import('../src/app.js');
const { createOrder, getOrder, listOrders, updateOrder } = await import('../src/store.js');
const { isExpired, markOrderDelivered, markOrderPaid, paymentDeadline, sweepOrders } = await import('../src/orders.js');
const { notifyOrder, outboxPath } = await import('../src/notify.js');

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
    body: JSON.stringify({ name: 'Order Tester', price: 99000, currency: 'VND', fileKey: 'products/t/1.0.0/t.exe', status: 'active' }),
  });
  product = (await created.json()).product;
});
test.after(async () => { server?.close(); await fs.rm(tempDir, { recursive: true, force: true }); });

const checkout = async (overrides = {}) => {
  const response = await fetch(`${base}/api/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: product.id, email: 'buyer@example.com', customerName: 'Test User', paymentMethod: 'bank_transfer', ...overrides }),
  });
  return { response, data: await response.json() };
};

const age = async (id, hours) => {
  const iso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  await updateOrder(id, { createdAt: iso, expiresAt: iso });
  return iso;
};

test('checkout ghi han thanh toan 24 gio va bao qua cho nguoi mua', async () => {
  const { response, data } = await checkout();
  assert.equal(response.status, 200);
  const hours = (new Date(data.expiresAt) - new Date(data.order.createdAt)) / 3600000;
  assert.equal(Math.round(hours), 24, 'han thanh toan phai dung 24 gio');
  assert.equal(data.order.status, 'pending_transfer');
  assert.ok(data.serverTime, 'phai tra server time de dem nguoc chinh dong ho');
  // The countdown is only meaningful if the browser can read the deadline back.
  const read = await fetch(`${base}/api/orders/${data.order.id}`, { headers: { 'x-order-token': data.accessToken } });
  const payload = await read.json();
  assert.equal(payload.expiresAt, data.expiresAt);
  assert.equal(payload.order.accessTokenHash, undefined, 'khong ro token hash ra ngoai');
  assert.equal(payload.order.notifications, undefined, 'khong ro nhat ky gui mail ra ngoai');
});

test('checkout options tra so gio de bien muc dang ky tu server', async () => {
  const response = await fetch(`${base}/api/checkout/options`);
  assert.equal((await response.json()).paymentWindowHours, 24);
});

test('checkout lai voi cung idempotencyKey tra ve chinh don do, khong tao don moi', async () => {
  const key = 'retry-key-1';
  const first = await checkout({ idempotencyKey: key });
  const second = await checkout({ idempotencyKey: key });
  assert.equal(first.data.order.id, second.data.order.id, 'phai tra ve cung mot don');
  assert.notEqual(first.data.accessToken, second.data.accessToken, 'phai cap lai ma tra cuu cho lan thu lai');
  const rows = (await listOrders()).filter((o) => o.idempotencyKey === key);
  assert.equal(rows.length, 1, 'khong duoc tao hai don cho mot lan thanh toán');
  // The recovered token has to actually work, or the buyer is locked out.
  const read = await fetch(`${base}/api/orders/${first.data.order.id}`, { headers: { 'x-order-token': second.data.accessToken } });
  assert.equal(read.status, 200);
});

test('don chua thanh toan het han se bi huy va gui mail', async () => {
  const { data } = await checkout();
  await age(data.order.id, 25);
  const result = await sweepOrders();
  assert.ok(result.expired.includes(data.order.id), 'don 25 gio phai bi huy');
  const order = await getOrder(data.order.id);
  assert.equal(order.status, 'cancelled');
  assert.equal(order.cancelReason, 'expired');
  assert.equal(order.cancelledAt !== null, true);
  const sent = await notifyOrder(order, 'cancelled');
  assert.equal(sent.sent, false, 'mail huy phai gui dung mot lan');
  const files = await fs.readdir(outboxPath);
  assert.ok(files.some((f) => f.includes(order.id) && f.endsWith('.txt')), 'phai co mail trong outbox');
});

test('quet khong huy don da duoc giao', async () => {
  const { data } = await checkout();
  await updateOrder(data.order.id, { status: 'paid', paidAt: new Date().toISOString(), paidCount: 1 });
  await markOrderDelivered(await getOrder(data.order.id));
  await age(data.order.id, 50);
  const result = await sweepOrders();
  assert.equal(result.expired.includes(data.order.id), false, 'don da giao khong duoc huy nua');
  const order = await getOrder(data.order.id);
  assert.equal(order.status, 'pending', 'truoc khi het han, don phai o trang thai don moi');
  assert.equal(order.paidCount, 1, 'doanh thu phai con lai sau khi dong don');
  assert.equal(order.paidAt, null);
  assert.ok(order.deliveredAt, 'phai ghi thoi diem giao');
});

test('thanh toan den sau khi don da bi huy van mo duoc nut tai', async () => {
  const { data } = await checkout();
  await age(data.order.id, 25);
  await sweepOrders();
  assert.equal((await getOrder(data.order.id)).status, 'cancelled');
  // Money in the account is money in the account: the order reopens.
  const paid = await markOrderPaid(await getOrder(data.order.id), { source: 'webhook' });
  assert.equal(paid.status, 'paid');
  assert.equal(paid.cancelReason, null);
  assert.equal(paid.paidCount, 1);
  const download = await fetch(`${base}/api/orders/${data.order.id}/download`, { headers: { 'x-order-token': data.accessToken } });
  assert.equal(download.status, 200, 'tiền đã về thì phải tải được');
});

test('markOrderPaid chay lai nhieu lan chi gui mot mail', async () => {
  const { data } = await checkout();
  const first = await markOrderPaid(await getOrder(data.order.id), { source: 'admin' });
  const second = await markOrderPaid(first, { source: 'webhook' });
  assert.equal(second.paidCount, 1, 'thanh toan trung khong duoc tinh lai');
  assert.equal(second.paidAt, first.paidAt, 'thoi diem thanh toan goc phai giu nguyen');
});

test('nut tai bi khoa truoc khi thanh toan va se mo khi da thanh toan', async () => {
  const { data } = await checkout();
  const locked = await fetch(`${base}/api/orders/${data.order.id}/download`, { headers: { 'x-order-token': data.accessToken } });
  assert.equal(locked.status, 409, 'chua thanh toan thi server phai tu choi');
  await markOrderPaid(await getOrder(data.order.id), { source: 'capture' });
  const unlocked = await fetch(`${base}/api/orders/${data.order.id}/download`, { headers: { 'x-order-token': data.accessToken } });
  assert.equal(unlocked.status, 200);
});

test('sau khi giao, don quay ve trang thai don moi va khoa lai', async () => {
  const { data } = await checkout();
  await markOrderPaid(await getOrder(data.order.id), { source: 'admin' });
  const response = await fetch(`${base}/api/orders/${data.order.id}/delivered`, { method: 'POST', headers: { 'x-order-token': data.accessToken } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.order.status, 'pending');
  assert.equal(payload.order.paidCount, 1, 'phai giu lai so lan da thu');
  const again = await fetch(`${base}/api/orders/${data.order.id}/download`, { headers: { 'x-order-token': data.accessToken } });
  assert.equal(again.status, 409, 'đơn đã giao thì không tải lại được');
});

test('admin xac nhan tay cung gui mail cho khach', async () => {
  const { data } = await checkout();
  const response = await fetch(`${base}/api/admin/orders/${data.order.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ status: 'paid' }) });
  assert.equal(response.status, 200);
  const order = (await response.json()).order;
  assert.equal(order.status, 'paid');
  assert.equal(order.paidCount, 1, 'xác nhận tay cũng phải được tính vào doanh thu');
});

test('admin dong don thu cong bang giao da', async () => {
  const { data } = await checkout();
  await fetch(`${base}/api/admin/orders/${data.order.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ status: 'paid' }) });
  const response = await fetch(`${base}/api/admin/orders/${data.order.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ delivered: true }) });
  assert.equal(response.status, 200);
  const order = (await response.json()).order;
  assert.equal(order.status, 'pending');
  assert.ok(order.deliveredAt);
});

test('quet khong huy don da duoc chuyen sang paid', async () => {
  const { data } = await checkout();
  await markOrderPaid(await getOrder(data.order.id), { source: 'admin' });
  await age(data.order.id, 30);
  const result = await sweepOrders();
  assert.equal(result.expired.includes(data.order.id), false);
  assert.equal((await getOrder(data.order.id)).status, 'paid');
});

test('canh bao het han chi gui mot lan', async () => {
  const { data } = await checkout();
  // 23 hours old with a 24 hour window: inside the one hour warning, not expired.
  const created = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
  const expires = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
  await updateOrder(data.order.id, { createdAt: created, expiresAt: expires });
  const first = await sweepOrders();
  assert.ok(first.warned.includes(data.order.id), '23,5 giờ phải được nhắc');
  const second = await sweepOrders();
  assert.equal(second.warned.includes(data.order.id), false, 'không được nhắc lần hai');
  assert.equal((await getOrder(data.order.id)).status, 'pending_transfer', 'đơn chưa hết hạn thì chưa hủy');
});

test('paymentDeadline dung expiresAt da ghi, khong dung lai bien moi', async () => {
  const { data } = await checkout();
  await age(data.order.id, 5);
  const order = await getOrder(data.order.id);
  const expected = new Date(order.expiresAt).getTime();
  assert.equal(paymentDeadline(order), expected);
  assert.equal(isExpired(order, expected - 1000), false);
  assert.equal(isExpired(order, expected), true);
});

test('tra cuu don cua người đã giao van tra ve duoc', async () => {
  const { data } = await checkout();
  await markOrderPaid(await getOrder(data.order.id), { source: 'admin' });
  await markOrderDelivered(await getOrder(data.order.id));
  const response = await fetch(`${base}/api/orders/lookup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: data.order.id, email: 'buyer@example.com' }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.order.status, 'pending');
  const read = await fetch(`${base}/api/orders/${data.order.id}`, { headers: { 'x-order-token': payload.accessToken } });
  assert.equal(read.status, 200, 'người mua vẫn phải xem được đơn của mình sau khi đóng');
});

test('health bao cao trang thai gui mail', async () => {
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.email, 'outbox', 'chưa có RESEND_API_KEY thì phải ghi ra outbox');
  assert.equal(health.orderWindowHours, 24);
});

test('mở lại đơn đã giao để khách tải lại được', async () => {
  const { data } = await checkout();
  await markOrderPaid(await getOrder(data.order.id), { source: 'admin' });
  await markOrderDelivered(await getOrder(data.order.id));
  // The server cannot see a file finish downloading, so a transfer that dies at
  // ten percent still closes the order. This is the one-click undo.
  const response = await fetch(`${base}/api/admin/orders/${data.order.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ reopen: true }) });
  assert.equal(response.status, 200);
  const order = (await response.json()).order;
  assert.equal(order.status, 'paid', 'phải mở lại nút tải');
  assert.equal(order.deliveredAt, null);
  assert.equal(order.paidCount, 1, 'doanh thu không bị mất');
  const download = await fetch(`${base}/api/orders/${data.order.id}/download`, { headers: { 'x-order-token': data.accessToken } });
  assert.equal(download.status, 200, 'khách phải tải lại được');
});

test('không mở lại được đơn chưa đóng', async () => {
  const { data } = await checkout();
  const response = await fetch(`${base}/api/admin/orders/${data.order.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ reopen: true }) });
  assert.equal(response.status, 409, 'đơn chưa giao thì không có gì để mở lại');
});
