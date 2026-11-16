// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first.
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseCategory, CATEGORY_EN } from '../src/lib/categories.mjs';
import { renderIndexFilters } from '../src/pages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

// The catalogue's category is typed by hand in the admin panel, and the
// production catalogue carried "Utility" (English, singular) beside "Tiện ích".
//
// The filter row grouped them as two categories and printed the raw English one
// on every locale: the Chinese homepage read "全部 | 工具 | 实用工具 | Utility" —
// one filter in English among three translated ones, and nothing in the build
// said so.
test('một category viết bằng tiếng Anh vẫn ra nhãn đúng ở mọi ngôn ngữ', () => {
  assert.equal(normaliseCategory('Utility'), 'Tiện ích',
    '"Utility" phải về "Tiện ích" — cùng một danh mục, viết khác cách');
  assert.equal(normaliseCategory('Utilities'), 'Tiện ích');
  assert.equal(normaliseCategory('Tools'), 'Công cụ');
  assert.equal(normaliseCategory('Software'), 'Phần mềm');
  assert.equal(normaliseCategory('Other'), 'Khác');
});

test('một category chưa biết thì giữ nguyên, không bị đoán nhầm sang danh mục khác', () => {
  assert.equal(normaliseCategory('Một danh mục lạ'), 'Một danh mục lạ',
    'một danh mục lạ phải hiện đúng như chủ đã gõ — đoán nhầm sang danh mục khác thì tệ hơn');
  assert.equal(normaliseCategory(''), '');
});

// The Vietnamese labels are the identity map: the key IS the Vietnamese word.
test('bảng nhãn tiếng Việt và bảng tiếng Anh có cùng bộ khoá', () => {
  const vi = { 'Công cụ': 'Công cụ', 'Tiện ích': 'Tiện ích', 'Phần mềm': 'Phần mềm', 'Khác': 'Khác' };
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(CATEGORY_EN).sort(),
    'hai bảng nhãn phải có cùng bộ danh mục, nếu không một bảng sẽ có mục mà bảng kia không');
});

test('hàng lọc gộp hai cách viết của cùng một danh mục thành một nút', () => {
  const html = renderIndexFilters([
    { category: 'Utility' },
    { category: 'Tiện ích' },
    { category: 'Tools' },
  ]);
  const buttons = [...html.matchAll(/<button class="filter[^>]*>[^<]*<\/button>/g)].map((m) => m[0]);
  const labels = buttons.map((b) => b.replace(/<[^>]*>/g, ''));
  // The order is by how many products each filter holds, so the busiest one is
  // first: "Tiện ích" has two (Utility + Tiện ích), "Công cụ" has one.
  assert.deepEqual(labels, ['Tất cả', 'Tiện ích', 'Công cụ'],
    `hàng lọc phải có 3 nút, đang có: ${labels.join(' | ')}`);
  assert.ok(!html.includes('>Utility<'),
    'không được in nhãn tiếng Anh thô ra trên trang');
  const utility = buttons.find((b) => b.includes('Tiện ích'));
  assert.match(utility, /data-count="2"/,
    '"Utility" và "Tiện ích" là cùng một danh mục nên phải gộp thành một nút, đếm 2 sản phẩm');
});

// The gate that missed the regression. b323084 typed "UtilitiesApplication"
// into data/products.json and it shipped: the filter row and the product
// eyebrow both printed the raw value in every language, and the filter test
// still passed because it only asked "does the category have a button". A
// category the dictionary does not know is a data defect, not a rendering
// choice — the row is built from what is for sale, so what is for sale has to
// be something the row can name.
//
// The check is "is the value a known category", not "does normaliseCategory
// change it". Those are different questions, and the first draft asked the
// second one: a value that matches nothing is left as-is, so
// normaliseCategory('UtilitiesApplication') === 'UtilitiesApplication' and the
// "changed?" test passed. A value can only be unknown, never wrongly mapped,
// which is why the test has to ask about the canonical set.
const CANONICAL = new Set(Object.keys(CATEGORY_EN));
const unknownIn = (values) => [...new Set(values)]
  .filter((c) => !CANONICAL.has(normaliseCategory(String(c || '').trim())))
  .filter(Boolean);

test('tất cả category trong data/products.json đều là danh mục canonical', () => {
  const products = JSON.parse(read('data/products.json'));
  const unknown = unknownIn(products.map((p) => p.category));
  assert.deepEqual(unknown, [], `category không được biết trong data/products.json: ${unknown.join(', ')}`);
});

test('tất cả category trong seed src/store.js đều là danh mục canonical', () => {
  const source = read('src/store.js');
  const matches = [...source.matchAll(/"category":\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(unknownIn(matches), [], `seed category không được biết trong src/store.js`);
});

test('tất cả category trong blog-posts đều là danh mục canonical', () => {
  const dir = path.join(root, 'src', 'blog-posts');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const unknown = [];
  for (const f of files) {
    const post = JSON.parse(read(path.join('src', 'blog-posts', f)));
    if (!post.category) continue;
    unknown.push(...unknownIn([post.category]).map((c) => `${f}:${c}`));
  }
  assert.deepEqual(unknown, [], `blog category không được biết: ${unknown.join(', ')}`);
});
