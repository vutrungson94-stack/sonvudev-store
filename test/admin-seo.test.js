import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';
import { closeTest } from './helpers/teardown.mjs';

// The SEO fields exist in the database, the API renders them onto the product
// page, and they decide whether anyone clicks a result. But the admin panel had
// no input for them at all, so a new product shipped with a title nobody
// searched for. These tests cover the panel and the edit it now performs.
process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-admin-seo-'));
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

const { createApp } = await import('../src/app.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readPublic = async (file) => fs.readFile(path.join(root, 'public', file), 'utf8');
let server;
let base;
test.before(async () => { server = (await createApp()).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await closeTest(server, tempDir); });

const json = (payload, method = 'POST', id) => ({
  method,
  headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
  body: JSON.stringify(id ? { ...payload, id } : payload),
});
const create = (payload) => fetch(`${base}/api/admin/products`, json(payload)).then((r) => r.json());
const patch = (id, payload) => fetch(`${base}/api/admin/products/${encodeURIComponent(id)}`, json(payload, 'PATCH')).then((r) => r.json());

test('trang quản trị có ô nhập SEO title và mô tả', async () => {
  const html = await readPublic('admin.html');
  // Without these two inputs the only way to set the fields was to edit the
  // database by hand, which is why the two live products had copy and a new
  // one could not.
  assert.match(html, /name="seoTitle"/, 'thieu o SEO title');
  assert.match(html, /name="seoDescription"/, 'thieu o mo ta');
  assert.match(html, /maxlength="70"/, 'tieu de phai gioi han 70 ky tu');
  assert.match(html, /maxlength="175"/, 'mo ta phai gioi han 175 ky tu');
});

test('trang quản trị mở được sản phẩm để sửa SEO, không phải chỉ thêm mới', async () => {
  const source = await readPublic('admin.js');
  assert.match(source, /data-seo-form=/, 'thiếu form sửa SEO trên từng sản phẩm');
  assert.match(source, /seoEditor/, 'thiếu hàm seoEditor');
  assert.match(source, /method:'PATCH'.*seoTitle/s, 'phai luu bang PATCH de khong ghi de truong khac');
  // A create-only form cannot fix a product that is already published, and the
  // title is the thing most worth revisiting after seeing real search queries.
  assert.match(source, /data-seo-toggle/, 'thiếu nút mở form sửa SEO');
});

test('form sửa SEO báo lỗi khi vượt giới hạn search result cắt', async () => {
  const source = await readPublic('admin.js');
  // Google cuts a title around 60 characters and a description around 160. A
  // field that silently accepts 175 characters teaches the owner to write copy
  // that half of which nobody ever reads.
  //
  // The thresholds live in SEO_FIELDS, the one list the counters and the save
  // payload both read. It used to be an inline literal inside countSeo, which
  // meant the four fields added for English had to be re-typed there or their
  // length was never counted at all.
  assert.match(source, /const SEO_FIELDS=\[\['seoTitle','Tiêu đề',70,60\]/, 'thieu nguong canh bao cho tieu de');
  assert.match(source, /\['seoDescription','Mô tả',175,160\]/, 'thieu nguong canh bao cho mo ta');
  assert.match(source, /\['seoTitleEn','SEO EN tiêu đề',70,60\]/, 'thieu nguong canh bao cho tieu de tieng Anh');
  assert.match(source, /\['seoDescriptionEn','SEO EN mô tả',175,160\]/, 'thieu nguong canh bao cho mo ta tieng Anh');
  assert.match(source, /bị cắt/, 'phải hiển thị cảnh báo bị cắt');
});

test('có đường dẫn CSS cho form sửa SEO', async () => {
  const css = await readPublic('styles.css');
  assert.match(css, /\.admin-seo-form\{[^}]*grid-column:1\/-1/, 'form phải tràn hết chiều rộng hàng');
  assert.match(css, /@media \(max-width:700px\)\{\.admin-seo-form\{grid-template-columns:1fr\}\}/, 'phai xep doc tren dien thoai');
  assert.ok(existsSync(path.join(root, 'public', 'styles.css')));
});

test('tạo sản phẩm có giữ nguyên SEO title và mô tả', async () => {
  const created = await create({
    name: 'SEO Tester', slug: 'seo-tester', price: 99000, currency: 'VND', status: 'active', fileKey: 'products/seo/1.0.0/s.exe',
    seoTitle: 'Bật macro Excel không cần chỉnh tay từng file',
    seoDescription: 'Excel bị chặn macro? Script tự thêm thư mục tin cậy, dọn thư mục rác, có sẵn cách hoàn tác.',
  });
  assert.equal(created.product.seoTitle, 'Bật macro Excel không cần chỉnh tay từng file');
  assert.equal(created.product.seoDescription.startsWith('Excel bị chặn macro'), true);
  const page = await (await fetch(`${base}/product/seo-tester`)).text();
  assert.ok(page.includes('Bật macro Excel không cần chỉnh tay từng file'), 'tieu de SEO phai len trang san pham');
});

test('sau khi luu, nut khoa lai va form bao "Đã lưu"', async () => {
  // This is the bug: pressing Lưu SEO appeared to do nothing.
  //
  // Two things caused it and neither showed up in the tests, because every test here
  // exercised the API and not the panel. The save handler re-rendered the whole
  // product list, which replaces productList.innerHTML and therefore destroys the
  // form the owner was looking at; its cleanup then ran countSeo on that detached
  // form, so the button state it computed applied to nothing on screen. And the
  // saved values were never written back into the form's baseline, so even with the
  // form intact it stayed "dirty" forever — button clickable, counters still
  // reporting unsaved text, and a second save writing the same two fields again.
  //
  // The assertions below are on the source because the panel is one dense module
  // wired to a real DOM at import time, which is the only reason it is not tested by
  // behaviour. They pin the contract rather than the formatting.
  const source = await readPublic('admin.js');
  const saveSeo = source.slice(source.indexOf('async function saveSeo'), source.indexOf('async function uploadExistingProduct'));
  assert.ok(saveSeo.length > 0, 'không tìm thấy saveSeo');

  // The baseline is what "dirty" is measured against, so it has to be updated or the
  // form can never be clean again. It holds what the server stored, not what was
  // typed — the API truncates a title to 70 characters, so a long paste would
  // otherwise leave the form permanently dirty.
  assert.match(saveSeo, /storedTitle/, 'baseline phải lấy từ giá trị server trả về');
  assert.match(saveSeo, /form\.dataset\.seoTitle\s*=\s*storedTitle/, 'phải ghi giá trị vừa lưu vào baseline');
  assert.match(saveSeo, /form\.dataset\.seoDescription\s*=\s*storedDescription/, 'phải ghi giá trị vừa lưu vào baseline');

  // No full re-render in the save path. It is the thing that detached the form, and
  // it also closed the form the owner was working in.
  assert.ok(!/loadProducts\(\)/.test(saveSeo), 'saveSeo khong duoc ve lai toan bo danh sach — no se tach form dang mo');

  // The counters and the button are re-evaluated on the form that is still live, and
  // they run on both paths so a failure leaves the button usable for a retry.
  assert.match(saveSeo, /countSeo\(form\)/, 'phai cap nhat lai bo dem tren form con tren man hinh');
  const after = saveSeo.slice(saveSeo.lastIndexOf('catch'));
  assert.match(after, /countSeo\(form\)/, 'khi that bai cung phai cap nhat lai de mo nut cho thu lai');

  // A clean form has to say so. A greyed button on its own reads as a broken button.
  assert.match(source, /Đã lưu/, 'form đã lưu phải hiển thị trạng thái');
  assert.match(source, /'admin-seo-count'\+\(clean\?' clean':''\)/, 'trang thai da luu phai co class rieng');
  const css = await readPublic('styles.css');
  assert.match(css, /\.admin-seo-count\.clean\{/, 'cần có CSS cho trạng thái đã lưu');
});

test('trang /en/ không được mượn tiêu đề tiếng Việt — đó là trùng nội dung', async () => {
  // The defect this file's sibling exists to prevent, one level down: the English
  // page served the Vietnamese <title> and meta description verbatim. Two hreflang
  // URLs with identical metadata is a duplicate-content signal, not a translation,
  // and it puts Vietnamese wording in front of an English query.
  const created = await create({
    name: 'Hreflang Probe', slug: 'hreflang-probe', price: 99000, currency: 'VND', status: 'active',
    fileKey: 'products/hreflang/1.0.0/h.exe',
    description: 'Mô tả tiếng Việt đầy đủ cho trang tiếng Việt.', descriptionEn: 'The full English description for the English page.',
    shortDescription: 'Mô tả ngắn tiếng Việt.', shortDescriptionEn: 'Short English summary.',
    seoTitle: 'Tiêu đề từ khoá tiếng Việt đầy đủ cho sản phẩm này', seoDescription: 'Mô tả SEO tiếng Việt đầy đủ cho sản phẩm này.',
  });
  const vi = await (await fetch(`${base}/product/hreflang-probe`)).text();
  const en = await (await fetch(`${base}/en/product/hreflang-probe`)).text();
  const titleOf = (html) => /<title>([^<]*)<\/title>/i.exec(html)?.[1] || '';
  const descOf = (html) => /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html)?.[1] || '';

  assert.match(titleOf(vi), /Tiêu đề từ khoá tiếng Việt đầy đủ/, 'trang tieng Viet phai dung SEO tieng Viet');
  assert.ok(!titleOf(en).includes('Tiêu đề từ khoá tiếng Việt'),
    `trang /en/ phai co tieu de rieng, thuc te la: ${titleOf(en)}`);
  assert.notEqual(titleOf(vi), titleOf(en), 'hai trang hreflang phai khac nhau');
  assert.ok(!descOf(en).includes('Mo ta SEO tieng Viet'),
    `mo ta /en/ khong duoc la tieng Viet, thuc te la: ${descOf(en)}`);
  // And what it does serve comes from the English copy, not from an empty string.
  assert.match(descOf(en), /English/i, 'trang /en/ phai lay mo ta tu ban tieng Anh');
  // The schema follows the same rule: an English page advertising a Vietnamese
  // alternateName is the same mistake in the structured data.
  const enGraph = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(en)[1].replace(/\\u003c/g, '<'));
  const software = (Array.isArray(enGraph) ? enGraph : enGraph['@graph'] || [enGraph]).find((n) => n['@type'] === 'SoftwareApplication');
  assert.ok(!JSON.stringify(software).includes('Tiêu đề từ khoá tiếng Việt'), 'schema cua trang /en/ khong duoc chua tieu do tieng Viet');
});

test('SEO tiếng Anh lưu được và lên đúng trang /en/', async () => {
  const created = await create({
    name: 'English SEO', slug: 'english-seo', price: 99000, currency: 'VND', status: 'active',
    fileKey: 'products/en/1.0.0/e.exe',
    seoTitle: 'Tiêu đề tiếng Việt', seoDescription: 'Mô tả tiếng Việt.',
  });
  const updated = await patch(created.product.id, {
    seoTitleEn: 'English title for the same product', seoDescriptionEn: 'English description written for an English search.',
  });
  assert.equal(updated.product.seoTitleEn, 'English title for the same product');
  assert.equal(updated.product.seoTitle, 'Tiêu đề tiếng Việt', 'sua SEO tieng Anh khong duoc xoa SEO tieng Viet');
  const en = await (await fetch(`${base}/en/product/english-seo`)).text();
  assert.match(en, /<title>English title for the same product<\/title>/, 'trang /en/ phai dung tieu do tieng Anh vua luu');
  assert.match(en, /content="English description written for an English search\."/, 'mo ta /en/ phai dung mo ta tieng Anh vua luu');
});

test('SEO tiếng Anh bị cắt ở tầng máy chủ, không đưa vào database', async () => {
  const created = await create({ name: 'Cap EN', slug: 'cap-en', price: 99000, currency: 'VND', status: 'active', fileKey: 'products/capen/1.0.0/c.exe' });
  const updated = await patch(created.product.id, { seoTitleEn: 'A'.repeat(200), seoDescriptionEn: 'B'.repeat(400) });
  assert.equal(updated.product.seoTitleEn.length, 70, 'tieu de tieng Anh phai cat con 70 ky tu');
  assert.equal(updated.product.seoDescriptionEn.length, 175, 'mo ta tieng Anh phai cat con 175 ky tu');
});

test('trang quản trị có ô nhập SEO tiếng Anh, cả khi thêm mới lẫn khi sửa', async () => {
  const html = await readPublic('admin.html');
  assert.match(html, /name="seoTitleEn"/, 'thieu o SEO tieng Anh khi thêm sản phẩm');
  assert.match(html, /name="seoDescriptionEn"/, 'thieu o mo ta tieng Anh khi thêm sản phẩm');
  const source = await readPublic('admin.js');
  assert.match(source, /name="seoTitleEn"/, 'thieu o SEO tieng Anh trong form sua');
  assert.match(source, /name="seoDescriptionEn"/, 'thieu o mo ta tieng Anh trong form sua');
  // All four travel together: a form that saves the Vietnamese pair and forgets the
  // English one leaves /en/ with whatever it derived, which is what the owner asked
  // to edit in the first place.
  assert.match(source, /SEO_FIELDS=\[\['seoTitle','Tiêu đề',70,60\]/, 'danh sach 4 truong SEO phai la noi duy nhat');
  for (const field of ['seoTitle', 'seoDescription', 'seoTitleEn', 'seoDescriptionEn']) {
    assert.ok(source.includes(`'${field}'`), `danh sach truong SEO thieu ${field}`);
  }
});

test('sửa SEO không được xoá mô tả và tính năng', async () => {
  const created = await create({
    name: 'Keep My Text', slug: 'keep-my-text', price: 99000, currency: 'VND', status: 'active', fileKey: 'products/keep/1.0.0/k.exe',
    description: 'Mô tả dài mà không được mất khi sửa SEO', features: ['Tinh nang A', 'Tinh nang B'],
  });
  // The editor sends only the two SEO keys. A merge that treated them as a
  // whole-product replacement would blank the copy on every save.
  const updated = await patch(created.product.id, { seoTitle: 'Tieu de moi', seoDescription: 'Mo ta moi' });
  assert.equal(updated.product.description, 'Mô tả dài mà không được mất khi sửa SEO', 'mô tả phải còn nguyên');
  assert.deepEqual(updated.product.features, ['Tinh nang A', 'Tinh nang B'], 'tinh nang phai con nguyen');
  assert.equal(updated.product.name, 'Keep My Text', 'ten phai con nguyen');
  assert.equal(updated.product.seoTitle, 'Tieu de moi');
});

test('mức độ dài SEO bị cắt ở tầng máy chủ, không đưa vào database', async () => {
  const created = await create({ name: 'Cap Test', slug: 'cap-test', price: 99000, currency: 'VND', status: 'active', fileKey: 'products/cap/1.0.0/c.exe' });
  const updated = await patch(created.product.id, { seoTitle: 'A'.repeat(200), seoDescription: 'B'.repeat(400) });
  assert.equal(updated.product.seoTitle.length, 70, 'tiêu đề phải cắt còn 70 ký tự');
  assert.equal(updated.product.seoDescription.length, 175, 'mô tả phải cắt còn 175 ký tự');
});

test('sửa sản phẩm không tồn tại trả 404 chứ không phải lỗi 500', async () => {
  const response = await fetch(`${base}/api/admin/products/does-not-exist`, json({ seoTitle: 'x' }, 'PATCH'));
  assert.equal(response.status, 404);
});

test('sửa SEO không được bỏ qua khi thiếu token', async () => {
  const created = await create({ name: 'Locked', slug: 'locked', price: 99000, currency: 'VND', status: 'active', fileKey: 'products/lock/1.0.0/l.exe' });
  const response = await fetch(`${base}/api/admin/products/${encodeURIComponent(created.product.id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seoTitle: 'khong duoc ghi' }),
  });
  assert.notEqual(response.status, 200, 'phai tu choi');
  const after = await (await fetch(`${base}/api/admin/products`, { headers: { 'x-admin-token': 'test-admin-token' } })).json();
  assert.notEqual(after.products.find((p) => p.id === created.product.id).seoTitle, 'khong duoc ghi');
});
