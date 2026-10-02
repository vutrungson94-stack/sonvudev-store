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
test.after(async () => { server?.close(); await fs.rm(tempDir, { recursive: true, force: true }); });

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
  assert.match(source, /\['Tiêu đề',form\.elements\.seoTitle,70,60\]/, 'thieu nguong canh bao cho tieu de');
  assert.match(source, /\['Mô tả',form\.elements\.seoDescription,175,160\]/, 'thieu nguong canh bao cho mo ta');
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
