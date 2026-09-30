import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  for (const route of ['/terms', '/privacy', '/refund', '/order.html', '/order/SVD-XXXXXX-XXXXXX', '/paypal-return.html']) {
    const html = await page(route);
    assert.ok(!html.includes('{{support}}'), `${route} còn token chưa thay`);
    assert.ok(!html.includes('hello@sonvudev.com'), `${route} vẫn ghi cứng địa chỉ cũ`);
    assert.ok(html.includes('support-ao@shop-vi.example'), `${route} chưa nhận địa chỉ từ cấu hình`);
  }
});

test('file trong public/ không ghi địa chỉ bằng tay', async () => {
  // The token in the file is not a hardcode, it is the one place that says "put
  // SUPPORT_EMAIL here". A literal anywhere else is a second address to remember.
  const files = ['terms.html', 'privacy.html', 'refund.html', 'order.html', 'paypal-return.html',
    'order.js', 'paypal-return.js', 'app.js', 'lookup.js'];
  for (const file of files) {
    assert.ok(!(await publicFile(file)).includes('hello@sonvudev.com'), `public/${file} vẫn ghi cứng địa chỉ`);
  }
  // i18n.js is the one deliberate exception: it carries the configured default so
  // a page served without the substituted value still gets a working mailto, and
  // the audit compares that one value against .env.
  const dictionary = await publicFile('i18n.js');
  assert.ok(dictionary.includes('brand.supportEmail'), 'từ điển phải có địa chỉ dự phòng');
  // One per language table, no more. A second address here would be exactly the
  // drift this whole change exists to remove.
  const cut = dictionary.indexOf('\n  en: {');
  const occurrences = (text) => (text.match(/hello@sonvudev\.com/g) || []).length;
  assert.equal(occurrences(dictionary.slice(0, cut)), 1, 'tiếng Việt giữ đúng một giá trị dự phòng');
  assert.equal(occurrences(dictionary.slice(cut)), 1, 'tiếng Anh giữ đúng một giá trị dự phòng');
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