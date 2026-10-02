import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDom, runScript, El } from './helpers/dom.mjs';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';

// A buyer whose device dies does not know which moment it happened in, so the
// page has to work that out for them and say the right thing. The matrix below
// is nine real cases: three timings of the payment, each with the network or the
// power going mid-flight. The wording matters more than the mechanics here —
// telling someone whose money already left that nothing happened is what turns a
// glitch into a chargeback.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, 'public', p), 'utf8');
const IDS = ['order-title', 'order-lead', 'order-body'];
// A fixture address, not the shop's real one. A test that hardcodes the live mailbox is a
// test that only passes on the machine where it happens to be configured.
const SUPPORT_FIXTURE = 'support@mail-fixture.example';

const order = (overrides = {}) => ({
  id: 'SVD-TEST', status: 'pending_transfer', amount: 99000, currency: 'VND',
  paymentProvider: 'bank_transfer', providerOrderId: null,
  customerEmail: 'buyer@example.com', createdAt: new Date().toISOString(),
  items: [{ name: 'Sản phẩm A', version: '1.0.0' }], ...overrides,
});

async function page(orderOverrides, respond) {
  const { document, nodes } = createDom(IDS);
  // The support address now comes from the page rather than from a literal in the
  // dictionary, which is what let the audit's domain check stop comparing the
  // files against a value it was itself reading out of a hardcoded file. Real
  // pages carry this attribute; the fake document has to as well.
  document.body = new El('body');
  document.body.dataset = { support: SUPPORT_FIXTURE };
  const extra = new Set(['order-download', 'order-refresh', 'order-countdown', 'order-card']);
  const base = document.getElementById.bind(document);
  document.getElementById = (id) => base(id) || (extra.has(id) ? new El('div', id) : null);
  const fetch = async (url, options = {}) => (respond || (async () => ({ ok: true, status: 200, json: async () => ({ order: order(orderOverrides), payment: null }) })))(String(url), options);
  const run = await runScript(`${read('i18n.js')}\n${read('order-client.js')}\n${read('order.js')}`, {
    document, window: {}, fetch, location: { href: '' },
    sessionStorage: { getItem: () => JSON.stringify({ id: 'SVD-TEST', token: 'tok' }), setItem() {}, removeItem() {} },
  });
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  return { run, nodes };
}

const text = (nodes) => nodes.get('order-body').innerHTML + nodes.get('order-lead').textContent;

// ── Trước khi thanh toán ────────────────────────────────────────────────

test('1. PayPal chưa duyệt, mất nguồn ở trang PayPal: nói rõ chưa bị trừ tiền', async () => {
  const { nodes } = await page({ status: 'pending', paymentProvider: 'paypal', providerOrderId: 'PP-1' });
  const shown = text(nodes);
  // The buyer's bank app will show a pending hold if PayPal merely authorized,
  // and the most alarming possible answer is that we saw nothing.
  assert.ok(shown.includes('chưa bị trừ tiền'), 'phải khẳng định chưa bị trừ tiền');
  assert.ok(shown.includes('thanh toán lại'), 'phải nói họ có thể thanh toán lại');
});

test('2. Mất nguồn ngay ở form, chưa tạo đơn: trang bỏ trống thay vì bịa dữ liệu', async () => {
  const { run, nodes } = await page({ status: 'pending_transfer' }, async () => { throw new TypeError('offline'); });
  assert.deepEqual(run.errors, []);
  assert.ok(text(nodes).includes('Mất kết nối'), 'phải báo mất kết nối');
  assert.ok(!text(nodes).includes('Sản phẩm A'), 'không được hiện dữ liệu chưa có');
});

// ── Trong khi thanh toán ───────────────────────────────────────────────

test('3. Đang chuyển khoản, app ngân hàng treo: chỉ ra việc nằm ở app ngân hàng', async () => {
  const { nodes } = await page({ status: 'pending_transfer' });
  const shown = text(nodes);
  assert.ok(shown.includes('app ngân hàng'), 'phải nói thao tác nằm ở app ngân hàng');
  assert.ok(shown.includes('kiểm tra giao dịch'), 'phải hướng dẫn kiểm tra giao dịch đã thực hiện chưa');
  assert.ok(shown.includes('Đơn này được giữ nguyên'), 'phải trấn an đơn vẫn còn');
});

test('4. Mất mạng giữa lúc gọi checkout: form nói đơn vẫn còn, thử lại được', () => {
  const source = read('app.js');
  // The buyer must be able to retry without being told they would be charged
  // twice, and without losing an order that already exists.
  assert.ok(source.includes("T('cart.errNetwork')"), 'phải có thông báo riêng cho mất mạng');
  assert.ok(source.includes('idempotencyKey'), 'phải gửi khoá chống tạo đơn trùng');
  const error = source.slice(source.indexOf("if (!res.ok && !res.status) throw Error(T('cart.errNetwork'))"));
  assert.ok(error.includes('idempotencyKey = null') === false, 'khoá chỉ reset khi đã có đơn trong tay');
});

// ── Sau khi thanh toán ─────────────────────────────────────────────────

test('5. PayPal đã trừ tiền nhưng mất mạng: trang tự hỏi lại và mở nút tải', async () => {
  let status = 'pending';
  const { nodes, run } = await page({ status: 'pending', paymentProvider: 'paypal', providerOrderId: 'PP-1' }, async (url) => {
    if (url.includes('/capture')) { status = 'paid'; return { ok: true, status: 200, json: async () => ({ order: order({ status }) }) }; }
    return { ok: true, status: 200, json: async () => ({ order: order({ status, paymentProvider: 'paypal', providerOrderId: 'PP-1' }), payment: null }) };
  });
  assert.deepEqual(run.errors, []);
  assert.ok(!/id="order-download"[^>]*disabled/.test(nodes.get('order-body').innerHTML), 'tiền đã vào thì nút tải phải mở');
});

test('6. Đã thanh toán, tải bị gián đoạn: nói rõ tải lại được', async () => {
  const { nodes } = await page({ status: 'paid' });
  const shown = text(nodes);
  assert.ok(shown.includes('tải lại'), 'phải nói tải lại được');
  assert.ok(shown.includes('đơn vẫn còn hiệu lực'), 'phải trấn an đơn còn hiệu lực');
});

test('7. Đã đóng đơn nhưng file hỏng: nói cách mở lại', async () => {
  const { nodes } = await page({ status: 'pending', deliveredAt: new Date().toISOString() });
  const shown = text(nodes);
  assert.ok(shown.includes('mở lại đơn'), 'phải nói chúng tôi mở lại được');
  assert.ok(shown.includes(SUPPORT_FIXTURE), 'phải có đường liên hệ');
});

test('8. Hết hạn nhưng tiền đã vào: nói rõ đơn đã được mở lại', async () => {
  const { nodes } = await page({ status: 'cancelled', paidCount: 1, paidProviderAmount: 3.81 });
  const shown = text(nodes);
  assert.ok(shown.includes('đã được mở lại'), 'phải nói đơn đã mở lại');
  assert.ok(!shown.includes('chưa bị trừ tiền'), 'đã có tiền thì không được nói chưa bị trừ tiền');
});

test('9. Hết hạn, chưa có tiền (PayPal): nói rõ chưa bị trừ tiền', async () => {
  const { nodes } = await page({ status: 'cancelled', paymentProvider: 'paypal', expiresAt: new Date(Date.now() - 3600e3).toISOString(), serverTime: new Date().toISOString() });
  const shown = text(nodes);
  assert.ok(shown.includes('chưa bị trừ tiền'), 'PayPal báo được nên được phép khẳng định');
  assert.ok(shown.includes('đặt đơn mới'), 'phải mở đường đặt đơn mới');
});

test('10. Hết hạn, chuyển khoản: KHÔNG được nói chưa bị trừ tiền', async () => {
  // The store cannot see a bank account. A buyer whose transfer landed an hour
  // after the deadline was charged, and telling them otherwise behind a long
  // confirmation queue is how one broken order becomes a chargeback.
  const { nodes } = await page({ status: 'cancelled', paymentProvider: 'bank_transfer', expiresAt: new Date(Date.now() - 3600e3).toISOString(), serverTime: new Date().toISOString() });
  const shown = text(nodes);
  assert.ok(!shown.includes('chưa bị trừ tiền'), 'không được khẳng định điều mình không biết');
  assert.ok(shown.includes('chưa ghi nhận được'), 'phải nói thẳng là chưa ghi nhận được');
  assert.ok(shown.includes('biên lai'), 'phải đưa đường gửi biên lai');
  assert.ok(shown.includes('mở lại đơn'), 'phải cam kết mở lại được');
});

// ── Chống hồi quy: hai nhánh không được phủ lẫn nhau ───────────────────

test('nhánh "chưa trừ tiền" và "đã trừ tiền" không được dùng chung', () => {
  // Every "you have not been charged" promise is a claim about a real balance.
  // Two of them sharing a message is how a buyer ends up told the wrong one.
  // The copy moved into i18n.js when the page became bilingual, so that is where
  // the guarantee is checked now.
  const source = read('i18n.js');
  const quote = String.fromCharCode(39);
  const value = (key) => {
    const hit = new RegExp(`${quote}${key}${quote}: ${quote}([^${quote}]*)${quote}`).exec(source);
    assert.ok(hit, `thiếu khoá ${key}`);
    return hit[1];
  };
  const paypal = value('order.hint.expiredPaypal');
  const bank = value('order.hint.expiredBank');
  // PayPal reported nothing, so the promise is a fact we can make.
  assert.match(paypal, /chưa bị trừ tiền/, 'nhánh PayPal phải nói rõ chưa bị trừ tiền');
  // A bank transfer tells us nothing either way. Telling a buyer who did pay that
  // they were not charged is the single worst thing this page can say.
  assert.ok(!/chưa bị trừ tiền/.test(bank), 'nhánh chuyển khoản KHÔNG được nói chưa bị trừ tiền');
  assert.match(bank, /chưa ghi nhận được|chưa chuyển/, 'nhánh chuyển khoản phải nói ta chưa biết, không phải nói khách chưa bị trừ');
  assert.notEqual(paypal, bank, 'hai nhánh phải là hai thông điệp khác nhau');
  // The same holds in English, where the two sentences were authored separately
  // and could drift apart from the Vietnamese without anything noticing.
  const englishBank = source.slice(source.indexOf('en: {'));
  const bankEn = /'order\.hint\.expiredBank': '([^']*)'/.exec(englishBank);
  assert.ok(bankEn, 'thiếu nhánh chuyển khoản tiếng Anh');
  assert.ok(!/not been charged/.test(bankEn[1]), 'tiếng Anh cũng không được nói chưa bị trừ tiền');
  const paypalEn = /'order\.hint\.expiredPaypal': '([^']*)'/.exec(englishBank);
  assert.match(paypalEn[1], /not been charged/, 'tiếng Anh nhánh PayPal phải nói rõ chưa bị trừ tiền');
});


