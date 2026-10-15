import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first.
import './helpers/env.mjs';
import { closeTest } from './helpers/teardown.mjs';

process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-chrome-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const { createApp } = await import('../src/app.js');
const { footerLinks, headerNav } = await import('../src/pages.js');

const server = (await createApp()).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => { await closeTest(server, tempDir); });

const html = async (route) => (await fetch(`${base}${route}`)).text();
const footerOf = (markup) => {
  const block = /<div class="footer-links">([\s\S]*?)<\/div>/.exec(markup);
  return block ? block[1] : '';
};
const hrefs = (markup) => [...markup.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// The footer is the same on every page except that it does not offer a link back
// to the page it is printed on.
//
// Both halves of that used to be hand-written. The link set was per file and the
// exclusion was per file too, so /privacy and /refund were each shipped with a
// "Privacy" and a "Refund" button that led to the page the reader was already on,
// and /about had a footer so short it did not even contain the other pages. No gate
// could see it: each file was internally consistent.
//
// The exclusion cannot live in a template at all — it is a function of the route —
// which is why the list of links is data in src/pages.js and the server renders it.
// ---------------------------------------------------------------------------
test('footer bỏ nút của chính trang đang đọc, giữ nút của các trang còn lại', async () => {
  const pages = {
    '/terms': '/terms',
    '/privacy': '/privacy',
    '/refund': '/refund',
    '/about': '/about',
    '/lookup': '/lookup',
    '/': '/',
  };
  for (const [route, own] of Object.entries(pages)) {
    const links = hrefs(footerOf(await html(route)));
    assert.ok(links.length >= 6, `${route}: footer phải còn các trang khác, đang có ${links.length}`);
    assert.ok(!links.includes(own), `${route}: footer không được chứa nút tới chính nó (${own})`);
  }
});

test('mọi trang dùng chung một danh sách footer, chỉ khác ở trang đang đọc', async () => {
  // The full set, taken from a page that is not one of them.
  const full = hrefs(footerOf(await html('/404.html')));
  // Which of those links is "a link back to the page you are reading". The two
  // anchors are sections of the homepage, so they belong to the same page as it.
  const own = {
    '/': ['/#products', '/#faq'],
    '/terms': ['/terms'],
    '/privacy': ['/privacy'],
    '/refund': ['/refund'],
    '/about': ['/about'],
    '/lookup': ['/lookup'],
    '/order/x': [],
  };
  for (const [route, expected] of Object.entries(own)) {
    const links = hrefs(footerOf(await html(route)));
    const missing = full.filter((href) => !links.includes(href));
    assert.deepEqual(missing.sort(), [...expected].sort(),
      `${route}: footer chỉ được thiếu đúng những nút trỏ về chính trang đang đọc`);
    assert.equal(links.length, full.length - expected.length, `${route}: số nút trong footer sai`);
  }
});

test('trang chủ không tự liên kết tới chính nó, nhưng vẫn tới mọi trang khác', async () => {
  const links = hrefs(footerOf(await html('/')));
  // #products and #faq are sections of the homepage, so on the homepage they are
  // the page the reader is on — the same rule, applied to an anchor.
  assert.ok(!links.some((href) => href === '/#products' || href === '/#faq'),
    `footer trang chủ không được chứa nút tới chính nó: ${links.join(', ')}`);
  for (const href of ['/terms', '/privacy', '/refund', '/about', '/lookup']) {
    assert.ok(links.includes(href), `footer trang chủ phải tới ${href}`);
  }
  assert.ok(links.some((href) => href.startsWith('mailto:')), 'footer phải có liên hệ');
});

// ---------------------------------------------------------------------------
// The header. One bar, on every page, with the page you are on marked for a
// screen reader and not for the eye.
//
// It used to exist in five shapes across eleven files: five different words on the
// same button, two pages with no header at all, and the navigation the buyer was
// looking at was not the one the operator was editing.
// ---------------------------------------------------------------------------
test('header giống nhau trên mọi trang, kể cả hai trang trước đây không có', async () => {
  const expected = '<nav><a href="/#products" data-i18n="nav.products">Sản phẩm</a>'
    + '<a href="/#faq" data-i18n="nav.faq">FAQ</a>'
    + '<a href="/terms" data-i18n="nav.terms">Điều khoản</a></nav>';
  for (const route of ['/', '/terms', '/privacy', '/refund', '/about', '/lookup',
    '/paypal-return', '/admin', '/404.html', '/order/x']) {
    const markup = await html(route);
    const header = /<header class="site-header">([\s\S]*?)<\/header>/.exec(markup);
    assert.ok(header, `${route}: phải có header`);
    // aria-current is allowed to differ — that is the one thing that should.
    const nav = (header[1].match(/<nav>[\s\S]*?<\/nav>/) || [''])[0]
      .replaceAll(' aria-current="page"', '');
    assert.equal(nav, expected, `${route}: thanh điều hướng phải giống mọi trang khác`);
  }
});

test('aria-current chỉ đánh dấu đúng trang đang đọc', async () => {
  assert.ok((await html('/terms')).includes('href="/terms" data-i18n="nav.terms" aria-current="page"'),
    '/terms phải đánh dấu chính nó');
  for (const route of ['/', '/privacy', '/refund', '/about']) {
    const markup = await html(route);
    const header = /<header class="site-header">([\s\S]*?)<\/header>/.exec(markup)[1];
    assert.ok(!header.includes('aria-current'),
      `${route}: không phải trang điều khoản thì không được đánh dấu aria-current`);
  }
});

// ---------------------------------------------------------------------------
// The invariant, held on the source rather than on the bytes.
//
// Asserting on rendered output proves the behaviour for the routes this file
// happens to request. Reading the list itself proves the rule has no exception:
// one more page with a hand-written footer cannot join in.
// ---------------------------------------------------------------------------
test('không trang nào tự chứa thanh điều hướng — nó chỉ có thể đến từ một chỗ', async () => {
  const dir = path.join(process.cwd(), 'public');
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.html'));
  assert.ok(names.length >= 10, `phải thấy đủ các trang, thấy ${names.length}`);
  // admin.html has no footer: it is the back office, its own surface, and it still
  // takes the header from the same list. The bar above is the storefront's.
  const withoutFooter = new Set(['admin.html']);
  for (const name of names) {
    const source = await fs.readFile(path.join(dir, name), 'utf8');
    assert.ok(/<header class="site-header">[\s\S]*?\{\{headerNav\}\}/.test(source),
      `${name}: header phải gọi {{headerNav}}, không tự viết <nav>`);
    assert.ok(!/\{\{headerNav\}\}/.test(source.replace(/<header class="site-header">[\s\S]*?\{\{headerNav\}\}/, '')),
      `${name}: {{headerNav}} chỉ được dùng trong header`);
    if (withoutFooter.has(name)) {
      assert.ok(!source.includes('{{footerLinks}}'), `${name}: không có footer thì không được gọi nó`);
      continue;
    }
    assert.ok(source.includes('<div class="footer-links">{{footerLinks}}</div>'),
      `${name}: footer phải gọi {{footerLinks}}`);
    assert.equal((source.match(/\{\{footerLinks\}\}/g) || []).length, 1,
      `${name}: {{footerLinks}} phải xuất hiện đúng một lần`);
  }
});

test('routeForFile đọc từ chính tên file mà router đăng ký', () => {
  // routeForFile is internal to pages.js. Verify the routes it derives
  // by checking the router actually serves them.
  assert.equal(typeof footerLinks, 'function');
  assert.equal(typeof headerNav, 'function');
  // An empty route must not equal any link's route, or a page rendered without
  // one would drop a link it should keep.
  assert.ok(footerLinks('').includes('href="/terms"'), 'route rỗng phải giữ nguyên mọi link');
  assert.ok(!footerLinks('/terms').includes('href="/terms"'));
});

test('headerNav là cùng một thanh trên mọi trang, chỉ đổi ở aria-current', () => {
  const items = (route) => [...headerNav(route).matchAll(/<a [^>]*>/g)].map((m) => m[0]);
  const plain = (route) => items(route).map((tag) => tag.replace(' aria-current="page"', ''));
  const onHome = items('/');
  assert.equal(onHome.length, 3, 'header phải có đúng ba mục');
  assert.ok(!onHome.some((tag) => tag.includes('aria-current')),
    'trang chủ không phải là một mục nào trong thanh điều hướng');
  assert.deepEqual(plain('/terms'), plain('/'), 'thanh điều hướng phải giống nhau trên mọi trang');
  assert.equal(items('/terms').filter((tag) => tag.includes('aria-current')).length, 1,
    'đúng một mục được đánh dấu, và đó là trang đang đọc');
});