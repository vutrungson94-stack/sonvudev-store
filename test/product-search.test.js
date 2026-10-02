import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDom, runScript, El } from './helpers/dom.mjs';

// The catalogue is going to grow — the stats strip counts it and the admin panel
// publishes into it — and a name like "Excel Trusted Locations Setup" does not
// announce itself from a grid of cards. So there is a search box.
//
// It filters in the browser, over the array that is already in memory. That is the
// whole design: no endpoint, no index, no request, and nothing new to keep in step
// with the catalogue. A search endpoint would be the wrong shape for a list that
// fits on one screen, and it would be a second place for a product to be visible in
// or not.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, 'public', p), 'utf8');

const products = [
  {
    id: 'p1', slug: 'spark', name: 'Spark Capacity Tester',
    shortDescription: 'Kiểm tra dung lượng thật của USB',
    description: 'Dung lượng thật trên ổ giả, báo PASS hoặc FAIL.',
    shortDescriptionEn: 'Check the real capacity of a drive',
    descriptionEn: 'Real capacity on a counterfeit drive, PASS or FAIL.',
    features: ['Tự đo dung lượng thật'], featuresEn: ['Measures real capacity'],
    category: 'Tiện ích', platform: 'Windows', version: '1.4.0', price: 99000, currency: 'VND', badge: 'Mới',
  },
  {
    id: 'p2', slug: 'excel', name: 'Excel Trusted Locations Setup',
    shortDescription: 'Bật macro cho file .xlsm',
    description: 'Thêm thư mục tin cậy vào Excel.',
    shortDescriptionEn: 'Enable macros for .xlsm files',
    descriptionEn: 'Adds a trusted folder to Excel.',
    features: ['Tự thêm thư mục tin cậy'], featuresEn: ['Adds the trusted folder'],
    category: 'Tiện ích', platform: 'Windows', version: '4.0', price: 149000, currency: 'VND',
  },
  {
    id: 'p3', slug: 'bundle', name: 'Combo Hai Công Cụ',
    shortDescription: 'Gộp cả hai',
    description: 'Một lần mua, có cả hai công cụ.',
    features: ['Gồm Spark và Excel'], featuresEn: ['Includes both'],
    category: 'Bundle', platform: 'Windows', version: '1.0.0', price: 199000, currency: 'VND',
  },
];

// The category row the server renders from the catalogue. Added before the script
// runs, because the storefront binds its handlers at load — which is exactly the
// wiring a stub that answered no class selector made invisible.
//
// dataset is set alongside attrs because that is what a real browser does with a
// data-* attribute, and the handler reads btn.dataset.filter. Setting only attrs
// made the click land on a button whose filter was undefined, which reads as a bug
// in the storefront and is really a gap in the harness.
function filterRow(nodes) {
  const make = (value, label, active) => {
    const el = new El('button');
    el.className = active ? 'filter active' : 'filter';
    el.attrs['data-filter'] = value;
    el.dataset.filter = value;
    el.textContent = label;
    return el;
  };
  nodes.set('filter-all', make('all', 'Tất cả', true));
  nodes.set('filter-util', make('Tiện ích', 'Tiện ích', false));
  nodes.set('filter-bundle', make('Bundle', 'Bundle', false));
}

async function boot({ lang = 'vi' } = {}) {
  const { document, nodes } = createDom(['product-grid', 'product-count', 'product-search', 'product-modal', 'modal-content', 'toast', 'lang-toggle', 'announce', 'why', 'faq']);
  filterRow(nodes);
  const fetchCalls = [];
  const fetch = async (url) => {
    fetchCalls.push(String(url));
    if (String(url).includes('/api/products')) return { ok: true, json: async () => ({ products }) };
    if (String(url).includes('/api/checkout/options')) return { ok: true, json: async () => ({ country: 'VN', options: [] }) };
    return { ok: true, json: async () => ({}) };
  };
  const localStorage = { _v: lang ? { sonvudev_lang: lang } : {}, getItem(k) { return this._v[k] ?? null; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } };
  const ctx = { document, window: { I18N: undefined }, fetch, localStorage };
  const i18n = await runScript(read('i18n.js'), ctx);
  const app = await runScript(`${read('order-client.js')}\n${read('app.js')}`, { ...ctx, window: { ...ctx.window, I18N: i18n.window.I18N } });
  return { ...app, i18n, nodes, fetchCalls, document };
}

const grid = (nodes) => nodes.get('product-grid').innerHTML;
const shown = (nodes) => (grid(nodes).match(/data-id="([^"]+)"/g) || []).map((m) => /data-id="([^"]+)"/.exec(m)[1]);
const type = (input, value) => { input.value = value; input.listeners.input.forEach((fn) => fn()); };

test('gõ vào là lọc danh sách, không cần bấm nút', async () => {
  const { nodes, errors } = await boot();
  assert.deepEqual(errors, [], `app.js nem loi: ${errors.join(' | ')}`);
  assert.equal(shown(nodes).length, 3, 'mặc định thấy tất cả');

  type(nodes.get('product-search'), 'capacity');
  assert.deepEqual(shown(nodes), ['p1'], 'tìm theo tên phải ra đúng một sản phẩm');
});

test('tìm một thứ cũng ra được gói chứa nó', async () => {
  // The bundle lists "Spark và Excel" in its features, so searching for either finds
  // it. That is the point of searching features as well as names: somebody who
  // wants the tool that fixes their Excel problem does not know whether they are
  // buying the single product or the bundle that carries it, and either is a
  // correct answer to what they typed.
  const { nodes } = await boot();
  type(nodes.get('product-search'), 'excel');
  assert.deepEqual(shown(nodes), ['p2', 'p3'], 'gói chứa Excel cũng phải ra');
});

test('lọc theo danh mục và tìm kiếm làm việc cùng nhau', async () => {
  // They answer different questions — "what kind of thing" against "which one" — and
  // a shopper who has already picked a category does not want to give it up to type
  // a word. Which is only true if the two compose rather than replace.
  const { nodes } = await boot();
  type(nodes.get('product-search'), 'excel');
  assert.equal(shown(nodes).length, 2, 'từ khoá "excel" ra cả hai');
  // Narrowing by category keeps the search on top of it.
  nodes.get('filter-bundle').onclick();
  assert.deepEqual(shown(nodes), ['p3'], 'từ khoá + danh mục phải lọc cùng lúc');
  // And releasing the category does not forget what was typed.
  nodes.get('filter-all').onclick();
  assert.equal(shown(nodes).length, 2, 'bỏ danh mục thì từ khoá vẫn còn');
  // Nor does picking a category clear the box.
  nodes.get('filter-util').onclick();
  assert.deepEqual(shown(nodes), ['p2'], 'đổi danh mục thì từ khoá vẫn còn');
});

test('tìm được cả trong tính năng, không chỉ tên sản phẩm', async () => {
  const { nodes } = await boot();
  type(nodes.get('product-search'), 'trusted folder');
  assert.deepEqual(shown(nodes), ['p2'], 'phải tìm được trong danh sách tính năng');
});

test('tìm không dấu vẫn ra kết quả có dấu', async () => {
  // A Vietnamese keyboard is easier with accents on and a Latin one is not. Someone
  // who cannot type the word they are looking after will not report that the box is
  // broken — they will just conclude the product is gone.
  const { nodes } = await boot();
  type(nodes.get('product-search'), 'dung luong');
  assert.deepEqual(shown(nodes), ['p1'], '"dung luong" phải ra "dung lượng"');
  type(nodes.get('product-search'), 'đung lượng');
  assert.deepEqual(shown(nodes), ['p1'], 'ngược lại cũng phải ra');
  type(nodes.get('product-search'), 'DUNG LUONG');
  assert.deepEqual(shown(nodes), ['p1'], 'không phân biệt hoa thường');
});

test('đang đọc tiếng Anh thì tìm trên bản tiếng Anh', async () => {
  // A reader who was handed the English name searches for the English name. Searching
  // only the Vietnamese copy finds nothing for exactly the visitor most likely to be
  // typing an English word.
  const { nodes } = await boot({ lang: 'en' });
  type(nodes.get('product-search'), 'capacity');
  assert.deepEqual(shown(nodes), ['p1'], 'từ khoá tiếng Anh phải ra sản phẩm');
  type(nodes.get('product-search'), 'macros');
  assert.deepEqual(shown(nodes), ['p2'], '"macros" phải ra sản phẩm Excel');
});

test('không có kết quả thì nói rõ, không để trống', async () => {
  const { nodes } = await boot();
  type(nodes.get('product-search'), 'zzz-khong-co');
  assert.deepEqual(shown(nodes), [], 'không được còn thẻ nào');
  const empty = grid(nodes);
  assert.match(empty, /empty-state/, 'phải có trạng thái rỗng');
  assert.ok(!/\{\{|\[object|undefined/.test(empty), 'trạng thái rỗng phải là văn bản');
});

test('xoá nội dung ô thì danh sách trở lại đầy đủ', async () => {
  const { nodes } = await boot();
  type(nodes.get('product-search'), 'capacity');
  assert.equal(shown(nodes).length, 1);
  type(nodes.get('product-search'), '');
  assert.equal(shown(nodes).length, 3, 'xoá ô là thấy lại tất cả');
});

test('Esc xoá ô tìm kiếm', async () => {
  const { nodes } = await boot();
  const input = nodes.get('product-search');
  type(input, 'capacity');
  assert.equal(shown(nodes).length, 1);
  // The shortcut people already expect from a search field. Without it the result
  // disappears under the cursor while the box still reads what was typed, which is
  // the confusing part.
  const event = { key: 'Escape', preventDefault() { this.defaultPrevented = true; } };
  input.listeners.keydown.forEach((fn) => fn(event));
  assert.equal(input.value, '', 'phải xoá ô');
  assert.equal(shown(nodes).length, 3, 'danh sách phải trở lại');
  assert.ok(event.defaultPrevented, 'phải chặn hành vi mặc định');
});

test('ô tìm kiếm có nhãn thật, không chỉ dựa vào placeholder', async () => {
  // A placeholder disappears the moment someone types, which leaves a screen reader
  // announcing an unnamed field — and it cannot be selected by anyone trying to copy
  // the label. The label is in the markup and only hidden visually.
  const html = read('index.html');
  assert.match(html, /id="product-search"/, 'trang chủ phải có ô tìm kiếm');
  assert.match(html, /<span class="sr-only"[^>]*data-i18n="products\.searchLabel"/, 'phải có nhãn cho trình đọc màn hình');
  assert.match(html, /aria-label:products\.searchLabel/, 'aria-label phải lấy từ từ điển');
  // And the visually-hidden class has to actually hide, not merely exist.
  const css = read('styles.css');
  assert.match(css, /\.sr-only\{[^}]*position:absolute/, 'sr-only phải ẩn khỏi bố cục');
  assert.match(css, /\.sr-only\{[^}]*clip:rect\(0 0 0 0\)/, 'sr-only phải cắt khỏi khung nhìn');
  // It is also a class the project did not have before, so its absence would have
  // left the label fully visible on screen and the page with two headings.
  assert.match(css, /\.product-search input:focus\{[^}]*outline/, 'vòng focus phải còn lại sau khi bỏ viền mặc định');
});

test('tìm kiếm không thêm request nào lên máy chủ', async () => {
  // The whole reason it filters in the browser. A request per keystroke would mean a
  // search endpoint to build, index and keep in step with the catalogue, for a list
  // that is already in memory — and its results could arrive out of order with the
  // letters being typed.
  const { nodes, fetchCalls } = await boot();
  const before = fetchCalls.filter((u) => u.includes('/api/products')).length;
  for (const term of ['e', 'ex', 'exc', 'exce', 'excel']) type(nodes.get('product-search'), term);
  const after = fetchCalls.filter((u) => u.includes('/api/products')).length;
  assert.equal(after, before, 'gõ năm chữ không được sinh thêm một request nào');
});

test('đổi ngôn ngữ thì từ khoá đang gõ vẫn dùng được', async () => {
  // Otherwise switching to English silently empties the grid: the word is Vietnamese
  // and no longer matches anything, with nothing to say why the list went away.
  const { nodes, i18n } = await boot();
  type(nodes.get('product-search'), 'capacity');
  assert.equal(shown(nodes).length, 1);
  i18n.window.I18N.set('en');
  assert.equal(nodes.get('product-search').value, 'capacity', 'ô tìm kiếm phải giữ nguyên nội dung');
  assert.equal(shown(nodes).length, 1, 'từ khoá đang gõ phải vẫn lọc được sau khi đổi ngôn ngữ');
});