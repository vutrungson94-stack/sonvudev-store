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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, 'public', p), 'utf8');

const IDS = [
  'product-grid', 'product-count', 'product-modal', 'modal-content', 'toast',
  'lang-toggle', 'announce', 'why', 'faq',
];

const products = [
  { id: 'p1', slug: 'p1', name: 'Sản phẩm A', shortDescription: 'Mô tả ngắn', description: 'Mô tả dài tiếng Việt', shortDescriptionEn: 'Short EN', descriptionEn: 'Long English description', features: ['Tính năng 1'], featuresEn: ['Feature 1 EN'], category: 'Công cụ', platform: 'Windows', version: '1.0.0', price: 99000, currency: 'VND', badge: 'Mới' },
  { id: 'p2', slug: 'p2', name: 'Product B', shortDescription: 'Mô tả ngắn', description: 'Mô tả dài', requirements: 'Cần .NET Framework 4.8. Chạy ở phạm vi người dùng.', category: 'Bundle', platform: 'Windows', version: '2.0.0', price: 149000, currency: 'VND' },
];

// Long-form copy arrives with blank lines between paragraphs. A customer
// complained it rendered as one unreadable wall, so this fixture is realistic.
const longCopy = 'DÒNG MỞ ĐẦU.\n\nÝ NGHĨA THỨ NHẤT.\nVẫn thuộc đoạn một.\n\nÝ NGHĨA THỨ HAI.\n\nKẾT THÚC.';
const longProduct = {
  id: 'p3', slug: 'p3', name: 'Sản phẩm mô tả dài', shortDescription: 'Tóm tắt',
  description: longCopy, category: 'Công cụ', platform: 'Windows', version: '1.0.0',
  price: 99000, currency: 'VND', features: ['f1'], requirements: '',
};

// Boots the real public/i18n.js then public/app.js against a stubbed DOM, so a
// truncation or a throw inside the storefront shows up here instead of on a phone.
async function boot({ lang = 'vi' } = {}) {
  const { document, nodes } = createDom(IDS);
  const fetchCalls = [];
  const fetch = async (url) => {
    fetchCalls.push(String(url));
    if (String(url).includes('/api/products')) return { ok: true, json: async () => ({ products }) };
    if (String(url).includes('/api/checkout/options')) return { ok: true, json: async () => ({ country: 'VN', options: [] }) };
    return { ok: true, json: async () => ({}) };
  };
  const store = { };
  if (lang) store.sonvudev_lang = lang;
  const localStorage = { _v: store, getItem(k) { return this._v[k] ?? null; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } };
  const ctx = { document, window: { I18N: undefined }, fetch, localStorage };
  const i18n = await runScript(read('i18n.js'), ctx);
  const app = await runScript(`${read('order-client.js')}\n${read('app.js')}`, { ...ctx, window: { ...ctx.window, I18N: i18n.window.I18N } });
  return { ...app, i18n, nodes, fetchCalls };
}

test('index.html tai i18n.js truoc app.js', () => {
  const html = read('index.html');
  assert.ok(html.includes('src="i18n.js"'), 'index.html phai tai i18n.js');
  assert.ok(html.includes('src="app.js"'), 'index.html phai tai app.js');
  assert.ok(html.indexOf('i18n.js') < html.indexOf('app.js'), 'i18n.js phai chay truoc app.js');
});

test('app.js chay khong loi va render san pham', async () => {
  const run = await boot();
  assert.deepEqual(run.errors, [], `app.js nem loi: ${run.errors.join(' | ')}`);
  assert.ok(run.fetchCalls.some((u) => u.includes('/api/products')), 'phai goi /api/products');
  const grid = run.nodes.get('product-grid');
  assert.ok(grid.innerHTML.includes('Sản phẩm A'), 'san pham phai xuat hien trong grid');
  assert.ok(grid.innerHTML.includes('Product B'), 'ca hai san pham phai render');
  assert.ok(run.nodes.get('product-count').textContent.includes('sản phẩm'), 'bo dem phai co so san pham');
});

test('HTML render ra khong chua undefined hay [object Object]', async () => {
  const run = await boot();
  const grid = run.nodes.get('product-grid');
  assert.ok(!/undefined/.test(grid.innerHTML), 'khong duoc chua "undefined"');
  assert.ok(!/\[object Object\]/.test(grid.innerHTML), 'khong duoc chua [object Object]');
});

test('showOrder viết trọn một khối, không bị cắt lúng giữa dòng', async () => {
  // Regression guard: the tail of showOrder (dl.hidden / dl.onclick / closing
  // brace) once ended up stranded after loadProducts(), which killed the whole
  // script and left the product grid stuck on the loading skeleton.
  const source = read('app.js');
  const start = source.indexOf('function showOrder(');
  assert.ok(start > 0, 'phải có hàm showOrder');
  const end = source.indexOf('\nasync function checkOrder(', start);
  assert.ok(end > start, 'showOrder phải kết thúc trước checkOrder');
  const body = source.slice(start, end);
  assert.ok(body.includes('dl.disabled'), 'showOrder phai khoa nut tai khi chua thanh toan');
  assert.ok(body.includes('dl.onclick'), 'showOrder phai gan su kien cho nut tai');
  assert.ok(body.includes('download-order'), 'showOrder phai lay nut download-order');
  assert.ok(!body.includes('dl.hidden'), 'nut tai phai luon hien, chi bi khoa chu khong bien mat');
  // The deadline the form promises and the countdown the buyer reads have to
  // come from the same place, or the form and the sweep disagree.
  assert.ok(source.includes('expiryNote'), 'form thanh toan phai bao het han');
  assert.ok(source.includes('paymentWindowHours'), 'số giờ phải lấy từ server');
});

test('showOrder chạy được và đầy đủ thông tin đơn hàng', async () => {
  const { document, nodes } = createDom(IDS);
  const extra = new Set(['modal-title', 'copy-token', 'check-order', 'download-order', 'token-box', 'pay-tabs', 'bank-box']);
  const base = document.getElementById.bind(document);
  document.getElementById = (id) => base(id) || (extra.has(id) ? new El('div', id) : null);
  const fetch = async (url) => (String(url).includes('/api/products')
    ? { ok: true, json: async () => ({ products }) }
    : { ok: true, json: async () => ({ country: 'VN', options: [] }) });
  const ctx = { document, window: {}, fetch, localStorage: { _v: {}, getItem: () => null, setItem() {}, removeItem() {} } };
  const i18n = await runScript(read('i18n.js'), ctx);
  // showOrder is a top-level function declaration, so it is reachable through a
  // trailing assignment on the same script text.
  const run = await runScript(`${read('order-client.js')}\n${read('app.js')}\nwindow.__showOrder = showOrder;`, {
    ...ctx, window: { ...ctx.window, I18N: i18n.window.I18N },
  });
  assert.deepEqual(run.errors, [], `app.js nem loi: ${run.errors.join(' | ')}`);
  assert.equal(typeof run.window.__showOrder, 'function', 'phai goi duoc showOrder tu script');
  run.window.__showOrder({ id: 'SVD-1', status: 'paid' }, 'tok-123', {
    channels: [{ id: 'bank_transfer', label: 'Chuyển khoản', account: '123456', amount: 99000, currency: 'VND', transferNote: 'SVD1' }],
  });
  const out = document.getElementById('modal-content').innerHTML;
  assert.ok(out.includes('SVD-1'), 'modal phai hien ma don');
  assert.ok(out.includes('tok-123'), 'modal phai hien ma tra cuu');
  assert.ok(out.includes('123456'), 'modal phải hiện số tài khoản');
  assert.ok(out.includes('SVD1'), 'modal phai hien noi dung chuyen khoan');
});

// p1 ships an English copy, p2 does not. Switching to English must show the
// English text for p1 while p2 keeps whatever copy it has, so no card is ever
// blank for a customer.
test('tiếng Anh dùng bản EN, thiếu thì fallback về tiếng Việt', async () => {
  const run = await boot({ lang: 'en' });
  assert.deepEqual(run.errors, [], 'app.js khong duoc nem loi o tieng Anh');
  const grid = run.nodes.get('product-grid');
  assert.ok(grid.innerHTML.includes('Short EN'), 'san pham co ban EN phai dung ban EN');
  assert.ok(grid.innerHTML.includes('Feature 1 EN'), 'features phai doi sang tieng Anh');
  assert.ok(!grid.innerHTML.includes('Mô tả dài tiếng Việt'), 'san pham co ban EN khong duoc dung ban tieng Viet');
  // p2 has no English copy at all: its original Vietnamese short text must stay.
  assert.ok(grid.innerHTML.includes('Mô tả ngắn'), 'sản phẩm chưa có bản EN phải giữ nguyên bản tiếng Việt');
});

// A product whose system-requirements text was never translated used to leak raw
// Vietnamese right under an English "System requirements" heading, even though the
// heading itself translated. The block is now field-driven: English override when
// the product has requirementsEn, otherwise the honest notice - never Vietnamese
// body copy in the English UI.
test('yêu cầu hệ thống chưa dịch không được để tiếng Việt dưới nhãn Anh', async () => {
  const openIn = async (lang) => {
    const { document, nodes } = createDom(IDS);
    const cache = new Map();
    for (const id of ['modal-title', 'buy-product']) cache.set(id, new El('div', id));
    const base = document.getElementById.bind(document);
    document.getElementById = (id) => base(id) || cache.get(id) || null;
    const fetchStub = async (url) => (String(url).includes('/api/products')
      ? { ok: true, json: async () => ({ products }) }
      : { ok: true, json: async () => ({ country: 'VN', options: [] }) });
    const ls = { _v: lang ? { sonvudev_lang: lang } : {}, getItem() { return this._v.sonvudev_lang ?? null; }, setItem() {}, removeItem() {} };
    const i18n = await runScript(read('i18n.js'), { document, window: {}, fetch: fetchStub, localStorage: ls });
    const run = await runScript(`${read('order-client.js')}\n${read('app.js')}`, { document, window: { I18N: i18n.window.I18N }, fetch: fetchStub, localStorage: ls });
    run.window.I18N.set(lang);
    run.window.openProduct('p2');
    return nodes.get('modal-content').innerHTML;
  };
  const enModal = await openIn('en');
  assert.ok(enModal.includes('guide is written in Vietnamese'),
    'tiếng Anh phải thay yêu cầu chưa dịch bằng thông báo hướng dẫn');
  assert.ok(!enModal.includes('phạm vi người dùng') && !enModal.includes('.NET Framework'),
    'tiếng Anh không được để lại thân viết tiếng Việt');

  const viModal = await openIn('vi');
  assert.ok(viModal.includes('phạm vi người dùng') && viModal.includes('.NET Framework'),
    'tiếng Việt phải giữ nguyên yêu cầu hệ thống gốc');
});

// The N-locale path: a dictionary that is not bundled ships under public/locales
// and is fetched on demand. A missing key inside a partial dictionary falls back
// to English, not Vietnamese, because the reader chose neither source language.
test('nạp từ điển ngôn ngữ mới theo yêu cầu và dự phòng về tiếng Anh', async () => {
  const { document } = createDom(IDS);
  const calls = [];
  const fetchStub = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/locales/ja.json')) {
      return { ok: true, json: async () => ({ 'nav.products': '製品', 'product.requirements': '動作環境' }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const res = await runScript(read('i18n.js'), {
    document,
    window: {},
    fetch: fetchStub,
    localStorage: { _v: {}, getItem: () => null, setItem() {}, removeItem() {} },
  });
  const I18N = res.window.I18N;
  assert.ok(I18N.supported.includes('ja'), 'tiếng Nhật phải nằm trong danh sách hỗ trợ');
  I18N.set('ja');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(calls.some((url) => url.includes('/locales/ja.json')), 'phải tải /locales/ja.json');
  assert.equal(I18N.lang, 'ja');
  assert.equal(I18N.t('nav.products'), '製品', 'khóa đã dịch phải dùng bản tiếng Nhật');
  assert.equal(I18N.t('hero.title1'), 'Good tools.', 'khóa chưa dịch phải rơi về tiếng Anh');
  assert.equal(document.documentElement.lang, 'ja');
});

test('mọi khoá i18n tồn tại ở cả hai ngôn ngữ', async () => {
  const { document } = createDom(IDS);
  const res = await runScript(read('i18n.js'), {
    document, window: {}, localStorage: { _v: {}, getItem: () => null, setItem() {}, removeItem() {} },
  });
  const I18N = res.window.I18N;
  assert.ok(I18N, 'phai export I18N');
  // Sampled across every page that now reads the dictionary: the storefront, the
  // order page, the recovery form and the PayPal return. A key that no page
  // renders would pass here and still be dead copy, which is what
  // scripts/audit-web.mjs now fails on.
  const keys = ['nav.products', 'hero.title1', 'faq.q1', 'products.count', 'order.download', 'pay.option.bank', 'geo.outside', 'lookup.title', 'paypal.pending', 'order.eyebrow', 'review.err.tooShort', 'order.help.or'];
  const vi = new Map(), en = new Map();
  for (const lang of ['vi', 'en']) {
    I18N.set(lang);
    for (const k of keys) {
      const v = I18N.t(k);
      assert.notEqual(v, k, `khoa "${k}" khong co trong bang "${lang}"`);
      (lang === 'vi' ? vi : en).set(k, v);
    }
  }
  // Same key set, genuinely different copy in each language.
  for (const k of keys) assert.notEqual(vi.get(k), en.get(k), `khoa "${k}" phau khac nhau giua 2 ngon ngu`);
});

test('doi ngon ngu thi <html lang> va combobox doi theo', async () => {
  const { document, nodes } = createDom(IDS);
  // Seed a minimal combobox so i18n.js can paint the flag and label.
  const wrap = document.createElement('div');
  wrap.className = 'lang-combobox-wrap';
  const labelEl = document.createElement('span');
  labelEl.className = 'lang-label';
  labelEl.attrs['data-lang-label'] = '';
  labelEl.dataset.langLabel = '';
  const combobox = document.createElement('div');
  combobox.className = 'lang-combobox';
  combobox.attrs['data-lang-switch'] = '';
  combobox.dataset.langSwitch = '';
  const trigger = document.createElement('button');
  trigger.className = 'lang-trigger';
  trigger.attrs['aria-haspopup'] = 'listbox';
  const flagEl = document.createElement('span');
  flagEl.className = 'lang-flag';
  flagEl.attrs['data-lang-flag'] = '';
  flagEl.dataset.langFlag = '';
  const caret = document.createElement('span');
  caret.className = 'lang-caret';
  caret.attrs['aria-hidden'] = 'true';
  caret.textContent = '▾';
  const dropdown = document.createElement('ul');
  dropdown.className = 'lang-dropdown';
  dropdown.attrs['role'] = 'listbox';
  dropdown.attrs['aria-label'] = 'Chọn ngôn ngữ';
  trigger.appendChild(flagEl);
  trigger.appendChild(caret);
  combobox.appendChild(trigger);
  combobox.appendChild(dropdown);
  wrap.appendChild(labelEl);
  wrap.appendChild(combobox);
  document.body.appendChild(wrap);
  nodes.set('lang-combobox', combobox);
  nodes.set('lang-flag', flagEl);
  nodes.set('lang-label', labelEl);
  const res = await runScript(read('i18n.js'), {
    document, window: {}, localStorage: { _v: {}, getItem: () => null, setItem() {}, removeItem() {} },
  });
  const I18N = res.window.I18N;
  assert.equal(document.documentElement.lang, 'vi');
  // The combobox flag and label must reflect the active language.
  const flagText = () => wrap.querySelector('[data-lang-flag]')?.textContent || '';
  const labelText = () => wrap.querySelector('[data-lang-label]')?.textContent || '';
  assert.ok(flagText().includes('🇻🇳') || labelText().includes('Tiếng Việt'), 'cờ hoặc nhãn phải hiện tiếng Việt khi trang mở');
  I18N.set('en');
  assert.equal(document.documentElement.lang, 'en', 'lang tren <html> phai doi theo');
  assert.ok(flagText().includes('🇺🇸') || labelText().includes('English'), 'cờ hoặc nhãn phải chuyển sang EN khi đổi sang tiếng anh');
  I18N.set('vi');
  assert.equal(document.documentElement.lang, 'vi');
  assert.ok(flagText().includes('🇻🇳') || labelText().includes('Tiếng Việt'), 'cờ hoặc nhãn phải quay lại VI');
});

test('combobox ngôn ngữ không làm vỡ layout trên màn hình nhỏ', () => {
  const css = read('styles.css');
  // The combobox is a flex child of .site-header. Without flex:0 0 auto it stretches
  // and pushes the row past the viewport, which is what broke the header on phones
  // when the language feature was added.
  const rule = css.match(/^\.lang-combobox\{[^}]*\}/m);
  assert.ok(rule, 'phải có rule .lang-combobox');
  assert.ok(rule[0].includes('flex:0 0 auto'), 'combobox phai co flex:0 0 auto de khong bi keo gian');
  // Below 800px the nav is hidden and the CTA is pushed right, so the combobox needs
  // its own margin and the CTA must stop using margin-left:auto.
  assert.ok(/@media\(max-width:800px\)\{[^}]*\.lang-combobox\{[^}]*margin-left:auto/.test(css), 'can margin-left:auto cho combobox o man hinh nho');
  assert.ok(/\.site-header \.header-cta\{margin-left:0\}/.test(css), 'nut mua phai bo margin-left:auto o man hinh nho');
  assert.ok(/@media\(max-width:420px\)\{[^}]*\.lang-trigger\{/.test(css), 'can rule rieng cho trigger 420px');
  // The combobox trigger has a visible active state tied to aria-expanded and the
  // selected option is painted from aria-selected, so the state a screen reader reads
  // and the state the eye sees are one attribute rather than two that can disagree.
  assert.ok(/\.lang-trigger\[aria-expanded="true"\]\{/.test(css) || /\.lang-dropdown li\[aria-selected="true"\]\{/.test(css),
    'trạng thái đang mở/phải được tô bằng thuộc tính mà trình đọc màn hình đọc');
});

test('combobox ngon ngu nam trong header cua index.html', () => {
  const html = read('index.html');
  assert.ok(/data-lang-switch/.test(html), 'combobox phải có data-lang-switch');
  assert.ok(/<span[^>]*data-lang-label/.test(html), 'phai co nhan hien thi ten ngon ngu');
  assert.ok(/<span[^>]*data-lang-flag/.test(html), 'phai co co ngon ngu');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.ok(header.includes('data-lang-switch'), 'combobox phải nằm trong header');
});

// The switch lives on the homepage only. Nine pages each carrying a control for one
// decision meant nine places to look for it, and two of them needed CSS rules that
// existed only to place a button on a page with no header to put it in.
test('chỉ trang chủ mới có nút đổi ngôn ngữ', () => {
  const pages = ['index.html', 'about.html', 'terms.html', 'privacy.html', 'refund.html',
    'lookup.html', 'order.html', '404.html', 'paypal-return.html'];
  const withSwitch = pages.filter((name) => /data-lang-switch|data-lang-toggle/.test(read(name)));
  assert.deepEqual(withSwitch, ['index.html'],
    `nút đổi ngôn ngữ phải chỉ ở trang chủ, các trang khác đọc lựa chọn đã lưu. Đang có ở: ${withSwitch.join(', ')}`);
  // Every one of them still renders in the language the reader chose on the
  // homepage — which is the whole point of moving the button rather than dropping it.
  for (const name of pages) {
    assert.match(read(name), /src="i18n\.js"/, `${name} phải vẫn nạp từ điển`);
  }
  // The classes that placed the removed buttons are gone with them.
  const css = read('styles.css');
  assert.ok(!/\.lookup-lang|\.paypal-lang|\.lang-toggle\b/.test(css),
    'CSS của nút đã bỏ phải bị gỡ — còn lại thì là quy tắc chết');
});

// The tab title, on every page that is not the admin panel.
//
// A language switch that leaves the browser tab in Vietnamese is a switch that only
// half happened: the tab is the first thing a reader sees of a page and the label
// they find it by again. All nine pages carried a hardcoded Vietnamese string, and
// the 404 page carried the near-miss — data-i18n-attr="title:...", which sets an
// *attribute* on the <title> element and therefore changed nothing at all. The gate
// that was supposed to catch untranslated sentences only walked <p> elements, so a
// <title> in the document head was outside its reach by construction.
test('mọi trang đều đổi được tiêu đề tab', async () => {
  const pages = ['index.html', 'about.html', 'terms.html', 'privacy.html', 'refund.html',
    'lookup.html', 'order.html', '404.html', 'paypal-return.html'];

  // The real dictionary, booted once. A regex over i18n.js source cannot tell a
  // key that resolves from one that is spelled slightly differently, which is the
  // whole failure mode here.
  const { document } = createDom(IDS);
  const res = await runScript(read('i18n.js'), {
    document, window: {}, localStorage: { _v: {}, getItem: () => null, setItem() {}, removeItem() {} },
  });
  const I18N = res.window.I18N;

  for (const name of pages) {
    const html = read(name);
    const title = /<title([^>]*)>/.exec(html);
    assert.ok(title, `${name} phải có <title>`);
    assert.match(title[1], /data-i18n="title\./, `${name}: <title> phải mang data-i18n trỏ tới khoá tiêu đề`);
    assert.ok(!/data-i18n-attr/.test(title[1]),
      `${name}: <title> không được dùng data-i18n-attr — attribute không đổi được chữ trên tab`);
    const key = /data-i18n="([\w.]+)"/.exec(title[1])[1];
    for (const lang of ['vi', 'en']) {
      I18N.set(lang);
      const value = I18N.t(key);
      assert.notEqual(value, key, `${name}: khoá "${key}" không có trong bảng ${lang}`);
      // A title that resolves to the Vietnamese text in the English table is the
      // same bug wearing a working key.
      if (lang === 'en') assert.ok(!/[à-ỹ]/.test(value),
        `${name}: bảng tiếng Anh của "${key}" vẫn chứa tiếng Việt: ${value}`);
    }
    // And both halves must actually differ, or the switch is decoration.
    I18N.set('vi');
    const vi = I18N.t(key);
    I18N.set('en');
    assert.notEqual(I18N.t(key), vi, `${name}: tiêu đề "${key}" phải khác nhau giữa hai ngôn ngữ`);
  }

  // The sticky header needs a fill or the page scrolls up behind it and the header
  // becomes a strip of half-readable copy. Reported as a scrolling bug on /about,
  // and the first fix only reached /about: the rule was scoped to a body class the
  // About page happens to carry, so /terms and /lookup kept scrolling theirs away.
  // The pin now lives on the shared .site-header rule, which is what this checks —
  // one rule, every page, rather than a list of body classes to keep in sync.
  const css = read('styles.css');
  const sticky = css.match(/^\.site-header\{([^}]*)\}/m);
  assert.ok(sticky, 'cần có rule .site-header cơ bản');
  assert.match(sticky[1], /position:sticky/, 'header phải được cố định (sticky) trên mọi trang');
  assert.match(sticky[1], /background:/, 'header cố định phải có nền, nếu không chữ nội trang sẽ hiện lên xuyên qua nó khi cuộn');
  assert.match(sticky[1], /z-index:/, 'header cố định phải nổi lên trên nội dung');
  // And the pinned 78px bar must not swallow a jump target: the nav links are
  // #products, #why and #faq, all below the fold.
  const margins = [...css.matchAll(/^([^{}]+)\{[^}]*scroll-margin-top:(\d+)px/mg)];
  assert.ok(margins.length > 0, 'phải có scroll-margin-top cho các đích nhảy tới bằng anchor');
  for (const id of ['products', 'why', 'faq']) {
    const covered = margins.some(([selector]) => new RegExp(`#${id}\\b`).test(selector));
    assert.ok(covered, `#${id} phải có scroll-margin-top để không bị header cố định che`);
  }
  // The admin panel keeps its own height for its own header; the pin itself is
  // shared, and that is the part a reader sees on every page.
  assert.match(css, /\.admin-page \.site-header\{[^}]*height:58px/, 'admin giữ chiều cao header riêng');

  // The footer is pinned the same way, on the same principle: one shared rule,
  // not a body class one page happens to carry. It is the last element in the
  // document, so its z-index has to sit under the header (20) and the checkout
  // sheet (20, later in the DOM, which is what decides a tie) — at the header's
  // own z-index the footer would paint over the sheet a buyer is paying in.
  const footer = css.match(/^\.site-footer\{([^}]*)\}/m);
  assert.ok(footer, 'cần có rule .site-footer cơ bản');
  assert.match(footer[1], /position:sticky/, 'footer phải được cố định (sticky) giống header');
  assert.match(footer[1], /bottom:0/, 'footer cố định phải neo vào đáy khung nhìn');
  assert.match(footer[1], /background:/, 'footer cố định phải có nền, nếu không chữ nội trang sẽ hiện xuyên qua');
  const footerZ = Number(/z-index:(\d+)/.exec(footer[1])[1]);
  assert.ok(footerZ < 20, `footer phải nằm dưới header/modal (20), đang là ${footerZ}`);
});


// End-to-end click path, the one a customer actually walks: tap a product,
// then tap the buy button. The extra modal nodes are cached so getElementById
// keeps returning the same object, exactly like a browser would after the
// innerHTML has inserted them.
async function clickThroughCheckout() {
  const { document } = createDom(IDS);
  const cache = new Map();
  for (const id of ['modal-title', 'buy-product', 'back-product', 'checkout-form']) cache.set(id, new El('div', id));
  const base = document.getElementById.bind(document);
  document.getElementById = (id) => base(id) || cache.get(id) || null;
  const fetch = async (url) => (String(url).includes('/api/products')
    ? { ok: true, json: async () => ({ products: [...products, longProduct] }) }
    : { ok: true, json: async () => ({ country: 'VN', options: [{ id: 'bank_transfer', label: 'Chuyen khoan', hint: 'h', account: '1', amount: 1, currency: 'VND', transferNote: 'n' }] }) });
  const ls = { _v: {}, getItem: () => null, setItem() {}, removeItem() {} };
  const i18n = await runScript(read('i18n.js'), { document, window: {}, fetch, localStorage: ls });
  const run = await runScript(`${read('order-client.js')}\n${read('app.js')}`, { document, window: { I18N: i18n.window.I18N }, fetch, localStorage: ls });
  return { run, document, get: (id) => cache.get(id) };
}

test('bam san pham -> mo duyet chi tiet -> bam mua -> den trang thanh toan', async () => {
  const { run, document, get } = await clickThroughCheckout();
  assert.deepEqual(run.errors, [], `app.js nem loi: ${run.errors.join(' | ')}`);
  assert.equal(typeof run.window.openProduct, 'function', 'openProduct phai la ham global');
  assert.equal(typeof run.window.openCheckout, 'function', 'openCheckout phai la ham global');

  run.window.openProduct('p1');
  const detail = document.getElementById('modal-content').innerHTML;
  assert.ok(detail.includes('Sản phẩm A'), 'modal chi tiết phải hiện tên sản phẩm');
  assert.ok(detail.includes('buy-product'), 'modal chi tiet phai co nut mua');

  const buy = get('buy-product');
  assert.equal(typeof buy.onclick, 'function', 'nut mua phai gan su kien onclick');
  buy.onclick();

  const checkout = document.getElementById('modal-content').innerHTML;
  assert.ok(checkout.includes('checkout-form'), 'buoc sau phai ra form thanh toan');
  assert.ok(checkout.includes('bank_transfer'), 'form thanh toan phai liet ke phuong thuc');
  assert.ok(checkout.includes('checkout-form'), 'phai co form');
  assert.deepEqual(run.errors, [], 'không được ném lỗi sau khi bấm');
});

test('openProduct và openCheckout phải nằm ở cấp global', () => {
  // A stray brace once turned these into a bare block, which parses fine and
  // silently hides the functions from the rest of the page: tapping a product
  // then did nothing. Assert they are reachable, not merely present in the file.
  const source = read('app.js');
  assert.ok(/^function openProduct\(/m.test(source), 'openProduct phai khai bao o dau dong');
  assert.ok(/^function openCheckout\(/m.test(source), 'openCheckout phai khai bao o dau dong');
  // Every top-level function must be balanced: no function may be swallowed by
  // an unclosed brace before it.
  const topLevel = [...source.matchAll(/^(?:async )?function (\w+)/gm)].map((m) => m[1]);
  for (const name of ['card', 'openProduct', 'closeModal', 'openCheckout', 'submitCheckout', 'showOrder', 'checkOrder', 'downloadOrder']) {
    assert.ok(topLevel.includes(name), `${name} phai la ham cap cao`);
  }
});

test('mô tả sản phẩm tách thành đoạn, không biến một khối liền dòng', async () => {
  const { document } = createDom(IDS);
  const cache = new Map();
  for (const id of ['modal-title', 'buy-product']) cache.set(id, new El('div', id));
  const base = document.getElementById.bind(document);
  document.getElementById = (id) => base(id) || cache.get(id) || null;
  const fetch = async (url) => (String(url).includes('/api/products')
    ? { ok: true, json: async () => ({ products: [longProduct] }) }
    : { ok: true, json: async () => ({ country: 'VN', options: [] }) });
  const ls = { _v: {}, getItem: () => null, setItem() {}, removeItem() {} };
  const i18n = await runScript(read('i18n.js'), { document, window: {}, fetch, localStorage: ls });
  const run = await runScript(`${read('order-client.js')}\n${read('app.js')}`, { document, window: { I18N: i18n.window.I18N }, fetch, localStorage: ls });
  assert.deepEqual(run.errors, [], 'app.js khong duoc nem loi');
  run.window.openProduct('p3');
  const html = document.getElementById('modal-content').innerHTML;
  const block = html.slice(html.indexOf('detail-description'), html.indexOf('</div>', html.indexOf('detail-description')));
  // The fixture has four blank-line separated blocks.
  const paras = (block.match(/<p>/g) || []).length;
  assert.equal(paras, 4, `mo ta phai tach thanh 4 doan, thuc te co ${paras}`);
  assert.ok(block.includes('DÒNG MỞ ĐẦU'), 'doan dau phai hien');
  assert.ok(block.includes('KẾT THÚC'), 'doan cuoi phai hien');
  // A single newline inside one block becomes <br> before the next line.
  assert.ok(block.includes('Ý NGHĨA THỨ NHẤT.<br>Vẫn thuộc'), 'xuong dong trong mot doan phai thanh <br>');
  // Separate blocks must each get their own <p>, with no raw newline left.
  assert.ok(block.includes('MỞ ĐẦU.</p><p>Ý NGHĨA'), 'hai doan phai tach bang the p');
  assert.ok(!block.includes('\n'), 'khong duoc con xuong dong tho trong HTML');
});

test('modal trên điện thoại cuộn từng phần, không phải cả trang', () => {
  const css = read('styles.css');
  // The whole modal used to scroll as one 90vh block, forcing a long page of
  // scrolling on a phone. The body must scroll on its own instead.
  const block = css.match(/@media\(max-width:700px\)\{([\s\S]*?)\n\}/);
  assert.ok(block, 'cần có media query 700px cho modal điện thoại');
  const rules = block[1];
  assert.ok(/\.modal\{[^}]*flex-direction:column/.test(rules), 'modal phai la flex column de tach phan');
  assert.ok(/\.checkout-form\{[^}]*overflow-y:auto/.test(rules), 'form thanh toan phai cuon rieng');
  assert.ok(/\.detail-body\{[^}]*overflow-y:auto/.test(rules), 'noi dung san pham phai cuon rieng');
  assert.ok(/\.detail-body\{[^}]*min-height:0/.test(rules), 'can min-height:0 de flex con cuon dung');
  // Inset padding gives the sheet a visible margin from the screen edges.
  assert.ok(/\.modal-backdrop\{[^}]*padding:10px 10px 14px/.test(rules), 'backdrop phai de khe 10-15px nhu ban goi y');
  // The decorative banner eats a lot of vertical space on a small screen.
  assert.ok(/\.detail-art\{display:none\}/.test(rules), 'anh banner nen an di tren dien thoai');
  // The header must not scroll away, and the buy bar must not either.
  assert.ok(/\.detail-copy\{[^}]*flex:0 0 auto/.test(rules), 'tên sản phẩm phải ghim không cuộn');
  assert.ok(/\.detail-footer\{[^}]*flex:0 0 auto/.test(rules), 'nut mua phai ghim o day duoi');
  // The base .modal-backdrop is a centred grid (`place-items:center`), which
  // leaves the sheet with no height to divide among its rows, so the scroll area
  // froze and the buy bar vanished. The phone rule has to switch it to flex.
  assert.ok(/\.modal-backdrop\{[^}]*display:flex/.test(rules), 'backdrop phai doi tu grid sang flex tren dien thoai');
  assert.ok(/\.modal-backdrop\{[^}]*align-items:stretch/.test(rules), 'backdrop phai keo theo chieu cao');
  assert.ok(/\.modal\{[^}]*flex:1 1 auto/.test(rules), 'modal phải nhận phần còn lại của backdrop');
  assert.ok(/\.modal\{[^}]*min-width:0/.test(rules), 'can min-width:0 de modal co lai duoc');
  // Swiping inside the sheet must not drag the store page along.
  assert.ok(/overscroll-behavior:contain/.test(rules), 'can chan lan truyen cuon sang trang nen');
});

test('chiều cao modal phải xác định ở cả máy tính và điện thoại', () => {
  const css = read('styles.css');
  // The sheet must have a definite height, not just a max-height: in a flex
  // column a max-height alone gives the children no height to shrink into, so
  // the scrolling area ended up pushed off screen and the buy bar vanished.
  const block = css.match(/@media\(max-width:700px\)\{([\s\S]*?)\n\}/);
  const rules = block[1];
  assert.ok(/\.modal-backdrop\{[^}]*position:fixed[^}]*inset:0/.test(rules), 'backdrop phai gan vao 4 canh man hinh');
  assert.ok(/\.modal\{[^}]*max-height:none/.test(rules), 'phai bo max-height tren dien thoai');
  assert.ok(/\.detail-body\{[^}]*flex:1 1 0/.test(rules), 'vùng cuộn phải flex-basis 0 để nhận phần còn lại');
  assert.ok(/\.checkout-form\{[^}]*flex:1 1 0/.test(rules), 'form thanh toan cung phan nay');
  assert.ok(/\.success-state\{[^}]*flex:1 1 0/.test(rules), 'trang thanh cong cung phan nay');

  // Desktop .modal used max-height + overflow:auto, so the whole sheet scrolled
  // and the buy bar scrolled out of view. It has to be a flex column with an
  // inner scroll region on every screen size.
  const base = css.match(/\.modal\{position:relative;[^}]*\}/);
  assert.ok(base, 'cần có rule .modal cơ bản');
  assert.ok(base[0].includes('display:flex'), 'modal phai la flex column');
  assert.ok(base[0].includes('flex-direction:column'), 'modal phải xếp cột');
  assert.ok(!base[0].includes('overflow:auto'), 'modal khong duoc cuon toan bo');
  const body = css.match(/^\.detail-body\{[^}]*\}/m);
  assert.ok(body, 'cần có rule .detail-body');
  assert.ok(body[0].includes('overflow-y:auto'), 'chi detail-body moi cuon');
  assert.ok(body[0].includes('min-height:0'), 'can min-height:0 de flex con co the co');
  const footer = css.match(/^\.detail-footer\{[^}]*\}/m);
  assert.ok(footer, 'cần có rule .detail-footer');
  assert.ok(footer[0].includes('flex:0 0 auto'), 'thanh nut mua phai co dinh khong co');
});


test('mở modal phải khoá trang nền lại', () => {
  const css = read('styles.css');
  // Without a body lock the page behind keeps its own scroll offset, so a swipe
  // over the sheet moved the store instead of the modal.
  assert.ok(/body\.modal-open\{[^}]*overflow:hidden/.test(css), 'mo phai khoa cuon trang nen');
  assert.ok(/body\.modal-open\{[^}]*position:fixed/.test(css), 'tren dien thoai phai gan body de khong doi vi tri');
  const source = read('app.js');
  assert.ok(/document\.body\.classList\.add\('modal-open'\)/.test(source), 'mo modal phai them class modal-open');
  assert.ok(/document\.body\.classList\.remove\('modal-open'\)/.test(source), 'dong modal phai go class modal-open');
});

test('nút mua nằm ngoài vùng cuộn, luôn nhìn thấy', async () => {
  const { run, document, get } = await clickThroughCheckout();
  assert.deepEqual(run.errors, [], `app.js nem loi: ${run.errors.join(' | ')}`);
  run.window.openProduct('p3');
  const html = document.getElementById('modal-content').innerHTML;
  // Structure order matters: art, header, scrolling body, then the buy bar.
  const iBody = html.indexOf('detail-body');
  const iFooter = html.indexOf('detail-footer');
  const iTitle = html.indexOf('detail-copy');
  assert.ok(iTitle >= 0 && iBody > iTitle, 'tên sản phẩm phải trên phần nội dung');
  assert.ok(iFooter > iBody, 'thanh nút mua phải dưới phần nội dung');
  const body = html.slice(iBody, iFooter);
  assert.ok(!body.includes('buy-product'), 'nut mua khong duoc nam trong vung cuon');
  assert.ok(html.slice(iFooter).includes('buy-product'), 'nut mua phai nam trong detail-footer');
  assert.equal(typeof get('buy-product').onclick, 'function', 'nut mua van bam duoc');
});

test('data-i18n trong index.html deu co khoa trong bang dich', async () => {
  const html = read('index.html');
  const { document } = createDom(IDS);
  const res = await runScript(read('i18n.js'), {
    document, window: {}, localStorage: { _v: {}, getItem: () => null, setItem() {}, removeItem() {} },
  });
  const I18N = res.window.I18N;
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 30, `index.html phai co nhieu data-i18n, thuc te co ${keys.length}`);
  for (const k of new Set(keys)) assert.notEqual(I18N.t(k), k, `khoa "${k}" dung o HTML nhung khong co trong bang dich`);
});

// The scrolling sheet used to be broken while every other layout test stayed
// green, because they all asserted CSS text on rules that were never applied.
// #modal-content is a wrapper div between .modal and the sections app.js writes
// into it, so when it stayed display:block the flex declarations below it were
// inert: the description kept its full height, nothing scrolled, and
// .modal{overflow:hidden} cut the buy bar off. These tests pin the chain the
// layout actually depends on rather than the presence of any one property.

// Pulls the top-level declaration block for a selector, skipping the minified
// block at the top of the file and any rule indented inside @media. The
// selector is matched within one line on purpose: an earlier version let the
// pattern cross newlines and happily matched a class named inside a comment.
function baseRule(css, token) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`^([^\\n@{}]*${esc}[^\\n@{}]*)\\{([^}]*)\\}`, 'm'));
  return m ? m[2] : null;
}

test('#modal-content phai la flex column, va la noi app.js ghi vao', () => {
  const css = read('styles.css');
  const wrapper = baseRule(css, '#modal-content');
  assert.ok(wrapper, 'can co rule cho #modal-content');
  assert.match(wrapper, /display:flex/, 'wrapper phải là flex container để các phần bên trong chia được chiều cao');
  assert.match(wrapper, /flex-direction:column/, 'wrapper phải xếp cột');
  assert.match(wrapper, /min-height:0/, 'cần min-height:0 để wrapper có thể bị ép xuống trong modal');
  assert.match(wrapper, /flex:1 1 auto/, 'wrapper phải nhận phần còn lại của .modal');

  // The CSS is only useful while it describes the node the JS fills in.
  const html = read('index.html');
  const modal = html.match(/<div class="modal"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(modal, 'can tim thay .modal trong index.html');
  assert.ok(modal[0].includes('id="modal-content"'), '#modal-content phai nam trong .modal');
  const source = read('app.js');
  assert.match(source, /getElementById\('modal-content'\)/, 'app.js phai ghi vao #modal-content');
  // Every section that has to scroll has to be a child of that wrapper.
  for (const cls of ['detail-body', 'detail-footer', 'checkout-head', 'checkout-form', 'success-state']) {
    assert.ok(source.includes(`class="${cls}"`), `app.js phai render .${cls} trong sheet`);
  }
});

// The PayPal return screen showed "{support}" and "{id}" as literal braces.
//
// Four page scripts each wrapped I18N.t in a local `T`, and three of the four
// forwarded all three arguments. paypal-return.js's took one, so a call written
// `T('paypal.errHint', {id, support})` put its object in the *fallback* slot, left
// `vars` undefined, and the placeholder pass left every brace alone. The failure
// screen therefore read "…contact {support} with order {id}" — on the one page a
// buyer reaches after PayPal has already taken their money, where the address and
// the order id are the only two things that get them the file or the refund.
//
// Driven against the real i18n.js rather than read as source text, because the
// bug is an argument *position*, and no regex over the wrapper distinguishes a
// wrapper that forwards vars from one that swallows them.
test('mọi bọc T() phải chuyển tiếp đủ 3 đối số, và placeholder phải được điền', async () => {
  const { document, nodes } = createDom(['title', 'message', 'actions', 'loader', 'eyebrow']);
  const i18n = await runScript(read('i18n.js'), { document, window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  const dict = i18n.window.I18N;

  // A key that exists in both languages and carries two placeholders. Resolving it
  // through each page's own wrapper is what the page does.
  const expectResolved = (key, vars) => {
    const text = dict.t(key, undefined, vars);
    assert.ok(!/\{[a-zA-Z]+\}/.test(text), `${key} phải điền hết placeholder, nhận: ${text}`);
    assert.ok(text.includes(vars.id), `${key} phải chứa mã đơn`);
    assert.ok(text.includes(vars.support), `${key} phải chứa địa chỉ hỗ trợ`);
    return text;
  };
  const vars = { id: 'SVD-TEST-0001', support: 'support@shop.example' };
  expectResolved('paypal.errHint', vars);

  // And the wrappers themselves, driven by their own parameter lists rather than
  // by a shape a regex guesses. Each page names its parameters differently —
  // (key, fallback, vars) or (key, vars) — so the thing to assert is where each
  // one lands in the call: the third slot is vars, always, and a wrapper with two
  // parameters has to fill the second slot with undefined rather than pass vars
  // there. That is the mistake this test exists for.
  for (const name of ['app.js', 'order.js', 'lookup.js', 'paypal-return.js']) {
    const source = read(name);
    const wrapper = source.match(/const T\s*=\s*\(([^)]*)\)\s*=>\s*window\.I18N\.t\(([^)]*)\)/);
    assert.ok(wrapper, `${name} phai co bọc T() chuyển tiếp sang window.I18N.t`);
    const [, params, forwarded] = wrapper;
    const names = params.split(',').map((p) => p.trim()).filter(Boolean);
    const slots = forwarded.split(',').map((a) => a.trim());
    assert.equal(slots.length, 3, `${name}: phải chuyển đủ 3 đối số vào I18N.t`);
    const varsParam = names.find((p) => /vars$/i.test(p)) || names[1];
    assert.ok(varsParam, `${name}: phải có tham số chứa vars`);
    assert.equal(slots[2], varsParam,
      `${name}: "${varsParam}" phải vào ô thứ ba của I18N.t — ô thứ hai là fallback, và đặt vars vào đó là lỗi đã xảy ra`);
    assert.notEqual(slots[1], varsParam,
      `${name}: không được truyền vars vào ô fallback`);
    if (names.length === 2) {
      assert.equal(slots[1], 'undefined',
        `${name}: bọc 2 tham số phải điền undefined vào ô fallback`);
    }
  }
});

// The stylesheet itself has to parse, and until this existed nothing checked it.
//
// A comment above a rule lost its opening line to an edit that split it in half,
// which left English prose sitting in the stylesheet. CSS does not nest comments:
// the first stray */ closed it, and the sentences after it were read as one
// enormous selector that swallowed the .site-header rule whole. Every other test
// here still passed, because they all read the file as text and the rule was
// still right there in it — it was the browser that could not see it. The header
// collapsed into the corner of the page: no width, no flex, links stacked.
//
// Balanced braces alone would not have caught it — the prose swallowed exactly
// one rule, so the counts still matched. What does catch it is reading the
// document the way a CSS parser does and looking at what sits in front of each
// rule: prose, which in a stylesheet means an English sentence where a selector
// belongs.
test('styles.css parse được: comment cân, ngoặc cân, và không có văn xuất trước rule', () => {
  const css = read('styles.css');

  // Walk the file once the way a stylesheet parser does: comments skipped, string
  // literals skipped, and everything else tracked. Braces inside either of those
  // are data, not structure.
  let depth = 0;
  let inComment = false;
  let inString = null;
  const problems = [];
  const preludes = [];
  let prelude = '';
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];
    const next = css[i + 1];
    if (inComment) {
      if (char === '*' && next === '/') { inComment = false; i += 1; }
      continue;
    }
    if (inString) {
      if (char === '\\') { i += 1; continue; }
      if (char === inString) inString = null;
      continue;
    }
    if (char === '/' && next === '*') { inComment = true; i += 1; continue; }
    if (char === '"' || char === "'") { inString = char; continue; }
    if (char === '{') {
      depth += 1;
      preludes.push(prelude);
      prelude = '';
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth < 0) { problems.push(`ngoặc đóng thừa tại offset ${i}`); depth = 0; }
      prelude = '';
      continue;
    }
    if (depth === 0) prelude += char;
  }
  if (inComment) problems.push('có comment /* không được đóng — phần còn lại của file sẽ bị coi là comment');
  if (depth !== 0) problems.push(`${depth} ngoặc mở không được đóng`);
  const openComments = (css.match(/\/\*/g) || []).length;
  const closeComments = (css.match(/\*\//g) || []).length;
  if (openComments !== closeComments) problems.push(`số comment mở (${openComments}) khác số comment đóng (${closeComments})`);

  // A selector never contains an apostrophe: this stylesheet quotes attribute
  // values with double quotes, and prose always has one ("page's", "doesn't").
  // One character, and it cannot be fooled by a selector that happens to read
  // like a sentence.
  for (const prelude of preludes) {
    if (prelude.includes("'")) {
      problems.push(`có dấu nháy đơn ngay trước một rule — văn xuất nằm chỗ selector phải ở: ${prelude.trim().slice(0, 60)}`);
    }
  }
  assert.deepEqual(problems, [], `styles.css không parse được:\n  ${problems.join('\n  ')}`);

  // And the rule that broke is still a rule: an English word where a selector
  // belongs is the same failure one edit earlier.
  const badPrelude = preludes.map((p) => p.trim()).find((p) => p && /^(a|an|the|so|and|which|that|it|for|to)\s/i.test(p));
  assert.equal(badPrelude, undefined, `có văn xuất tiếng Anh trước một rule: ${badPrelude}`);
});

// Every band on the homepage shares one horizontal frame, and this is the gate
// that keeps them sharing it.
//
// The why-section was the one that spanned the full bleed with a .wrap inside
// it, so its edges floated past the header and the footer on both sides while
// its content sat on the shared frame — the green band's left edge was not the
// logo's left edge. The legal pages had the same problem from the other side:
// a 760px island in the middle of a 1160px frame, lining up with nothing.
//
// What is checked is the shared class rather than any one width, because the
// point is that a band joins the page's grid or declares itself an exception.
test('mọi section của trang chủ nằm trên cùng một khung ngang', () => {
  const html = read('index.html');
  const sections = [...html.matchAll(/<section class="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(sections.length >= 4, `chỉ thấy ${sections.length} section trên trang chủ`);
  const offFrame = sections.filter((classes) => !classes.split(/\s+/).includes('wrap'));
  assert.deepEqual(offFrame, [],
    `section không nằm trên khung .wrap: ${offFrame.join(', ')} — cạnh của nó sẽ trôi qua header và footer`);

  // And the reading column on the legal pages uses the same frame as the header
  // and footer it sits above. Compared against .wrap rather than a number, so a
  // change to the page's grid moves both instead of leaving them disagreeing.
  const css = read('styles.css');
  const frame = /\.wrap\{[^}]*\}/.exec(css);
  const legal = /\.legal\{([^}]*)\}/.exec(css);
  assert.ok(frame, 'cần có rule .wrap');
  assert.ok(legal, 'cần có rule .legal');
  const frameWidth = /width:min\(([^)]*)\)/.exec(frame[0])[1];
  assert.match(legal[1], new RegExp(`width:min\\(${frameWidth.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`),
    '.legal phải dùng cùng khung ngang với .wrap, không phải một cột hẹp lặng lẽ giữa trang');
  assert.match(legal[1], /margin:0 auto/, '.legal phải căn giữa theo khung đó');
  // The lines take the whole frame and are justified, so the right edge is a
  // straight line beside the full-width rule under the title block. A ragged
  // edge next to that rule is what makes a typeset page look unfinished, and a
  // narrow measure inside a wide frame wraps the same text early for the same
  // reason.
  assert.match(css, /\.legal p,\.legal li\{[^}]*text-align:justify/,
    'đoạn văn và danh sách pháp lý phải căn đều hai bên (justify)');
  assert.match(css, /\.legal p,\.legal li\{[^}]*hyphens:auto/,
    'căn đều cần hyphens:auto để vỡ từ, nếu không dòng dài sẽ hở ra thành lỗ trống');
  const capped = /\.legal[^{}]*\{[^}]*max-width:\d+px/.exec(css);
  assert.equal(capped, null,
    'đoạn văn pháp lý không được giới hạn chiều rộng hẹp hơn khung trang — dòng chữ sẽ bị cắt sớm');
});

// A document has to show what introduces what, and these pages showed nothing.
//
// The eyebrow, the h1, the bylines, the section headings, the paragraphs and the
// bullets all started on the same vertical line, so the page read as one flat
// list of equally important blocks — which is what a wall of legal text looks
// like before it is laid out. The ladder is three steps now: the title block
// introduces a numbered section, the section introduces its clause, and the
// clause introduces its cases.
//
// What is checked here is the resolved indent of the real markup, not the
// numbers written in the rules. The previous version of this gate did the
// opposite and stayed green while all three legal pages were visibly broken: the
// numbers were in the file and in the right order, but `~` means "any following
// sibling", so `.legal h2 ~ *` reached the section headings themselves. The
// second heading on a page is a following sibling of the first, so 10 of the 11
// numbered sections matched the deeper step and sat one step below section 1.
//
// Checking that a rule holds a number is not checking that the page is right.

const VOID_TAGS = new Set(['br', 'img', 'meta', 'link', 'input', 'hr', 'source', 'area', 'col']);

// The two bylines that close the title block. They are the only blocks on the
// page that sit back on the h1's line, and they are checked apart from the rest
// because a page without them would otherwise pass for an indented one.
const BYLINES = ['legal-updated', 'legal-entity'];

// The terms page carries a prose comment and a `{{legalEntityLine}}` token
// between its bylines; neither is markup, and the token is the only way the
// entity byline ever reaches the page, so it is stood in for here the way
// src/pages.js stands in for it at render time.
const withoutComments = (source) => source.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

const classesOf = (attrs) => (/class="([^"]*)"/.exec(attrs) || [, ''])[1].trim().split(/\s+/).filter(Boolean);

// The direct children of <article class="legal">, in document order. The ladder
// addresses siblings, so a <span> inside a clause is not on it and must not be
// counted as a block of its own.
function legalBlocks(html) {
  const article = /<article class="legal">([\s\S]*?)<\/article>/.exec(withoutComments(html));
  assert.ok(article, 'trang pháp lý phải có <article class="legal">');
  const blocks = [];
  const open = ['article'];
  const tags = /<(\/?)([a-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = tags.exec(article[1]))) {
    const [, close, tag, , selfClose, text] = m;
    if (text !== undefined) continue;
    if (close) { open.pop(); continue; }
    if (open.length === 1) blocks.push({ tag, classes: classesOf(m[0]) });
    if (!selfClose && !VOID_TAGS.has(tag)) open.push(tag);
  }
  return blocks;
}

// Every leaf rule under `.legal` that sets a padding-left, in source order. The
// cascade breaks a specificity tie on order, so the order is part of the rule
// and cannot be reconstructed afterwards. `padding-left:0` carries no unit —
// the byline rules are written that way, and an extractor that insists on `px`
// silently drops the two rules that put them back on the h1's line.
function legalIndentRules(css) {
  const rules = [];
  for (const m of withoutComments(css).matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const px = /(?:^|;)\s*padding-left:(\d+)(?:px)?\s*(?:;|$)/.exec(m[2]);
    if (!px) continue;
    const selectors = m[1].trim().split(',').map((s) => s.trim())
      .filter((s) => /(?:^|[\s,>+~])\.legal(?![\w-])/.test(s));
    if (selectors.length) rules.push({ selectors, px: Number(px[1]), order: rules.length });
  }
  return rules;
}

// Models the selector shapes the ladder is allowed to use. A shape it does not
// recognise is a thrown error, never a silent skip: an unmeasured rule would read
// as "this block is not indented" and the gate would go green again, which is the
// failure this whole rewrite exists to prevent.
function compileSelector(selector) {
  const unsupported = () => {
    throw new Error(
      `selector "${selector}" đặt padding-left dưới .legal nhưng gate này chưa mô phỏng — `
      + 'phải mô phỏng nó, không được bỏ qua: bỏ qua thì nó đọc như "không thụt" và gate lại xanh');
  };
  const rest = selector.startsWith('.legal') ? selector.slice(6).trim() : unsupported();

  if (rest.startsWith('.')) {
    const only = /^\.([\w-]+)$/.exec(rest);
    if (!only) unsupported();
    return { cls: only[1], tag: null, not: null, head: null };
  }

  const tilde = /^([a-z][\w-]*)\s*~\s*(.+)$/.exec(rest);
  if (!tilde) {
    if (rest && !/^[a-z][\w-]*$/.test(rest)) unsupported();
    return { cls: null, tag: rest || null, not: null, head: null };
  }

  const negated = /^(\*|[a-z][\w-]*):not\(([a-z][\w-]*)\)$/.exec(tilde[2]);
  const tag = negated ? negated[1] : tilde[2];
  if (tag !== '*' && !/^[a-z][\w-]*$/.test(tag)) unsupported();
  return { cls: null, tag, not: negated ? negated[2] : null, head: tilde[1] };
}

// [ids, classes+attributes+pseudo-classes, types]. `:not()` contributes the
// specificity of its argument, which is what makes `.legal h2 ~ *:not(h2)` tie
// with `.legal h2 ~ ul` and hand the decision to source order.
const specificityOf = (selector) => {
  const expanded = selector.replace(/:not\(([^)]*)\)/g, ' $1 ');
  const withoutNames = expanded
    .replace(/\.[\w-]+/g, ' ').replace(/#[^\s]+/g, ' ').replace(/\[[^\]]+\]/g, ' ').replace(/:[\w-]+/g, ' ');
  return [
    (expanded.match(/#[\w-]+/g) || []).length,
    (expanded.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length,
    (withoutNames.match(/\b[a-zA-Z][\w-]*/g) || []).length,
  ];
};
const compareSpecificity = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// The padding-left each block of a legal article actually ends up with. A
// selector list applies when any of its selectors matches, and the cascade ranks
// the one that matched — so the list is expanded into one entry per selector
// before anything is compared.
function resolveLegalIndents(css, blocks) {
  const rules = legalIndentRules(css).flatMap((rule) => rule.selectors.map((selector) => ({
    ...compileSelector(selector), px: rule.px, order: rule.order, specificity: specificityOf(selector),
  })));
  return blocks.map((block, index) => {
    let winner = null;
    for (const rule of rules) {
      if (rule.cls ? !block.classes.includes(rule.cls)
        : rule.tag && rule.tag !== '*' && block.tag !== rule.tag) continue;
      if (rule.not && block.tag === rule.not) continue;
      if (rule.head && !blocks.slice(0, index).some((before) => before.tag === rule.head)) continue;
      if (!winner) { winner = rule; continue; }
      const gap = compareSpecificity(rule.specificity, winner.specificity);
      if (gap > 0 || (gap === 0 && rule.order > winner.order)) winner = rule;
    }
    return winner ? winner.px : 0;
  });
}

test('nội dung trang pháp lý thụt vào theo từng cấp', () => {
  const css = read('styles.css');
  for (const file of ['terms.html', 'privacy.html', 'refund.html']) {
    const html = read(file).replace('{{legalEntityLine}}', '<p class="legal-entity">Công ty</p>');
    const blocks = legalBlocks(html);
    const indent = resolveLegalIndents(css, blocks);
    const levelsOf = (tag, from = 0) => [...new Set(
      blocks.map((b, i) => (b.tag === tag && i >= from ? indent[i] : null)).filter((v) => v !== null))];
    const spelled = (list) => [...list].sort((a, b) => a - b).join('px và ');

    const headings = levelsOf('h2');
    assert.ok(headings.length === 1, `${file}: các mục 1., 2., 3. phải nằm cùng một bậc thụt lề, đang là ${spelled(headings)}`);
    assert.ok(headings[0] >= 16 && headings[0] <= 48, `bậc đầu phải vừa đủ thấy (16–48px), đang là ${headings[0]}px`);
    assert.ok(blocks.filter((b) => b.tag === 'h2').length >= 5,
      `${file}: phải có ít nhất 5 mục thì mới thấy được các mục có cùng bậc hay không`);

    // What the h1 introduces directly — the intro paragraph — belongs to the
    // first step, beside the section headings. Only what a numbered section
    // introduces is a clause, so the two are counted apart rather than assumed
    // to share a level. The bylines and the eyebrow close the title block and
    // are checked elsewhere; they sit on the h1's own line by design.
    const firstHeading = blocks.findIndex((b) => b.tag === 'h2');
    const title = blocks.findIndex((b) => b.tag === 'h1');
    assert.ok(title >= 0 && firstHeading > title, `${file}: phải có phần mở đầu giữa tiêu đề và mục đầu tiên`);
    const intro = blocks.slice(title + 1, firstHeading)
      .filter((b) => b.tag === 'p' && !b.classes.some((c) => BYLINES.includes(c)))
      .map((b) => indent[blocks.indexOf(b)]);
    assert.ok(intro.length >= 1, `${file}: phải có đoạn dẫn nhập trước mục đầu tiên`);
    assert.ok(new Set(intro).size === 1 && intro[0] === headings[0],
      `${file}: phần mở đầu phải cùng bậc với tiêu đề mục, đang là ${[...new Set(intro)].join(' và ')}px so với ${headings[0]}px`);

    const clauses = levelsOf('p', firstHeading);
    assert.ok(clauses.length === 1, `${file}: các đoạn thân mục phải cùng một bậc, đang là ${spelled(clauses)}`);
    assert.ok(clauses[0] > headings[0], `${file}: đoạn thân mục (${clauses[0]}px) phải sâu hơn tiêu đề mục (${headings[0]}px)`);
    assert.ok(clauses[0] - headings[0] <= 48, `${file}: bậc hai cách bậc một ${clauses[0] - headings[0]}px — quá rộng so với một bậc thụt lề`);

    const lists = levelsOf('ul', firstHeading);
    if (lists.length) {
      assert.ok(lists.length === 1, `${file}: các danh sách phải cùng một bậc, đang là ${spelled(lists)}`);
      assert.ok(lists[0] > clauses[0], `${file}: các ca trong mục (${lists[0]}px) phải sâu hơn đoạn của mục đó (${clauses[0]}px)`);
      assert.ok(lists[0] - clauses[0] <= 48, `${file}: bậc ba cách bậc hai ${lists[0] - clauses[0]}px — quá rộng so với một bậc thụt lề`);
    }

    // The bylines under the h1 stay on the parent line: they close the title
    // block, and the hairline under them is the boundary a reader sees.
    for (const byline of BYLINES) {
      const at = blocks.findIndex((b) => b.classes.includes(byline));
      assert.ok(at >= 0, `${file}: phải có dòng phụ đề .${byline}`);
      assert.equal(indent[at], 0, `${file}: dòng .${byline} phải nằm cùng hàng với tiêu đề, đang thụt ${indent[at]}px`);
    }
    assert.ok(Math.max(...indent) <= 96,
      `${file}: bậc sâu nhất là ${Math.max(...indent)}px — quá sâu, chữ bị đẩy khỏi khung ngang của header và footer`);
  }
  assert.match(css, /\.legal \.legal-updated,\.legal \.legal-entity\{[^}]*padding-left:0/,
    'dòng "Cập nhật" và dòng pháp nhân phải nằm cùng hàng với tiêu đề, không thụt theo phần thân');
});

// A gate that cannot go red is not a gate. These two mutations are the failures
// this page has actually shipped: the second step swallowing the headings, and
// the ladder being flattened back to one line. If either stops being detected
// here, the resolver above has stopped seeing the thing it was written to see.
test('gate thụt lề pháp lý phải bắt được hai lỗi nó sinh ra', () => {
  const css = read('styles.css');
  const blocks = legalBlocks(read('terms.html'));
  const headingLevels = (sheet) => [...new Set(
    resolveLegalIndents(sheet, blocks).filter((_, i) => blocks[i].tag === 'h2'))].sort((a, b) => a - b);

  const swallowed = css.replace('.legal h2 ~ *:not(h2)', '.legal h2 ~ *');
  assert.notEqual(swallowed, css, 'phải còn rule .legal h2 ~ *:not(h2) để mutation này có ý nghĩa');
  assert.equal(headingLevels(swallowed).length, 2,
    'bỏ :not(h2) phải làm các mục lệch bậc — nếu không, gate này không bắt được đúng lỗi đó');

  const flattened = css.replace('.legal h2 ~ *:not(h2)', '.legal h2 ~ *:not(h2){padding-left:24px}');
  assert.notEqual(flattened, css, 'phải còn bậc hai riêng để mutation này có ý nghĩa');
  assert.equal(headingLevels(flattened).length, 1,
    'làm bậc hai bằng bậc một phải làm tiêu đề mục trùng với đoạn thân mục');
});

test('vùng cuộn phải có overflow và min-height:0 ngay ở rule cơ bản', () => {
  const css = read('styles.css');
  // These have to hold on a desktop too, where the 700px query never applies.
  // A scroll region that is not allowed to shrink below its content is just a
  // tall block, and the sheet clips it instead of scrolling.
  for (const cls of ['.detail-body', '.checkout-form', '.success-state']) {
    const rule = baseRule(css, cls);
    assert.ok(rule, `can co rule co ban cho ${cls}`);
    assert.match(rule, /overflow-y:auto/, `${cls} phai cuon duoc o rule co ban`);
    assert.match(rule, /min-height:0/, `${cls} can min-height:0 o rule co ban`);
    assert.match(rule, /flex:1 1/, `${cls} phải là flex item để nhận phần còn lại của wrapper`);
  }
  const footer = baseRule(css, '.detail-footer');
  assert.match(footer, /flex:0 0 auto/, 'thanh nút mua phải ghim không có');
  assert.match(footer, /margin-top:0/, 'thanh nút mua phải sát vùng cuộn, không để khe 27px');
});

test('flex-basis của vùng cuộn đúng theo cách tính chiều cao của từng màn hình', () => {
  const css = read('styles.css');
  // On a desktop .modal is height:auto with only a max-height, so it sizes to
  // its content and a 0-basis child has no free space to grow into: the scroll
  // region collapsed to 0px tall. `auto` lets a short sheet shrink to fit and a
  // long one push the overflow into the region that is allowed to shrink.
  assert.match(baseRule(css, '.detail-body'), /flex:1 1 auto/, 'vùng cuộn trên máy tính phải flex-basis auto');
  // On a phone the backdrop pins a real height, so basis 0 is correct there and
  // is what lets the middle take exactly the leftover space.
  const block = css.match(/@media\(max-width:700px\)\{([\s\S]*?)\n\}/);
  assert.ok(block, 'cần có media query 700px');
  assert.match(block[1], /\.detail-body\{[^}]*flex:1 1 0/, 'vùng cuộn trên điện thoại phải flex-basis 0');
  assert.match(block[1], /\.checkout-form\{[^}]*flex:1 1 0/, 'form thanh toán trên điện thoại phải flex-basis 0');
});

