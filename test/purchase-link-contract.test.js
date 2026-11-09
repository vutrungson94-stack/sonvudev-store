import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.mjs';
import { renderIndexGrid } from '../src/pages.js';

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
  assert.match(html, /class="round-arrow"[^>]*href="\/\?buy=p-123"/, 'nút mua trên store phải mở luồng /?buy=<id>');
  assert.match(html, /class="product-page-link"[^>]*href="[^"]*\/product\/san-pham-demo"/, 'tên/liên kết khám phá sản phẩm phải tới trang sản phẩm');
  assert.doesNotMatch(html, /product-page-link[^>]*href="[^"]*\/\?buy=/, 'liên kết khám phá không được mở form mua');
});
