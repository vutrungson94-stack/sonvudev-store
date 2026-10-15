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

// The store grew past the shape it was written for. Four readers wanted the
// order table and all four got all of it, including the ones on a timer and the
// ones a browser polls: a shop with a few thousand orders moved a few thousand
// fat rows a minute, for ever, to look at rows it had already dealt with. These
// tests pin the narrow queries that replaced that, because the symptom is a
// monthly data bill, not a stack trace.
process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-store-scale-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET_NAME = 'test-private-bucket';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';
process.env.ORDER_PAYMENT_WINDOW_HOURS = '24';
process.env.ORDER_EXPIRY_WARN_HOURS = '1';
process.env.ORDER_SWEEP_DISABLED = '1';
process.env.APP_URL = 'http://127.0.0.1:4179';

const { createApp } = await import('../src/app.js');
const store = await import('../src/store.js');
const { sweepOrders } = await import('../src/orders.js');

let server;
let base;
let product;
let seq = 0;
const auth = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };
const now = Date.now();
const hours = (n) => new Date(now + n * 60 * 60 * 1000).toISOString();

const makeOrder = async (overrides = {}) => {
  seq += 1;
  return (await (await fetch(`${base}/api/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: product.id, email: `buyer${seq}@example.com`, customerName: 'Test', acceptPolicy: 'on', paymentMethod: 'bank_transfer', ...overrides }),
  })).json()).order;
};

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  product = (await (await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: 'Scale Tester', price: 99000, currency: 'VND', fileKey: 'products/s/1.0.0/s.exe', status: 'active' }),
  })).json()).product;
});
test.after(async () => { await closeTest(server, tempDir); });

test('quét hết hạn chỉ đọc đơn còn có thể cảnh báo hoặc huỷ', async () => {
  // History that can never be acted on: long settled, or a deadline days away.
  const settled = await makeOrder();
  await store.updateOrder(settled.id, { status: 'paid', paidAt: hours(-1), createdAt: hours(-500), expiresAt: hours(-476) });
  const distant = await makeOrder();
  await store.updateOrder(distant.id, { createdAt: hours(-1), expiresAt: hours(23) });
  const delivered = await makeOrder();
  await store.updateOrder(delivered.id, { status: 'pending', deliveredAt: hours(-2), createdAt: hours(-500), expiresAt: hours(-476) });
  const soon = await makeOrder();
  await store.updateOrder(soon.id, { createdAt: hours(-23), expiresAt: hours(1) });

  const candidates = await store.listExpiringOrders({ before: hours(1) });
  const ids = candidates.map((order) => order.id);
  assert.ok(ids.includes(soon.id), 'đơn sắp hết hạn phải vào danh sách quét');
  assert.ok(!ids.includes(distant.id), 'đơn còn 23 giờ mới hết hạn thì chưa cần đụng tới');
  assert.ok(!ids.includes(settled.id), 'đơn đã thanh toán không được quét lại');
  assert.ok(!ids.includes(delivered.id), 'đơn đã giao thì đóng, không được quét');
});

test('ranh giới cảnh báo được lấy vào, không loại bằng cách bằng lẻ', async () => {
  // An order exactly one warning window from its deadline is at the very start
  // of the window and is owed a reminder. An exclusive bound dropped it — the
  // one order the buyer was closest to losing.
  const edge = await makeOrder();
  await store.updateOrder(edge.id, { createdAt: hours(-23), expiresAt: hours(1) });
  const before = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const candidates = await store.listExpiringOrders({ before });
  assert.ok(candidates.some((order) => order.id === edge.id), 'đơn đúng ngưỡng phải vào danh sách quét');
  const result = await sweepOrders();
  assert.ok(result.warned.includes(edge.id), 'đơn đúng ngưỡng phải được nhắc');
});

test('đơn cũ không có expires_at vẫn được quét', async () => {
  // A range comparison never matches null. A row written before the column
  // existed derives its deadline from created_at, so excluding null would leave
  // it uncancelled for ever.
  const legacy = await makeOrder();
  await store.updateOrder(legacy.id, { createdAt: hours(-40), expiresAt: null });
  const candidates = await store.listExpiringOrders({ before: hours(0) });
  assert.ok(candidates.some((order) => order.id === legacy.id), 'đơn không có expires_at phải vào danh sách quét');
  const result = await sweepOrders();
  assert.ok(result.expired.includes(legacy.id), 'đơn cũ không có expires_at vẫn phải bị hủy');
});

test('danh sách đơn hàng có phân trang, không trả hết bằng', async () => {
  const page = await store.listOrders({ limit: 2, offset: 0 });
  assert.equal(page.length, 2, 'phải giới hạn số dòng trả về');
  const second = await store.listOrders({ limit: 2, offset: 2 });
  assert.notEqual(page[0].id, second[0].id, 'trang sau phải khác trang trước');
});

test('báo đơn chờ không đọc cả bảng', async () => {
  const pending = await store.listOpenOrders();
  // Everything in the table from earlier tests that is paid or delivered is
  // excluded, so the count the admin badge shows is bounded by orders open now
  // rather than by how long the shop has been running.
  assert.ok(pending.every((order) => order.status === 'pending_transfer' && !order.deliveredAt), 'chỉ được trả về đơn còn mở');
  const newest = await store.latestOrder();
  assert.ok(newest?.id, 'phải trả về đơn mới nhất');
  assert.ok(!('accessTokenHash' in newest) && !('access_token_hash' in newest), 'đơn mới nhất không được mang token truy cập');
});

test('báo cáo doanh thu không kéo theo phần không dùng', async () => {
  const rows = await store.listOrdersForRevenue();
  // A full row carries the access-token hash, the per-order mail log and the
  // line items. The report needs the money columns; the rest is weight.
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.ok(!('accessTokenHash' in row) && !('access_token_hash' in row), 'không được kéo access token hash');
    assert.ok(!('idempotencyKey' in row) && !('idempotency_key' in row), 'không được kéo idempotency key');
    assert.ok(!('notifications' in row), 'không được kéo nhật ký thông báo');
  }
});

test('bảng orders có index cho truy vấn theo thời gian', async () => {
  const schema = await fs.readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  // Every reader above orders by created_at, and no other index covered it, so
  // Postgres sorted the whole table on each one.
  assert.match(schema, /orders_created_at_idx on public\.orders\(created_at desc\)/, 'thiếu index created_at cho orders');
  assert.match(schema, /products_active_idx on public\.products\(status, created_at desc\)/, 'thiếu index cho danh mục sản phẩm đang bán');
  // The sweep's query is equality on status plus a range on expires_at, which
  // is what the existing open-orders index is for. It has to stay.
  assert.match(schema, /orders_open_idx on public\.orders\(status, expires_at\)/);
});

test('tìm quốc gia chạy song song hai nhà cung cấp, không cộng dồn thời gian chờ', async () => {
  const source = await fs.readFile(new URL('../src/geo.js', import.meta.url), 'utf8');
  // The buyer is waiting on the payment list to appear. Asking one provider and
  // only then the other turned a cache miss into the sum of both timeouts.
  assert.match(source, /Promise\.any\(/, 'phải hỏi cả hai nhà cung cấp cùng lúc');
  assert.ok(!/for \(const provider of providers\(ip\)\)/.test(source), 'không được hỏi tuần tự');
});

test('đặt đơn có giới hạn, và chỉ tính đơn mới thật sự', async () => {
  const ip = '203.0.113.9';
  // A buyer on a bad connection taps Mua again. The storefront resends the same
  // idempotency key, gets the original order handed back, and must never be
  // charged for the retry — that would lose the sale and fix nothing.
  const first = await (await fetch(`${base}/api/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ productId: product.id, email: 'retry@example.com', acceptPolicy: 'on', paymentMethod: 'bank_transfer', idempotencyKey: 'same-key' }),
  })).json();
  assert.ok(first.order?.id, 'lần đầu phải tạo đơn');
  for (let i = 0; i < 20; i += 1) {
    const repeat = await fetch(`${base}/api/checkout`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ productId: product.id, email: 'retry@example.com', acceptPolicy: 'on', paymentMethod: 'bank_transfer', idempotencyKey: 'same-key' }),
    });
    assert.equal(repeat.status, 200, 'thử lại cùng một đơn phải không bao giờ bị chặn');
  }
  // The address budget is deliberately generous: one carrier address is many
  // real buyers behind CGNAT. Only an address opening dozens of distinct orders
  // is abuse.
  const statuses = [];
  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${base}/api/checkout`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7' },
      body: JSON.stringify({ productId: product.id, email: `flood${i}@example.com`, acceptPolicy: 'on', paymentMethod: 'bank_transfer' }),
    });
    statuses.push(response.status);
    if (response.status === 429) break;
  }
  assert.ok(statuses.includes(429), 'phải chặn một máy mở hàng loạt đơn');
});
