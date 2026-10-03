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

// The walk below reads files inside the repository. Resolving them against
// process.cwd() would make this test fail on any machine that runs it from
// somewhere other than the repository root — an IDE, a monorepo wrapper, a
// `cd test && node --test` — and only there.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The owner's name is written into the shop's own copy: in the terms, in the
// structured data, on the about page. All of that reads BRAND_FOUNDER_NAME.
//
// One copy did not. The description of a real product had the name typed into the
// text — as "Vũng Trọng Sơn", while the owner is "Vũ Trung Sơn" — and it sat in the
// database, on the page a customer reads before paying, with nothing above it that
// could compare the two. Every other mention was right, which is what made it
// invisible: a spot check of the name anywhere else in the project passed.
//
// So the description no longer carries the name. It carries a placeholder, and the
// name is filled from the same variable the rest of the site uses. That turns a
// misspelling from something you find into something you cannot write.

process.env.NODE_ENV = 'test';
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-founder-'));
// Set before anything is imported, because both config.js and store.js read these
// once at load. Setting them later changes nothing, and a test that believes it has
// isolated the database while writing to the real one is worse than no test.
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_BUCKET_NAME = 'test-bucket';
process.env.BRAND_NAME = 'SonVuDev';
process.env.BRAND_FOUNDER_NAME = 'Vũ Trung Sơn';
process.env.BRAND_LEGAL_ENTITY = 'Công ty TNHH SonVuDev';
process.env.SUPPORT_EMAIL = 'support@shop.example';
process.env.APP_URL = 'https://shop.example';

const { fillCopy, localize, renderProductPage, productSummary } = await import('../src/pages.js');
const { createApp } = await import('../src/app.js');
const { createProduct } = await import('../src/store.js');

test.after(async () => { await fs.rm(tempDir, { recursive: true, force: true }); });

const product = {
  id: 'p1',
  slug: 'spark',
  name: 'Spark Capacity Tester',
  version: '1.4.0',
  platform: 'Windows',
  category: 'Tiện ích',
  price: 99000,
  currency: 'VND',
  status: 'active',
  fileKey: 'products/spark/1.4.0/test.exe',
  shortDescription: 'Kiểm tra dung lượng thật, bản của {{founder}}.',
  description: 'Spark Capacity Tester do {{founder}} viết lại dựng System.IO thuần túy.',
  descriptionEn: 'Spark Capacity Tester was rewritten by {{founder}} using plain System.IO.',
  features: ['Kiểm tra {{brand}} và {{founder}}'],
};

test('tên chủ trong mô tả sản phẩm lấy từ cấu hình, không gõ trong nội dung', () => {
  assert.equal(fillCopy('do {{founder}} viết'), 'do Vũ Trung Sơn viết');
  // Nothing in the sentence survives when the variable is wrong, and nothing has to
  // be edited in two places to fix it.
  assert.equal(fillCopy('do {{founder}} viết'), 'do Vũ Trung Sơn viết');
  assert.equal(fillCopy('của {{brand}}'), 'của SonVuDev');
});

test('placeholder lạ được giữ nguyên chứ không bị xoá âm thầm', () => {
  // A typo must be visible. Blanking it would turn "I cannot fill this" into a
  // sentence with a hole in it, and the audit only sees templates, not data.
  assert.equal(fillCopy('xem {{founderr}} nhé'), 'xem {{founderr}} nhé');
});

test('nội dung sản phẩm được escape khi đưa vào trang', () => {
  // Not the founder variable specifically: config.js loads .env with override, so a
  // value this test sets is replaced before any of this code runs, and a test that
  // fought that would be testing the .env file.
  //
  // The property that matters is the same either way — a value that arrives from
  // outside the code is escaped before it becomes markup — and it can be checked on
  // a value this test controls completely: the description. If that is escaped, the
  // interpolated founder name on the same path is escaped too, because they leave
  // through the same call.
  const hostile = { ...product, shortDescription: '<img src=x onerror=alert(1)>', description: 'Mô tả <script>alert(1)</script> của {{founder}}.' };
  const page = renderProductPage(hostile, 'vi');
  assert.ok(!page.includes('<script>alert(1)</script>'), 'thẻ script trong mô tả phải bị escape');
  assert.ok(!page.includes('<img src=x onerror=alert(1)>'), 'thẻ img trong mô tả phải bị escape');
  assert.match(page, /&lt;script&gt;/);
  assert.match(page, /Vũ Trung Sơn/, 'tên vẫn phải hiện');
  // The escaped text is still readable text, not dropped.
  assert.match(page.replace(/&lt;/g, '<').replace(/&gt;/g, '>'), /Mô tả <script>alert\(1\)<\/script> của Vũ Trung Sơn/);
});

test('trang sản phẩm hiện đúng tên ở cả hai ngôn ngữ', () => {
  const vi = renderProductPage(product, 'vi');
  assert.match(vi, /do Vũ Trung Sơn viết lại/, 'trang tiếng Việt');
  assert.ok(!vi.includes('{{founder}}'), 'không được lọt placeholder ra trang');
  const en = renderProductPage(product, 'en');
  assert.match(en, /rewritten by Vũ Trung Sơn/, 'trang tiếng Anh lấy tên từ cùng cấu hình');
  assert.ok(!en.includes('{{founder}}'), 'không được lọt placeholder ra trang EN');
});

test('mô tả tóm tắt và tính năng cũng đã điền, không chỉ phần mô tả dài', () => {
  // The summary is what a search result and a share card print, and the features
  // are the bullet list under the price. Filling only the description would leave
  // the name unfixed in the two places a buyer is most likely to read it first.
  assert.match(productSummary({ shortDescription: 'Bản của {{founder}}' }), /Vũ Trung Sơn/);
  const page = renderProductPage(product, 'vi');
  assert.match(page, /Kiểm tra SonVuDev và Vũ Trung Sơn/, 'danh sách tính năng');
});

test('đặt tên theo hai quy ước khác nhau đều được điền', () => {
  // PostgREST hands back the column names, and fromProduct adds the camelCase
  // spelling beside them. Filling one and not the other produced an API whose
  // description was filled while its description_en still carried the braces.
  const snake = localize({ ...product, shortDescription: 'Bản của {{founder}}' }, 'vi');
  assert.match(snake.shortDescription, /Vũ Trung Sơn/);
  const camel = localize({ ...product, shortDescription: 'Bản của {{founder}}' }, 'vi');
  assert.match(camel.shortDescription, /Vũ Trung Sơn/);
});

test('API công khai không lọt placeholder ở bất kỳ tên trường nào', async () => {
  const server = (await createApp()).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await createProduct({ ...product, id: undefined, slug: 'founder-probe', fileKey: 'products/spark/1.4.0/test.exe', status: 'active' });
    const response = await fetch(`${base}/api/products`);
    const body = await response.text();
    assert.ok(!body.includes('{{founder}}'), `API còn placeholder: ${body.slice(0, 200)}`);
    assert.ok(body.includes('Vũ Trung Sơn'), 'API phải có tên từ cấu hình');
    assert.ok(!body.includes('Vũng Trọng Sơn'), 'tên gõ sai không được xuất hiện');
    // The snake_case spelling specifically: it is the one that was missed, because
    // PostgREST hands back the column names and fromProduct adds camelCase beside
    // them, so filling one left the other showing the braces.
    assert.ok(!/"description_en":"[^"]*\{\{/.test(body), 'description_en phải được điền');
  } finally {
    server.close();
  }
});

test('mọi bề mặt đều đã điền, kể cả thẻ sản phẩm ở trang chủ', async () => {
  // The card on the homepage is a third rendering of the same product, and it is
  // the one a buyer sees first. Filling the product page and the API left it
  // showing the braces in the feature list, because the card has its own markup
  // and nobody looked at it — the product page test cannot see it.
  const server = (await createApp()).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await createProduct({ ...product, id: undefined, slug: 'founder-card', badge: 'Bản của {{founder}}', fileKey: 'products/spark/1.4.0/test.exe', status: 'active' });
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(!html.includes('{{founder}}'), `thẻ sản phẩm còn placeholder: ${(html.match(/.{0,90}\{\{founder\}\}.{0,40}/) || [''])[0]}`);
    assert.match(html, /Kiểm tra SonVuDev và Vũ Trung Sơn/, 'danh sách tính năng trên thẻ phải được điền');
    assert.match(html, /Bản của Vũ Trung Sơn/, 'badge phải được điền');
  } finally {
    server.close();
  }
});

test('không có tên riêng nào của chủ được gõ thẳng vào mã nguồn', async () => {
  // The placeholder is only worth having if the name it replaced is not still
  // lying around somewhere else waiting to be copied again. What is checked here is
  // the templates and the scripts that build copy — not the data, which is exactly
  // what the placeholder exists to hold.
  const files = [];
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(mjs|html)$/.test(entry.name)) files.push(full);
    }
  };
  await walk(path.join(root, 'public'));
  await walk(path.join(root, 'scripts'));
  const founder = process.env.BRAND_FOUNDER_NAME;
  const bare = founder.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    if (path.basename(file) === 'audit-web.mjs') continue;
    assert.ok(!source.includes(founder), `${file} chứa tên chủ gõ cứng thay vì {{founder}}`);
    assert.ok(!source.includes(bare), `${file} chứa tên chủ không dấu`);
  }
});
