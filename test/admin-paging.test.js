import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Capping the order query at one page left the panel showing fifty orders and
// nothing else, with no sign there were more. These cover the two halves of
// finishing that: the button that loads the rest, and the server agreeing about
// how many are left.
process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-paging-'));
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
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

let server;
let base;
let product;
let seq = 0;
const auth = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  product = (await (await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: 'Paging Tester', price: 99000, currency: 'VND', fileKey: 'products/p/1.0.0/p.exe', status: 'active' }),
  })).json()).product;
});
test.after(async () => { server?.close(); await fs.rm(tempDir, { recursive: true, force: true }); });

const orders = () => fetch(`${base}/api/admin/orders?limit=10&offset=0`, { headers: { 'x-admin-token': 'test-admin-token' } }).then((r) => r.json());
const makeOrder = async () => {
  seq += 1;
  return (await (await fetch(`${base}/api/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: product.id, email: `page${seq}@example.com`, paymentMethod: 'bank_transfer' }),
  })).json()).order;
};

test('trang sau khác trang trước, và báo rõ còn bao nhiêu', async () => {
  for (let i = 0; i < 25; i += 1) await makeOrder();
  const first = await orders();
  assert.equal(first.orders.length, 10, 'phải trả đúng một trang');
  assert.equal(first.hasMore, true, 'phải báo có trang tiếp theo');
  const second = await fetch(`${base}/api/admin/orders?limit=10&offset=10`, { headers: { 'x-admin-token': 'test-admin-token' } }).then((r) => r.json());
  assert.equal(second.orders.length, 10);
  const overlap = second.orders.filter((order) => first.orders.some((seen) => seen.id === order.id));
  assert.equal(overlap.length, 0, 'hai trang không được trùng đơn nhau');
});

test('trang cuối cùng bắt buộc báo hết, không báo gì còn trang sau', async () => {
  const last = await fetch(`${base}/api/admin/orders?limit=10&offset=20`, { headers: { 'x-admin-token': 'test-admin-token' } }).then((r) => r.json());
  assert.ok(last.orders.length > 0, 'trang cuối phải vẫn có đơn');
  assert.equal(last.hasMore, false, 'het rồi thì phai noi het, khong de nút no giong them nua');
});

test('số đơn đang mở được đếm trên cả shop, không phải trên trang hiện lên', async () => {
  const page = await fetch(`${base}/api/admin/orders?limit=2&offset=0`, { headers: { 'x-admin-token': 'test-admin-token' } }).then((r) => r.json());
  assert.equal(typeof page.live, 'number', 'phai tra so don con mo');
  // Scrolling down must not make the waiting count fall to zero, which is what
  // happened when the figure came from the rows on screen.
  assert.ok(page.live >= 25, 'số đơn đang chờ phải đếm cả shop');
});

test('panel có nút tải thêm, và chỉ nút đó mới thêm tiếp', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'admin.html'), 'utf8');
  assert.ok(html.includes('id="orders-more"'), 'thieu hang chua nut tai them');
  assert.ok(html.includes('id="orders-more-btn"'), 'thieu nut tai them');
  const source = await fs.readFile(path.join(root, 'public', 'admin.js'), 'utf8');
  // Appending, not replacing: page numbers throw away the row the owner was
  // reading and where they had scrolled to.
  assert.ok(/body\.insertAdjacentHTML\('beforeend',rows\)/.test(source), 'phai noi them duoi, khong thay the toan bo');
  assert.ok(/moreBtn\.onclick=\(\)=>loadOrders\(\{append:true\}\)/.test(source), 'nut phai tai trang ke tiep');
  // Any other reload has to go back to the newest orders, or a status change
  // made on page three would leave the owner looking at page three.
  const reloads = source.match(/resetOrderPage\(\)/g) || [];
  assert.ok(reloads.length > 5, 'mọi lần tai lai khac nut deu phai ve trang dau');
  assert.ok(!/\)\s*loadOrders\(\)\s*;?\s*(catch|;)/.test(source), 'khong duoc tai tiep o noi khong phai do nguoi dung bam nut');
});

test('panel nội bộ không được lưu trong bộ đếm trình duyệt', async () => {
  // A cached admin.js sits in a browser for weeks because the panel is opened
  // rarely. A fix lands, the owner keeps running the old one, and the panel does
  // the wrong thing with no error anywhere to look at.
  const html = await (await fetch(`${base}/admin.html`)).text();
  assert.ok(html.includes('admin.js'), 'trang quan tri van tai dung file');
  const response = await fetch(`${base}/admin.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /no-store/, 'admin.js phai khong luu trong bo dem');
  assert.match((await fetch(`${base}/admin`)).headers.get('cache-control') || '', /no-store/, 'trang quan tri phai khong luu trong bo dem');
});
