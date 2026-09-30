import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDom, runScript, El } from './helpers/dom.mjs';

// The order page is the only place a buyer who lost the session can come back
// to, and it is the page most likely to be open on a bad connection. These
// tests drive the real file against a stubbed DOM so the retry and offline paths
// cannot rot unnoticed.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, 'public', p), 'utf8');

const IDS = ['order-title', 'order-lead', 'order-body'];

const order = (overrides = {}) => ({
  id: 'SVD-TEST', status: 'pending_transfer', amount: 99000, currency: 'VND',
  customerEmail: 'buyer@example.com', createdAt: new Date().toISOString(),
  items: [{ name: 'Sản phẩm A', version: '1.0.0' }], ...overrides,
});

/**
 * Boots public/order.js. `respond` decides what the network returns, and
 * `offline` makes fetch reject the way a dropped connection does.
 *
 * i18n.js is loaded first and into the same sandbox, because the page reads every
 * string from it. Loading only order.js would leave the dictionary out of the
 * test and prove nothing about the copy a buyer actually reads — including the
 * English half, which is the whole reason the page uses one.
 */
async function boot({ respond, offline = false, lang = 'vi-VN', state = { id: 'SVD-TEST', token: 'tok-123' } } = {}) {
  const { document, nodes } = createDom(IDS);
  const extra = new Set(['order-download', 'order-refresh', 'order-countdown', 'order-card']);
  const base = document.getElementById.bind(document);
  document.getElementById = (id) => base(id) || (extra.has(id) ? new El('div', id) : null);
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (offline) throw new TypeError('Failed to fetch');
    return respond(String(url), options);
  };
  const sessionStorage = {
    _v: state ? { sonvudev_order: JSON.stringify(state) } : {},
    getItem(k) { return this._v[k] ?? null; },
    setItem(k, v) { this._v[k] = String(v); },
    removeItem(k) { delete this._v[k]; },
  };
  // The browser's language picks the starting side of the switch, exactly as it
  // does for a real buyer whose OS is set to English.
  const navigator = { language: lang, clipboard: { writeText: async () => {} } };
  const run = await runScript(`${read('i18n.js')}\n${read('order.js')}`, {
    document, window: {}, fetch, sessionStorage, navigator, location: { href: '' },
  });
  // Recovery costs extra round trips: read the order, ask PayPal to capture,
  // then read the order again. Draining more than the usual two ticks is what
  // lets that chain settle before anything is asserted.
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  return { run, nodes, calls, document };
}

const json = (payload, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => payload });

test('order.js chạy không lỗi', async () => {
  const { run } = await boot({ respond: json({ order: order(), payment: null }) });
  assert.deepEqual(run.errors, [], `order.js nem loi: ${run.errors.join(' | ')}`);
});

test('chưa có session thì hướng người dùng sang trang tra cứu', async () => {
  const { run, nodes } = await boot({ respond: json({ order: order() }), state: null });
  assert.deepEqual(run.errors, []);
  assert.ok(nodes.get('order-body').innerHTML.includes('/lookup'), 'phai huong sang trang tra cuu');
});

test('đơn chưa thanh toán: nút tải hiện nhưng bị khoá', async () => {
  const { nodes } = await boot({ respond: json({ order: order(), payment: null }) });
  const html = nodes.get('order-body').innerHTML;
  assert.ok(html.includes('order-download'), 'nut tai phai luon co mat');
  assert.ok(html.includes('disabled'), 'chua thanh toan thi nut tai phai khoa');
  assert.ok(html.includes('Đơn hàng đã hủy') === false, 'trang thai don phai dung');
});

test('đơn đã thanh toán: chỉ còn nút tải, không còn nút kiểm tra', async () => {
  const { nodes } = await boot({ respond: json({ order: order({ status: 'paid' }) }) });
  const html = nodes.get('order-body').innerHTML;
  assert.ok(html.includes('id="order-download"'), 'phai có nút tải');
  assert.ok(!/id="order-download"[^>]*disabled/.test(html), 'đã thanh toán thì nút tải phải mở');
  // Once the money is in, polling for a status that can no longer change is just
  // battery drain on a phone.
  assert.ok(!html.includes('order-refresh'), 'đơn đã thanh toán thì không cần nút kiểm tra');
});

test('đơn đã giao: báo hoàn tất và khoá lại nút tải', async () => {
  const { nodes } = await boot({ respond: json({ order: order({ status: 'pending', deliveredAt: new Date().toISOString() }) }) });
  assert.equal(nodes.get('order-lead').textContent, 'Đã hoàn tất');
  const html = nodes.get('order-body').innerHTML;
  assert.ok(/id="order-download"[^>]*disabled/.test(html), 'đơn đã giao thì khoá nút tải lại');
});

test('đơn đã hủy: giải thích lý do và không hiện QR', async () => {
  const { nodes } = await boot({
    respond: json({ order: order({ status: 'cancelled' }), expiresAt: null, serverTime: new Date().toISOString(), payment: { channels: [{ id: 'bank', label: 'Ngân hàng', account: '123', amount: 99000, currency: 'VND', transferNote: 'SVD' }] } }),
  });
  const html = nodes.get('order-body').innerHTML;
  assert.ok(html.includes('đã bị hủy'), 'phai giải thích là đơn bị hủy');
  assert.ok(!html.includes('123'), 'đơn hủy thì không hiện thông tin chuyển khoản nữa');
});

test('mất kết nối: không báo lỗi, giữ nội dung và thử lại', async () => {
  const { run, nodes } = await boot({ respond: json({ order: order() }), offline: true });
  assert.deepEqual(run.errors, [], 'offline không được ném lỗi');
  assert.ok(nodes.get('order-body').innerHTML.includes('Mất kết nối'), 'phải báo mất kết nối');
  assert.equal(nodes.get('order-body').innerHTML.includes('Sản phẩm A'), false, 'chưa có dữ liệu thì không được bịa nội dung');
});

test('bấm nút tải thì gọi delivered để đóng đơn', async () => {
  const { document, nodes } = createDom(IDS);
  const button = new El('button', 'order-download');
  const extra = new Set(['order-refresh', 'order-countdown']);
  const base = document.getElementById.bind(document);
  document.getElementById = (id) => base(id) || (id === 'order-download' ? button : extra.has(id) ? new El('div', id) : null);
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).includes('/download')) return { ok: true, status: 200, json: async () => ({ url: 'https://r2.example/file.zip' }) };
    return { ok: true, status: 200, json: async () => ({ order: order({ status: 'paid' }) }) };
  };
  const run = await runScript(`${read('i18n.js')}\n${read('order.js')}`, {
    document, window: {}, fetch, location: { href: '' }, navigator: { language: 'vi-VN' },
    sessionStorage: { getItem: () => JSON.stringify({ id: 'SVD-TEST', token: 'tok-123' }), setItem() {}, removeItem() {} },
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(run.errors, []);
  const listeners = button.listeners.click || [];
  assert.equal(listeners.length, 1, 'phải gắn sự kiện click vào nút tải');
  await listeners[0]();
  assert.ok(calls.some((c) => c.url.endsWith('/download')), 'phải xin link tải');
  assert.ok(calls.some((c) => c.url.endsWith('/delivered') && c.method === 'POST'), 'phải báo đã giao để đóng đơn');
});

test('server trả 404 thì xoá session và không poll lại vô hạn', async () => {
  const { run, nodes, calls } = await boot({ respond: json({ error: 'Không tìm thấy đơn hàng' }, false) });
  assert.deepEqual(run.errors, []);
  assert.ok(nodes.get('order-body').innerHTML.includes('/lookup'), 'phai dua nguoi dung sang tra cuu');
  assert.equal(calls.length, 1, 'đơn không tồn tại thì không poll lại');
});

test('đơn PayPal chưa xác nhận: tự thử capture lại để cứu ca mất nguồn', async () => {
  // State is held by the stub, not hard-coded, because the page re-reads the
  // order after a successful capture and the answer has to have changed.
  let status = 'pending_transfer';
  const { nodes, calls } = await boot({
    respond: async (url) => {
      if (url.includes('/capture')) { status = 'paid'; return { ok: true, status: 200, json: async () => ({ order: order({ status }) }) }; }
      return { ok: true, status: 200, json: async () => ({ order: order({ status, paymentProvider: 'paypal', providerOrderId: 'PP-1' }), payment: null }) };
    },
  });
  // A phone that died after approving but before the capture finished leaves the
  // money taken and the order pending. Opening the order page must clear it.
  assert.ok(calls.some((c) => c.url.includes('/capture')), 'phải thử capture lại khi mở trang đơn PayPal');
  assert.ok(!/id="order-download"[^>]*disabled/.test(nodes.get('order-body').innerHTML), 'capture thành công thì nút tải phải mở');
  assert.equal(calls.filter((c) => c.url.includes('/capture')).length, 1, 'chỉ thử capture một lần, không lặp');
});

test('server cứ trả chưa thanh toán thì không lặp capture vô hạn', async () => {
  const { calls } = await boot({
    respond: async (url) => {
      if (url.includes('/capture')) return { ok: true, status: 200, json: async () => ({ order: order({ status: 'paid' }) }) };
      // A server that never reports the capture back must not turn the recovery
      // into a request loop against PayPal.
      return { ok: true, status: 200, json: async () => ({ order: order({ status: 'pending_transfer', paymentProvider: 'paypal', providerOrderId: 'PP-1' }), payment: null }) };
    },
  });
  assert.equal(calls.filter((c) => c.url.includes('/capture')).length, 1);
});

test('đơn PayPal chưa duyệt: không gọi capture vô ích', async () => {
  const { calls } = await boot({ respond: json({ order: order({ paymentProvider: 'paypal', providerOrderId: null }), payment: null }) });
  assert.equal(calls.some((c) => c.url.includes('/capture')), false, 'chưa có providerOrderId thì không có gì để capture');
});

test('đơn chuyển khoản không gọi capture của PayPal', async () => {
  const { calls } = await boot({ respond: json({ order: order(), payment: null }) });
  assert.equal(calls.some((c) => c.url.includes('/capture')), false, 'đơn nội địa không được gọi PayPal');
});

test('trang đơn luôn chỉ đường cứu đơn, kể cả khi đã thanh toán', async () => {
  const { nodes } = await boot({ respond: json({ order: order({ status: 'paid' }) }) });
  const html = nodes.get('order-body').innerHTML;
  // A device that dies has no session to fall back on, so the recovery route has
  // to be visible before the buyer needs it, not after.
  assert.ok(html.includes('Tra cứu đơn hàng'), 'phải có lối tra cứu');
  assert.ok(html.includes('/lookup?order=SVD-TEST'), 'mã đơn phải đi kèm link để khỏi phải gõ tay');
  assert.ok(html.includes('Mất mạng'), 'phải nói rõ khi nào dùng đường này');
});

test('đơn đã giao vẫn còn lối tra cứu', async () => {
  const { nodes } = await boot({ respond: json({ order: order({ status: 'pending', deliveredAt: new Date().toISOString() }) }) });
  assert.ok(nodes.get('order-body').innerHTML.includes('/lookup?order=SVD-TEST'));
});

test('đếm ngược theo đồng hồ server chứ không tin đồng hồ máy', async () => {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const { nodes } = await boot({
    respond: json({ order: order(), expiresAt, serverTime: new Date(Date.now() + 10 * 60 * 1000).toISOString() }),
  });
  // The device clock reads ten minutes behind, so counting from the device would
  // show 2:10:00 and promise a buyer half an hour of time that is not theirs.
  // Counting from the server must show 1:50:00.
  const shown = nodes.get('order-body').innerHTML.match(/Còn (\d{1,2}:\d{2}:\d{2})/);
  assert.ok(shown, 'phai có đồng hồ đếm ngược');
  const [h, m, s] = shown[1].split(':').map(Number);
  const seconds = h * 3600 + m * 60 + s;
  assert.ok(Math.abs(seconds - (2 * 3600 - 10 * 60)) < 2, `phải đếm theo đồng hồ server, thấy ${shown[1]}`);
});

test('hết hạn thì đồng hồ chuyển sang trạng thái hết hạn', async () => {
  const { nodes } = await boot({
    respond: json({ order: order(), expiresAt: new Date(Date.now() - 60 * 1000).toISOString(), serverTime: new Date().toISOString() }),
  });
  const html = nodes.get('order-body').innerHTML;
  assert.ok(html.includes('is-over'), 'hết hạn phải đổi màu cảnh báo');
  assert.ok(html.includes('hết thời gian thanh toán'), 'phải giải thích sắp bị hủy');
});

// The page a buyer reaches after paying by PayPal, and the reason all of the
// above moved into the dictionary. These boot the same file with an English
// browser: every assertion is that Vietnamese is gone, not merely that something
// appeared, because a half-translated recovery page is worse than an untranslated
// one.
test('trang don hang theo ngon ngu trinh duyet', async () => {
  const vi = await boot({ lang: 'vi-VN', respond: json({ order: order({ status: 'pending_transfer' }), payment: null }) });
  const en = await boot({ lang: 'en-US', respond: json({ order: order({ status: 'pending_transfer' }), payment: null }) });
  const html = (run) => String(run.nodes.get('order-body').innerHTML);
  const lead = (run) => String(run.nodes.get('order-lead').textContent);
  const title = (run) => String(run.nodes.get('order-title').textContent);

  assert.deepEqual(en.run.errors, [], `tieng Anh khong nem loi: ${en.run.errors.join(' | ')}`);
  assert.match(title(vi), /^Đơn SVD-TEST$/);
  assert.equal(title(en), 'Order SVD-TEST', 'tieu de phai doi ngon ngu');
  assert.equal(lead(vi), 'Đang chờ chuyển khoản');
  assert.equal(lead(en), 'Awaiting bank transfer');
  for (const key of ['Sản phẩm', 'Số tiền', 'Trạng thái', 'Thời điểm']) assert.ok(html(vi).includes(key), `tieng Viet thieu "${key}"`);
  for (const key of ['Product', 'Amount', 'Status', 'Created']) {
    assert.ok(html(en).includes(key), `tieng Anh thieu "${key}"`);
  }
  // Only the interface is compared. The product name in the fixture is the
  // buyer's own Vietnamese data, which is correct to leave alone.
  for (const leftover of ['Số tiền', 'Trạng thái', 'Thời điểm', 'Thanh toán thành công để mở nút tải']) {
    assert.ok(!html(en).includes(leftover), `tieng Anh con chu tieng Viet: "${leftover}"`);
  }
  assert.ok(html(en).includes('Pay to unlock the download'));
  assert.ok(html(vi).includes('Thanh toán thành công để mở nút tải'));
});

test('so tien va ngay duoc dinh dang theo ngon ngu', async () => {
  const vi = await boot({ lang: 'vi-VN', respond: json({ order: order({ amount: 249000 }), payment: null }) });
  const en = await boot({ lang: 'en-US', respond: json({ order: order({ amount: 249000 }), payment: null }) });
  // The separator is part of the language. An English buyer reading 249.000 was
  // being shown a Vietnamese number, on the one screen that follows a payment.
  assert.ok(String(vi.nodes.get('order-body').innerHTML).includes('249.000'), 'tieng Viet tach ngan cach bang cham');
  assert.ok(String(en.nodes.get('order-body').innerHTML).includes('249,000'), 'tieng Anh tach ngan cach bang phay');
});

test('moi trang don hang deu dung chung mot bo nhan trang thai', () => {
  const source = read('order.js');
  const app = read('app.js');
  // Two copies of this map had already drifted: the same order read as awaiting
  // payment in one place and awaiting a bank transfer in the other.
  assert.ok(!/const statusLabels\s*=/.test(source), 'order.js khong duoc tu dinh nghia nhan trang thai');
  assert.ok(!/const labels\s*=\s*\{\s*pending/.test(app), 'app.js khong duoc tu dinh nghia nhan trang thai');
  for (const [name, file] of [['order.js', source], ['app.js', app]]) {
    assert.ok(/I18N\.status(Key)?\(/.test(file), `${name} phai dung ham trang thai chung`);
    // Aliasing the shared helper is the point. Writing a second implementation is
    // the thing this check exists to stop, so the test looks for the escaping and
    // the formatter rather than for the name.
    const escLine = file.split(/\r?\n/).find((l) => /^\s*const esc\s*=/.test(l)) || '';
    assert.ok(!/\.replace\(/.test(escLine), `${name} khong duoc tu viet lai ham escape`);
    const moneyLine = file.split(/\r?\n/).find((l) => /^\s*const money\s*=/.test(l)) || '';
    assert.ok(!/Intl\.NumberFormat/.test(moneyLine), `${name} khong duoc goi dinh dang so tien bang ngon ngu cua nguoi ban`);
  }
});

test('trang don hang co nut doi ngon ngu', () => {
  const html = read('order.html');
  assert.ok(/data-lang-toggle/.test(html), 'trang don hang can nut doi ngon ngu');
  const order = read('order.js');
  assert.ok(/I18N\.onChange\(\(\)=>render\(\)\)/.test(order), 'doi ngon ngu thi ve tu dung loi chu khong doi chu');
});
