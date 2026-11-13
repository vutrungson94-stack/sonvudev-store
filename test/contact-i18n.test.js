import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.mjs';

const { createApp } = await import('../src/app.js');

let server;
let base;

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
});

const text = async (p) => (await fetch(`${base}${p}`)).text();

// /en/contact used to skip localizeStaticHtml: contact.html was missing from
// STATIC_PAGES, so the localized route answered with the Vietnamese template and
// lang="vi", and i18n.js translated the whole page after load. On a phone that
// was a 0.204 layout shift (the <ul class="contact-list"> moved 168 px) and 2.6 s
// of LCP render delay — the text was already on screen, then replaced. The
// server has to answer in the language its URL names; the dictionary only keeps
// the live page in step after that.
test('/en/contact được render tiếng Anh ngay từ server', async () => {
  const html = await text('/en/contact');
  assert.match(html, /<html lang="en">/, 'trang phải khai báo lang="en"');
  assert.match(html, /<h1[^>]*>[\s\S]*?Contact/, 'h1 phải là tiếng Anh ngay từ server');
  assert.ok(!/<h1[^>]*>[\s\S]*?Liên hệ/.test(html),
    'server không được trả tiếng Việt cho /en/contact rồi để i18n.js dịch sau khi tải');
  assert.match(html, /<title[^>]*>Contact/, 'title phải là tiếng Anh');
  const item = html.match(/data-i18n="contact\.li1"[^>]*>([^<]*)/);
  assert.ok(item && item[1].startsWith('Order lookup'),
    'nội dung contact-list phải là tiếng Anh ngay từ server');
});

test('/contact vẫn là tiếng Việt', async () => {
  const html = await text('/contact');
  assert.match(html, /<html lang="vi">/);
  assert.match(html, /<h1[^>]*>[\s\S]*?Liên hệ/);
});
