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

// The product page's header used to open the brand link and never close it:
//
//   <a class="brand" href="/">…wordmark…<nav><a href="/#products">…</a></nav>
//
// It looks like a missing tag, and the HTML parser copes: a link cannot
// contain a link, so when it met the navigation's first link it ran the
// adoption agency algorithm and re-created the brand link — empty — inside the
// <nav>. The rendered page therefore carried two brand links, one of them with
// no text, no image text and no label.
//
// That is what axe reported as "Links do not have a discernible name" and what
// Lighthouse's agentic-browsing check reports as a malformed accessibility
// tree: a screen reader and an agent both meet a nameless link.
//
// The check reads the source, because that is where the mistake is; the parsed
// result is what the audit above could not see.
test('header trang sản phẩm đóng thẻ link thương hiệu trước khi mở điều hướng', async () => {
  const pages = await read(path.join('src', 'pages.js'));

  const headers = [...pages.matchAll(/<a class="brand"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.ok(headers.length > 0, 'phải tìm thấy header thương hiệu trong src/pages.js');

  for (const [, inner] of headers) {
    assert.ok(inner.includes('${brandWordmark()}'),
      'link thương hiệu phải chứa ${brandWordmark()}');
    assert.ok(!inner.includes('<nav'),
      'link thương hiệu không được chứa <nav> — trình duyệt sẽ tạo lại link rỗng bên trong nav');
    assert.ok(!inner.includes('<a '),
      'link thương hiệu không được chứa link khác');
  }

  // And the navigation must be a sibling of the brand link, not a child.
  const productHeader = /<header class="site-header">([\s\S]*?)<\/header>/.exec(pages);
  assert.ok(productHeader, 'phải tìm thấy header của trang sản phẩm');
  const header = productHeader[1];
  const brandEnd = header.indexOf('</a>');
  assert.ok(brandEnd !== -1, 'header phải đóng link thương hiệu');
  assert.ok(!header.slice(0, brandEnd).includes('${headerNav('),
    'nav phải nằm sau link thương hiệu, không nằm trong nó');
  assert.ok(header.indexOf('${headerNav(') > brandEnd,
    'nav phải nằm sau </a> của link thương hiệu');
});

// The "Sản phẩm khác" strip is rendered by the server, and the client loader
// used to fetch the whole catalogue again to replace it with the same list: 14 KB
// and 549 ms, on the longest chain of every product page.
//
// The loader is still needed for the 404 page, whose list is a loading line
// waiting to be filled. The difference is whether the server already put links
// in the box.
test('bộ nạp sản phẩm liên quan không gọi lại API khi server đã render sẵn', async () => {
  const related = await read(path.join('public', 'related.js'));
  assert.match(related, /if \(box\.querySelector\('a'\)\) return;/,
    "related.js phải bỏ qua khi hộp đã có link — nếu không, mọi trang sản phẩm lại tải /api/products lần nữa");
});
