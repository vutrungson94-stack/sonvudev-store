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

// The refund path a shop cannot survive: a buyer pays, takes the file, then asks
// for their money back and keeps it. Nothing here refuses the refund — the policy
// already decides that — but every part of it now has to be provable. These cover
// the three pieces that make it provable: the consent recorded before the money
// moved, the category and amount the refund carries, and the trail that shows a
// returning buyer was refunded once before.
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
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';
process.env.ORDER_SWEEP_DISABLED = '1';
process.env.APP_URL = 'http://127.0.0.1:4180';

const { createApp } = await import('../src/app.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let base;
let product;
const auth = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };
const json = (response) => response.json();
const checkout = async (body) => json(await fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product.id, email: 'buyer@example.com', paymentMethod: 'bank_transfer', ...body }) }));
const confirmPaid = (id) => fetch(`${base}/api/admin/orders/${id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'paid' }) }).then(json);

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  product = (await json(await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: 'Refund Tester', price: 200000, currency: 'VND', fileKey: 'products/refund-tester/1.0.0/p.exe', status: 'active' }),
  }))).product;
});
test.after(async () => { await closeTest(server, tempDir); });

test('không đồng ý điều khoản thì không nhận thanh toán', async () => {
  const before = await json(await fetch(`${base}/api/admin/orders?limit=1`, { headers: { 'x-admin-token': 'test-admin-token' } })).total;
  const response = await checkout({ acceptPolicy: false });
  assert.equal(response.status, 400, 'thiếu đồng ý thì không được mở đơn');
  assert.match(response.error, /điều khoản/, 'lý do phải nói rõ cần đồng ý điều khoản');
  const after = await json(await fetch(`${base}/api/admin/orders?limit=1`, { headers: { 'x-admin-token': 'test-admin-token' } })).total;
  assert.equal(after, before, 'đơn không được tạo ra khi chưa đồng ý');
});

test('đơn lưu lại đồng ý điều khoản: lúc nào, từ đâu, bản nào', async () => {
  // The checkbox the browser sends is "on"; anything else must also be accepted,
  // because the form is not the only caller.
  const { order } = await checkout({ acceptPolicy: 'on' });
  assert.ok(order.policyAcceptedAt, 'phải ghi thời điểm đồng ý');
  assert.match(order.policyAcceptedIp || '', /\d|\w+/, 'phải ghi địa chỉ đã đồng ý');
  assert.equal(order.policyAcceptedVersion, '2026-09-28', 'phải ghi phiên bản chính sách đã được xem');
});

test('đơn được mở lại khi mạng đứt, không bị hỏi đồng ý thêm lần nữa', async () => {
  const key = `retry-${Date.now()}`;
  const first = await checkout({ acceptPolicy: 'on', idempotencyKey: key });
  const second = await checkout({ idempotencyKey: key });
  assert.equal(second.order.id, first.order.id, 'phải trả lại đơn cũ');
  assert.ok(second.order.policyAcceptedAt, 'đơn cũ vẫn giữ được sự đồng ý');
});

test('mỗi lần tải file được đếm lại trên đơn', async () => {
  // The count is the only evidence the shop has that a file ever left. A refund
  // argument about "tải ba lần rồi đòi hoàn" is only possible if the number is
  // written down at the moment the link is issued.
  const { order, accessToken } = await checkout({ acceptPolicy: 'on' });
  await confirmPaid(order.id);
  for (let i = 0; i < 2; i += 1) {
    const response = await fetch(`${base}/api/orders/${order.id}/download?token=${encodeURIComponent(accessToken)}`);
    assert.equal(response.status, 200, 'đã trả tiền thì phải tải được');
  }
  const list = await json(await fetch(`${base}/api/admin/orders?q=${encodeURIComponent(order.id)}`, { headers: { 'x-admin-token': 'test-admin-token' } }));
  assert.equal(list.orders[0].downloads, 2, 'phải đếm đúng hai lần tải');
});

test('hoàn tiền phải chọn loại lý do, không gõ tự do được', async () => {
  const { order } = await checkout({ acceptPolicy: 'on' });
  await confirmPaid(order.id);
  const withoutCategory = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ refund: true, reason: 'hoàn thử' }) });
  assert.equal(withoutCategory.status, 400, 'không chọn loại thì không hoàn được');
  const withoutReason = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ refund: true, category: 'defect' }) });
  assert.equal(withoutReason.status, 400, 'lý do vẫn bắt buộc như trước');
  const bogus = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ refund: true, category: 'thấy khó chịu', reason: 'lý do tự nghĩ ra' }) });
  assert.equal(bogus.status, 400, 'loại lạ không được chấp nhận');
});

test('phần mềm lỗi hoặc trừ nhầm thì hoàn toàn bộ', async () => {
  const { order } = await checkout({ acceptPolicy: 'on' });
  await confirmPaid(order.id);
  const defect = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ refund: true, category: 'defect', reason: 'file thiếu DLL, có ảnh từ khách' }) });
  assert.equal(defect.status, 200);
  const refunded = defect.order || (await defect.json()).order;
  assert.equal(refunded.status, 'refunded');
  assert.equal(refunded.refundCategory, 'defect', 'phải ghi loại hoàn tiền');
  assert.equal(refunded.refundAmount, 200000, 'lỗi kỹ thuật thì hoàn nguyên giá');
  assert.equal(refunded.refundedAmount, 200000, 'số đã hoàn phải khớp số đã thu');
});

test('khách đổi ý sau khi có file chỉ hoàn được một phần có giới hạn', async () => {
  const { order } = await checkout({ acceptPolicy: 'on' });
  await confirmPaid(order.id);
  const nothing = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ refund: true, category: 'changed_mind', reason: 'khách đã tải xong đổi ý' }) });
  assert.equal(nothing.status, 400, 'thiếu số tiền thì không hoàn — nếu không đây là bán cho không');
  const tooMuch = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ refund: true, category: 'changed_mind', reason: 'khách đã tải xong đổi ý', partialAmount: 200000 }) });
  assert.equal(tooMuch.status, 400, 'hoàn bằng đúng giá thì thành hoàn toàn phần, chính sách không cho');
  const over = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ refund: true, category: 'changed_mind', reason: 'khách đã tải xong đổi ý', partialAmount: 500000 }) });
  assert.equal(over.status, 400, 'hoàn quá số đã thu cũng bị chặn');
  const agreed = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ refund: true, category: 'changed_mind', reason: 'thỏa thuận hoàn một phần vì đổi ý', partialAmount: 50000 }) });
  assert.equal(agreed.status, 200, 'số tiền hợp lệ thì hoàn được');
  const refunded = (await agreed.json()).order;
  assert.equal(refunded.refundAmount, 50000, 'phải hoàn đúng số đã thỏa thuận');
  assert.equal(refunded.refundedAmount, 50000, 'số đã hoàn là một phần, không phải cả đơn');
});

test('danh sách đơn chỉ ra những email đã từng được hoàn tiền', async () => {
  // The flag exists so a second order from the same address is not a surprise.
  // The server answers for every refunded order, not only the page on screen.
  const refunded = await json(await fetch(`${base}/api/admin/orders?status=refunded`, { headers: { 'x-admin-token': 'test-admin-token' } }));
  assert.ok(refunded.orders.length >= 2, 'phải có đơn đã hoàn');
  assert.ok(refunded.refundedEmails.includes('buyer@example.com'), 'email của khách đã hoàn phải nằm trong danh sách');
  // An order still open from the same address is returned in the same shape, so
  // the panel can mark the row.
  const live = await checkout({ acceptPolicy: 'on', email: 'again@example.com' });
  const page = await json(await fetch(`${base}/api/admin/orders?limit=50`, { headers: { 'x-admin-token': 'test-admin-token' } }));
  assert.ok(page.refundedEmails.every((email) => typeof email === 'string'), 'danh sách email phải là chuỗi');
  assert.ok(!page.refundedEmails.includes(live.order.customerEmail), 'khách chưa hoàn lần nào thì không được gắn cờ');
});

test('bảng điều khiển có ô tìm, lọc trạng thái và hộp hoàn tiền ba lựa chọn', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'admin.html'), 'utf8');
  assert.ok(html.includes('id="order-search"'), 'thiếu ô tìm đơn');
  assert.ok(html.includes('id="product-search"'), 'thiếu ô tìm sản phẩm');
  assert.ok(html.includes('id="refund-modal"'), 'thiếu hộp thoại hoàn tiền');
  for (const value of ['defect', 'duplicate', 'changed_mind']) assert.ok(html.includes(`value="${value}"`), `thiếu lựa chọn ${value}`);
  const source = await fs.readFile(path.join(root, 'public', 'admin.js'), 'utf8');
  assert.ok(/const payload=\{refund:true,category,reason:/.test(source), 'hoàn tiền phải gửi category kèm lý do');
  assert.ok(/partialAmount/.test(source), 'hoàn một phần phải gửi số tiền');
  assert.ok(/refundedEmails/.test(source), 'phải đọc cờ đã hoàn tiền từ server');
});

test('trang thanh toán bắt tích đồng ý, và từ điển nói đúng điều đó', async () => {
  const source = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.ok(/name="acceptPolicy"/.test(source), 'form thanh toán phải có ô tích đồng ý');
  const vi = await fs.readFile(path.join(root, 'public', 'i18n.js'), 'utf8');
  assert.match(vi, /'cart\.agree': 'Tôi đã đọc .*không được hoàn tiền sau khi đã tải\.'/, 'câu đồng ý phải nói rõ phần mềm không hoàn sau khi tải');
  for (const key of ['api.err.policyNotAccepted', 'api.err.refundCategoryRequired', 'api.err.refundPartialAmountRequired']) {
    assert.ok(vi.includes(`'${key}'`), `từ điển thiếu ${key}`);
  }
});

test('đổi ý mất tiền vẫn hoàn một phần, và số liệu doanh thu không bị trừ oan', async () => {
  // The whole point of recording the amount: the report must show the money that
  // actually moved, not an assumption at either end. Measured before and after this
  // one refund rather than against a hard number, because the file's other tests
  // have already bought and refunded on this same shop.
  const before = await json(await fetch(`${base}/api/admin/revenue`, { headers: { 'x-admin-token': 'test-admin-token' } }));
  const { order } = await checkout({ acceptPolicy: 'on' });
  await confirmPaid(order.id);
  const response = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ refund: true, category: 'changed_mind', reason: 'thỏa thuận', partialAmount: 40000 }) });
  assert.equal(response.status, 200);
  const after = await json(await fetch(`${base}/api/admin/revenue`, { headers: { 'x-admin-token': 'test-admin-token' } }));
  assert.equal(after.gross.VND, before.gross.VND + 200000, 'doanh thu gộp vẫn giữ nguyên số đã thu');
  assert.equal(after.refunds.VND, before.refunds.VND + 40000, 'tiền hoàn phải là phần đã thỏa thuận, không phải cả đơn');
});
