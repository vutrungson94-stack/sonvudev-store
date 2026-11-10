// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first.
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

// A product page that scrolls sideways on a phone.
//
// The About page and the product page share the class "product-detail", and the
// About page — prose, like the legal pages — carries an indentation ladder
// (24px, 48px, 72px). Written for ".product-detail", that ladder reached the
// product page too: every list under a heading was indented by 72px, and the
// feature cards, which are a grid with a 280px minimum column, no longer fit
// in what was left of the 390px screen. The page scrolled sideways and the
// header and the buy card went off the right edge with it.
//
// Two rules hold this shut: the ladder belongs to the About page alone, and a
// grid whose minimum column is wider than its container must be allowed to
// shrink.
test('trang sản phẩm không bị thụt lề kiểu trang pháp lý', async () => {
  const css = await read(path.join('public', 'styles.css'));

  const productIndent = css.match(/\.product-detail\s+h\d\s*~[^{]*\{[^}]*padding-left/g) || [];
  assert.deepEqual(productIndent, [],
    '`.product-detail` không được đặt padding-left theo thang heading — '
    + `thang này là của trang Giới thiệu (văn xuôi), không phải của trang sản phẩm: ${productIndent.join(', ')}`);

  // The About page is the one that owns the ladder, and it says so with a class
  // of its own rather than by borrowing the product page's.
  const about = await read(path.join('public', 'about.html'));
  assert.match(about, /<article class="product-detail about-copy">/,
    'trang Giới thiệu phải mang lớp about-copy để nhận thang thụt lề của riêng nó');

  const ladder = css.match(/\.about-copy\s+h\d\s*~[^{]*\{[^}]*padding-left/g) || [];
  assert.ok(ladder.length > 0,
    'thang thụt lề của trang Giới thiệu phải còn, chỉ là không được áp vào trang sản phẩm');
});

test('lưới có cột tối thiểu cố định phải co lại được trong khung hẹp', async () => {
  const css = await read(path.join('public', 'styles.css'));
  // repeat(auto-fit, minmax(280px,1fr)) trong khung 278px là thanh cuộn ngang.
  // min(280px,100%) cho phép cột co về đúng bề rộng khung.
  const fixed = [...css.matchAll(/repeat\(auto-fit,\s*minmax\((\d+)px,\s*1fr\)\)/g)];
  for (const match of fixed) {
    assert.fail(`cột tối thiểu cố định ${match[1]}px trong auto-fit sẽ tràn khung hẹp — `
      + 'dùng minmax(min(Npx,100%),1fr) để cột co theo khung');
  }
});
