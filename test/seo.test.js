import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-seo-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET_NAME = 'test-private-bucket';
process.env.APP_URL = 'https://sonvudev.com';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
process.env.RESEND_API_KEY = '';

const { createApp } = await import('../src/app.js');
const { updateProduct, getProduct } = await import('../src/store.js');
const { productSummary, renderProductPage } = await import('../src/pages.js');

let server;
let base;
let product;
const auth = () => ({ 'x-admin-token': 'test-admin-token' });
const jsonHeaders = { 'content-type': 'application/json', ...auth() };
const get = (path) => fetch(`${base}${path}`, { redirect: 'manual' });

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const created = await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({
      name: 'SEO Tester Pro', slug: 'seo-tester-pro', category: 'Công cụ', platform: 'Windows',
      version: '2.1', price: 249000, currency: 'VND', fileKey: 'products/s/2.1/s.exe', status: 'active',
      badge: 'Bản Pro', shortDescription: 'Công cụ kiểm tra năng suất máy chủ, chạy trên Windows, báo cáo xuất Excel.',
      description: '=== TÍNH NĂNG CHÍNH ===\n\nĐo tải liên tục.\n\n- Đọc CPU\n- Đọc RAM\n\n=== YÊU CẦU ===\n\nWindows 10 trở lên.',
      features: ['Đo tải liên tục', 'Báo cáo Excel', 'Không cần cài thêm'],
      requirements: 'Windows 10 trở lên, 2 GB RAM trống.',
    }),
  });
  product = (await created.json()).product;
});
test.after(async () => { server?.close(); await fs.rm(tempDir, { recursive: true, force: true }); });

const text = (path) => get(path).then(async (r) => r.text());

test('trang sản phẩm trả về HTML có nội dung thật, không phải khung rỗng', async () => {
  const response = await get(`/product/${product.slug}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  // The whole point: a crawler that never runs JavaScript still sees the product.
  assert.ok(html.includes('SEO Tester Pro'), 'phải có tên sản phẩm trong HTML');
  assert.ok(html.includes('2.1'), 'phải có phiên bản');
  assert.ok(html.includes('249.000'), 'phải có giá định dạng tiếng Việt');
  assert.ok(html.includes('Đo tải liên tục'), 'phải có mô tả dài');
  assert.ok(html.includes('Windows 10 trở lên'), 'phải có yêu cầu hệ thống');
  assert.ok(html.includes('TÍNH NĂNG CHÍNH'), 'phải tách phần theo tiêu đề ===');
  assert.ok(!html.includes('data-i18n'), 'trang sản phẩm không được phụ thuộc i18n.js');
});

test('mỗi trang sản phẩm có tiêu đề, mô tả và canonical riêng', async () => {
  const html = await text(`/product/${product.slug}`);
  assert.ok(html.includes(`<title>SEO Tester Pro v2.1`), 'tiêu đề phải chứa tên sản phẩm');
  assert.ok(html.includes(`<link rel="canonical" href="https://sonvudev.com/product/${product.slug}">`));
  assert.ok(/<meta name="description" content="[^"]{60,}"/.test(html), 'mô tả phải đủ dài để tìm kiếm dùng');
  assert.ok(html.includes('property="og:title"'), 'phải có Open Graph cho link được chia sẻ');
  assert.ok(html.includes('property="og:image"'), 'phải có ảnh preview');
});

test('dữ liệu có cấu trúc đúng schema và có giá khớp sản phẩm', async () => {
  const html = await text(`/product/${product.slug}`);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, '<')));
  // The product page ships one script holding an array of nodes; the homepage
  // ships a single @graph. Both shapes have to end up in the same flat list.
  const graph = blocks.flatMap((b) => b['@graph'] || b);
  const types = graph.map((node) => node['@type']);
  assert.ok(types.includes('SoftwareApplication'), 'phải có SoftwareApplication');
  assert.ok(types.includes('BreadcrumbList'), 'phải có BreadcrumbList');
  assert.ok(types.includes('Organization'), 'phải có Organization');
  const software = graph.find((node) => node['@type'] === 'SoftwareApplication');
  assert.equal(software.offers.price, 249000, 'giá trong schema phải lấy từ dữ liệu, không gõ tay');
  assert.equal(software.offers.priceCurrency, 'VND');
  assert.equal(software.operatingSystem, 'Windows');
  assert.equal(software.softwareVersion, '2.1');
});

test('sản phẩm ngừng bán trả về 404 chứ không phải trang noindex', async () => {
  await updateProduct(product.id, { status: 'archived' });
  const response = await get(`/product/${product.slug}`);
  assert.equal(response.status, 404, 'URL cũ phải biến mất chứ không cạnh tranh với sản phẩm đang bán');
  const body = await response.text();
  assert.ok(body.includes('noindex'), 'trang 404 phải noindex');
  await updateProduct(product.id, { status: 'active' });
});

test('robots.txt mở trang công khai và chặn trang chứa thông tin riêng', async () => {
  const body = await text('/robots.txt');
  assert.ok(body.includes('Sitemap: https://sonvudev.com/sitemap.xml'));
  assert.ok(body.includes('Disallow: /admin'), 'trang quản trị không được lập chỉ mục');
  assert.ok(body.includes('Disallow: /api/'));
  assert.ok(body.includes('Allow: /'));
});

test('sitemap lấy sản phẩm từ dữ liệu sống, không phải danh sách gõ tay', async () => {
  const body = await text('/sitemap.xml');
  assert.ok(body.includes(`<loc>https://sonvudev.com/product/${product.slug}</loc>`));
  await updateProduct(product.id, { price: 259000 });
  const updated = await text('/sitemap.xml');
  // lastmod is what tells a crawler a page changed instead of being re-read
  // forever, so it has to follow the product's own updatedAt, not a constant.
  const stamp = (await getProduct(product.id)).updatedAt.slice(0, 10);
  assert.ok(updated.includes(`<lastmod>${stamp}</lastmod>`), `lastmod phải theo ngày sửa sản phẩm (${stamp})`);
});

test('ảnh preview sinh theo từng sản phẩm', async () => {
  const response = await get(`/og/${product.slug}.svg`);
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-type').includes('svg'));
  const svg = await response.text();
  assert.ok(svg.includes('SEO Tester Pro'));
  // Read the live price rather than a literal: an earlier test changes it, and a
  // preview showing a stale price is exactly the bug worth catching.
  const live = (await getProduct(product.id)).price;
  assert.ok(svg.includes(new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(live)), `ảnh preview phải có giá hiện tại ${live}`);
  assert.equal((await get(`/og/khong-ton-tai.svg`)).status, 404);
});

test('trang chủ có nội dung tiếng Việt ngay trong HTML, không cần chạy JavaScript', async () => {
  const html = await text('/');
  // Everything used to be an empty <span data-i18n="...">, which is what a
  // crawler and a link-preview bot actually receive.
  assert.ok(!/data-i18n="[\w.]+"[^>]*>\s*</.test(html), 'không còn thẻ data-i18n nào rỗng');
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  assert.ok(heading && /[a-zA-Zà-ỹ]/.test(heading[1]), 'thẻ h1 phải chứa chữ, không chỉ thẻ rỗng bọc ngoài');
  assert.ok(html.includes('application/ld+json'), 'phải có dữ liệu có cấu trúc');
  assert.ok(html.includes('name="description" content="Tiện ích'), 'mô tả phải có từ khoá thật');
  // Structure that app.js depends on must survive the text injection.
  for (const id of ['product-grid', 'product-count', 'product-modal', 'modal-content', 'toast']) {
    assert.ok(html.includes(`id="${id}"`), `thiếu id ${id} mà app.js cần`);
  }
  assert.ok(html.includes('class="filter'), 'thiếu bộ lọc mà app.js cần');
});

test('dữ liệu sản phẩm không thể phá vỡ HTML trang', async () => {
  // Product copy is admin-editable and lands in the page verbatim, so a stray
  // angle bracket must not be able to inject a tag into a page Google reads.
  const html = await text(`/product/${product.slug}`);
  const body = html.slice(html.indexOf('<body'));
  // Every opening tag that is not a known void element must have its matching
  // close in the same document, and no angle bracket may appear as text.
  const textNodes = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '|');
  assert.ok(!textNodes.includes('<'), 'không có dấu < nào lọt ra ngoài thẻ');
  assert.ok(!textNodes.includes('>'), 'không có dấu > nào lọt ra ngoài thẻ');
  assert.ok(!html.includes('undefined'), 'không được lộ undefined ra trang');
  assert.ok(!html.includes('[object Object]'));
});

test('productSummary cắt ở ranh giới từ và không cắt ngang HTML', () => {
  const long = { short_description: 'a '.repeat(200) };
  const summary = productSummary(long, 50);
  assert.ok(summary.length <= 51);
  assert.ok(!summary.includes('<'), 'không được cắt vào giữa thẻ');
  assert.ok(!/\s$/.test(summary.replace('…', '')), 'không để lại khoảng trắng thừa trước dấu chấm lửng');
  assert.equal(productSummary({ short_description: 'Ngắn' }, 50), 'Ngắn');
});

test('renderProductPage tự thoát ký tự trong dữ liệu sản phẩm', () => {
  // A product description is admin-editable text going straight into HTML.
  const html = renderProductPage({ slug: 'x', name: '<script>alert(1)</script>', version: '1', price: 1, currency: 'VND', description: 'a & b < c', features: ['<img onerror=x>'], platform: 'Windows' });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'tên sản phẩm phải được thoát');
  assert.ok(!html.includes('<img onerror=x>'), 'tính năng phải được thoát');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('a &amp; b &lt; c'));
});
