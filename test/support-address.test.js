import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';

// The support address was written into five places by hand: the email templates,
// the terms, the privacy policy, the refund policy, and the order page. Changing
// SUPPORT_EMAIL moved four of them and left the rest pointing at an address
// nobody reads. These hold the remaining ones to the config.
process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-support-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET_NAME = 'test-private-bucket';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';
process.env.APP_URL = 'http://127.0.0.1:4182';
// An address that exists nowhere in the repository, so a page still serving the
// old literal cannot pass by accident.
process.env.SUPPORT_EMAIL = 'support-ao@shop-vi.example';

const { createApp } = await import('../src/app.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFile(path.join(root, file), 'utf8');
const publicFile = (name) => read(path.join('public', name));

let server;
let base;
test.before(async () => { server = (await createApp()).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server?.close(); await fs.rm(tempDir, { recursive: true, force: true }); });

const page = async (route) => (await fetch(`${base}${route}`)).text();

test('mọi trang có địa chỉ đều nhận từ SUPPORT_EMAIL', async () => {
  // /order/<id> is the shape the lookup form and the PayPal return both link to.
  // It used to fall through to the static file, which is why it still carried its
  // template tokens while /order and /order.html did not.
  const configured = process.env.SUPPORT_EMAIL;
  for (const route of ['/terms', '/privacy', '/refund', '/order.html', '/order/SVD-XXXXXX-XXXXXX', '/paypal-return.html', '/lookup', '/lookup.html']) {
    const html = await page(route);
    assert.ok(!html.includes('{{support}}'), `${route} còn token chưa thay`);
    // A rendered page is supposed to show the configured address — that is the
    // whole point of the substitution. What it must not do is show a *different*
    // one, which is what happens when a file carries a literal and the token is
    // never reached. The token check above is what catches that case; here the
    // assertion is simply that the configured value made it into the bytes.
    assert.ok(html.includes(configured), `${route} chưa nhận địa chỉ từ cấu hình`);
  }
});

test('không trang nào phục vụ nguyên template, ở bất kỳ đường dẫn nào', async () => {
  // Every page that exists as a file, requested by the name a person or a crawler
  // would type, plus the shape the catch-all answers. A template that reaches the
  // browser unsubstituted is the defect this whole arrangement exists to prevent,
  // and there were two of them that every other gate called clean:
  //
  //   /lookup printed the literal "{{support}}" as the support address, on the page
  //   a PayPal buyer reaches after losing their session.
  //   /404.html printed "© {{year}}", because it is a real file and express.static
  //   answered it before the catch-all could render it.
  //
  // So the check is on the bytes, over every URL, rather than on a list of which
  // files the renderer is supposed to know about.
  //
  // Rendered product copy counts too: {{founder}} is filled on the way out from
  // BRAND_FOUNDER_NAME, and a card on the homepage that skipped that step put the
  // braces in the feature list. Nothing here knows what the placeholders mean; it
  // only insists that a reader is never shown one.
  //
  // The known set is imported from src/pages.js — the same list the renderer fills
  // from and the audit reads — so the three can never disagree about which token
  // is legitimate again. A hand-written copy here is how {{brandWordmark}} ended
  // up filled on every page yet "leaked" on the one route the renderer never saw.
  const { KNOWN_TEMPLATE_TOKENS } = await import('../src/pages.js');
  const KNOWN = new Set(KNOWN_TEMPLATE_TOKENS);
  const unresolvedIn = (html) => [...html.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)].map((m) => m[1]).filter((name) => !KNOWN.has(name));

  for (const file of ['index.html', 'terms.html', 'privacy.html', 'refund.html', 'about.html', 'order.html', 'lookup.html', '404.html']) {
    for (const route of [`/${file}`, `/${file.replace(/\.html$/, '')}`]) {
      const response = await fetch(`${base}${route}`);
      const html = await response.text();
      const unresolved = unresolvedIn(html);
      assert.deepEqual(unresolved, [], `${route} (HTTP ${response.status}) còn token chưa thay: ${unresolved.join(', ')}`);
    }
  }
  // The path that is not a file at all.
  const missing = await fetch(`${base}/khong-ton-tai`);
  assert.equal(missing.status, 404);
  const html = await missing.text();
  assert.deepEqual(unresolvedIn(html), [], 'trang 404 còn token chưa thay');
  assert.match(html, new RegExp(`©\\s*${new Date().getFullYear()}`), 'trang 404 phải hiện năm thật');

  // And the pages that carry the dictionary must not leak one either, at any URL.
  for (const route of ['/', '/product/spark-capacity-tester-pro']) {
    const page = await (await fetch(`${base}${route}`)).text();
    const leaked = unresolvedIn(page);
    assert.deepEqual(leaked, [], `${route} lọt placeholder ra trang: ${leaked.join(', ')}`);
  }
});

test('trang pháp lý và trang tra cứu dùng chung một nguồn', async () => {
  for (const route of ['/refund', '/lookup']) {
    const html = await page(route);
    assert.ok((html.match(/support-ao@shop-vi\.example/g) || []).length >= 1, `${route} phải có địa chỉ từ cấu hình`);
    assert.ok(!html.includes('{{support}}'));
  }
});

test('file trong public/ không ghi địa chỉ bằng tay', async () => {
  // The token in the file is not a hardcode, it is the one place that says "put
  // SUPPORT_EMAIL here". A literal anywhere else is a second address to remember.
  const configured = process.env.SUPPORT_EMAIL;
  const files = ['terms.html', 'privacy.html', 'refund.html', 'order.html', 'paypal-return.html',
    'order.js', 'paypal-return.js', 'app.js', 'lookup.js'];
  for (const file of files) {
    assert.ok(!(await publicFile(file)).includes(configured), `public/${file} vẫn ghi cứng chính địa chỉ đang cấu hình`);
  }
  // i18n.js used to hold the address as a literal "last resort" so a page served
  // without the substituted value still had a working mailto. That literal is the
  // one thing that made the domain check hollow: the audit compared the files
  // against a hardcoded value it was itself reading out of a hardcoded file, so it
  // reported itself clean exactly when nothing was configured.
  //
  // The address now comes from data-support, which the server fills from
  // SUPPORT_EMAIL on every page it renders. Same guarantee, no second copy.
  const dictionary = await publicFile('i18n.js');
  assert.ok(!/hello@sonvudev\.com/.test(dictionary), 'từ điển không được ghi cứng địa chỉ');
  assert.ok(/dataset\?\.support|dataset\.support/.test(dictionary), 'từ điển phải đọc địa chỉ từ data-support');
  // Every page that loads i18n.js has to carry that attribute, or the dictionary
  // resolves to an empty string and every link built from it becomes mailto:.
  for (const file of ['index.html', 'lookup.html']) {
    const html = await publicFile(file);
    assert.match(html, /<body[^>]*data-support="\{\{support\}\}"/, `public/${file} phải có data-support trên body`);
  }
});

test('trang đơn hàng truyền địa chỉ xuống script qua data attribute', async () => {
  assert.match(await page('/order/SVD-XXXXXX-XXXXXX'), /<body[^>]+data-support="support-ao@shop-vi\.example"/, 'trang đơn phải có data-support');
  assert.match(await page('/paypal-return.html'), /<body[^>]+data-support="support-ao@shop-vi\.example"/, 'trang PayPal phải có data-support');
  // Reading it from the page is what makes the change one edit instead of two.
  for (const file of ['order.js', 'paypal-return.js']) {
    const source = await publicFile(file);
    assert.ok(/document\.body\?\.dataset\?\.support/.test(source), `public/${file} phải đọc từ data-support`);
    assert.ok(/brand\.supportEmail/.test(source), `public/${file} phải có địa chỉ dự phòng từ từ điển`);
  }
});

test('audit bắt được địa chỉ lệch khỏi .env', async () => {
  const audit = await read(path.join('scripts', 'audit-web.mjs'));
  // Without scanning i18n.js the default could sit at an address the owner
  // abandoned and the check would still pass, because it only compared pages.
  assert.ok(/i18n\.js/.test(audit), 'audit phải quét i18n.js tìm địa chỉ');
  assert.ok(/SUPPORT_EMAIL/.test(audit), 'audit phải so với SUPPORT_EMAIL');
});

test('trang pháp lý và trang đơn dùng chung một nguồn', async () => {
  const refund = await page('/refund');
  assert.ok((refund.match(/support-ao@shop-vi\.example/g) || []).length >= 2, 'mọi chỗ liên hệ trên trang hoàn tiền phải cùng một địa chỉ');
  assert.ok(!refund.includes('{{support}}'));
});

// A visitor reaches a 404 by following a broken link or typing an address, and
// neither carries a language. So this is the one page where the reader's own
// browser is the only signal available — and it was the only page still speaking
// one language, which meant a visitor from outside Vietnam who mistyped a URL was
// told, in Vietnamese, that nothing was there.
test('trang 404 nói được cả hai ngôn ngữ', async () => {
  const html = await fetch(`${base}/khong-ton-tai`).then((r) => r.text());
  assert.match(html, /<script src="i18n\.js"><\/script>/, 'trang 404 phải nạp từ điển');
  // Every sentence on the page is a key, so switching language can reach it. A
  // Vietnamese sentence left as literal text here is a sentence the switch cannot
  // move.
  for (const key of ['notfound.eyebrow', 'notfound.title', 'notfound.text', 'notfound.loading']) {
    assert.match(html, new RegExp(`data-i18n="${key}"`), `thiếu data-i18n="${key}"`);
  }
  // No switch of its own: it is chosen on the homepage and stored, and the dictionary
  // reads that before the first paint. A second control on the 404 would be the ninth
  // button for one decision.
  assert.ok(!/data-lang-switch|data-lang-toggle/.test(html), 'trang 404 không có nút đổi ngôn ngữ riêng');
  // The static text is Vietnamese, which is the correct fallback for a reader whose
  // browser says nothing — but it is a fallback, and the dictionary has to hold the
  // other side or the button would show the same words twice.
  const publicI18n = await publicFile('i18n.js');
  for (const key of ['notfound.eyebrow', 'notfound.title', 'notfound.text', 'notfound.loading']) {
    assert.ok(new RegExp(`'${key.replace(/\./g, '\\.')}':`).test(publicI18n), `từ điển thiếu ${key}`);
  }
  // related.js, the one piece of the page that is a standalone loader rather than a
  // data-i18n node. It used to carry a private {vi, en} table for one sentence, on the
  // stated reasoning that this page has no dictionary — which was false, and is the
  // reason the 404 was named as "the page with no switch" in that very comment while
  // it sat three lines above a working toggle. The sentence now comes from the shared
  // dictionary, so adding a locale reaches it.
  const related = await publicFile('related.js');
  assert.match(related, /dictionary\.t\(EMPTY\)/, 'related.js phải đọc câu từ từ điển chung');
  assert.match(related, /window\.I18N/, 'related.js phải dùng từ điển khi trang có nó');
  assert.ok(!/^\s*vi:\s*'/m.test(related.replace(/emptyFallback[\s\S]*?\};/, '')),
    'related.js không được mang bảng hai ngôn ngữ riêng cho câu này');
  assert.ok(publicI18n.includes("'products.onlyOne'"),
    'từ điển phải có products.onlyOne — đó là nơi câu duy nhất này sống bây giờ');
});

test('danh sách sản phẩm trong trang 404 cũng theo ngôn ngữ của trang', async () => {
  // The price formatter in the same file grouped digits by the page
  // language, and before that by nothing at all: a dot everywhere, which
  // is right for a Vietnamese reader and wrong for an English one. The
  // rule is now the one the server applies — the locale follows the
  // currency, never the page language — so a VND price keeps its dot
  // grouping on an English page exactly as the receipt writes it, and a
  // USD price wears its dollar sign on every screen.
  const related = await publicFile('related.js');
  assert.match(related, /SVDFormat\.money\(value, currency\)/, 'money() phải truyền currency');
  assert.ok(!/money\(value, currency, locale\)/.test(related),
    'related.js không được chọn locale theo trang — giá theo currency, không theo ngôn ngữ');
  const shared = await publicFile('format.js');
  assert.match(shared, /function money\(value, currency\)/, 'bộ định dạng dùng chung phải nhận currency');
  assert.match(shared, /currency === 'USD' \? 'en-US' : 'vi-VN'/, 'bộ định dạng dùng chung phải chọn locale theo currency');
  // And the same rule on the server, so the price on the page and the
  // price on the receipt are the same number written the same way.
  const server = await read('src/format.js');
  assert.match(server, /currency === "USD" \? "en-US" : "vi-VN"/, 'src/format.js phải chọn locale theo currency giống phía trình duyệt');
  // The language is still read from the document, for the empty message:
  // this file loads on pages that may not include i18n.js at all.
  assert.match(related, /documentElement.*lang|lang.*documentElement/s, 'related.js phải đọc lang từ document');
});