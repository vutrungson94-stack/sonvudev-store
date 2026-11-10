// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first.
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseCategory, CATEGORY_EN } from '../src/lib/categories.mjs';
import { renderIndexFilters } from '../src/pages.js';

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
