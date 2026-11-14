// Merchant Center "Misrepresentation" policy regression guard.
//
// Every check here corresponds to a real violation found in the 2026-11-12
// audit (support.google.com/merchants/answer/6150127). Each one is a thing a
// future edit could silently reintroduce, and each one is cheap to assert:
//
//   1. Feed price must be the product's own shelf price in its own currency.
//      A hard-coded USD conversion is a second price for the same product,
//      which is exactly the "price mismatch" GMC flags.
//   2. contact.html must render identity from config, not hard-code a phone
//      number or street address that can drift from BRAND_PHONE/BRAND_ADDRESS.
//   3. Product copy in the locale files must not carry scarcity/discount
//      claims ("first 100", "33% off", "only N left") that the store cannot
//      actually enforce.
//   4. The refund story must be one story: the contact page and FAQ must not
//      promise refunds for "wrong purchase" while the refund policy excludes
//      them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/env.mjs';
import { renderMerchantFeed } from '../src/pages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

// ---------------------------------------------------------------------------
// 1. Feed price is the product's own currency, never a hard-coded conversion.
// ---------------------------------------------------------------------------
test('merchant feed price uses the product own currency, not a hard-coded USD conversion', () => {
  const products = [
    { id: 'p1', slug: 'p1', name: 'P1', price: 99000, currency: 'VND', status: 'active', fileKey: 'x', category: 'Utilities' },
  ];
  const feed = renderMerchantFeed(products);
  const row = feed.split('\n')[1];
  const price = row.split('\t')[5];
  assert.match(price, /\d+\.\d+\s+VND/, `feed price must be VND, got "${price}"`);
  assert.doesNotMatch(price, /USD/, 'feed price must not be a converted USD figure');
});

test('merchant feed has no hard-coded exchange-rate constant', () => {
  const source = read('src/pages.js');
  // The old bug was `const vndToUsd = 26000;` in renderMerchantFeed.
  assert.doesNotMatch(source, /const\s+vndToUsd\s*=\s*\d+/, 'renderMerchantFeed must not hard-code a VND/USD rate');
});

// ---------------------------------------------------------------------------
// 2. contact.html renders identity from config, not hard-coded values.
// ---------------------------------------------------------------------------
test('contact.html uses config tokens for phone and address', () => {
  const html = read('public/contact.html');
  assert.ok(html.includes('{{brandPhone}}'), 'contact.html must use {{brandPhone}}');
  assert.ok(html.includes('{{brandAddress}}'), 'contact.html must use {{brandAddress}}');
  // A hard-coded phone number or street address is what this catches.
  assert.doesNotMatch(html, /tel:\+84/, 'contact.html must not hard-code a phone number');
  assert.doesNotMatch(html, /Đường XH3|Phú Điền|Chánh Phú Hòa/, 'contact.html must not hard-code a street address');
});

test('brandPhone and brandAddress are page tokens the renderer fills', () => {
  const source = read('src/pages.js');
  const tokens = source.match(/export const PAGE_TOKENS = \[([\s\S]*?)\];/);
  assert.ok(tokens, 'PAGE_TOKENS not found');
  assert.ok(tokens[1].includes('"brandPhone"'), 'brandPhone must be in PAGE_TOKENS');
  assert.ok(tokens[1].includes('"brandAddress"'), 'brandAddress must be in PAGE_TOKENS');
});

// The test environment configures neither BRAND_PHONE nor BRAND_ADDRESS, which is
// also what a fresh deploy looks like before the owner sets them. An empty card
// (a <p></p> under "Địa chỉ", a tel: link with no number) reads as a broken page
// and as a seller nobody can locate — the misrepresentation review cares about
// both. The card has to disappear, not render empty.
test('thẻ điện thoại/địa chỉ trống được ẩn, không render ô rỗng', async () => {
  const { createApp } = await import('../src/app.js');
  const app = await createApp();
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const html = await (await fetch(`http://127.0.0.1:${port}/contact`)).text();
    assert.match(html, /class="contact-card" hidden/,
      'thẻ phải mang hidden khi chưa cấu hình BRAND_PHONE/BRAND_ADDRESS');
    assert.equal((html.match(/class="contact-card" hidden/g) || []).length, 2,
      'cả thẻ điện thoại và thẻ địa chỉ phải bị ẩn khi chưa cấu hình');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// 3. No unenforceable scarcity/discount claims in product copy.
// ---------------------------------------------------------------------------
const SCARCITY_PATTERNS = [
  /100\s*(khách|customers?|clients?|premiers|ersten|名|客户|份)/i,
  /first\s+100/i,
  /first\s+100\s+customers?/i,
  /33\s*%/,
  /hết\s+là\s+hết/i,
  /only\s+\d+\s+copies?/i,
  /limited\s+to\s+\d+/i,
  /先着\s*\d+/,
  /前\s*\d+\s*名/,
  /ưu đãi/i,
  /giảm giá/i,
  /khuyến mãi/i,
  /early bird deal/i,
  /introductory pricing/i,
  /limited time/i,
];

test('locale product copy carries no scarcity or discount claims', () => {
  const locales = ['de', 'es', 'fr', 'ja', 'zh-CN'];
  const offenders = [];
  for (const lang of locales) {
    const dict = JSON.parse(read(`public/locales/${lang}.json`));
    for (const [key, value] of Object.entries(dict)) {
      if (!key.startsWith('product.copy.')) continue;
      const text = Array.isArray(value) ? value.join(' ') : String(value);
      for (const pattern of SCARCITY_PATTERNS) {
        if (pattern.test(text)) {
          offenders.push(`${lang}:${key} matches ${pattern}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `scarcity/discount claims found:\n${offenders.join('\n')}`);
});

// ---------------------------------------------------------------------------
// 4. The refund story is one story across contact, FAQ and the policy page.
// ---------------------------------------------------------------------------
test('contact page does not promise refunds for wrong purchases', () => {
  const html = read('public/contact.html');
  // The refund policy (refund.html) excludes wrong version/product. The contact
  // page must not contradict that by promising "mua nhầm"/"accidental" refunds.
  assert.doesNotMatch(html, /mua nhầm/i, 'contact.html must not promise refunds for "mua nhầm"');
});

test('FAQ does not promise refunds for wrong purchases', () => {
  const source = read('src/pages.js');
  assert.doesNotMatch(source, /tôi mua nhầm|bought the wrong thing/i, 'FAQ must not promise refunds for wrong purchases');
});

test('checkout consent matches the refund policy language', () => {
  const dict = read('public/i18n.js');
  // The consent must reference the policy, not a blanket "no refund after download".
  assert.doesNotMatch(dict, /không được hoàn tiền sau khi đã tải|not refundable once it has been downloaded/i,
    'cart.agree must not claim a blanket no-refund-after-download');
});

// ---------------------------------------------------------------------------
// 5. The catalogue the BUYER sees (and the live shop syncs to) carries no
//    unenforceable scarcity/discount claims either — not only the locale assets.
// ---------------------------------------------------------------------------
// The 2026-11-14 GMC audit found "Ưu đãi sớm - chỉ 199.000đ (giảm 33%) cho 100
// khách đầu tiên" live on the storefront after the repo had been cleaned: the
// claim lived in the runtime catalogue (Supabase), fed by this JSON file. A gate
// that only watches public/locales cannot see that class of escape.
import { readdirSync } from 'node:fs';
const catalogFiles = (dir) => readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.json'));

test('catalogue (products.json) carries no scarcity/discount claims', () => {
  const products = JSON.parse(read('data/products.json'));
  assert.ok(Array.isArray(products) && products.length > 0, 'data/products.json phải có sản phẩm');
  const offenders = [];
  for (const p of products) {
    const text = Object.entries(p)
      .filter(([, v]) => typeof v === 'string' || Array.isArray(v))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : v}`)
      .join(' ');
    for (const pattern of SCARCITY_PATTERNS) {
      if (pattern.test(text)) offenders.push(`${p.slug} matches ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], `catalogue carries claims:\n${offenders.join('\n')}`);
});

test('seed catalogue (src/store.js) carries no scarcity/discount claims', () => {
  const source = read('src/store.js');
  const offenders = SCARCITY_PATTERNS.filter((p) => p.test(source)).map((p) => String(p));
  assert.deepEqual(offenders, [], `seed store carries claims:\n${offenders.join('\n')}`);
});

test('blog posts carry no scarcity/discount claims', () => {
  const offenders = [];
  for (const file of catalogFiles('src/blog-posts')) {
    const post = JSON.parse(read(`src/blog-posts/${file}`));
    const text = Object.values(post)
      .filter((v) => typeof v === 'string')
      .join(' ');
    for (const pattern of SCARCITY_PATTERNS) {
      if (pattern.test(text)) offenders.push(`${file} matches ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], `blog posts carry claims:\n${offenders.join('\n')}`);
});

// ---------------------------------------------------------------------------
// 6. Checkout shows the price before the buyer commits.
// ---------------------------------------------------------------------------
// Google Merchant Center "Giá và điều kiện giao dịch không trung thực": the buyer
// must see the total price, the payment model and the delivery method BEFORE
// paying. The checkout modal used to collect name + email and jump straight to
// the payment step with no price anywhere on that screen.
test('checkout hiển thị giá, quy đổi PayPal, cách nhận và hoàn tiền trước khi trả', () => {
  const app = read('public/app.js');
  const form = app.slice(app.indexOf('function openCheckout'));
  assert.ok(form.includes('priceFor(p)'), 'openCheckout phải render giá sản phẩm (priceFor(p))');
  assert.ok(form.includes("T('cart.conversion')"), 'phải ghi chú quy đổi VND→USD của PayPal');
  assert.ok(form.includes("T('cart.deliveryDigital')"), 'phải ghi cách nhận sản phẩm số');
  assert.ok(form.includes("T('cart.refundWindow')"), 'phải ghi cửa sổ hoàn tiền');
  const i18n = read('public/i18n.js');
  for (const key of ['cart.conversion', 'cart.deliveryDigital', 'cart.refundWindow']) {
    assert.ok(i18n.includes(`'${key}'`), `i18n.js thiếu ${key}`);
  }
  // Locale parity: các bản dịch khác cũng phải có key (khóa mồ côi / thiếu dịch).
  for (const lang of ['de', 'es', 'fr', 'ja', 'zh-CN']) {
    const dict = JSON.parse(read(`public/locales/${lang}.json`));
    for (const key of ['cart.conversion', 'cart.deliveryDigital', 'cart.refundWindow']) {
      assert.ok(dict[key], `thiếu bản dịch ${key} trong ${lang}.json`);
    }
  }
});