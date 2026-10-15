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

// A shop with a hundred products and a few thousand orders is the case the admin
// panel was built for. Finding one order meant scrolling to it, and the "Tải thêm"
// button was the only tool. These cover the two search boxes that replaced that:
// one that narrows the orders, one that narrows the products, plus the delete that
// knows the difference between a product nobody bought and one somebody did.
process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-search-'));
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
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';
process.env.ORDER_SWEEP_DISABLED = '1';
process.env.APP_URL = 'http://127.0.0.1:4180';

const { createApp } = await import('../src/app.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let base;
let product;
let spareProduct;
let seq = 0;
const auth = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };
const orders = (query = '') => fetch(`${base}/api/admin/orders${query}`, { headers: { 'x-admin-token': 'test-admin-token' } }).then((r) => r.json());
const makeOrder = async (email, customerName) => {
  seq += 1;
  return (await (await fetch(`${base}/api/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: product.id, email: email || `buyer${seq}@example.com`, customerName, acceptPolicy: 'on', paymentMethod: 'bank_transfer' }),
  })).json()).order;
};
const setStatus = (id, status) => fetch(`${base}/api/admin/orders/${id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status }) }).then((r) => r.json());

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const create = async (name) => (await (await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name, price: 99000, currency: 'VND', fileKey: `products/${name}/1.0.0/p.exe`, status: 'active' }),
  })).json()).product;
  product = await create('Search Tester');
  spareProduct = await create('Spare Tester');
  // Three buyers the search has to tell apart, in two of the statuses the panel
  // filters on.
  await makeOrder('nguyen.van.a@gmail.com', 'Nguyễn Văn A');
  await makeOrder('tran.thi.b@gmail.com', 'Trần Thị B');
  const paid = await makeOrder('le.van.c@gmail.com', 'Lê Văn C');
  await setStatus(paid.id, 'paid');
});
test.after(async () => { await closeTest(server, tempDir); });

test('tìm đơn theo email và theo tên, chỉ trả đơn khớp', async () => {
  const byEmail = await orders('?q=' + encodeURIComponent('tran.thi.b'));
  assert.equal(byEmail.orders.length, 1, 'phải tìm ra đúng một đơn');
  assert.equal(byEmail.orders[0].customerEmail, 'tran.thi.b@gmail.com');
  assert.equal(byEmail.total, 1, 'tổng số phải đếm theo bộ lọc, không phải cả shop');
  const byName = await orders('?q=' + encodeURIComponent('Nguyễn Văn'));
  assert.equal(byName.orders.length, 1, 'tìm theo tên khách cũng phải ra');
  assert.equal(byName.orders[0].customerName, 'Nguyễn Văn A');
});

test('tìm đơn theo mã đơn, không phân biệt hoa thường', async () => {
  // Đặt hàng mới rồi gõ một đoạn đầu của mã: đúng thứ người bán có trong tay khi
  // khách nhắn "tôi vừa đặt".
  const fresh = await makeOrder('ma.don.moi@gmail.com', 'Mã Đơn Mới');
  const prefix = fresh.id.slice(0, 8).toLowerCase();
  const found = await orders('?q=' + encodeURIComponent(prefix));
  assert.ok(found.orders.some((o) => o.id === fresh.id), 'gõ một đoạn mã đơn phải tìm ra đơn đó');
});

test('lọc theo trạng thái chỉ giữ đơn ở trạng thái đó', async () => {
  const paid = await orders('?status=paid');
  assert.ok(paid.orders.length >= 1, 'phải có ít nhất đơn đã thanh toán');
  assert.ok(paid.orders.every((o) => o.status === 'paid'), 'bảng không được chứa đơn trạng thái khác');
  const waiting = await orders('?status=pending_transfer');
  assert.ok(waiting.orders.every((o) => o.status === 'pending_transfer'));
  assert.ok(waiting.total >= 2, 'phải đếm cả các đơn đang chờ, không chỉ trang đang xem');
});

test('trạng thái lạ trong URL không được làm cạn bảng', async () => {
  // A hand-edited URL, or a status added later and not in the dropdown: the panel
  // shows the orders rather than an empty table that reads like an outage.
  const bogus = await orders('?status=' + encodeURIComponent('khong-co-trang-thai-nay'));
  const all = await orders();
  assert.equal(bogus.orders.length, all.orders.length, 'bộ lọc lỗi phải tương đương không lọc');
});

test('tìm kiếm và phân trang đi cùng nhau', async () => {
  const first = await orders('?limit=2&offset=0&q=' + encodeURIComponent('@gmail.com'));
  assert.equal(first.orders.length, 2, 'phải trả đúng hai đơn theo yêu cầu');
  assert.equal(first.hasMore, true, 'còn đơn khớp phải báo còn');
  assert.ok(first.total >= 3, 'total phải đếm cả bộ khớp, không chỉ trang đầu');
  const second = await orders('?limit=2&offset=2&q=' + encodeURIComponent('@gmail.com'));
  const overlap = second.orders.filter((o) => first.orders.some((seen) => seen.id === o.id));
  assert.equal(overlap.length, 0, 'hai trang của cùng bộ lọc không được trùng đơn');
});

test('tìm sản phẩm theo tên và theo mã', async () => {
  const byName = await fetch(`${base}/api/admin/products?q=${encodeURIComponent('Search')}`, { headers: auth }).then((r) => r.json());
  assert.equal(byName.products.length, 1, 'chỉ sản phẩm khớp tên được trả về');
  assert.equal(byName.products[0].name, 'Search Tester');
  const bySlug = await fetch(`${base}/api/admin/products?q=${encodeURIComponent('spare-tester')}`, { headers: auth }).then((r) => r.json());
  assert.equal(bySlug.products.length, 1, 'gõ slug cũng phải tìm ra');
  assert.equal(bySlug.products[0].id, spareProduct.id);
});

test('lọc sản phẩm theo trạng thái, và cửa hàng chỉ thấy đang bán', async () => {
  await fetch(`${base}/api/admin/products/${spareProduct.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'archived' }) });
  await fetch(`${base}/api/admin/products/${product.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'draft' }) });
  const archived = await fetch(`${base}/api/admin/products?status=archived`, { headers: auth }).then((r) => r.json());
  assert.equal(archived.products.length, 1, 'chỉ sản phẩm đã lưu trữ');
  const drafts = await fetch(`${base}/api/admin/products?status=draft`, { headers: auth }).then((r) => r.json());
  assert.equal(drafts.products.length, 1, 'chỉ bản nháp');
  const shop = await fetch(`${base}/api/products`).then((r) => r.json());
  assert.ok(shop.products.every((p) => p.status === 'active'), 'cửa hàng không được thấy bản nháp lẫn đã lưu trữ');
  // Put them back so the tests below start from a known catalogue.
  await fetch(`${base}/api/admin/products/${spareProduct.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'active' }) });
  await fetch(`${base}/api/admin/products/${product.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'active' }) });
});

test('xoá sản phẩm đã có đơn bị từ chối, và nói rõ vì sao', async () => {
  const response = await fetch(`${base}/api/admin/products/${product.id}`, { method: 'DELETE', headers: auth });
  assert.equal(response.status, 409, 'sản phẩm đã bán không cho xoá');
  const body = await response.json();
  assert.match(body.error || '', /đơn hàng/, 'lý do phải nói rõ là đã có đơn hàng');
  const still = await fetch(`${base}/api/admin/products?q=Search`, { headers: auth }).then((r) => r.json());
  assert.equal(still.products.length, 1, 'sản phẩm bị từ chối phải còn nguyên trong danh sách');
});

test('xoá sản phẩm chưa bán thì bay, và không đụng tới đơn đã có', async () => {
  const before = await orders();
  const response = await fetch(`${base}/api/admin/products/${spareProduct.id}`, { method: 'DELETE', headers: auth });
  assert.equal(response.status, 200, 'sản phẩm chưa có đơn nào phải xoá được');
  const left = await fetch(`${base}/api/admin/products`, { headers: auth }).then((r) => r.json());
  assert.ok(!left.products.some((p) => p.id === spareProduct.id), 'sản phẩm đã xoá không còn trong danh sách');
  const after = await orders();
  assert.equal(after.total, before.total, 'xoá sản phẩm không được làm mất đơn hàng');
  // A second delete of the same id is a 404, not a silent success.
  const again = await fetch(`${base}/api/admin/products/${spareProduct.id}`, { method: 'DELETE', headers: auth });
  assert.equal(again.status, 404);
});

test('xoá và tìm đều cần token, không có thì 401', async () => {
  for (const call of [() => fetch(`${base}/api/admin/products?q=x`), () => fetch(`${base}/api/admin/orders?q=x`), () => fetch(`${base}/api/admin/products/${product.id}`, { method: 'DELETE' })]) {
    const response = await call();
    assert.equal(response.status, 401, 'thiếu token phải bị chặn');
  }
});

test('panel có ô tìm và ô lọc, và dùng chúng đúng cách', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'admin.html'), 'utf8');
  for (const id of ['order-search', 'order-status', 'product-search', 'product-status-filter']) {
    assert.ok(html.includes(`id="${id}"`), `thiếu ô ${id}`);
  }
  assert.ok(html.includes('placeholder="Tìm mã đơn, email, tên khách…'), 'ô tìm đơn phải nói được tìm theo gì');

  // One id, once. The product filter and the product form's result message were
  // both id="product-status", and getElementById returns the first one in the
  // document — the <select>. So saving a product wrote the message onto the filter:
  // its className was replaced, its <option> list was overwritten with a sentence,
  // and the outcome of the save was never shown at all. A duplicate id is
  // invisible in review and catastrophic at runtime, so it is checked here.
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const duplicated = [...new Set(ids.filter((id) => ids.filter((other) => other === id).length > 1))];
  assert.deepEqual(duplicated, [], `id bị trùng trong admin.html: ${duplicated.join(', ')}`);
  const source = await fs.readFile(path.join(root, 'public', 'admin.js'), 'utf8');
  // One request per pause: typing an email address must not fire a query per
  // character against a shop with thousands of orders.
  assert.ok(/addEventListener\('input',debounce\(/.test(source), 'ô tìm phải debounce');
  assert.ok(/params\.set\('q'/.test(source), 'ô tìm phải gửi q lên server, không lọc trong trình duyệt');
  assert.ok(/params\.set\('status'/.test(source), 'ô lọc phải gửi status lên server');
  assert.ok(/method:'DELETE'/.test(source), 'phải có đường xoá sản phẩm');
  assert.ok(/confirm\('Xoá hẳn sản phẩm này\?/.test(source), 'xoá phải hỏi lại trước');
  assert.ok(/data-archive-to/.test(source), 'lưu trữ phải biết đích đến là gì');
  // A filtered reload goes back to page one, the same rule every other reload
  // already followed: a status change on page three must not leave the owner there.
  const resets = source.match(/resetOrderPage\(\)/g) || [];
  assert.ok(resets.length > 8, 'đổi bộ lọc phải quay về trang đầu');
});
