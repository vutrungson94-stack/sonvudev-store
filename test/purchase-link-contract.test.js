import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.mjs';
import { renderIndexGrid, renderProductPage } from '../src/pages.js';

test('store grid: CTA mua dùng /?buy=<id>, liên kết khám phá dùng trang sản phẩm', () => {
  const html = renderIndexGrid([
    {
      id: 'p-123',
      slug: 'san-pham-demo',
      name: 'Sản phẩm demo',
      shortDescription: 'Mô tả',
      description: 'Mô tả dài',
      category: 'Tiện ích',
      platform: 'Windows',
      version: '1.0.0',
      price: 1000,
      currency: 'VND',
      fileKey: 'releases/p-123.zip',
      status: 'active',
    },
  ]);
  assert.match(html, /class="round-arrow buy-btn"[^>]*href="\/\?buy=p-123"/, 'nút mua trên store phải mở luồng /?buy=<id>');
  assert.match(html, /rel="nofollow"[^>]*href="\/\?buy=p-123"|href="\/\?buy=p-123"[^>]*rel="nofollow"/,
    'link mua phải có rel="nofollow" — /?buy= là bản trùng của /');
  assert.match(html, /class="product-page-link"[^>]*href="[^"]*\/product\/san-pham-demo"/, 'tên/liên kết khám phá sản phẩm phải tới trang sản phẩm');
  assert.doesNotMatch(html, /product-page-link[^>]*href="[^"]*\/\?buy=/, 'liên kết khám phá không được mở form mua');
});

test('trang sản phẩm SSR: nút mua chính dùng /?buy=<id>, sản phẩm khác (khám phá) dùng trang sản phẩm', () => {
  const product = {
    id: 'p-main',
    slug: 'san-pham-chinh',
    name: 'Sản phẩm chính',
    shortDescription: 'Mô tả',
    description: 'Mô tả dài',
    category: 'Tiện ích',
    platform: 'Windows',
    version: '1.0.0',
    price: 1000,
    currency: 'VND',
    fileKey: 'releases/p-main.zip',
    status: 'active',
  };
  const related = [
    { id: 'p-rel', slug: 'san-pham-khac', name: 'Sản phẩm khác', version: '2.0.0', platform: 'Windows', price: 2000, currency: 'VND' },
  ];
  const vi = renderProductPage(product, 'vi', [], related);
  assert.match(vi, /class="button button-primary button-wide buy-btn"[^>]*href="(?:https?:\/\/[^"]+)?\/\?buy=p-main#products"/, 'nút mua chính trang sản phẩm phải dùng /?buy=<id>');
  assert.match(vi, /rel="nofollow"[^>]*href="(?:https?:\/\/[^"]+)?\/\?buy=p-main#products"|href="(?:https?:\/\/[^"]+)?\/\?buy=p-main#products"[^>]*rel="nofollow"/,
    'nút mua chính phải có rel="nofollow"');
  assert.match(vi, /class="related-card"[^>]*href="[^"]*\/product\/san-pham-khac"/, 'sản phẩm khác/liên quan (khám phá) phải đi tới trang sản phẩm');
  assert.doesNotMatch(vi, /class="related-card"[^>]*href="[^"]*\/\?buy=/, 'sản phẩm khác không được mở form thanh toán');

  const en = renderProductPage(product, 'en', [], related);
  assert.match(en, /href="(?:https?:\/\/[^"]+)?\/en\/\?buy=p-main#products"|href="(?:https?:\/\/[^"]+)?\/\?buy=p-main#products"/, 'nút mua trang sản phẩm EN phải dùng luồng mua');
  assert.match(en, /class="related-card"[^>]*href="[^"]*\/en\/product\/san-pham-khac"/, 'sản phẩm khác EN phải giữ locale trang sản phẩm');
});

test('public/related.js fallback: thẻ sản phẩm khác là discovery (trang sản phẩm), không dùng /?buy=', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../public/related.js', import.meta.url), 'utf8');
  assert.match(src, /prefix\s*\+\s*'\/product\//, 'related.js phải tạo link trang sản phẩm');
  assert.doesNotMatch(src, /\/\?buy=|openPurchaseForm|openCheckout/, 'related.js fallback discovery không được mở luồng mua');
});

test('structured data merchant listing: Offer có applicableCountry/returnMethod/shippingDetails cho digital products', () => {
  const product = {
    id: 'p-schema',
    slug: 'schema-probe',
    name: 'Schema Probe',
    shortDescription: 'Mô tả',
    description: 'Mô tả dài',
    category: 'Tiện ích',
    platform: 'Windows',
    version: '1.0.0',
    price: 1000,
    currency: 'VND',
    fileKey: 'releases/p-schema.zip',
    status: 'active',
  };
  const html = renderProductPage(product, 'vi', [], []);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const graph = blocks.flatMap((b) => b['@graph'] || [b]);
  const merchant = graph.find((n) => n['@type'] === 'Product' && n.offers);
  assert.ok(merchant, 'phải có node Product cho merchant listing');
  assert.ok(!('aggregateRating' in merchant), 'không tự thêm AggregateRating (không đủ điều kiện rich result)');
  assert.ok(Array.isArray(merchant.offers.hasMerchantReturnPolicy.applicableCountry), 'return policy phải có applicableCountry');
  assert.ok(merchant.offers.hasMerchantReturnPolicy.applicableCountry.includes('VN'), 'return policy áp dụng VN');
  // Digital products: no returnMethod (no physical return by mail)
  assert.ok(!merchant.offers.hasMerchantReturnPolicy.returnMethod, 'sản phẩm số: không có returnMethod ReturnByMail');
  // Digital products: no shippingDetails (no physical shipping)
  assert.ok(!merchant.offers.shippingDetails, 'sản phẩm số: không có shippingDetails');
});
