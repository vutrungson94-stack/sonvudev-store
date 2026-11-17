// The homepage grid and chrome are rendered once per locale. A crawler or a
// reader without JavaScript sees the route's language, not a Vietnamese skeleton
// with a /de/ prefix. These gates hold that behaviour and the one-source locale
// registry the browser reads.
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIndexCount, renderIndexFilters, renderIndexGrid } from '../src/pages.js';
import { LOCALE_CODES } from '../src/i18n-registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const products = [{
  id: 'p1', slug: 'reviewable-tool', name: 'Công cụ thật', nameEn: 'Real tool',
  shortDescription: 'Mô tả tiếng Việt', shortDescriptionEn: 'English description',
  category: 'Công cụ', price: 99000, currency: 'VND', status: 'active',
  fileKey: 'release/p1.zip', slug: 'reviewable-tool',
  features: ['Tính năng một'], featuresEn: ['Feature one'],
}];

test('renderIndexCount theo ngôn ngữ của route', () => {
  assert.match(renderIndexCount(products, 'vi'), /sản phẩm$/);
  assert.match(renderIndexCount(products, 'en'), /products$/);
  assert.match(renderIndexCount(products, 'de'), /Produkte$/);
});

test('renderIndexFilters dịch nhãn nhưng giữ data-vi/data-en cho browser swap', () => {
  const vi = renderIndexFilters(products, 'vi');
  const de = renderIndexFilters(products, 'de');
  assert.match(vi, />Tất cả</);
  assert.match(de, />Alle</);
  // data attributes stay the canonical vi/en pair regardless of the route.
  assert.match(de, /data-vi="Tất cả" data-en="All"/);
  assert.match(de, /data-filter="Công cụ"/);
});

test('renderIndexGrid SSR text theo locale, data-vi/data-en vẫn là cặp gốc', () => {
  const en = renderIndexGrid(products, 'en');
  const de = renderIndexGrid(products, 'de');
  assert.match(en, />English description</);
  // de has no per-product copy asset in this fixture; it falls back to English,
  // never to the Vietnamese source string.
  assert.match(de, />English description</);
  assert.doesNotMatch(de, />Mô tả tiếng Việt</);
  assert.match(de, /data-vi="Mô tả tiếng Việt" data-en="English description"/);
});

test('locale registry là external script, không phải inline (CSP)', () => {
  // The template carries a token, not an inline script: fillPageTokens replaces
  // it with a same-origin <script src> at render time. CSP forbids inline.
  const html = read('public/index.html');
  assert.match(html, /\{\{localeRegistry\}\}/);
  assert.doesNotMatch(html, /<script>window\.SVD_LOCALES/);
  const pages = read('src/pages.js');
  assert.match(pages, /localeRegistry:\s*`<script defer src="\/locale-registry\.js">/);
  const i18n = read('public/i18n.js');
  assert.match(i18n, /window\.SVD_LOCALES/);
  const app = read('src/app.js');
  assert.match(app, /app\.get\("\/locale-registry\.js"/);
  assert.match(app, /JSON\.stringify\(LOCALE_CODES\)/);
});

test('mọi locale code trong registry có cấu hình label/tag', () => {
  const i18n = read('public/i18n.js');
  for (const code of LOCALE_CODES) {
    const escaped = code.replace(/-/g, '\\-');
    assert.match(i18n, new RegExp(`['"]?${escaped}['"]?:\\s*\\{`), `i18n.js thiếu meta cho ${code}`);
  }
});
