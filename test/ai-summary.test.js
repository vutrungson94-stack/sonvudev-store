import test from 'node:test';
import assert from 'node:assert/strict';
// The shop's shared test environment, before anything imports src/.
import './helpers/env.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProductPage } from '../src/pages.js';
import { esc } from '../src/format.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const products = JSON.parse(read('data/products.json'));
const summaries = JSON.parse(read('src/ai-summaries.json'));

test('mọi sản phẩm đều có tóm tắt AI vi/en', () => {
  for (const product of products) {
    const entry = summaries[product.slug];
    assert.ok(entry, `thiếu tóm tắt AI cho ${product.slug}`);
    assert.ok(entry.vi && entry.vi.trim().length > 40, `tóm tắt vi quá ngắn: ${product.slug}`);
    assert.ok(entry.en && entry.en.trim().length > 40, `tóm tắt en quá ngắn: ${product.slug}`);
  }
});

test('trang sản phẩm render đúng một section tóm tắt AI, 1 cột, có disclaimer', () => {
  for (const lang of ['vi', 'en']) {
    for (const product of products) {
      const html = renderProductPage(product, lang, [], []);
      const sections = html.match(/class="detail-block ai-summary"/g) || [];
      assert.equal(sections.length, 1, `${lang}/${product.slug} phải có đúng 1 section tóm tắt AI`);
      const text = summaries[product.slug][lang];
      assert.ok(html.includes(esc(text)), `${lang}/${product.slug} thiếu nội dung tóm tắt`);
      const disclaimer = lang === 'vi' ? 'Tóm tắt do AI tạo' : 'AI-generated summary';
      assert.ok(html.includes(esc(disclaimer)), `${lang}/${product.slug} thiếu disclaimer`);
      // 1 column: no grid/card container for the summary.
      assert.ok(!/ai-summary-grid|ai-card-grid|ai-points/.test(html), `${lang}/${product.slug} không được chia nhiều cột`);
    }
  }
});