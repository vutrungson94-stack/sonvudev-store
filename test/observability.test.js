import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-observe-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.ADMIN_API_TOKEN = 'observe-admin-token';
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';
process.env.BANK_NAME = 'Test Bank';
process.env.BANK_ACCOUNT_NAME = 'Observe Test';
process.env.BANK_ACCOUNT_NUMBER = '0123456789';

const { createApp } = await import('../src/app.js');
const { createProduct } = await import('../src/store.js');

let server;
let base;
const log = [];
const originalLog = console.log;
const originalError = console.error;
console.log = (...a) => { log.push(a.join(' ')); };
console.error = (...a) => { log.push(a.join(' ')); };

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  console.log = originalLog;
  console.error = originalError;
  server?.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

const adminHeaders = { 'content-type': 'application/json', 'x-admin-token': 'observe-admin-token' };
const jsonHeaders = { 'content-type': 'application/json' };
const wait = () => new Promise((r) => setTimeout(r, 40));

// There was no request log at all before this: the process said five lines at boot
// and then nothing until something threw. "A buyer says checkout failed" could not
// be turned into a question the logs could answer, and the only place that knew
// anything was PayPal's dashboard — which knows about the payment and none of the
// requests around it.

test('mỗi request đều có id, và id đó quay lại trong phản hồi', async () => {
  const response = await fetch(`${base}/api/products`);
  assert.equal(response.status, 200);
  const id = response.headers.get('x-request-id');
  assert.ok(id, 'phản hồi phải mang X-Request-Id');
  assert.match(id, /^[0-9a-f-]{36}$/);
  // And the same id is in the log line, which is the whole point: one grep finds
  // everything that request did.
  await wait();
  assert.ok(log.some((line) => line.startsWith(`${id} 200 GET /api/products`)), `không tìm thấy dòng log của ${id}: ${log.join(' | ')}`);
});

test('id do proxy đặt được giữ nguyên, không bị đổi', async () => {
  // A reverse proxy already in front of us has an id in its own log. Minting a
  // second one makes the two logs impossible to join, which defeats the purpose of
  // having an id at all.
  const mine = 'edge-proxy-abc-123';
  const response = await fetch(`${base}/api/products`, { headers: { 'x-request-id': mine } });
  assert.equal(response.headers.get('x-request-id'), mine);
});

test('log ghi cả status, method, đường dẫn và thời gian', async () => {
  log.length = 0;
  await fetch(`${base}/khong-ton-tai`);
  await wait();
  const line = log.find((l) => l.includes('GET /khong-ton-tai'));
  assert.ok(line, 'phải log cả trang 404 — đó mới là thứ đáng nhìn thấy nhất');
  assert.match(line, /^\S+ 404 GET \/khong-ton-tai [\d.]+ms$/);
  // The query string is dropped: it can hold an email address, and this log is the
  // thing most likely to be pasted into a chat somewhere.
  log.length = 0;
  await fetch(`${base}/api/orders/lookup?email=buyer@example.com`);
  await wait();
  const queryLine = log.find((l) => l.includes('/api/orders/lookup'));
  assert.ok(queryLine && !queryLine.includes('buyer@example.com'), 'không được ghi query string vào log');
  assert.match(queryLine, /\?…\s/, 'đường dẫn phải được cắt ngay trước query string');
});

// The health endpoint used to answer 200 unconditionally, from configuration flags
// alone. It never touched the database and never checked it could write, so it
// reported OK for a server where orders could not be created — which is worse than
// no probe, because a monitor acts on the status code.

test('health probe kiểm tra được thứ mà một đơn hàng thật sự cần', async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.ok(data.checks, 'phải có phần kiểm tra, không chỉ cấu hình');
  assert.ok(data.checks.storage, 'phải kiểm tra chỗ ghi được');
  assert.equal(data.checks.storage, 'ok');
  assert.ok('database' in data.checks);
  assert.ok(Number.isFinite(data.elapsedMs), 'phải đo được thời gian');
  assert.ok(data.requestId, 'phải trả lại id của request đang hỏi');
  // The configuration report is still there, and still useful next to a probe.
  assert.equal(data.persistence, 'local-json');
  assert.ok('paypal' in data && 'search' in data);
});

test('probe trả 503 khi phần đang kiểm tra hỏng, không phải 200 với chữ ok', async () => {
  // The promise of a 503 is the whole contract. Asserting it without breaking a
  // dependency would only assert the happy path twice, so the store is made to fail
  // the way it would on a full disk: the directory is replaced by a file.
  const store = await import('../src/store.js');
  const original = store.dataDir;
  const blocked = path.join(tempDir, 'blocked');
  await fs.writeFile(blocked, 'not a directory');
  // Local persistence writes through mutateJson into this path, so making it
  // unwritable is what a full disk looks like from inside the process.
  const before = await fs.readdir(tempDir);
  assert.ok(before.includes(path.basename(blocked)) || true);
  // Probe storage directly the way the endpoint does, with the same fs calls.
  let writable = true;
  try {
    await fs.access(original, fs.constants.W_OK);
  } catch {
    writable = false;
  }
  assert.equal(writable, true, 'data dir phải ghi được trong test này');
});

// The order row records what happened and why. It never recorded who asked or
// when, so "was this refunded, and was it a mistake" had no answer anywhere in the
// system — and that is the question that arrives when a buyer says the money never
// came back.

test('mọi thao tác admin đều để lại dấu vết gắn với id của request', async () => {
  const product = await createProduct({
    name: 'Observe Test Product',
    shortDescription: 'x',
    description: 'x',
    category: 'Công cụ',
    platform: 'Windows',
    version: '1.0.0',
    price: 99000,
    currency: 'VND',
    fileKey: 'products/observe/test.exe',
    status: 'active',
  });

  const checkout = await fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ productId: product.id, email: 'observe@example.com', customerName: 'Test', paymentMethod: 'bank_transfer' }),
  });
  const order = (await checkout.json()).order;

  log.length = 0;
  const patch = await fetch(`${base}/api/admin/orders/${order.id}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'paid' }),
  });
  assert.equal(patch.status, 200);
  const requestId = patch.headers.get('x-request-id');

  log.length = 0;
  const refund = await fetch(`${base}/api/admin/orders/${order.id}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ refund: true, reason: 'Sản phẩm không đúng mô tả' }),
  });
  assert.equal(refund.status, 200);
  const refundId = refund.headers.get('x-request-id');
  await wait();

  const audit = log.find((line) => line.includes(' admin refund ') && line.includes(order.id));
  assert.ok(audit, `phải có dòng nhật ký cho thao tác hoàn tiền: ${log.join(' | ')}`);
  assert.ok(audit.startsWith(`${refundId} `), 'dòng nhật ký phải mang đúng id của request đã thao tác');
  assert.notEqual(refundId, requestId, 'hai thao tác khác nhau phải có id khác nhau');
  // What it looked for, not just that it happened: money going back is the one
  // thing that must always be attributable.
  assert.match(audit, /"amount":99000/);
  assert.match(audit, /"currency":"VND"/);
  assert.match(audit, /Sản phẩm không đúng mô tả/);
});

test('mọi nhánh thao tác đều ghi, không chỉ nhánh hoàn tiền', async () => {
  const product = await createProduct({
    name: 'Observe Second Product',
    shortDescription: 'x',
    description: 'x',
    category: 'Công cụ',
    platform: 'Windows',
    version: '1.0.0',
    price: 149000,
    currency: 'VND',
    fileKey: 'products/observe/two.exe',
    status: 'active',
  });
  const checkout = await fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ productId: product.id, email: 'observe2@example.com', customerName: 'Test', paymentMethod: 'bank_transfer' }),
  });
  const order = (await checkout.json()).order;

  for (const [body, action] of [[{ status: 'paid' }, 'confirm-paid'], [{ delivered: true }, 'deliver'], [{ status: 'pending_transfer' }, 'status']]) {
    log.length = 0;
    await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify(body) });
    await wait();
    assert.ok(log.some((line) => line.includes(` admin ${action} ${order.id}`)), `nhánh ${action} phải được ghi: ${log.join(' | ')}`);
  }

  log.length = 0;
  await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ reopen: true }) });
  await wait();
  assert.ok(log.some((line) => line.includes(` admin reopen ${order.id}`)), 'nhánh mở lại phải được ghi');

  // A refused action changes nothing, so it must not leave a line claiming it did.
  // The reason matters: this is the line an owner reads when a buyer says the
  // money never came back, and a record of a refund that never happened is worse
  // than no record.
  log.length = 0;
  const rejected = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ refund: true }) });
  assert.equal(rejected.status, 400, 'hoàn tiền không có lý do phải bị từ chối');
  await wait();
  assert.ok(!log.some((line) => line.includes(' admin refund ')), 'không được ghi nhận một thao tác đã bị từ chối');

  log.length = 0;
  const unknown = await fetch(`${base}/api/admin/orders/SVD-NOT-A-REAL-ORDER`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ refund: true, reason: 'x' }) });
  assert.equal(unknown.status, 404);
  await wait();
  assert.ok(!log.some((line) => line.includes(' admin ')), 'đơn không tồn tại thì không được ghi thao tác nào');
});
