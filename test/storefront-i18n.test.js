import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDom, runScript, El } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, 'public', p), 'utf8');

const IDS = [
  'product-grid', 'product-count', 'product-modal', 'modal-content', 'toast',
  'lang-toggle', 'announce', 'why', 'faq',
];

const products = [
  { id: 'p1', slug: 'p1', name: 'Sản phẩm A', shortDescription: 'Mô tả ngắn', description: 'Mô tả dài tiếng Việt', shortDescriptionEn: 'Short EN', descriptionEn: 'Long English description', features: ['Tính năng 1'], featuresEn: ['Feature 1 EN'], category: 'Công cụ', platform: 'Windows', version: '1.0.0', price: 99000, currency: 'VND', badge: 'Mới' },
  { id: 'p2', slug: 'p2', name: 'Product B', shortDescription: 'Mô tả ngắn', description: 'Mô tả dài', category: 'Bundle', platform: 'Windows', version: '2.0.0', price: 149000, currency: 'VND' },
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
  const app = await runScript(read('app.js'), { ...ctx, window: { ...ctx.window, I18N: i18n.window.I18N } });
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

test('showOrder viet tron mot khoi, khong bi cat lung giua duong', async () => {
  // Regression guard: the tail of showOrder (dl.hidden / dl.onclick / closing
  // brace) once ended up stranded after loadProducts(), which killed the whole
  // script and left the product grid stuck on the loading skeleton.
  const source = read('app.js');
  const start = source.indexOf('function showOrder(');
  assert.ok(start > 0, 'phai co ham showOrder');
  const end = source.indexOf('\nasync function checkOrder(', start);
  assert.ok(end > start, 'showOrder phai ket thuc truoc checkOrder');
  const body = source.slice(start, end);
  assert.ok(body.includes('dl.disabled'), 'showOrder phai khoa nut tai khi chua thanh toan');
  assert.ok(body.includes('dl.onclick'), 'showOrder phai gan su kien cho nut tai');
  assert.ok(body.includes('download-order'), 'showOrder phai lay nut download-order');
  assert.ok(!body.includes('dl.hidden'), 'nut tai phai luon hien, chi bi khoa chu khong bien mat');
  // The deadline the form promises and the countdown the buyer reads have to
  // come from the same place, or the form and the sweep disagree.
  assert.ok(source.includes('expiryNote'), 'form thanh toan phai bao het han');
  assert.ok(source.includes('paymentWindowHours'), 'so gio phai lay tu server');
});

test('showOrder chay duoc va day du thong tin don hang', async () => {
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
  const run = await runScript(`${read('app.js')}\nwindow.__showOrder = showOrder;`, {
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
  assert.ok(out.includes('123456'), 'modal phai hien so tai khoan');
  assert.ok(out.includes('SVD1'), 'modal phai hien noi dung chuyen khoan');
});

// p1 ships an English copy, p2 does not. Switching to English must show the
// English text for p1 while p2 keeps whatever copy it has, so no card is ever
// blank for a customer.
test('tieng Anh dung ban EN, thieu thi fallback ve tieng Viet', async () => {
  const run = await boot({ lang: 'en' });
  assert.deepEqual(run.errors, [], 'app.js khong duoc nem loi o tieng Anh');
  const grid = run.nodes.get('product-grid');
  assert.ok(grid.innerHTML.includes('Short EN'), 'san pham co ban EN phai dung ban EN');
  assert.ok(grid.innerHTML.includes('Feature 1 EN'), 'features phai doi sang tieng Anh');
  assert.ok(!grid.innerHTML.includes('Mô tả dài tiếng Việt'), 'san pham co ban EN khong duoc dung ban tieng Viet');
  // p2 has no English copy at all: its original Vietnamese short text must stay.
  assert.ok(grid.innerHTML.includes('Mô tả ngắn'), 'san pham chua co ban EN phai giu nguyen ban tieng Viet');
});

test('moi khoa i18n ton tai o ca hai ngon ngu', async () => {
  const { document } = createDom(IDS);
  const res = await runScript(read('i18n.js'), {
    document, window: {}, localStorage: { _v: {}, getItem: () => null, setItem() {}, removeItem() {} },
  });
  const I18N = res.window.I18N;
  assert.ok(I18N, 'phai export I18N');
  const keys = ['nav.products', 'hero.title1', 'faq.q1', 'products.count', 'cart.pay', 'order.download', 'pay.bank', 'geo.outside', 'lookup.title', 'legal.back'];
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

test('doi ngon ngu thi <html lang> va nut doi cung doi theo', async () => {
  const { document, nodes } = createDom(IDS);
  const res = await runScript(read('i18n.js'), {
    document, window: {}, localStorage: { _v: {}, getItem: () => null, setItem() {}, removeItem() {} },
  });
  const I18N = res.window.I18N;
  assert.equal(document.documentElement.lang, 'vi');
  I18N.set('en');
  assert.equal(document.documentElement.lang, 'en', 'lang tren <html> phai doi theo');
  assert.equal(nodes.get('lang-toggle').textContent, 'VI', 'nut phai hien chuoi doi sang VI');
  I18N.set('vi');
  assert.equal(document.documentElement.lang, 'vi');
});

test('nut chuyen ngon ngu khong lam vo layout tren man hinh nho', () => {
  const css = read('styles.css');
  // The switch is a 4th flex child of .site-header. Without flex:0 0 auto the
  // button stretches and pushes the row past the viewport, which is what broke
  // the header on phones when the language feature was added.
  const rule = css.match(/^\.lang-toggle\{[^}]*\}/m);
  assert.ok(rule, 'phai co rule .lang-toggle');
  assert.ok(rule[0].includes('flex:0 0 auto'), 'nut phai co flex:0 0 auto de khong bi keo gian');
  // Below 800px the nav is hidden and the CTA is pushed right, so the switch
  // needs its own margin and the CTA must stop using margin-left:auto.
  assert.ok(/@media\(max-width:800px\)\{[^}]*\.lang-toggle\{[^}]*margin-left:auto/.test(css), 'can margin-left:auto cho nut o man hinh nho');
  assert.ok(/\.site-header \.header-cta\{margin-left:0\}/.test(css), 'nut mua phai bo margin-left:auto o man hinh nho');
  assert.ok(/@media\(max-width:420px\)\{[^}]*\.lang-toggle\{/.test(css), 'can rule rieng cho man hinh 420px');
});

test('nut chuyen ngon ngu nam trong header cua index.html', () => {
  const html = read('index.html');
  assert.ok(/<button[^>]*data-lang-toggle/.test(html), 'phai co nut co thuoc tinh data-lang-toggle');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.ok(header.includes('data-lang-toggle'), 'nut phai nam trong header');
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
  const run = await runScript(read('app.js'), { document, window: { I18N: i18n.window.I18N }, fetch, localStorage: ls });
  return { run, document, get: (id) => cache.get(id) };
}

test('bam san pham -> mo duyet chi tiet -> bam mua -> den trang thanh toan', async () => {
  const { run, document, get } = await clickThroughCheckout();
  assert.deepEqual(run.errors, [], `app.js nem loi: ${run.errors.join(' | ')}`);
  assert.equal(typeof run.window.openProduct, 'function', 'openProduct phai la ham global');
  assert.equal(typeof run.window.openCheckout, 'function', 'openCheckout phai la ham global');

  run.window.openProduct('p1');
  const detail = document.getElementById('modal-content').innerHTML;
  assert.ok(detail.includes('Sản phẩm A'), 'modal chi tiet phai hien ten san pham');
  assert.ok(detail.includes('buy-product'), 'modal chi tiet phai co nut mua');

  const buy = get('buy-product');
  assert.equal(typeof buy.onclick, 'function', 'nut mua phai gan su kien onclick');
  buy.onclick();

  const checkout = document.getElementById('modal-content').innerHTML;
  assert.ok(checkout.includes('checkout-form'), 'buoc sau phai ra form thanh toan');
  assert.ok(checkout.includes('bank_transfer'), 'form thanh toan phai liet ke phuong thuc');
  assert.ok(checkout.includes('checkout-form'), 'phai co form');
  assert.deepEqual(run.errors, [], 'khong duoc nem loi sau khi bam');
});

test('openProduct va openCheckout phai nam o cap global', () => {
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

test('mo ta san pham tach thanh doan, khong bien mot khoi lien dong', async () => {
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
  const run = await runScript(read('app.js'), { document, window: { I18N: i18n.window.I18N }, fetch, localStorage: ls });
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

test('modal tren dien thoai cuon tung phan, khong phai ca trang', () => {
  const css = read('styles.css');
  // The whole modal used to scroll as one 90vh block, forcing a long page of
  // scrolling on a phone. The body must scroll on its own instead.
  const block = css.match(/@media\(max-width:700px\)\{([\s\S]*?)\n\}/);
  assert.ok(block, 'can co media query 700px cho modal dien thoai');
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
  assert.ok(/\.detail-copy\{[^}]*flex:0 0 auto/.test(rules), 'ten san pham phai ghim khong cuon');
  assert.ok(/\.detail-footer\{[^}]*flex:0 0 auto/.test(rules), 'nut mua phai ghim o day duoi');
  // The base .modal-backdrop is a centred grid (`place-items:center`), which
  // leaves the sheet with no height to divide among its rows, so the scroll area
  // froze and the buy bar vanished. The phone rule has to switch it to flex.
  assert.ok(/\.modal-backdrop\{[^}]*display:flex/.test(rules), 'backdrop phai doi tu grid sang flex tren dien thoai');
  assert.ok(/\.modal-backdrop\{[^}]*align-items:stretch/.test(rules), 'backdrop phai keo theo chieu cao');
  assert.ok(/\.modal\{[^}]*flex:1 1 auto/.test(rules), 'modal phai nhan phan con lai cua backdrop');
  assert.ok(/\.modal\{[^}]*min-width:0/.test(rules), 'can min-width:0 de modal co lai duoc');
  // Swiping inside the sheet must not drag the store page along.
  assert.ok(/overscroll-behavior:contain/.test(rules), 'can chan lan truyen cuon sang trang nen');
});

test('chieu cao modal phai xac dinh o ca may tinh va dien thoai', () => {
  const css = read('styles.css');
  // The sheet must have a definite height, not just a max-height: in a flex
  // column a max-height alone gives the children no height to shrink into, so
  // the scrolling area ended up pushed off screen and the buy bar vanished.
  const block = css.match(/@media\(max-width:700px\)\{([\s\S]*?)\n\}/);
  const rules = block[1];
  assert.ok(/\.modal-backdrop\{[^}]*position:fixed[^}]*inset:0/.test(rules), 'backdrop phai gan vao 4 canh man hinh');
  assert.ok(/\.modal\{[^}]*max-height:none/.test(rules), 'phai bo max-height tren dien thoai');
  assert.ok(/\.detail-body\{[^}]*flex:1 1 0/.test(rules), 'vung cuon phai flex-basis 0 de nhan phan con lai');
  assert.ok(/\.checkout-form\{[^}]*flex:1 1 0/.test(rules), 'form thanh toan cung phan nay');
  assert.ok(/\.success-state\{[^}]*flex:1 1 0/.test(rules), 'trang thanh cong cung phan nay');

  // Desktop .modal used max-height + overflow:auto, so the whole sheet scrolled
  // and the buy bar scrolled out of view. It has to be a flex column with an
  // inner scroll region on every screen size.
  const base = css.match(/\.modal\{position:relative;[^}]*\}/);
  assert.ok(base, 'can co rule .modal co ban');
  assert.ok(base[0].includes('display:flex'), 'modal phai la flex column');
  assert.ok(base[0].includes('flex-direction:column'), 'modal phai xep cot');
  assert.ok(!base[0].includes('overflow:auto'), 'modal khong duoc cuon toan bo');
  const body = css.match(/^\.detail-body\{[^}]*\}/m);
  assert.ok(body, 'can co rule .detail-body');
  assert.ok(body[0].includes('overflow-y:auto'), 'chi detail-body moi cuon');
  assert.ok(body[0].includes('min-height:0'), 'can min-height:0 de flex con co the co');
  const footer = css.match(/^\.detail-footer\{[^}]*\}/m);
  assert.ok(footer, 'can co rule .detail-footer');
  assert.ok(footer[0].includes('flex:0 0 auto'), 'thanh nut mua phai co dinh khong co');
});


test('mo mo phai khoa trang nen lai', () => {
  const css = read('styles.css');
  // Without a body lock the page behind keeps its own scroll offset, so a swipe
  // over the sheet moved the store instead of the modal.
  assert.ok(/body\.modal-open\{[^}]*overflow:hidden/.test(css), 'mo phai khoa cuon trang nen');
  assert.ok(/body\.modal-open\{[^}]*position:fixed/.test(css), 'tren dien thoai phai gan body de khong doi vi tri');
  const source = read('app.js');
  assert.ok(/document\.body\.classList\.add\('modal-open'\)/.test(source), 'mo modal phai them class modal-open');
  assert.ok(/document\.body\.classList\.remove\('modal-open'\)/.test(source), 'dong modal phai go class modal-open');
});

test('nut mua nam ngoai vung cuon, luon nhin thay', async () => {
  const { run, document, get } = await clickThroughCheckout();
  assert.deepEqual(run.errors, [], `app.js nem loi: ${run.errors.join(' | ')}`);
  run.window.openProduct('p3');
  const html = document.getElementById('modal-content').innerHTML;
  // Structure order matters: art, header, scrolling body, then the buy bar.
  const iBody = html.indexOf('detail-body');
  const iFooter = html.indexOf('detail-footer');
  const iTitle = html.indexOf('detail-copy');
  assert.ok(iTitle >= 0 && iBody > iTitle, 'ten san pham phai tren phan noi dung');
  assert.ok(iFooter > iBody, 'thanh nut mua phai duoi phan noi dung');
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
  assert.match(wrapper, /display:flex/, 'wrapper phai la flex container de cac phan ben trong chia duoc chieu cao');
  assert.match(wrapper, /flex-direction:column/, 'wrapper phai xep cot');
  assert.match(wrapper, /min-height:0/, 'can min-height:0 de wrapper co the bi ep xuong trong modal');
  assert.match(wrapper, /flex:1 1 auto/, 'wrapper phai nhan phan con lai cua .modal');

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

test('vung cuon phai co overflow va min-height:0 ngay o rule co ban', () => {
  const css = read('styles.css');
  // These have to hold on a desktop too, where the 700px query never applies.
  // A scroll region that is not allowed to shrink below its content is just a
  // tall block, and the sheet clips it instead of scrolling.
  for (const cls of ['.detail-body', '.checkout-form', '.success-state']) {
    const rule = baseRule(css, cls);
    assert.ok(rule, `can co rule co ban cho ${cls}`);
    assert.match(rule, /overflow-y:auto/, `${cls} phai cuon duoc o rule co ban`);
    assert.match(rule, /min-height:0/, `${cls} can min-height:0 o rule co ban`);
    assert.match(rule, /flex:1 1/, `${cls} phai la flex item de nhan phan con lai cua wrapper`);
  }
  const footer = baseRule(css, '.detail-footer');
  assert.match(footer, /flex:0 0 auto/, 'thanh nut mua phai ghim khong co');
  assert.match(footer, /margin-top:0/, 'thanh nut mua phai sat vung cuon, khong de khe 27px');
});

test('flex-basis cua vung cuon dung theo cach tinh chieu cao cua tung man hinh', () => {
  const css = read('styles.css');
  // On a desktop .modal is height:auto with only a max-height, so it sizes to
  // its content and a 0-basis child has no free space to grow into: the scroll
  // region collapsed to 0px tall. `auto` lets a short sheet shrink to fit and a
  // long one push the overflow into the region that is allowed to shrink.
  assert.match(baseRule(css, '.detail-body'), /flex:1 1 auto/, 'vung cuon tren may tinh phai flex-basis auto');
  // On a phone the backdrop pins a real height, so basis 0 is correct there and
  // is what lets the middle take exactly the leftover space.
  const block = css.match(/@media\(max-width:700px\)\{([\s\S]*?)\n\}/);
  assert.ok(block, 'can co media query 700px');
  assert.match(block[1], /\.detail-body\{[^}]*flex:1 1 0/, 'vung cuen tren dien thoai phai flex-basis 0');
  assert.match(block[1], /\.checkout-form\{[^}]*flex:1 1 0/, 'form thanh toan tren dien thoai phai flex-basis 0');
});

