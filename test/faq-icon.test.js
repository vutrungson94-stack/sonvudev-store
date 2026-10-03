import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/.
import './helpers/env.mjs';

// The FAQ summary holds two elements: the question, and the ＋ that becomes an ×
// when the answer is open. A selector written for the icon instead reached both,
// because both are spans.
//
// Three defects came out of the one selector:
//   1. the question was painted coral, overriding the 600-weight ink type the
//      summary rule sets for it
//   2. the question was 20px/400 instead of 17px/600
//   3. opening an item rotated the QUESTION 45 degrees across the heading
//
// (3) is the one a screenshot catches. The first item ships with `open`, so it
// was on the homepage for every visitor, not an edge case.
//
// The fix is a class on the icon, and these assertions pin it: they fail the
// build if the selector ever goes back to reaching the question.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readPublic = (name) => fs.readFile(path.join(root, 'public', name), 'utf8');

test('mỗi mục FAQ có đúng một icon được đánh dấu', async () => {
  const html = await readPublic('index.html');
  const summaries = [...html.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map((m) => m[1]);
  assert.ok(summaries.length >= 4, `phải có các mục FAQ, thực tế ${summaries.length}`);

  for (const [index, summary] of summaries.entries()) {
    const icons = [...summary.matchAll(/<span class="faq-plus"/g)].length;
    assert.equal(icons, 1, `summary #${index + 1} phải có đúng 1 span.faq-plus, thực tế ${icons}`);
    // The question keeps its own span so the icon rule can never reach it again.
    assert.match(summary, /<span data-i18n="faq\.q\d+"/,
      `summary #${index + 1} phải còn span chứa câu hỏi`);
  }

  // And the icon is decoration, not content: a screen reader should not read "＋"
  // between the question and the answer.
  assert.match(html, /<span class="faq-plus" aria-hidden="true">/,
    'icon phải aria-hidden — nó là hình, không phải chữ để đọc');
});

test('CSS chỉ tới icon, không tới câu hỏi', async () => {
  const css = await readPublic('styles.css');

  // The selector that caused it: bare `summary span` cannot tell the two apart.
  assert.ok(!/\.faq-list summary span\{/.test(css),
    'cấm selector ".faq-list summary span" — nó trúng cả câu hỏi');
  assert.ok(!/\.faq-list details\[open\] summary span\{/.test(css),
    'cấm selector ".faq-list details[open] summary span" — nó xoay cả câu hỏi');
  assert.ok(!/\.faq-list summary span\s*[,>]/.test(css),
    'mọi rule trong .faq-list phải chỉ tới .faq-plus, không tới span trần');

  // The rotation exists, and exists for the icon only.
  assert.match(css, /\.faq-list details\[open\] summary \.faq-plus\{transform:rotate\(45deg\)\}/,
    'phải còn xoay 45deg, nhưng chỉ trên icon');
  // The question keeps the summary rule's own type rather than the icon's.
  assert.match(css, /\.faq-list summary\{[^}]*font:600 17px 'Space Grotesk'/,
    'câu hỏi phì giữ kiểu của summary: 600, 17px, Space Grotesk');
});