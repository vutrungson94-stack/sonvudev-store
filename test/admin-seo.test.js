import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('trang quan tri co o nhap SEO title va mo ta', async () => {
  const html = await readPublic('admin.html');
  // Without these two inputs the only way to set the fields was to edit the
  // database by hand, which is why the two live products had copy and a new
  // one could not.
  assert.match(html, /name="seoTitle"/, 'thieu o SEO title');
  assert.match(html, /name="seoDescription"/, 'thieu o mo ta');
  assert.match(html, /maxlength="70"/, 'tieu de phai gioi han 70 ky tu');
  assert.match(html, /maxlength="175"/, 'mo ta phai gioi han 175 ky tu');
});

test('trang quan tri mo duoc san pham de sua SEO, khong phai chi them moi', async () => {
  const source = await readPublic('admin.js');
  assert.match(source, /data-seo-form=/, 'thieu form sua SEO tren tung san pham');
  assert.match(source, /seoEditor/, 'thieu ham seoEditor');
  assert.match(source, /method:'PATCH'.*seoTitle/s, 'phai luu bang PATCH de khong ghi de truong khac');
  // A create-only form cannot fix a product that is already published, and the
  // title is the thing most worth revisiting after seeing real search queries.
  assert.match(source, /data-seo-toggle/, 'thieu nut mo form sua SEO');
});

test('form sua SEO do loi bao khi vuot gioi han search result cat', async () => {
  const source = await readPublic('admin.js');
  // Google cuts a title around 60 characters and a description around 160. A
  // field that silently accepts 175 characters teaches the owner to write copy
  // that half of which nobody ever reads.
  assert.match(source, /\['Tiêu đề',form\.elements\.seoTitle,70,60\]/, 'thieu nguong canh bao cho tieu de');
  assert.match(source, /\['Mô tả',form\.elements\.seoDescription,175,160\]/, 'thieu nguong canh bao cho mo ta');
  assert.match(source, /bị cắt/, 'phai hien thi canh bao bi cat');
});

test('co duong dan CSS cho form sua SEO', async () => {
  const css = await readPublic('styles.css');
  assert.match(css, /\.admin-seo-form\{[^}]*grid-column:1\/-1/, 'form phai tran het chieu rong hang');
  assert.match(css, /@media \(max-width:700px\)\{\.admin-seo-form\{grid-template-columns:1fr\}\}/, 'phai xep doc tren dien thoai');
  assert.ok(existsSync(path.join(root, 'public', 'styles.css')));
});

test('tao san pham co giu nguyen SEO title va mo ta', async () => {
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

test('sua SEO khong duoc xoa mo ta va tinh nang', async () => {
  const created = await create({
    name: 'Keep My Text', slug: 'keep-my-text', price: 99000, currency: 'VND', status: 'active', fileKey: 'products/keep/1.0.0/k.exe',
    description: 'Mo ta dai ma khong duoc mat khi sua SEO', features: ['Tinh nang A', 'Tinh nang B'],
  });
  // The editor sends only the two SEO keys. A merge that treated them as a
  // whole-product replacement would blank the copy on every save.
  const updated = await patch(created.product.id, { seoTitle: 'Tieu de moi', seoDescription: 'Mo ta moi' });
  assert.equal(updated.product.description, 'Mo ta dai ma khong duoc mat khi sua SEO', 'mo ta phai con nguyen');
  assert.deepEqual(updated.product.features, ['Tinh nang A', 'Tinh nang B'], 'tinh nang phai con nguyen');
  assert.equal(updated.product.name, 'Keep My Text', 'ten phai con nguyen');
  assert.equal(updated.product.seoTitle, 'Tieu de moi');
});

test('muc do dai SEO bi cat o tang may chu, khong dua vao database', async () => {
  const created = await create({ name: 'Cap Test', slug: 'cap-test', price: 99000, currency: 'VND', status: 'active', fileKey: 'products/cap/1.0.0/c.exe' });
  const updated = await patch(created.product.id, { seoTitle: 'A'.repeat(200), seoDescription: 'B'.repeat(400) });
  assert.equal(updated.product.seoTitle.length, 70, 'tieu de phai cat con 70 ky tu');
  assert.equal(updated.product.seoDescription.length, 175, 'mo ta phai cat con 175 ky tu');
});

test('sua san pham khong ton tai tra 404 chu khong phai loi 500', async () => {
  const response = await fetch(`${base}/api/admin/products/does-not-exist`, json({ seoTitle: 'x' }, 'PATCH'));
  assert.equal(response.status, 404);
});

test('sua SEO khong duoc bo qua khi thieu token', async () => {
  const created = await create({ name: 'Locked', slug: 'locked', price: 99000, currency: 'VND', status: 'active', fileKey: 'products/lock/1.0.0/l.exe' });
  const response = await fetch(`${base}/api/admin/products/${encodeURIComponent(created.product.id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seoTitle: 'khong duoc ghi' }),
  });
  assert.notEqual(response.status, 200, 'phai tu choi');
  const after = await (await fetch(`${base}/api/admin/products`, { headers: { 'x-admin-token': 'test-admin-token' } })).json();
  assert.notEqual(after.products.find((p) => p.id === created.product.id).seoTitle, 'khong duoc ghi');
});
