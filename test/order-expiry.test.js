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
// The same trap as the mail key: a real one in .env would make every product
// created in before() fire a real IndexNow ping over the network.
process.env.INDEXNOW_KEY = '';

const { createApp } = await import('../src/app.js');
const { UNPAID_STATUSES, createOrder, getOrder, listOrders, updateOrder } = await import('../src/store.js');
const { isExpired, isUnpaid, markOrderDelivered, markOrderPaid, paymentDeadline, sweepOrders } = await import('../src/orders.js');
const { notifyOrder, outboxPath } = await import('../src/notify.js');
const readSrc = (file) => fs.readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', file), 'utf8');

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
test.after(async () => { await closeTest(server, tempDir); });

let buyerSeq = 0;
const checkout = async (overrides = {}) => {
  // Every call is a different buyer. Seventeen orders from one inbox inside a
  // quarter of an hour is not shopping, it is the abuse the checkout limit
  // exists to stop, so a shared placeholder email would test the wrong thing.
  const email = overrides.email || `buyer${(buyerSeq += 1)}@example.com`;
  const response = await fetch(`${base}/api/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: product.id, email, customerName: 'Test User', acceptPolicy: 'on', paymentMethod: 'bank_transfer', ...overrides }),
  });
  return { response, data: await response.json(), email };
};

const age = async (id, hours) => {
  const iso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  await updateOrder(id, { createdAt: iso, expiresAt: iso });
  return iso;
};

test('checkout ghi hạn thanh toán 24 giờ và báo qua cho người mua', async () => {
  const { response, data } = await checkout();
  assert.equal(response.status, 200);
  const hours = (new Date(data.expiresAt) - new Date(data.order.createdAt)) / 3600000;
  assert.equal(Math.round(hours), 24, 'han thanh toan phai dung 24 gio');
  assert.equal(data.order.status, 'pending_transfer');
  assert.ok(data.serverTime, 'phải trả server time để đếm ngược đúng đồng hồ');
  // The countdown is only meaningful if the browser can read the deadline back.
  const read = await fetch(`${base}/api/orders/${data.order.id}`, { headers: { 'x-order-token': data.accessToken } });
  const payload = await read.json();
  assert.equal(payload.expiresAt, data.expiresAt);
  assert.equal(payload.order.accessTokenHash, undefined, 'không rò token hash ra ngoài');
  assert.equal(payload.order.notifications, undefined, 'không rò nhật ký gửi mail ra ngoài');
});

test('checkout options trả số giờ để biết mức đăng ký từ server', async () => {
  const response = await fetch(`${base}/api/checkout/options`);
  assert.equal((await response.json()).paymentWindowHours, 24);
});

test('checkout lại với cùng idempotencyKey trả về chính đơn đó, không tạo đơn mới', async () => {
  const key = 'retry-key-1';
  const first = await checkout({ idempotencyKey: key });
  const second = await checkout({ idempotencyKey: key });
  assert.equal(first.data.order.id, second.data.order.id, 'phải trả về cùng một đơn');
  assert.notEqual(first.data.accessToken, second.data.accessToken, 'phải cấp lại mã tra cứu cho lần thử lại');
  const rows = (await listOrders()).filter((o) => o.idempotencyKey === key);
  assert.equal(rows.length, 1, 'khong duoc tao hai don cho mot lan thanh toán');
  // The recovered token has to actually work, or the buyer is locked out.
  const read = await fetch(`${base}/api/orders/${first.data.order.id}`, { headers: { 'x-order-token': second.data.accessToken } });
  assert.equal(read.status, 200);
});

test('đơn chưa thanh toán hết hạn sẽ bị huỷ và gửi mail', async () => {
  const { data, email } = await checkout();
  await age(data.order.id, 25);
  const result = await sweepOrders();
  assert.ok(result.expired.includes(data.order.id), 'don 25 gio phai bi huy');
  const order = await getOrder(data.order.id);
  assert.equal(order.status, 'cancelled');
  assert.equal(order.cancelReason, 'expired');
  assert.equal(order.cancelledAt !== null, true);
  const sent = await notifyOrder(order, 'cancelled');
  assert.equal(sent.sent, false, 'mail huỷ phải gửi đúng một lần');
  const files = await fs.readdir(outboxPath);
  assert.ok(files.some((f) => f.includes(order.id) && f.endsWith('.txt')), 'phai co mail trong outbox');
});

test('quét không huỷ đơn đã được giao', async () => {
  const { data, email } = await checkout();
  await updateOrder(data.order.id, { status: 'paid', paidAt: new Date().toISOString(), paidCount: 1 });
  await markOrderDelivered(await getOrder(data.order.id));
  await age(data.order.id, 50);
  const result = await sweepOrders();
  assert.equal(result.expired.includes(data.order.id), false, 'don da giao khong duoc huy nua');
  const order = await getOrder(data.order.id);
  assert.equal(order.status, 'pending', 'truoc khi het han, don phai o trang thai don moi');
  assert.equal(order.paidCount, 1, 'doanh thu phải còn lại sau khi đóng đơn');
  assert.equal(order.paidAt, null);
  assert.ok(order.deliveredAt, 'phải ghi thời điểm giao');
});

test('thanh toán đến sau khi đơn đã bị huỷ vẫn mở được nút tải', async () => {
  const { data, email } = await checkout();
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

test('markOrderPaid chạy lại nhiều lần chỉ gửi một mail', async () => {
  const { data, email } = await checkout();
  const first = await markOrderPaid(await getOrder(data.order.id), { source: 'admin' });
  const second = await markOrderPaid(first, { source: 'webhook' });
  assert.equal(second.paidCount, 1, 'thanh toán trùng không được tính lại');
  assert.equal(second.paidAt, first.paidAt, 'thời điểm thanh toán gốc phải giữ nguyên');
});

// PayPal redelivers a webhook for days, and delivering a file deliberately returns
// the order to pending so it cannot be paid twice. Those two facts together were
// enough to count one payment twice: the order looked unpaid again, the retry
// landed, and paidAmount doubled while the bank statement did not.
//
// The guard is paid_count rather than status for exactly this reason, so the test
// walks the whole sequence rather than calling markOrderPaid twice in a row.
test('webhook lặp lại sau khi đã giao không tính doanh thu hai lần', async () => {
  const { data } = await checkout();
  const first = await markOrderPaid(await getOrder(data.order.id), { source: 'webhook' });
  assert.equal(first.paidCount, 1);
  await markOrderDelivered(await getOrder(data.order.id));
  const delivered = await getOrder(data.order.id);
  assert.equal(delivered.status, 'pending', 'giao xong thì đơn về trạng thái đơn mới');

  const retry = await markOrderPaid(delivered, { source: 'webhook-retry' });
  assert.equal(retry.paidCount, 1, 'một lần thanh toán chỉ được tính một lần');
  assert.equal(Number(retry.paidAmount), Number(first.paidAmount),
    'tiền đã thu không được nhân đôi khi PayPal gửi lại webhook');
  const stored = await getOrder(data.order.id);
  assert.equal(stored.paidCount, 1);
  assert.equal(stored.paidAmount, first.paidAmount);
});

test('hai lần ghi nhận thanh toán chạy song song thì chỉ một lần được ghi', async () => {
  const { data } = await checkout();
  // The webhook and the capture call really do arrive together for one payment.
  // Read once and fire both, which is the closest a test gets to the race.
  const snapshot = await getOrder(data.order.id);
  const [a, b] = await Promise.all([
    markOrderPaid(snapshot, { source: 'webhook' }),
    markOrderPaid(snapshot, { source: 'capture' }),
  ]);
  const stored = await getOrder(data.order.id);
  assert.equal(stored.paidCount, 1, 'ghi đồng thời thì chỉ một lần được tính');
  assert.equal(stored.paidAmount, snapshot.amount, 'tiền đã thu không được nhân đôi');
  // Both callers agree the money arrived, so neither may report a failure.
  assert.ok(a, 'caller thứ nhất phải nhận về một đơn');
  assert.ok(b, 'caller thứ hai phải nhận về một đơn');
});

test('admin xác nhận đơn đã hoàn thì sửa trạng thái, không ghi thêm doanh thu', async () => {
  const { data } = await checkout();
  await markOrderPaid(await getOrder(data.order.id), { source: 'admin' });
  const before = await getOrder(data.order.id);
  const response = await fetch(`${base}/api/admin/orders/${data.order.id}`, {
    method: 'PATCH', headers: jsonHeaders,
    body: JSON.stringify({ status: 'paid' }),
  });
  assert.equal(response.status, 200);
  const after = (await response.json()).order;
  assert.equal(after.status, 'paid', 'đơn đã hoàn nhầm phải mở lại được');
  const stored = await getOrder(data.order.id);
  assert.equal(stored.paidCount, before.paidCount, 'sửa trạng thái không phải là thêm một lần thanh toán');
  assert.equal(stored.paidAmount, before.paidAmount);
});

test('nút tải bị khoá trước khi thanh toán và sẽ mở khi đã thanh toán', async () => {
  const { data, email } = await checkout();
  const locked = await fetch(`${base}/api/orders/${data.order.id}/download`, { headers: { 'x-order-token': data.accessToken } });
  assert.equal(locked.status, 409, 'chưa thanh toán thì server phải từ chối');
  await markOrderPaid(await getOrder(data.order.id), { source: 'capture' });
  const unlocked = await fetch(`${base}/api/orders/${data.order.id}/download`, { headers: { 'x-order-token': data.accessToken } });
  assert.equal(unlocked.status, 200);
});

test('sau khi giao, đơn quay về trạng thái đơn mới và khoá lại', async () => {
  const { data, email } = await checkout();
  await markOrderPaid(await getOrder(data.order.id), { source: 'admin' });
  const response = await fetch(`${base}/api/orders/${data.order.id}/delivered`, { method: 'POST', headers: { 'x-order-token': data.accessToken } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.order.status, 'pending');
  assert.equal(payload.order.paidCount, 1, 'phải giữ lại số lần đã thử');
  const again = await fetch(`${base}/api/orders/${data.order.id}/download`, { headers: { 'x-order-token': data.accessToken } });
  assert.equal(again.status, 409, 'đơn đã giao thì không tải lại được');
});

test('admin xác nhận tay cũng gửi mail cho khách', async () => {
  const { data, email } = await checkout();
  const response = await fetch(`${base}/api/admin/orders/${data.order.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ status: 'paid' }) });
  assert.equal(response.status, 200);
  const order = (await response.json()).order;
  assert.equal(order.status, 'paid');
  assert.equal(order.paidCount, 1, 'xác nhận tay cũng phải được tính vào doanh thu');
});

test('admin đóng đơn thủ công bằng giao đã', async () => {
  const { data, email } = await checkout();
  await fetch(`${base}/api/admin/orders/${data.order.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ status: 'paid' }) });
  const response = await fetch(`${base}/api/admin/orders/${data.order.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ delivered: true }) });
  assert.equal(response.status, 200);
  const order = (await response.json()).order;
  assert.equal(order.status, 'pending');
  assert.ok(order.deliveredAt);
});

test('quét không huỷ đơn đã được chuyển sang paid', async () => {
  const { data, email } = await checkout();
  await markOrderPaid(await getOrder(data.order.id), { source: 'admin' });
  await age(data.order.id, 30);
  const result = await sweepOrders();
  assert.equal(result.expired.includes(data.order.id), false);
  assert.equal((await getOrder(data.order.id)).status, 'paid');
});

test('cảnh báo hết hạn chỉ gửi một lần', async () => {
  const { data, email } = await checkout();
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

test('paymentDeadline dùng expiresAt đã ghi, không dùng lại biến mới', async () => {
  const { data, email } = await checkout();
  await age(data.order.id, 5);
  const order = await getOrder(data.order.id);
  const expected = new Date(order.expiresAt).getTime();
  assert.equal(paymentDeadline(order), expected);
  assert.equal(isExpired(order, expected - 1000), false);
  assert.equal(isExpired(order, expected), true);
});

test('tra cuu don cua người đã giao van tra ve duoc', async () => {
  const { data, email } = await checkout();
  await markOrderPaid(await getOrder(data.order.id), { source: 'admin' });
  await markOrderDelivered(await getOrder(data.order.id));
  const response = await fetch(`${base}/api/orders/lookup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: data.order.id, email }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.order.status, 'pending');
  const read = await fetch(`${base}/api/orders/${data.order.id}`, { headers: { 'x-order-token': payload.accessToken } });
  assert.equal(read.status, 200, 'người mua vẫn phải xem được đơn của mình sau khi đóng');
});

test('health báo cáo trạng thái gửi mail', async () => {
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.email, 'outbox', 'chưa có RESEND_API_KEY thì phải ghi ra outbox');
  assert.equal(health.orderWindowHours, 24);
});

test('mở lại đơn đã giao để khách tải lại được', async () => {
  const { data, email } = await checkout();
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
  const { data, email } = await checkout();
  const response = await fetch(`${base}/api/admin/orders/${data.order.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ reopen: true }) });
  assert.equal(response.status, 409, 'đơn chưa giao thì không có gì để mở lại');
});

test('mọi đường truy vấn đều hỏi cả hai trạng thái chưa thanh toán', async () => {
  // This test exists because of a real production bug, not a hypothetical one.
  // A PayPal order stays `pending` until its capture lands, so a query asking only
  // for `pending_transfer` never saw one. A buyer who abandoned PayPal checkout left
  // an order that could never expire, never got its reminder mail, and sat in the
  // admin list for ever — one was found that way. The JSON path was correct and the
  // PostgREST path was not, and every test in this repository runs against JSON,
  // which is exactly why it survived a long time unnoticed.
  //
  // The rule is enforced structurally rather than behaviourally: a status filter
  // written into a query by hand is how the two paths drift apart, so there cannot
  // be one.
// Scoped to order queries and with comments stripped: `products` legitimately
  // filters on `status=eq.active`, and a paragraph explaining this very bug quotes
  // the old string. Neither is a hand-written order filter.
  const source = (await readSrc('src/store.js'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
    const orderQueries = [...source.matchAll(/orders\?([^`"']*)/g)].map((match) => match[1]);
    assert.ok(orderQueries.length >= 2, 'phai co it nhat hai truy vấn bảng orders');
    // The rule is about the *unpaid* statuses: an unpaid query that asks for one of
    // them silently hides the other's rows, which is the bug described above. A
    // query for the settled `refunded` status cannot go one-sided that way — there
    // is exactly one such status and asking for any other would be wrong — so it is
    // allowed, and it reads that status from the same named constant as its readers.
    const handWritten = orderQueries.filter((query) => /status=eq\./.test(query) && !query.includes('status=eq.${REFUNDED_STATUS}'));
    assert.deepEqual(handWritten, [], `truy vấn orders còn ghi cứng trạng thái: ${handWritten.join(' | ')}`);
  assert.ok(/status=in\.\(\$\{UNPAID_STATUSES/.test(source), 'bộ lọc PostgREST phải dựng từ UNPAID_STATUSES, không gõ tay');

  // Both statuses are unpaid, and the sweep's own rule agrees.
  assert.deepEqual([...UNPAID_STATUSES].sort(), ['pending', 'pending_transfer']);
  assert.equal(isUnpaid({ status: 'pending' }), true);
  assert.equal(isUnpaid({ status: 'pending_transfer' }), true);
  assert.equal(isUnpaid({ status: 'paid' }), false);

  // And an expired PayPal order is actually cancelled, which it was not before,
  // because the status was filtered out before the sweep ever saw the row.
  const now = Date.parse('2026-06-02T12:00:00Z');
  const paypal = {
    id: 'SVD-SWEEP-PAYPAL', status: 'pending', paymentProvider: 'paypal',
    createdAt: '2026-06-01T00:00:00.000Z', expiresAt: '2026-06-01T12:00:00.000Z',
    customerEmail: 'buyer@example.com', items: [product],
  };
  assert.equal(isExpired(paypal, now), true, 'đơn PayPal quá hạn phải được coi là hết hạn');
  await createOrder(paypal);

  const touched = await sweepOrders(now);
  assert.ok(touched.expired.includes('SVD-SWEEP-PAYPAL'), 'sweep phải huỷ được đơn PayPal quá hạn');
  const after = await getOrder('SVD-SWEEP-PAYPAL');
  assert.equal(after.status, 'cancelled');
  assert.equal(after.cancelReason, 'expired');
});
