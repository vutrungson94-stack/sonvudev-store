import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Reviews, and the rule behind them: no stars, ever.
//
// "Add ratings so Google ranks us higher" is the wrong goal and would cost more
// than it returns. Google has never used a rating or a review count as a ranking
// signal, and self-collected AggregateRating markup is not eligible for a rich
// result on a normal website — so the stars would earn nothing. Meanwhile a paid
// product with public stars makes the refund-then-review route obvious to anyone
// who reads the terms, and this shop refunds on request.
//
// What an assistant actually quotes is prose: a sentence from a buyer who had the
// same problem. So the review is the text, the gate is a fulfilled purchase, and
// these tests exist to keep it that way and to make sure the gate cannot be walked
// around.
process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-review-'));
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
process.env.APP_URL = 'http://127.0.0.1:4291';
process.env.BANK_NAME = 'Test Bank';
process.env.BANK_ACCOUNT_NAME = 'SonVuDev Test';
process.env.BANK_ACCOUNT_NUMBER = '0123456789';
process.env.BANK_BIN = '970436';

const { createApp } = await import('../src/app.js');
const { getOrder, isOrderOwner } = await import('../src/store.js');
const { markOrderDelivered, markOrderPaid } = await import('../src/orders.js');

let server;
let base;
let product;
let counter = 0;

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };
  const created = await fetch(`${base}/api/admin/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Reviewable Tool',
      category: 'Công cụ',
      platform: 'Windows',
      version: '1.4.0',
      price: 149000,
      currency: 'VND',
      description: 'Mô tả đủ dài để trang sản phẩm có nội dung thật và các đoạn được tách bởi hai khoảng trắng.',
      fileKey: 'products/reviewable/1.4.0/tool.exe',
      status: 'active',
    }),
  });
  assert.equal(created.status, 201);
  product = (await created.json()).product;
});
test.after(async () => { server?.close(); await fs.rm(tempDir, { recursive: true, force: true }); });

/** Checks out, and optionally walks the order all the way to delivered. */
async function purchase({ email = 'buyer@example.com', deliver = false } = {}) {
  counter += 1;
  const response = await fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: product.id, email, customerName: 'Buyer', paymentMethod: 'bank_transfer' }),
  });
  assert.equal(response.status, 200, 'checkout phải thành công');
  const data = await response.json();
  let order = data.order;
  if (deliver) {
    order = await markOrderPaid(order, { source: 'admin' });
    order = await markOrderDelivered(order);
  }
  return { order, token: data.accessToken, email };
}

const send = (payload) => fetch(`${base}/api/reviews`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

const GOOD = 'Cài xong chạy ngay, tôi tiết kiệm được buổi sáng đặt phòng họp.';

test('chỉ người đã nhận file mới viết được đánh giá', async () => {
  const paidOnly = await purchase();
  const pending = await send({ orderId: paidOnly.order.id, accessToken: paidOnly.token, productId: product.id, body: GOOD });
  assert.equal(pending.status, 409, 'đơn mới tạo chưa thanh toán thì chưa được viết');

  const paid = await purchase();
  const paidOnlyNoDelivery = await send({ orderId: paid.order.id, accessToken: paid.token, productId: product.id, body: GOOD });
  assert.equal(paidOnlyNoDelivery.status, 409, 'đã thanh toán nhưng chưa gửi file thì chưa được viết');

  const fulfilled = await purchase({ deliver: true });
  const ok = await send({ orderId: fulfilled.order.id, accessToken: fulfilled.token, productId: product.id, body: GOOD });
  assert.equal(ok.status, 201, 'đơn đã giao file thì viết được');
});

test('token sai bị từ chối, và không tiết lộ đơn có tồn tại hay không', async () => {
  const fulfilled = await purchase({ deliver: true });
  const wrongToken = await send({ orderId: fulfilled.order.id, accessToken: 'khong-phai-token-that', productId: product.id, body: GOOD });
  const missingOrder = await send({ orderId: 'SVD-KHONG-TON-TAI-XXXX', accessToken: fulfilled.token, productId: product.id, body: GOOD });
  assert.equal(wrongToken.status, 404);
  assert.equal(missingOrder.status, 404);
  // Identical wording, so the endpoint cannot be used to discover order ids.
  assert.equal((await wrongToken.json()).error, (await missingOrder.json()).error);
});

test('không thể gắn đánh giá vào sản phẩm mình không mua', async () => {
  const fulfilled = await purchase({ deliver: true });
  const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };
  const other = await (await fetch(`${base}/api/admin/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Unbought Thing', price: 100, fileKey: 'products/unbought/1.0.0/x.exe', status: 'active' }),
  })).json();
  const response = await send({ orderId: fulfilled.order.id, accessToken: fulfilled.token, productId: other.product.id, body: GOOD });
  assert.equal(response.status, 400, 'sản phẩm ngoài đơn thì bị từ chối');
});

test('một đơn chỉ viết được một lần cho mỗi sản phẩm', async () => {
  const fulfilled = await purchase({ deliver: true });
  assert.equal((await send({ orderId: fulfilled.order.id, accessToken: fulfilled.token, productId: product.id, body: GOOD })).status, 201);
  const second = await send({ orderId: fulfilled.order.id, accessToken: fulfilled.token, productId: product.id, body: 'Một câu khác hoàn toàn khác câu trước, dài hơn.' });
  assert.equal(second.status, 409, 'gửi hai lần phải bị từ chối, không để lặp trên trang');
  const stored = await getOrder(fulfilled.order.id);
  assert.equal((stored.reviews || []).length, 1, 'chỉ một đánh giá được ghi vào đơn');
});

test('đánh giá quá ngắn bị từ chối, quá dài bị cắt', async () => {
  const short = await purchase({ deliver: true });
  assert.equal((await send({ orderId: short.order.id, accessToken: short.token, productId: product.id, body: 'Tốt' })).status, 400);

  const long = await purchase({ deliver: true });
  const tooLong = await send({ orderId: long.order.id, accessToken: long.token, productId: product.id, body: 'a'.repeat(1500) });
  assert.equal(tooLong.status, 400, 'quá giới hạn thì từ chối chứ không cắt im lặng');
});

test('đánh giá lưu trên chính đơn, và không mang theo dữ liệu riêng tư', async () => {
  const fulfilled = await purchase({ email: 'private@example.com', deliver: true });
  const created = await (await send({ orderId: fulfilled.order.id, accessToken: fulfilled.token, productId: product.id, body: GOOD, authorName: 'Lan' })).json();
  assert.equal(created.review.body, GOOD);
  assert.equal(created.review.authorName, 'Lan');

  // The order row keeps the proof of purchase. Nothing published carries the token,
  // the order id or the email.
  assert.ok(!('orderId' in created.review), 'bản công khai không mang mã đơn');
  assert.ok(!('accessToken' in created.review), 'bản công khai không mang token');
  const stored = await getOrder(fulfilled.order.id);
  assert.equal(stored.reviews[0].orderId, undefined, 'đánh giá lưu không cần lặp lại mã đơn');
  assert.ok(!JSON.stringify(created.review).includes('private@example.com'), 'email không lọt ra ngoài');
});

test('bỏ tên thì hiển thị ẩn danh, không lộ tên trống', async () => {
  const fulfilled = await purchase({ deliver: true });
  const created = await (await send({ orderId: fulfilled.order.id, accessToken: fulfilled.token, productId: product.id, body: GOOD })).json();
  assert.equal(created.review.authorName, 'Khách hàng', 'không có tên thì dùng nhãn chung, không để trống');
  assert.ok(!('anonymous' in created.review), 'cờ ẩn danh là chi tiết nội bộ');
});

test('đánh giá hiện trên trang sản phẩm, và mất khi đơn bị hoàn tiền', async () => {
  const fulfilled = await purchase({ deliver: true });
  await send({ orderId: fulfilled.order.id, accessToken: fulfilled.token, productId: product.id, body: 'Cài đặt một phút là xong, đúng như mô tả.' });

  const before = await (await fetch(`${base}/product/reviewable-tool`)).text();
  assert.match(before, /Cài đặt một phút là xong/, 'đánh giá phải lên trang sản phẩm');

  // A refund means the buyer did not get what they paid for. Their words about it
  // are no longer a description of the product, so they come down with it.
  const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };
  await fetch(`${base}/api/admin/orders/${fulfilled.order.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ refund: true, reason: 'Sản phẩm không đúng mô tả' }),
  });

  const after = await (await fetch(`${base}/product/reviewable-tool`)).text();
  assert.ok(!after.includes('Cài đặt một phút là xong'), 'đã hoàn tiền thì đánh giá phải bị gỡ khỏi trang');
});

test('không có AggregateRating ở bất kỳ đâu, và không có widget sao', async () => {
  const forPages = ['/product/reviewable-tool', '/en/product/reviewable-tool'];
  for (const url of forPages) {
    const body = await (await fetch(`${base}${url}`)).text();
    for (const markup of ['AggregateRating', 'ratingValue', 'reviewCount', 'bestRating']) {
      assert.ok(!body.includes(markup), `${url} chứa ${markup} — sao không phải tín hiệu xếp hạng và sẽ vi phạm rich result`);
    }
    assert.ok(!/★|☆/.test(body), `${url} không được hiện sao`);
  }
});

test('isOrderOwner dùng chung một cách so sánh, không phải === trên hash', async () => {
  const fulfilled = await purchase({ deliver: true });
  const stored = await getOrder(fulfilled.order.id);
  assert.equal(isOrderOwner(stored, fulfilled.token), true);
  assert.equal(isOrderOwner(stored, `${fulfilled.token}x`), false);
  assert.equal(isOrderOwner(stored, ''), false);
  assert.equal(isOrderOwner(null, fulfilled.token), false);
  assert.equal(isOrderOwner(stored, undefined), false);
  // The endpoint used to do this comparison inline with ===, which leaked how many
  // leading characters matched and was a fourth copy of the check.
  const source = await fs.readFile(path.resolve('src', 'app.js'), 'utf8');
  assert.ok(!/accessTokenHash\s*!==\s*hashToken/.test(source), 'app.js không được tự so sánh hash');
});
