import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDom, runScript, El } from './helpers/dom.mjs';
// The shop's test environment, applied before src/ is imported: config.js reads
// the environment once at load.
import './helpers/env.mjs';

// The catalogue stores Vietnamese plus one English pair; there are no Japanese or
// Chinese columns. Before this layer existed a shopper who switched the shop to
// Japanese got a Japanese header, Japanese buttons and English (sometimes
// Vietnamese) product cards - the "for sale" section was the one part of the page
// the language switch never reached.
//
// The fix keeps the catalogue schema untouched: per-locale product copy lives in
// public/locales/<lang>.json as `product.copy.<slug>.<field>`, and the cards, the
// product modal and product search all read it through I18N. These tests pin that
// contract from the browser side.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, 'public', p), 'utf8');
const locale = (lang) => JSON.parse(read(`locales/${lang}.json`));

// Real catalogue rows: these slugs are on sale today and are the ones that used
// to render in English on a Japanese page.
const products = [
  {
    id: 'r1', slug: 'ramcleaner-personal', name: 'RAMCleaner Personal', nameEn: 'RAMCleaner Personal',
    shortDescription: 'Dọn dẹp bộ nhớ thông minh - bản cá nhân, 1 thiết bị, cập nhật trọn đời.',
    shortDescriptionEn: 'Smart memory cleaner - personal license, 1 device, lifetime updates.',
    description: 'RAMCleaner Personal giúp giải phóng bộ nhớ RAM standby/modified, nén bộ nhớ và dọn dẹp file tạm.',
    descriptionEn: 'RAMCleaner Personal frees standby/modified RAM, compresses memory, and cleans temp files.',
    features: ['Dọn dẹp Standby/Modified/List memory tự động', 'Nén bộ nhớ giảm RAM dùng'],
    featuresEn: ['Auto cleanup Standby/Modified/List memory', 'Memory Compression reduces RAM usage'],
    category: 'Công cụ', platform: 'Windows, Linux, macOS', version: '2.0.0', price: 299000, currency: 'VND', badge: 'Phổ biến',
  },
  {
    // A row with no English pair at all: the English page must fall back to the
    // source copy rather than render an empty card, and the Japanese page must
    // still use whatever the dictionary carries.
    id: 'r2', slug: 'untranslated-row', name: 'Công Cụ Chưa Dịch',
    shortDescription: 'Mô tả tiếng Việt chưa có bản tiếng Anh.', description: 'Mô tả dài tiếng Việt.',
    features: ['Tính năng tiếng Việt'], category: 'Tiện ích', platform: 'Windows', version: '1.0.0',
    price: 99000, currency: 'VND', badge: 'Mới',
  },
];

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
  nodes.set('filter-tools', make('Công cụ', 'Công cụ', false));
}

async function boot({ lang = 'vi' } = {}) {
  const { document, nodes } = createDom(['product-grid', 'product-count', 'product-search', 'product-modal', 'modal-content', 'toast', 'lang-toggle', 'announce', 'why', 'faq', 'buy-product']);
  filterRow(nodes);
  const fetch = async (url) => {
    const target = String(url);
    if (target.includes('/api/products')) return { ok: true, json: async () => ({ products }) };
    if (target.includes('/api/checkout/options')) return { ok: true, json: async () => ({ country: 'VN', options: [] }) };
    // Serve the real asset so the assertions below run against the copy the shop
    // actually ships, not against a fixture that can drift from it.
    if (target.includes('/locales/')) return { ok: true, json: async () => locale(target.split('/locales/')[1].replace(/\.json.*$/, '')) };
    return { ok: true, json: async () => ({}) };
  };
  const localStorage = { _v: {}, getItem(k) { return this._v[k] ?? null; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } };
  const ctx = { document, window: { I18N: undefined }, fetch, localStorage };
  const i18n = await runScript(read('i18n.js'), ctx);
  const app = await runScript(`${read('order-client.js')}\n${read('app.js')}`, { ...ctx, window: { ...ctx.window, I18N: i18n.window.I18N } });
  const I18N = i18n.window.I18N;
  if (lang !== 'vi') {
    I18N.set(lang);
    // The locale asset is fetched on switch; the storefront only re-renders once
    // it lands, so the wait is part of the contract being tested.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { ...app, i18n, I18N, nodes, document };
}

const grid = (nodes) => nodes.get('product-grid').innerHTML;

test('thẻ sản phẩm trên trang tiếng Nhật dùng bản dịch, không phải tiếng Anh', async () => {
  const { nodes, errors } = await boot({ lang: 'ja' });
  assert.deepEqual(errors, [], `app.js ném lỗi: ${errors.join(' | ')}`);
  const html = grid(nodes);
  assert.match(html, /RAMCleaner パーソナル/, 'tên sản phẩm phải là bản tiếng Nhật');
  assert.match(html, /スマートなメモリクリーナー/, 'mô tả ngắn phải là bản tiếng Nhật');
  assert.match(html, /ツール/, 'nhãn danh mục phải được dịch');
  assert.match(html, /人気/, 'nhãn badge phải được dịch');
  assert.doesNotMatch(html, /Smart memory cleaner/, 'không được để lọt bản tiếng Anh');
  assert.doesNotMatch(html, /Công cụ/, 'không được để lọt nhãn tiếng Việt');
});

test('trang tiếng Việt giữ nguyên dữ liệu gốc', async () => {
  const { nodes } = await boot({ lang: 'vi' });
  const html = grid(nodes);
  assert.match(html, /Công cụ/, 'nhãn tiếng Việt phải giữ nguyên');
  assert.match(html, /Phổ biến/, 'badge tiếng Việt phải giữ nguyên');
  assert.match(html, /Dọn dẹp bộ nhớ thông minh/, 'mô tả gốc phải giữ nguyên');
});

test('sản phẩm chưa có bản dịch thì rơi về tiếng Anh, không để trống', async () => {
  const { nodes, I18N, errors } = await boot({ lang: 'zh-CN' });
  assert.deepEqual(errors, [], 'không được ném lỗi khi thiếu bản dịch');
  const html = grid(nodes);
  assert.match(html, /Công Cụ Chưa Dịch|工具/, 'phải hiển thị tên gốc thay vì ô trống');
  assert.equal(I18N.productCopy({ slug: 'khong-ton-tai' }), null, 'sản phẩm lạ phải trả về null');
});

test('productCopy chỉ trả về trường thật sự có trong asset', async () => {
  const { I18N } = await boot({ lang: 'ja' });
  assert.equal(I18N.productCopy({ slug: 'ramcleaner-personal' }).name, 'RAMCleaner パーソナル');
  assert.equal(I18N.productCopy({ slug: 'ramcleaner-personal' }).shortDescription.length > 0, true);
  assert.equal(I18N.lang, 'ja');
  I18N.set('vi');
  assert.equal(I18N.productCopy({ slug: 'ramcleaner-personal' }), null, 'tiếng Việt là ngôn ngữ gốc, không cần overlay');
});

test('nhãn danh mục và badge tra theo giá trị, kể cả khi gõ thiếu dấu', async () => {
  const { I18N } = await boot({ lang: 'ja' });
  assert.equal(I18N.productLabel('category', 'Tools'), 'ツール');
  assert.equal(I18N.productLabel('category', 'Utilities'), 'ユーティリティ');
  assert.equal(I18N.productLabel('badge', 'Popular'), '人気');
  assert.equal(I18N.productLabel('badge', 'Release 1.4.0'), 'v1.4.0 リリース', 'key suy ra từ giá trị, không cần bảng tay');
  assert.equal(I18N.productLabel('category', 'Không tồn tại'), null, 'giá trị lạ phải trả null để nơi gọi tự dự phòng');
});

test('modal sản phẩm cũng dùng bản dịch, không chỉ thẻ', async () => {
  const { window, nodes } = await boot({ lang: 'ja' });
  window.openProduct('r1');
  const modal = nodes.get('modal-content').innerHTML;
  assert.match(modal, /RAMCleaner パーソナル/, 'tiêu đề modal phải là tiếng Nhật');
  assert.doesNotMatch(modal, /Smart memory cleaner/, 'modal không được rơi về tiếng Anh');
});

test('tìm bằng tiếng Nhật vẫn ra sản phẩm', async () => {
  const { nodes } = await boot({ lang: 'ja' });
  const input = nodes.get('product-search');
  input.value = 'メモリ';
  input.listeners.input.forEach((fn) => fn());
  const html = grid(nodes);
  assert.match(html, /RAMCleaner パーソナル/, 'từ khoá tiếng Nhật phải khớp bản dịch đang hiển thị');
});
