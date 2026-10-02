import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
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
// Empty, not deleted: .env is loaded without overriding what is already set, so
// a real INDEXNOW_KEY on the developer's machine would otherwise make this file
// believe IndexNow is on. See test/indexnow-off.test.js.
process.env.INDEXNOW_KEY = '';

const { createApp } = await import('../src/app.js');
const { updateProduct, getProduct, listProducts, isSellable } = await import('../src/store.js');
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
// Source-level assertions: some of these rules are about a value that must not
// be written down twice, and the only place that can happen is the text itself.
const fsSync = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

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

test('sản phẩm không bán được không được lập chỉ mục', async () => {
  // The seed rows that never got a file attached are active in the database but
  // hidden from the storefront. Listing them in the sitemap would hand Google
  // three URLs that lead nowhere.
  const ghost = await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ name: 'Ghost Product', slug: 'ghost-product', price: 100, currency: 'VND', status: 'active' }),
  });
  const created = (await ghost.json()).product;
  const body = await text('/sitemap.xml');
  assert.ok(!body.includes('ghost-product'), 'sản phẩm chưa có file không được vào sitemap');
  assert.equal((await get('/product/ghost-product')).status, 404, 'và cũng không được mở trang');
  await updateProduct(created.id, { status: 'archived' });
});

test('chỉ có một route robots.txt, và nó là bản đầy đủ', async () => {
  const source = await fs.readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  // Two routes on the same path: Express answers with the first one registered,
  // so a second, better one silently does nothing.
  assert.equal((source.match(/app\.get\("\/robots\.txt"/g) || []).length, 1, 'chỉ được đăng ký một route robots.txt');
  const body = await text('/robots.txt');
  assert.ok(body.includes('Disallow: /order/'), 'phải chặn trang đơn hàng');
  assert.ok(body.includes('Disallow: /lookup'));
  assert.ok(!body.includes('/admin.html'), 'bản cũ đã bị thay');
});

test('tiêu đề trang lấy theo từ khoá khi sản phẩm có, không thì tự suy ra', async () => {
  // A page titled after the product name can only be found by people who
  // already know the product. The owner can override it with the phrase people
  // actually type.
  await updateProduct(product.id, { seoTitle: 'Bật macro Excel — thêm thư mục tin cậy | SonVuDev', seoDescription: 'Excel bị chặn macro khi mở file .xlsm? Script tự thêm thư mục bạn chọn vào Trusted Locations.' });
  const html = await text(`/product/${product.slug}`);
  assert.ok(html.includes('<title>Bật macro Excel'), 'phải dùng seo_title');
  const graph = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { const p = JSON.parse(m[1].replace(/\\u003c/g, '<')); return p['@graph'] || p; });
  const software = graph.find((n) => n['@type'] === 'SoftwareApplication');
  assert.equal(software.alternateName, 'Bật macro Excel — thêm thư mục tin cậy | SonVuDev');
  await updateProduct(product.id, { seoTitle: '', seoDescription: '' });
  const fallback = await text(`/product/${product.slug}`);
  assert.ok(fallback.includes(`<title>SEO Tester Pro v2.1`), 'không có seo_title thì tự suy ra từ tên sản phẩm');
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
  const description = html.match(/name="description" content="([^"]+)"/)?.[1] || '';
  assert.ok(description.length > 70 && description.length < 175, `mô tả phải đủ dài mà không bị cắt (${description.length} ký tự)`);
  // The copy has to name what the products do, not what the shop is.
  assert.ok(/macro Excel/.test(description) && /USB/.test(description), 'mô tả phải chứa từ khoá người ta gõ');
  assert.ok(!/Kho phần mềm và tiện ích/.test(description), 'câu chung chung cũ không tìm được ai');
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

// ---------------------------------------------------------------------------
// Everything below guards the Search Console step: a site that is perfect on
// disk is still invisible if it never proved it owns the domain, if its
// canonical names the wrong host, or if the landing page advertises nothing.
// ---------------------------------------------------------------------------

test('trang chủ liệt kê sản phẩm ngay trong HTML, không cần chạy JavaScript', async () => {
  const html = await text('/');
  // The grid used to hold three grey placeholders and nothing else, so the page
  // a visitor lands on told a crawler nothing about what is for sale, and linked
  // to no product at all. Internal links are how the rest of a site is found.
  assert.ok(!html.includes('loading-card'), 'khung tải rỗng không được tới máy crawler');
  assert.ok(html.includes(`href="https://sonvudev.com/product/${product.slug}"`), 'phải có link tuyệt đối tới trang sản phẩm');
  assert.ok(html.includes('SEO Tester Pro'), 'phải có tên sản phẩm trong HTML trang chủ');
  const live = (await getProduct(product.id)).price;
  assert.ok(html.includes(new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(live)), `giá trên trang chủ phải là giá hiện tại (${live})`);
  assert.ok(/id="product-count">\s*\d\d\s*sản phẩm/.test(html), 'phải có bộ đếm sản phẩm bằng chữ');
});

test('trang chủ không để lại token chưa thay thế', async () => {
  const html = await text('/');
  assert.ok(!html.includes('{{site}}'), 'mọi URL tuyệt đối phải điền từ APP_URL');
  // A canonical left as a token is ignored by a search engine, and a canonical
  // naming another host tells Google to index the other host's page instead.
  assert.ok(html.includes('<link rel="canonical" href="https://sonvudev.com/">'), 'canonical phải theo APP_URL');
  for (const page of ['/terms', '/privacy', '/refund']) {
    const legal = await text(page);
    assert.ok(!legal.includes('{{site}}'), `${page} còn token chưa thay`);
    assert.ok(legal.includes(`<link rel="canonical" href="https://sonvudev.com${page}">`), `${page} canonical phải theo APP_URL`);
  }
});

test('sản phẩm mồ côi không lọt vào trang chủ', async () => {
  const created = (await (await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ name: 'Draft Only', slug: 'draft-only', price: 100, currency: 'VND', status: 'draft' }),
  })).json()).product;
  const html = await text('/');
  assert.ok(!html.includes('draft-only'), 'bản nháp không được hiện trên trang chủ');
  assert.ok(!html.includes(created.id), 'bản nháp không được có trong HTML');
});

test('thẻ xác minh Search Console lấy từ cấu hình, không gõ trong HTML', async () => {
  const html = await text('/');
  // GOOGLE_SITE_VERIFICATION is deliberately not set in this run: the tags must
  // simply be absent, and the page must still be complete without them.
  assert.ok(!html.includes('google-site-verification'), 'chưa cấu hình thì không được thêm thẻ');
  assert.equal((await get('/google0123456789abcdef.html')).status, 404, 'token lạ không được phục vụ');
  assert.equal((await get('/ms0123456789abcdef.txt')).status, 404, 'token Bing lạ không được phục vụ');
});

test('số liệu trên trang chủ được đếm từ catalogue, không gõ tay', async () => {
  // These three read 01+, 4.9/5 and 100%, and none of them was ever a measurement:
  // there is no rating in this shop and nothing behind the third figure. On the
  // page whose argument is that the software is made carefully, invented numbers
  // are the cheapest thing to fix and the most expensive to leave.
  //
  // The test runs against the real catalogue, so it checks that the numbers on the
  // page are the numbers in the data — which is the only property that survives the
  // next product being added.
  const html = await text('/');
  const sellable = (await listProducts()).filter(isSellable);
  if (!sellable.length) {
    // Nothing to count: the strip is removed rather than showing zeros, because a
    // shop saying "0 products" is still making a claim about itself.
    assert.ok(!html.includes('id="stats"'), 'không có sản phẩm thì bỏ hẳn dải số liệu');
    return;
  }
  const platforms = new Set(sellable.map((p) => String(p.platform || '').trim()).filter(Boolean));
  assert.match(html, new RegExp(`id="stat-products">${sellable.length}<`), 'số sản phẩm phải bằng số sản phẩm đang bán');
  assert.match(html, new RegExp(`id="stat-platforms">${platforms.size}<`), 'số nền tảng phải đếm từ dữ liệu');
  // Narrowed to the strip itself: a product description is free to contain the
  // number 4.9, and a check over the whole page would fail on that for ever.
  const stats = html.match(/<section class="stats[^"]*"[^>]*>[\s\S]*?<\/section>/);
  assert.ok(stats, 'phải có dải số liệu');
  assert.ok(!/4\.9/.test(stats[0]) && !/100\s*<span>\s*%/.test(stats[0]), 'không được trình số liệu không đo được');
  // And the numbers are not in the template, where the next edit would leave them
  // stale.
  const template = fsSync('public/index.html');
  assert.ok(!/stat-products">\s*\d/.test(template), 'số liệu không được gõ trong template');
});

test('danh mục lọc được sinh từ dữ liệu, không phải danh sách gõ tay', async () => {
  // The row held three literals — two categories and a platform — beside a grid
  // that was loaded live. Nothing connected them: publish a product in a fourth
  // category and it appears with no button that reaches it, while the three
  // buttons sit there offering a subset nobody chose. One was not even a category.
  const html = await text('/');
  const sellable = (await listProducts()).filter(isSellable);
  const categories = new Set(sellable.map((p) => String(p.category || '').trim()).filter(Boolean));
  const buttons = [...html.matchAll(/class="filter[^"]*"\s+data-filter="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(buttons.includes('all'), 'luôn có nút "tất cả"');
  // The direction that matters: every category with products has a button, or the
  // buyer cannot filter to something they can see.
  for (const category of categories) assert.ok(buttons.includes(category), `thiếu nút lọc cho danh mục "${category}"`);
  // Not the other direction. Rendered pages are cached for a minute on purpose, so
  // a category emptied a moment ago can keep its button until the cache turns over.
  // That is the trade the TTL buys — a stale button that filters to nothing is a
  // far smaller problem than a product with no way to reach it, and asserting
  // against it would only make the test flaky.
  // And no literal category list is left in the template to drift again.
  assert.ok(!/data-filter="(Công cụ|Bundle|Windows)"/.test(fsSync('public/index.html')), 'danh sách danh mục không được gõ trong template');
});

test('mọi trang lập chỉ mục đều chứa dữ liệu có cấu trúc và logo tồn tại', async () => {
  assert.ok(existsSync(new URL('../public/favicon.svg', import.meta.url)), 'file logo phải tồn tại thật');
  const html = await text(`/product/${product.slug}`);
  const graph = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => JSON.parse(m[1].replace(/\\u003c/g, '<')));
  const organization = graph.find((node) => node['@type'] === 'Organization');
  assert.equal(organization.logo, 'https://sonvudev.com/favicon.svg', 'logo phải trỏ tới file có thật');
  // Google removed the sitelinks search box in November 2024, and the only page
  // that took a query string here was /lookup, which robots.txt disallows.
  const website = graph.find((node) => node['@type'] === 'WebSite');
  assert.equal(website.potentialAction, undefined, 'không còn SearchAction đã bị Google bỏ');
  assert.ok(!JSON.stringify(graph).includes('/lookup?q='), 'schema không được trỏ tới trang bị chặn');
});

test('một quy tắc duy nhất quyết định "bán được", dùng ở mọi nơi', () => {
  const source = fsSync('src/app.js');
  // The rule used to be written out four times and the copies did not agree, so
  // the sitemap listed pages the storefront refused to show.
  const inline = (source.match(/product\.status === "active"/g) || []).length;
  assert.equal(inline, 0, `không được tự viết lại điều kiện bán được (còn ${inline} bản), hãy dùng isSellable`);
  assert.ok(!/product\.status === 'active'/.test(fsSync('src/pages.js')), 'src/pages.js cũng phải dùng isSellable');
});

test('đổi giờ hạn đơn thì email báo đúng giờ đó', () => {
  // The templates said "24 hours" while the server cancelled on whatever
  // ORDER_PAYMENT_WINDOW_HOURS said, so a buyer could be told to wait for an
  // order that was already gone.
  const source = fsSync('src/notify.js');
  const template = source.slice(source.indexOf('const TEMPLATES'), source.indexOf('function body'));
  assert.ok(!/sau 24 giờ|within 24 hours/.test(template), 'email không được gõ cứng 24 giờ');
  assert.ok(template.includes('c.windowHours'), 'phải đọc số giờ từ cấu hình');
  // One resolved number, read from config, rather than three modules each
  // re-deriving a fallback. The window the email promises has to be the window the
  // sweep enforces, and re-deriving it in each place is how the two drift.
  assert.ok(source.includes('windowHours: env.orders.paymentWindowHours'), 'context phải lấy thẳng từ env.orders');
  assert.ok(!/Math\.max\(1, Number\(env\.orders\.paymentWindowHours\)/.test(source), 'không cần chốt lại giá trị config đã chốt sẵn');
});

test('redirect www lấy từ APP_URL chứ không gõ tên miền', () => {
  const source = fsSync('src/app.js');
  assert.ok(!source.includes('www.sonvudev.com'), 'tên miền không được gõ thẳng vào code');
  assert.ok(source.includes('canonicalOrigin') && source.includes('wwwHost'), 'redirect phải suy ra từ APP_URL');
});

test('trang quản trị báo đến cảnh báo khi publish sản phẩm', async () => {
  const before = Date.now();
  await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ name: 'Ping Me', slug: 'ping-me', price: 50000, currency: 'VND', fileKey: 'products/ping/1.0.0/p.exe', status: 'active' }),
  });
  // No INDEXNOW key in this run, so the call must be a silent no-op rather than
  // an outbound request or a failed product save.
  assert.ok(Date.now() - before < 5000, 'lưu sản phẩm không được chờ mạng');
  const health = await (await get('/api/health')).json();
  assert.equal(health.search.indexNow, false, 'chưa cấu hình thì phải báo false');
  assert.equal(typeof health.search.google, 'boolean');
});
