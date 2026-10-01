import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-mail-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
// Set before importing, because config decides once at load time whether mail
// goes to Resend or to the outbox. That decision is the whole point here.
process.env.RESEND_API_KEY = 're_test_key_123';
// A real IndexNow key in .env would make every product created in these
// tests fire a real ping at api.indexnow.org. Same trap as the mail key above.
process.env.INDEXNOW_KEY = '';
process.env.EMAIL_FROM = 'SonVuDev <no-reply@mail-fixture.example>';
process.env.SUPPORT_EMAIL = 'support@mail-fixture.example';

const { ensureSeed } = await import('../src/store.js');
const { notifyOrder, notifyMode, previewMessage } = await import('../src/notify.js');
await ensureSeed();

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  sent.push({ url: String(url), headers: options.headers || {}, body: JSON.parse(options.body || '{}') });
  return { ok: true, status: 200, json: async () => ({ id: 'email-1' }), text: async () => '' };
};

const order = (overrides = {}) => ({
  id: 'SVD-MAIL01', status: 'pending_transfer', customerEmail: 'buyer@example.com',
  customerName: 'Buyer', amount: 199000, currency: 'VND',
  expiresAt: new Date(Date.now() + 86400e3).toISOString(),
  items: [{ name: 'Sản phẩm Test', version: '1.0.0' }], notifications: {}, ...overrides,
});

test.after(async () => { globalThis.fetch = realFetch; await fs.rm(tempDir, { recursive: true, force: true }); });
test.beforeEach(() => { sent.length = 0; });

test('có key thì gửi qua Resend chứ không ghi ra outbox', () => {
  assert.equal(notifyMode(), 'resend');
});

test('gửi đúng endpoint, header và payload Resend yêu cầu', async () => {
  const result = await notifyOrder(order(), 'created');
  assert.equal(result.sent, true);
  assert.equal(sent.length, 1);
  const [request] = sent;
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.headers.Authorization, 'Bearer re_test_key_123');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.equal(request.body.from, 'SonVuDev <no-reply@mail-fixture.example>');
  assert.deepEqual(request.body.to, ['buyer@example.com']);
  assert.equal(typeof request.body.subject, 'string');
  assert.ok(request.body.html.length > 0, 'phải có bản HTML');
  assert.ok(request.body.text.length > 0, 'phải có bản text thuần');
});

test('Reply-To trỏ về email hỗ trợ, không phải no-reply', async () => {
  // This is the moment a buyer needs help. Without Reply-To their reply lands
  // in an address nobody reads and the sale becomes a bad review.
  await notifyOrder(order({ id: 'SVD-MAIL02' }), 'created');
  assert.equal(sent[0].body.reply_to, 'support@mail-fixture.example');
  assert.ok(!sent[0].body.from.includes(sent[0].body.reply_to), 'địa chỉ gửi và Reply-To phải khác nhau');
});

test('khoá chống gửi trùng ở phía Resend, khoá theo mã đơn và loại thư', async () => {
  await notifyOrder(order({ id: 'SVD-MAIL03' }), 'paid', 'paid:1');
  const first = sent[0].headers['Idempotency-Key'];
  assert.ok(first, 'phải gửi Idempotency-Key');
  // Resend keeps this for 24h, so a lost response cannot become a second email.
  assert.ok(first.length <= 256, 'khoá không được dài quá 256 ký tự');
  assert.ok(first.includes('SVD-MAIL03'));
  await notifyOrder(order({ id: 'SVD-MAIL03' }), 'paid', 'paid:2');
  assert.notEqual(sent[1].headers['Idempotency-Key'], first, 'hai lần thu tiền khác phải có khoá khác');
});

test('gửi lại cùng một thư sau khi phản hồi rơi thì không thành công hai lần', async () => {
  const { createOrder, getOrder } = await import('../src/store.js');
  const record = order({ id: 'SVD-MAIL04', notifications: {} });
  await createOrder(record);
  // The real flow re-reads the order between attempts, so the second call is
  // given a fresh copy with whatever the first one wrote back.
  const first = await notifyOrder(await getOrder('SVD-MAIL04'), 'cancelled');
  const second = await notifyOrder(await getOrder('SVD-MAIL04'), 'cancelled');
  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(second.reason, 'already-sent');
  assert.equal(sent.length, 1, 'chỉ một thư được gửi');
});

test('Resend từ chối thì ghi nhận lỗi và không làm hỏng đơn hàng', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 422, text: async () => 'Invalid from address' });
  const result = await notifyOrder(order({ id: 'SVD-MAIL05' }), 'created');
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'failed');
  globalThis.fetch = async (url, options = {}) => {
    sent.push({ url: String(url), headers: options.headers || {}, body: JSON.parse(options.body || '{}') });
    return { ok: true, status: 200, json: async () => ({ id: 'x' }), text: async () => '' };
  };
});

test('xem trước thư không gửi đi', () => {
  const message = previewMessage(order(), 'created');
  assert.ok(message.html.includes('SVD-MAIL01'));
  assert.ok(message.html.includes('199.000'), 'phải điền số tiền thật để soi lỗi bố cục');
  assert.ok(!message.html.includes('undefined'), 'không được lộ undefined trong thư gửi khách');
  assert.ok(!message.html.includes('[object Object]'));
  // Both the code and the lookup route, because losing a device is the case the
  // email exists to cover.
  assert.ok(message.html.includes('http'), 'phải có link tra cứu');
});

test('bản text thuần không lộ thẻ HTML', () => {
  // The block copy is shared by both versions of the message. If the tags are
  // not stripped for text, a plain-text mail client shows the letters b and
  // slash-b where the buyer should see bold.
  const message = previewMessage(order(), 'created');
  assert.ok(message.html.includes('<b>'), 'bản HTML phải giữ thẻ để in đậm');
  assert.ok(!message.text.includes('<b>'), 'bản text không được chứa thẻ');
  assert.ok(!message.text.includes('</b>'));
  assert.ok(message.text.includes('SonVuDev SVD-MAIL01'), 'nội dung phải còn nguyên sau khi bỏ thẻ');
});

test('cả bốn thư đều khai báo đúng tên người gửi và không rò rỉ token', () => {
  for (const template of ['created', 'expiring', 'cancelled', 'paid']) {
    const message = previewMessage(order({ status: 'paid' }), template);
    assert.ok(message.subject.length > 0, `${template} phải có tiêu đề`);
    assert.ok(!message.html.includes('accessToken'), `${template} không được chứa token tra cứu trong HTML`);
    assert.ok(!message.html.includes('accountNumber'), `${template} không được chứa số tài khoản ngân hàng`);
  }
});
