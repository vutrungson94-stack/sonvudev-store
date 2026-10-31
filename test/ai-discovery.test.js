import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';
import { closeTest } from './helpers/teardown.mjs';

// Resolved from the file's own location rather than from process.cwd(). These
// checks read files inside the repository, and an IDE that runs a single test
// file from its own directory would otherwise report ENOENT for every one of
// them — on every operating system, and only on that machine.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Everything that decides whether a crawler, a link-preview bot or an assistant
// can read this site. Each check here corresponds to a way that used to be
// quietly broken rather than loudly broken.
//
// The two that mattered most were invisible. og:image was an SVG, which every
// platform that renders a share refuses, so every link to the shop showed an
// empty box. And the product pages carried their "other products" loader as an
// inline script, which the site's own Content-Security-Policy refused to run, so
// that section stayed on its loading text forever. Neither throws, neither shows
// in the console, and neither would have been caught by testing the functions —
// only by fetching the bytes a crawler fetches.
process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-discovery-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.BANK_NAME = 'Test Bank';
process.env.BANK_ACCOUNT_NAME = 'SonVuDev Test';
process.env.BANK_ACCOUNT_NUMBER = '0123456789';
process.env.BANK_BIN = '970436';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';
process.env.APP_URL = 'http://127.0.0.1:4271';
// Set to something other than the default on purpose. The legal pages used to
// carry the number 24 written into the markup, so a test that left this unset
// would have passed against a hardcoded value rather than against the config.
process.env.ORDER_PAYMENT_WINDOW_HOURS = '9';
process.env.SUPPORT_EMAIL = 'support-ao@shop-vi.example';
// A real key in .env would ping the live IndexNow API from a test run.
process.env.BRAND_SOCIAL_LINKS = '';
process.env.BRAND_FOUNDER_NAME = '';
process.env.BRAND_FOUNDER_URL = '';

const { createApp } = await import('../src/app.js');
let server;
let base;
let product;

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };
  const created = await fetch(`${base}/api/admin/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Discovery Probe',
      category: 'Công cụ',
      platform: 'Windows',
      version: '2.3.1',
      price: 249000,
      currency: 'VND',
      requirements: 'Windows 10 build 19045 trở lên, .NET 8',
      features: ['Chạy không cần cài đặt', 'Có script tháo gỡ'],
      featuresEn: ['Runs without installing', 'Ships with an uninstall script'],
      description: 'Công cụ kiểm tra dung lượng thật của ổ USB. Mô tả dài để dàn trang có nội dung.',
      descriptionEn: 'Checks the real capacity of a USB drive so a fake one cannot pass itself off as 128GB.',
      shortDescription: 'Đo dung lượng thật của ổ USB.',
      shortDescriptionEn: 'Measures the real capacity of a USB drive.',
      fileKey: 'products/discovery/2.3.1/probe.exe',
      status: 'active',
    }),
  });
  assert.equal(created.status, 201);
  product = (await created.json()).product;
});
test.after(async () => { await closeTest(server, tempDir); });

const page = async (url) => {
  const response = await fetch(`${base}${url}`);
  return { response, body: await response.text() };
};
// The block is a bare JSON array of nodes rather than an @graph, so this has to
// flatten one level. Wrapping it in an array again makes every lookup below return
// undefined and the test would pass for the wrong reason if it were not asserting
// on something it can see.
const jsonLd = (body) => [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .flatMap((block) => {
    try {
      const parsed = JSON.parse(block[1].replace(/\\u003c/g, '<'));
      return Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
    } catch { return []; }
  });

// ---------------------------------------------------------------------------
// The share card. The single highest-value change in the whole set.
// ---------------------------------------------------------------------------
test('og:image là ảnh raster thật, đúng kích thước khai báo', async () => {
  const { body } = await page('/');
  const declared = body.match(/<meta property="og:image" content="([^"]*)"/i)?.[1];
  assert.ok(declared, 'trang chủ phải có og:image');
  assert.ok(/\.png$/i.test(declared), `og:image phải là PNG, không phải SVG: ${declared}`);

  // Fetched through the listening address rather than the one in the markup. The
  // markup is built from APP_URL and the test binds an arbitrary port, so the two
  // hosts differ here and only here.
  const path = new URL(declared).pathname;
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /image\/png/i, 'kiểu nội dung phải là ảnh');
  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'file phải thật sự là PNG');
  // Read the size out of the file rather than trusting the header, so a file that
  // is not the card it claims to be still fails.
  assert.equal(buffer.readUInt32BE(16), 1200, 'chiều rộng ảnh');
  assert.equal(buffer.readUInt32BE(20), 630, 'chiều cao ảnh');
  assert.equal(body.match(/<meta property="og:image:width" content="(\d+)"/i)?.[1], '1200');
  assert.equal(body.match(/<meta property="og:image:height" content="(\d+)"/i)?.[1], '630');
  assert.ok(buffer.length > 4000, `ảnh phải có nội dung thật, ${buffer.length} byte là ảnh trống`);
});

test('ảnh share nằm trong bản build, không được sinh lúc chạy', () => {
  assert.ok(existsSync(path.join(root, 'public', 'og.png')), 'public/og.png phải được commit');
  const generator = readFileSync(path.join(root, 'scripts', 'make-og-image.mjs'), 'utf8');
  assert.match(generator, /'og\.png'/, 'script sinh ảnh phải ghi ra đúng file mà server trỏ tới');
});

test('mọi trang index được trỏ tới cùng một ảnh raster', async () => {
  for (const url of ['/', '/terms', '/privacy', '/refund', '/about', `/product/${product.slug}`, `/en/product/${product.slug}`]) {
    const { body } = await page(url);
    const image = body.match(/<meta property="og:image" content="([^"]*)"/i)?.[1];
    assert.ok(image, `${url} phải có og:image`);
    assert.ok(/\.png$/i.test(image), `${url} không được trỏ og:image vào SVG: ${image}`);
  }
});

// ---------------------------------------------------------------------------
// The Content-Security-Policy. Strict, and it blocks what it should block —
// including anything we forgot about.
// ---------------------------------------------------------------------------
test('CSP chặn script inline, và không trang nào còn script inline', async () => {
  const { response, body } = await page('/');
  const csp = response.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src 'self'/, 'CSP phải hạn chế script');
  assert.ok(!/'unsafe-inline'/.test(csp.replace(/style-src[^;]*/, '')), 'script-src không được có unsafe-inline');

  // The check that actually caught the bug: an executable inline script is refused
  // by the browser, so one on a page means that page is missing something.
  const inline = [...body.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/g)];
  for (const match of inline) assert.fail(`trang chủ có script inline, CSP sẽ chặn: ${match[0]}`);

  for (const url of [`/product/${product.slug}`, `/en/product/${product.slug}`, '/terms', '/privacy', '/refund', '/about', '/order', '/lookup', '/paypal-return.html']) {
    const target = await page(url);
    const found = [...target.body.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/g)];
    for (const match of found) assert.fail(`${url} có script inline, CSP sẽ chặn: ${match[0]}`);
  }

  // The 404 body is served by sendFile, not through the page renderer, so it was
  // outside every check that existed and carried its own inline loader.
  const missing = await fetch(`${base}/khong-ton-tai`);
  const notFound = await missing.text();
  assert.equal(missing.status, 404);
  for (const match of notFound.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/g)) {
    assert.fail(`404 có script inline, CSP sẽ chặn: ${match[0]}`);
  }
  assert.match(notFound, /<script src="\/related\.js"/, '404 phải dùng loader ngoài');
});

test('script ngoài phải được phép chạy theo chính CSP đó', async () => {
  const { body } = await page(`/product/${product.slug}`);
  // script-src 'self' with no nonce allows same-origin scripts, so the loader has
  // to be a real file rather than a nonce the template forgot to pass.
  assert.match(body, /<script src="\/related\.js"/, 'trang sản phẩm phải nạp loader ngoài');
  assert.equal((await fetch(`${base}/related.js`)).status, 200, 'loader phải tồn tại');
  const loader = await (await fetch(`${base}/related.js`)).text();
  // Both the product page and the 404 page used to concatenate a product name
  // straight into innerHTML with nothing escaping it. Only the admin can create a
  // product, so it was not a hole an attacker could reach — but it turns one
  // stray ampersand into broken markup, and it would become a hole the moment
  // anyone else could edit the catalogue.
  //
  // The escaping lives in the shared public/format.js; what is asserted here is
  // that the loader really calls it on every interpolated value, and that the
  // shared implementation really escapes.
  assert.match(loader, /SVDFormat\.esc\(/, 'loader phải escape qua bộ dùng chung trước khi chèn vào innerHTML');
  const shared = await (await fetch(`${base}/format.js`)).text();
  assert.match(shared, /replace\(\/\[&<>"'\]\//, 'bộ dùng chung phải escape ký tự HTML');
  assert.ok(!/['"]\s*\+\s*(p|product)\.(name|slug|version|platform)\b/.test(loader), 'không được nối thẳng dữ liệu sản phẩm vào chuỗi HTML');
});

// ---------------------------------------------------------------------------
// Two languages, two URLs, pointing at each other.
// ---------------------------------------------------------------------------
test('trang sản phẩm tiếng Anh dùng bản dịch trong database, không phải bản Việt', async () => {
  const vi = await page(`/product/${product.slug}`);
  const en = await page(`/en/product/${product.slug}`);
  assert.equal(vi.response.status, 200);
  assert.equal(en.response.status, 200);

  assert.match(vi.body, /<html lang="vi">/);
  assert.match(en.body, /<html lang="en">/, 'trang tiếng Anh phải khai báo lang="en"');
  assert.match(en.body, /Runs without installing/, 'phải dùng featuresEn');
  assert.match(en.body, /fake one cannot pass itself off/, 'phải dùng descriptionEn');
  assert.ok(!en.body.includes('Đo dung lượng thật của ổ USB.'), 'không được lẫn mô tả tiếng Việt');

  const canonicalVi = vi.body.match(/<link rel="canonical" href="([^"]*)"/i)?.[1];
  const canonicalEn = en.body.match(/<link rel="canonical" href="([^"]*)"/i)?.[1];
  assert.match(canonicalVi, /\/product\/discovery-probe$/, 'canonical bản Việt ở gốc');
  assert.match(canonicalEn, /\/en\/product\/discovery-probe$/, 'canonical bản Anh dưới /en');
  assert.notEqual(canonicalVi, canonicalEn, 'hai bản phải là hai URL khác nhau');
});

test('hai bản trỏ qua lại bằng hreflang và og:locale:alternate', async () => {
  for (const [url, expected] of [[`/product/${product.slug}`, 'vi_VN'], [`/en/product/${product.slug}`, 'en_US']]) {
    const { body } = await page(url);
    assert.match(body, new RegExp(`<meta property="og:locale" content="${expected}"`), `${url} phải khai og:locale ${expected}`);
    assert.match(body, /<meta property="og:locale:alternate" content="(vi_VN|en_US)">/, `${url} phải khai og:locale:alternate`);
    assert.match(body, /<link rel="alternate" hreflang="vi" href="[^"]+\/product\/discovery-probe">/, `${url} phải trỏ bản vi`);
    assert.match(body, /<link rel="alternate" hreflang="en" href="[^"]+\/en\/product\/discovery-probe">/, `${url} phải trỏ bản en`);
    assert.match(body, /<link rel="alternate" hreflang="x-default"/, `${url} phải có x-default`);
  }
});

test('sitemap liệt kê cả hai bản, nối qua hreflang', async () => {
  const { body } = await page('/sitemap.xml');
  assert.match(body, /<loc>[^<]*\/product\/discovery-probe<\/loc>/);
  assert.match(body, /<loc>[^<]*\/en\/product\/discovery-probe<\/loc>/, 'bản tiếng Anh phải có trong sitemap');
  assert.match(body, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/, 'cần khai xmlns:xhtml để dùng hreflang');
  assert.match(body, /<xhtml:link rel="alternate" hreflang="en"/, 'hai URL phải trỏ qua lại');
});

// ---------------------------------------------------------------------------
// Structured data: what an assistant reads to decide it can quote the page.
// ---------------------------------------------------------------------------
test('schema mô tả đủ để trả lời "chạy được trên máy nào"', async () => {
  const { body } = await page(`/product/${product.slug}`);
  const software = jsonLd(body).find((node) => node['@type'] === 'SoftwareApplication');
  assert.ok(software, 'phải có SoftwareApplication');
  assert.equal(software.operatingSystem, 'Windows');
  assert.equal(software.softwareVersion, '2.3.1');
  assert.equal(software.softwareRequirements, 'Windows 10 build 19045 trở lên, .NET 8');
  assert.equal(software.applicationCategory, 'Công cụ');
  assert.ok(software.downloadUrl, 'phải có downloadUrl');
  assert.ok(software.inLanguage, 'phải khai ngôn ngữ');
  assert.equal(software.offers.price, 249000);
  assert.equal(software.offers.priceCurrency, 'VND');
});

test('trang sản phẩm có FAQPage lấy từ dữ liệu thật', async () => {
  const { body } = await page(`/product/${product.slug}`);
  const faq = jsonLd(body).find((node) => node['@type'] === 'FAQPage');
  assert.ok(faq, 'phải có FAQPage');
  const questions = faq.mainEntity.map((entry) => entry.name);
  assert.ok(questions.length >= 4, 'phải có câu hỏi thực tế');
  // The question about a platform has to name the platform, or it answers nothing.
  const platform = faq.mainEntity.find((entry) => entry.name.includes('nền tảng'));
  assert.match(platform.acceptedAnswer.text, /Windows/, 'câu hỏi về nền tảng phải nói tên nền tảng');
  for (const entry of faq.mainEntity) {
    assert.ok(entry.acceptedAnswer.text.length > 20, 'câu trả lời phải đủ dài để có nghĩa');
  }
});

test('organization có sameAs và founder khi cấu hình, và bỏ trống khi không', async () => {
  const plain = jsonLd((await page('/')).body).find((node) => node['@type'] === 'Organization');
  assert.ok(plain, 'phải có Organization');
  assert.ok(!('sameAs' in plain), 'không có BRAND_SOCIAL_LINKS thì không được bịa sameAs');
  assert.ok(!('founder' in plain), 'không có BRAND_FOUNDER_NAME thì không được bịa founder');
  // Compared against APP_URL, not the listening port: the markup is built from
  // configuration, so that is what it has to agree with.
  // Organization.logo is the image Google renders in a knowledge panel, and Google
// asks for at least 112x112. It pointed at /favicon.svg, a 64x64 SVG built for a
// browser tab — present in the markup, unusable in practice. It now points at the
// source mark at full size, and the assertion below reads that path out of the
// response and checks the file is really there, so naming a logo that does not exist
// cannot pass again.
assert.ok(
  existsSync(new URL(`../public${new URL(plain.logo).pathname}`, import.meta.url)),
  `logo trong structured data trỏ tới file không tồn tại: ${plain.logo}`,
);
assert.ok(Number(new URL(plain.logo).pathname.match(/logo-(\d+)\.png/)?.[1]) >= 112,
  `logo phải rộng ít nhất 112px cho knowledge panel, đang là ${plain.logo}`);
});

// The homepage carried a second hand-written copy of the Organization and WebSite
// nodes that a product page builds, and the copies had drifted: the product pages
// read the brand, sameAs and founder from configuration, the homepage had them
// typed in. A crawler was being told two different things about who the shop is,
// and the homepage's answer was the one missing the profile links.
test('trang chủ và trang sản phẩm mô tả cửa hàng giống hệt nhau', async () => {
  const home = jsonLd((await page('/')).body);
  const detail = jsonLd((await page(`/product/${product.slug}`)).body);
  const org = (nodes) => JSON.stringify(nodes.find((node) => node['@type'] === 'Organization'));
  assert.equal(org(home), org(detail), 'Organization phải là một khối duy nhất, không phải hai bản ghi tay');
  const site = (nodes) => JSON.stringify(nodes.find((node) => node['@type'] === 'WebSite'));
  assert.equal(site(home), site(detail));

  // And the homepage must not reintroduce a hand-written copy later.
  const source = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  assert.ok(source.includes('{{jsonLd}}'), 'index.html phải để server điền dữ liệu có cấu trúc');
  assert.ok(!(await page('/')).body.includes('{{jsonLd}}'), 'placeholder phải được thay thế');
});

// ---------------------------------------------------------------------------
// The two machine-readable entry points.
// ---------------------------------------------------------------------------
test('/llms.txt là chữ thuần, nêu tên và liệt kê sản phẩm', async () => {
  const response = await fetch(`${base}/llms.txt`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/plain/);
  const text = await response.text();
  assert.ok(text.startsWith('# '), 'phải bắt đầu bằng tiêu đề markdown');
  assert.match(text, /Discovery Probe/, 'phải nêu sản phẩm đang bán');
  assert.match(text, /249\.000|VND/, 'phải nêu giá');
  assert.match(text, /Windows/, 'phải nêu nền tảng');
  assert.match(text, /support-ao@shop-vi\.example/, 'phải nêu địa chỉ liên hệ lấy từ SUPPORT_EMAIL');
  assert.match(text, /\/feed\.json/, 'phải trỏ tới feed');
});

test('/feed.json là JSON đúng và lấy từ danh mục sống', async () => {
  const response = await fetch(`${base}/feed.json`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  const feed = JSON.parse(await response.text());
  assert.equal(feed['@type'], 'ItemList');
  assert.equal(feed.numberOfItems, 1);
  const item = feed.itemListElement[0].item;
  assert.equal(item.name, 'Discovery Probe');
  assert.equal(item.operatingSystem, 'Windows');
  assert.equal(item.softwareVersion, '2.3.1');
  assert.equal(item.offers.price, 249000);
  assert.ok(item.offers.priceCurrency);
  assert.match(item.url, /\/product\/discovery-probe$/);
});

test('/llms.txt và /feed.json trả đúng cả khi cache còn nóng', async () => {
  // Cache HIT từng trả nguyên object bao {at, value}: request đầu (miss) đúng,
  // request hai trong 60s nhận JSON bọc khiến /llms.txt thành {"at":...} và
  // /feed.json thành 2 lớp. Các test trên chỉ gọi mỗi route một lần nên không thấy.
  const firstLlms = await (await fetch(`${base}/llms.txt`)).text();
  const secondLlms = await (await fetch(`${base}/llms.txt`)).text();
  assert.ok(secondLlms.startsWith('# '), `lần hai phải vẫn là markdown, thực tế: ${secondLlms.slice(0, 60)}`);
  assert.equal(secondLlms, firstLlms, 'nội dung cache phải giống lần đầu');
  const firstFeed = JSON.parse(await (await fetch(`${base}/feed.json`)).text());
  const secondFeed = JSON.parse(await (await fetch(`${base}/feed.json`)).text());
  assert.equal(secondFeed['@type'], 'ItemList', 'lần hai phải vẫn là ItemList, không phải lớp bọc cache');
  assert.deepEqual(secondFeed, firstFeed, 'feed cache phải giống lần đầu');
});

test('/llms.txt và /feed.json không báo sản phẩm đã ngừng bán', async () => {
  const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };
  await fetch(`${base}/api/admin/products/${product.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fileKey: '', status: 'draft' }),
  });
  const feed = await (await fetch(`${base}/feed.json`)).text();
  const llms = await (await fetch(`${base}/llms.txt`)).text();
  assert.ok(!feed.includes('Discovery Probe'), 'feed vẫn liệt kê sản phẩm đã gỡ');
  assert.ok(!llms.includes('Discovery Probe'), 'llms.txt vẫn liệt kê sản phẩm đã gỡ');
  const page404 = await fetch(`${base}/product/discovery-probe`, { redirect: 'manual' });
  assert.equal(page404.status, 404, 'trang sản phẩm phải trả 404');
});

test('/merchant-feed.tsv là TSV hợp lệ và có đủ trường GMC', async () => {
  const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };
  const created = await fetch(`${base}/api/admin/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Merchant Feed Probe',
      category: 'Công cụ',
      platform: 'Windows',
      version: '1.0.0',
      price: 99000,
      currency: 'VND',
      fileKey: 'products/merchant-feed/1.0.0/probe.exe',
      status: 'active',
    }),
  });
  assert.equal(created.status, 201);
  const text = await (await fetch(`${base}/merchant-feed.tsv`)).text();
  const lines = text.split('\n').filter((l) => l.trim());
  assert.ok(lines[0].startsWith('id\ttitle\tdescription\tlink\timage_link\tprice\tavailability\tcondition\tbrand\tmpn\tproduct_type\tshipping'));
  assert.ok(lines.length >= 2, 'phải có ít nhất 1 sản phẩm');
  const cols = lines[1].split('\t');
  assert.equal(cols.length, 12);
  assert.match(cols[5], /\d+\.\d+\s+USD/);
  assert.equal(cols[6], 'in stock');
  assert.equal(cols[7], 'new');
  assert.ok(cols[11].length > 0, 'shipping phải có giá trị');
});

// ---------------------------------------------------------------------------
// robots.txt states the crawler decision instead of leaving it implied.
// ---------------------------------------------------------------------------
test('robots.txt nói rõ quyết định với các trình thu thập AI', async () => {
  const text = await (await fetch(`${base}/robots.txt`)).text();
  for (const agent of ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'anthropic-ai', 'PerplexityBot', 'Google-Extended']) {
    assert.match(text, new RegExp(`User-agent:\\s*${agent.replace(/[.-]/g, '\\$&')}`), `thiếu ${agent}`);
  }
  // Named and allowed on purpose, so the block is written down and an opt-out is
  // one copy-paste away rather than a guess.
  const gpt = text.split('User-agent: GPTBot')[1]?.split('User-agent:')[0] || '';
  assert.match(gpt, /Allow:\s*\//, 'GPTBot được phép đọc trang chủ');
  for (const rule of ['/admin', '/api/', '/order/', '/lookup', '/paypal-return']) {
    assert.match(text, new RegExp(`Disallow:\\s*${rule.replace(/\//g, '\\/')}`), `phải chặn ${rule}`);
  }
  assert.match(text, /Sitemap:\s*http:\/\/127\.0\.0\.1:4271\/sitemap\.xml/);
});

// ---------------------------------------------------------------------------
// About page: a named shop, which is what a model will cite.
// ---------------------------------------------------------------------------
test('trang about tồn tại, index được, và nói ai làm ra', async () => {
  const { response, body } = await page('/about');
  assert.equal(response.status, 200);
  assert.match(body, /<meta name="description" content="[^"]{80,}/, 'cần mô tả đủ dài');
  assert.ok(!/noindex/.test(body), 'trang about phải được index');
  assert.match(body, /mailto:support-ao@shop-vi\.example/, 'phải lấy địa chỉ từ SUPPORT_EMAIL');
  assert.match((await page('/')).body, /href="\/about"/, 'phải có link từ trang chủ');
  assert.match((await page('/sitemap.xml')).body, /<loc>[^<]*\/about<\/loc>/, 'phải có trong sitemap');
});

// ---------------------------------------------------------------------------
// Content that was hardcoded and would lie.
// ---------------------------------------------------------------------------
test('thời gian thanh toán trong điều khoản lấy từ biến môi trường', async () => {
  for (const url of ['/terms', '/refund']) {
    const { body } = await page(url);
    // The payment window is a configured rule, so the legal pages must quote the
    // configured value. They used to carry the number 24 written in, which meant
    // changing ORDER_PAYMENT_WINDOW_HOURS made the terms promise something the
    // server did not do. Each page words it differently, so this asserts on the
    // sentence about the window rather than on the whole page.
    // Stripped of markup first: the sentence wraps the number in <strong>, so a
    // pattern that skips over tags cannot see that "bị hủy" and "9 giờ" belong to
    // the same claim — which is the whole point being checked.
    const prose = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const windowSentence = prose.split(/(?<=\.)\s+/).find((sentence) => /\b9\b/.test(sentence) && /giờ/.test(sentence));
    assert.ok(windowSentence, `${url} phải nói thời gian thanh toán lấy từ cấu hình (ORDER_PAYMENT_WINDOW_HOURS=9)`);
    assert.ok(/hủy/.test(windowSentence), `${url} phải nói rõ đơn bị hủy sau bao lâu, không phải chỉ nhắc một con số: ${windowSentence.slice(0, 120)}`);
    for (const token of ['{{paymentWindowHours}}', '{{year}}', '{{support}}', '{{site}}']) {
      assert.ok(!body.includes(token), `${url} còn sót token chưa thay: ${token}`);
    }
    // The window itself may never appear as the old literal. Other uses of "24
    // giờ" are deliberately literal — a support-response commitment is a policy
    // statement that changes when the policy changes, the same way the "updated
    // on" date does — so this checks the sentence, not the number's absence
    // everywhere in the document.
    assert.ok(!/sau (?:<strong>)?24 giờ/.test(body), `${url} vẫn ghi cứng 24 giờ cho thời gian thanh toán`);
  }
});

test('năm bản quyền đọc từ đồng hồ, không phải viết cứng', async () => {
  const year = String(new Date().getFullYear());
  for (const url of ['/', '/terms', '/privacy', '/refund', '/about', '/404-not-found']) {
    const { body } = await page(url);
    assert.ok(!/©\s*20\d{2}\s*SonVuDev\.com\b(?!.*\{\{year\}\})/.test(body) || body.includes(`© ${year}`), `${url} còn năm ghi cứng`);
  }
});

// The legal entity has to be one value across the pages, and it has to be filled in
// rather than printed as a token. BRAND_LEGAL_ENTITY was added to config and to
// .env.example with a promise that it appears on the legal pages, and then nothing
// used it: setting it changed nothing at all.
//
// It then got a second failure: three pages carried `<p class="legal-entity">{{legalEntity}}</p>`
// unconditionally, and the variable is unset by default — so a buyer on /terms saw an
// empty paragraph on the one page whose job is to say who is responsible for the sale.
// The token is now the whole element, so "unset" means the element is not rendered at
// all rather than rendered empty.
test('pháp nhân hiển thị trên trang pháp lý, và biến trống thì không in gì', async () => {
  // The token registry lives in src/pages.js now (one list for the renderer, the
  // audit and the byte-level tests); what is asserted here is that the legal
  // entity is in it and that renderPage goes through the shared filler.
  const { PAGE_TOKENS } = await import('../src/pages.js');
  assert.ok(PAGE_TOKENS.includes('legalEntityLine'), 'registry token phải có pháp nhân');
  assert.ok(!PAGE_TOKENS.includes('legalEntity'),
    'token legalEntity (chỉ phần chữ) không được giữ: không template nào dùng nó nữa, và giữ lại là một token mồ côi in ra chỗ trống');
  const source = await fs.readFile(path.join(root, 'src', 'app.js'), 'utf8');
  assert.ok(/fillPageTokens\s*\(/.test(source), 'renderPage phải điền token qua bộ dùng chung');
  for (const file of ['terms.html', 'privacy.html', 'refund.html']) {
    const html = await fs.readFile(path.join(root, 'public', file), 'utf8');
    assert.ok(html.includes('{{legalEntityLine}}'), `public/${file} phải có chỗ hiện pháp nhân`);
    assert.ok(!html.includes('<p class="legal-entity">{{'), `public/${file} không được in thẻ <p> rỗng khi biến trống`);
  }
  // This run sets nothing, so the token has to come out as nothing rather than as
  // the literal text or a dangling label.
  for (const url of ['/terms', '/privacy', '/refund']) {
    const { body } = await page(url);
    assert.ok(!body.includes('{{legalEntity}}'), `${url} còn sót token pháp nhân`);
  }
});
