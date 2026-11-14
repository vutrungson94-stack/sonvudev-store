import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers/env.mjs';
import { createDom, runScript } from './helpers/dom.mjs';

process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-blog-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET_NAME = 'test-private-bucket';
process.env.APP_URL = 'https://blog-fixture.example';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';
// Blog content ships in src/blog-posts (not data/), so the fixture points the
// loader at a temp dir to seed a controlled single post. Without this the test
// would read the real 8 posts and its "exactly 1 post" assertions would fail.
process.env.BLOG_POSTS_DIR = path.join(tempDir, 'blog-posts');

const { createApp } = await import('../src/app.js');
const { loadBlogPosts, getBlogPostBySlug, renderBlogPost, renderBlogIndex, renderBlogFeed } = await import('../src/blog.js');
const { absolute } = await import('../src/pages.js');

let server;
let base;
const get = (p) => fetch(`${base}${p}`, { redirect: 'manual' });
const text = async (p) => (await get(p)).text();
const json = async (p) => (await get(p)).json();

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  // Seed one blog post directly into the temp blog-posts dir used by the app
  const blogDir = path.join(tempDir, 'blog-posts');
  await fs.mkdir(blogDir, { recursive: true });
  await fs.writeFile(path.join(blogDir, 'kiem-tra-dung-luong-usb.json'), JSON.stringify({
    slug: 'kiem-tra-dung-luong-usb',
    titleVi: 'Cách kiểm tra dung lượng thật của USB',
    titleEn: 'How to check real USB capacity',
    descriptionVi: 'Hướng dẫn kiểm tra dung lượng thật USB.',
    descriptionEn: 'Guide to checking real USB capacity.',
    contentVi: '<p>Nội dung tiếng Việt.</p>',
    contentEn: '<p>English content.</p>',
    published: '2025-01-15T00:00:00.000Z',
    modified: '2025-01-15T00:00:00.000Z',
    section: 'Hướng dẫn',
    sectionEn: 'Guides',
    tags: ['USB', 'kiểm tra'],
    relatedProductSlug: 'spark-capacity-tester-pro',
  }));
});

test.after(async () => {
  server.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('blog index trả về 200 và có danh sách bài viết', async () => {
  const res = await get('/blog');
  assert.equal(res.status, 200);
  const html = await text('/blog');
  assert.ok(html.includes('Cách kiểm tra dung lượng thật của USB'), 'phải có tiêu đề bài viết');
  assert.ok(html.includes('/blog/kiem-tra-dung-luong-usb'), 'phải có link đến bài viết');
});

test('blog index tiếng Anh trả về 200', async () => {
  const res = await get('/en/blog');
  assert.equal(res.status, 200);
  const html = await text('/en/blog');
  assert.ok(html.includes('How to check real USB capacity'), 'phải có tiêu đề tiếng Anh');
});

test('bài viết blog trả về 200 với đúng nội dung', async () => {
  const res = await get('/blog/kiem-tra-dung-luong-usb');
  assert.equal(res.status, 200);
  const html = await text('/blog/kiem-tra-dung-luong-usb');
  assert.ok(html.includes('Cách kiểm tra dung lượng thật của USB'), 'tiêu đề phải có trong HTML');
  assert.ok(html.includes('Nội dung tiếng Việt'), 'nội dung phải có trong HTML');
  assert.ok(html.includes('<link rel="canonical"'), 'phải có canonical');
  assert.ok(html.includes('hreflang'), 'phải có hreflang');
});

test('bài viết blog tiếng Anh trả về 200', async () => {
  const res = await get('/en/blog/kiem-tra-dung-luong-usb');
  assert.equal(res.status, 200);
  const html = await text('/en/blog/kiem-tra-dung-luong-usb');
  assert.ok(html.includes('How to check real USB capacity'), 'tiêu đề tiếng Anh phải có');
  assert.ok(html.includes('English content'), 'nội dung tiếng Anh phải có');
});

test('blog index uses the stored publication date and a compact, mobile-safe language combobox layout', async () => {
  const html = await text('/blog');
  assert.ok(html.includes('15 thg 1, 2025'), 'the card must display the stored published date');
  assert.ok(!/class="blog-date"[^>]*>.*(26|2026)/.test(html), 'the card must not fall back to request time');
  // Intentional UX change: blog language switcher is a compact combobox (like homepage)
  // instead of a 2-column grid of links, so it stays space-efficient on phones.
  assert.ok(html.includes('class="blog-language-label'), 'the language control must include an accessible label');
  assert.ok(html.includes('data-blog-lang-nav'), 'blog must render a self-contained combobox (blog pages do not load homepage i18n)');
  assert.ok(html.includes('class="lang-combobox blog-lang-combobox"'), 'blog must use the shared compact combobox structure');
  assert.ok(html.includes('class="lang-trigger"'), 'combobox must have a trigger button');
  assert.ok(/data-blog-lang="vi"[^>]*aria-current="true"|aria-current="true"[^>]*data-blog-lang="vi"/.test(html), 'current blog locale must be marked selected/current');
  assert.ok(html.includes('/blog-lang.js'), 'blog combobox behavior/persistence script must be loaded');
  // Both blog scripts used to be blocking. Lighthouse measured 440 ms of
  // render-blocking requests and a /en/blog -> blog-lang.js -> lang-detect.js
  // chain. They only wire the combobox and redirect an unprefixed URL, so they
  // are deferred; a blocking tag here brings the 440 ms back.
  assert.match(html, /<script defer src="\/blog-lang\.js/, 'blog-lang.js phải defer');
  assert.match(html, /<script defer src="\/lang-detect\.js/, 'lang-detect.js phải defer');
  assert.ok(!/<script src="\/(blog-lang|lang-detect)\.js/.test(html),
    'blog-lang.js và lang-detect.js không được chặn render');
  const css = readFileSync(path.join(process.cwd(), 'public', 'styles.css'), 'utf8');
  assert.ok(/\.blog-lang a\.active\{[^}]*background:var\(--brand\)/.test(css), 'legacy active-link rule must remain available');
  assert.ok(/@media\(max-width:700px\)\{\.blog-lang\{display:flex/.test(css), 'mobile must keep blog nav compact (home + combobox), not a grid of language links');
  assert.ok(css.includes('.blog-lang-combobox-wrap'), 'combobox wrapper must have blog-specific layout styles');
  assert.ok(css.includes('.blog-lang-option'), 'combobox options (real links) must be styled for tap targets');
  assert.ok(css.includes('.blog-date{flex:0 0 auto}'), 'dates must not shrink inside card metadata');
  assert.ok(css.includes('.blog-section{flex:1 1 auto;text-align:right}'), 'the section must stay aligned to the right');
});

test('blog slug không tồn tại trả về 404', async () => {
  const res = await get('/blog/khong-ton-tai');
  assert.equal(res.status, 404);
});

// Blog pages used to inline the whole storefront stylesheet (~70 KB) when they
// match about a fifth of it: Lighthouse charged 12-14 KiB gzipped of "unused CSS"
// on a content page. scripts/subset-blog-css.mjs writes public/blog.min.css from
// the same public/styles.css, and this test holds the two ends together: the page
// must inline the subset, and every class the page renders must have a rule in it
// (a class added to a template without rebuilding would style nothing).
test('blog inline CSS rút gọn và phủ hết class đang dùng', async () => {
  const index = await text('/blog');
  const post = await text('/blog/kiem-tra-dung-luong-usb');
  assert.ok(index.includes('<style id="site-styles">'), 'blog phải inline CSS như các trang khác');
  assert.ok(!index.includes('href="/styles.min.css'), 'blog không được tải stylesheet đầy đủ');
  const subset = readFileSync(path.join(process.cwd(), 'public', 'blog.min.css'), 'utf8');
  const full = readFileSync(path.join(process.cwd(), 'public', 'styles.min.css'), 'utf8');
  assert.ok(subset.length < full.length / 2, 'subset phải nhỏ hơn một nửa stylesheet đầy đủ');
  const faces = (text) => (text.match(/@font-face/g) || []).length;
  assert.equal(faces(subset), faces(full),
    'subset phải giữ đủ @font-face — thiếu một unicode-range là mất dấu tiếng Việt');
  for (const page of [index, post]) {
    for (const match of page.matchAll(/class="([^"]+)"/g)) {
      for (const name of match[1].split(/\s+/)) {
        // Some classes are hooks with no rule of their own (e.g.
        // .blog-language-label carries .sr-only). Only assert the rules that
        // exist in the full sheet survive the subset.
        if (!full.includes(`.${name}`)) continue;
        assert.ok(subset.includes(`.${name}`),
          `blog.min.css thiếu .${name} — chạy npm run build để sinh lại subset`);
      }
    }
  }
});

// The redirect that sent PageSpeed Insights from /blog to /en/blog. The script
// runs in a stubbed browser, the same way the storefront i18n tests boot the
// real i18n.js.
async function runLangDetect({ pathname = '/blog', stored = null, language = 'en-US' } = {}) {
  const store = stored ? { sonvudev_lang: stored } : {};
  const localStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
  };
  const location = { pathname, href: '', search: '', hash: '' };
  const { document } = createDom([]);
  await runScript(readFileSync(path.join(process.cwd(), 'public', 'lang-detect.js'), 'utf8'), {
    document,
    localStorage,
    navigator: { language },
    // `location` is a top-level sandbox global: runScript assigns win.location
    // from here, so passing it inside `window` is overwritten by the default.
    location,
  });
  return location;
}

test('browser tiếng Anh không bị chuyển từ /blog sang /en/blog', async () => {
  const location = await runLangDetect({ stored: null, language: 'en-US' });
  assert.equal(location.href, '',
    'trình duyệt mới không được redirect — PageSpeed/Lighthouse không audit được /blog');
});

test('lựa chọn ngôn ngữ đã lưu vẫn được tôn trọng', async () => {
  const location = await runLangDetect({ stored: 'en', language: 'vi-VN' });
  assert.equal(location.href, '/en/blog');
});

test('URL có prefix ngôn ngữ luôn thắng lựa chọn đã lưu', async () => {
  const location = await runLangDetect({ pathname: '/de/blog', stored: 'en' });
  assert.equal(location.href, '', 'trang /de/blog phải giữ nguyên');
});

test('loadBlogPosts đọc đúng số bài viết', async () => {
  const posts = loadBlogPosts();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].slug, 'kiem-tra-dung-luong-usb');
});

test('getBlogPostBySlug tìm đúng bài viết', async () => {
  const post = getBlogPostBySlug('kiem-tra-dung-luong-usb');
  assert.ok(post, 'phải tìm thấy bài viết');
  assert.equal(post.titleVi, 'Cách kiểm tra dung lượng thật của USB');
});

test('blog index không chứa token chưa thay thế', async () => {
  const html = renderBlogIndex(loadBlogPosts(), 'vi');
  assert.ok(!html.includes('{{title}}'), 'không được có token chưa thay');
  assert.ok(!html.includes('{{site}}'), 'không được có token chưa thay');
});
test('renderBlogIndex không chứa token chưa thay thế', async () => {
  const html = renderBlogIndex(loadBlogPosts(), 'vi');
  assert.ok(!html.includes('{{title}}'), 'không được có token chưa thay');
  assert.ok(!html.includes('{{site}}'), 'không được có token chưa thay');
});

test('renderBlogPost thoát ký tự đặc biệt', async () => {
  const post = {
    slug: 'x',
    titleVi: '<script>alert(1)</script>',
    titleEn: '',
    descriptionVi: 'desc',
    descriptionEn: '',
    contentVi: '<p>Nội dung đã được soạn HTML sẵn.</p>',
    contentEn: '',
    published: '2025-01-01T00:00:00.000Z',
    modified: '2025-01-01T00:00:00.000Z',
    section: 'Test',
    sectionEn: 'Test',
    tags: [],
    relatedProductSlug: '',
  };
  const html = renderBlogPost(post, 'vi');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'tiêu đề phải được thoát');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<p>Nội dung đã được soạn HTML sẵn.</p>'), 'nội dung HTML được giữ nguyên vì là nội dung đã soạn');
});

test('liên kết sản phẩm liên quan trên blog đi đến trang sản phẩm, không mở form thanh toán', async () => {
  const post = {
    slug: 'bai-viet',
    titleVi: 'Bài viết',
    titleEn: 'Post',
    descriptionVi: 'Mô tả',
    descriptionEn: 'Description',
    contentVi: '<p>Nội dung</p>',
    contentEn: '<p>Content</p>',
    published: '2025-01-01T00:00:00.000Z',
    modified: '2025-01-01T00:00:00.000Z',
    section: 'Test',
    sectionEn: 'Test',
    tags: [],
    relatedProductSlug: 'san-pham-lien-quan',
  };
  const vi = renderBlogPost(post, 'vi');
  assert.ok(vi.includes('class="blog-related-link"'), 'phải render liên kết sản phẩm liên quan');
  assert.ok(vi.includes('/product/san-pham-lien-quan'), 'liên kết liên quan phải trỏ tới trang sản phẩm');
  assert.ok(!vi.includes('/?buy='), 'liên kết liên quan không được mở form thanh toán');
  const en = renderBlogPost(post, 'en');
  assert.ok(en.includes('/en/product/san-pham-lien-quan'), 'liên kết liên quan tiếng Anh phải giữ prefix locale');
  assert.ok(!en.includes('/?buy='), 'liên kết liên quan tiếng Anh không được mở form thanh toán');
});

test('liên kết /product trong nội dung blog: xem chi tiết -> trang sản phẩm, CTA mua rõ ràng -> form mua', async () => {
  await fs.mkdir(path.join(tempDir, 'data'), { recursive: true });
  await fs.writeFile(path.join(tempDir, 'data', 'products.json'), JSON.stringify([
    { id: 'sp-b-id', slug: 'san-pham-b', name: 'SP B' },
  ]));
  const post = {
    slug: 'bai-viet',
    titleVi: 'Bài viết',
    titleEn: 'Post',
    descriptionVi: 'Mô tả',
    descriptionEn: 'Description',
    contentVi: '<p><a class="blog-cta" href="/product/san-pham-a">Xem chi tiết sản phẩm</a> <a class="btn-buy" href="/product/san-pham-b">Mua ngay</a></p>',
    contentEn: '<p><a href="/product/san-pham-a">View details</a> <a data-buy="1" href="/product/san-pham-b">Buy now</a></p>',
    published: '2025-01-01T00:00:00.000Z',
    modified: '2025-01-01T00:00:00.000Z',
    section: 'Test',
    sectionEn: 'Test',
    tags: [],
    relatedProductSlug: '',
  };
  const vi = renderBlogPost(post, 'vi');
  assert.match(vi, /<a[^>]*href="[^"]*\/product\/san-pham-a"[^>]*>Xem chi tiết sản phẩm<\/a>/, 'liên kết xem chi tiết phải tới trang sản phẩm');
  assert.ok(!vi.includes('/product/san-pham-a?buy=') && !/<a[^>]*href="[^"]*\/\?buy=[^"]*"[^>]*>Xem chi tiết/.test(vi), 'anchor xem chi tiết không được mở form mua');
  assert.ok(vi.includes('/?buy=sp-b-id'), 'CTA mua rõ ràng phải mở luồng mua theo id sản phẩm');
  assert.ok(vi.includes('Mua ngay'), 'giữ nội dung CTA mua');
  const en = renderBlogPost(post, 'en');
  assert.ok(en.includes('/en/product/san-pham-a'), 'liên kết xem chi tiết tiếng Anh phải giữ locale');
  assert.ok(en.includes('/?buy=sp-b-id'), 'CTA mua data-buy phải mở luồng mua');
});

test('blog.json feed trả về cấu trúc hợp lệ', async () => {
  const data = await json('/blog.json');
  assert.ok(Array.isArray(data.items), 'phải có mảng items');
  assert.ok(data.items.length >= 1, 'phải có ít nhất 1 bài viết');
  const postItem = data.items.find((i) => i.url.includes('kiem-tra-dung-luong-usb'));
  assert.ok(postItem, 'phải có bài viết USB trong feed');
  assert.ok(postItem.title.includes('USB'), 'tiêu đề phải chứa USB');
  // JSON Feed extension fields the homepage cards read for vi/en content.
  assert.ok(postItem._titleVi !== undefined && postItem._titleEn !== undefined, 'items phải mang extension fields đa ngữ (_titleVi/_titleEn)');
  assert.ok(postItem._descriptionVi !== undefined && postItem._descriptionEn !== undefined, 'items phải mang extension fields đa ngữ (_descriptionVi/_descriptionEn)');
});

test('sitemap bao gồm blog posts', async () => {
  const body = await text('/sitemap.xml');
  assert.ok(body.includes('/blog/kiem-tra-dung-luong-usb'), 'sitemap phải có blog post');
  assert.ok(body.includes('/en/blog/kiem-tra-dung-luong-usb'), 'sitemap phải có blog post tiếng Anh');
});

test('llms.txt bao gồm blog posts', async () => {
  const body = await text('/llms.txt');
  assert.ok(body.includes('How to check real USB capacity'), 'llms.txt phải có blog post (tiêu đề tiếng Anh cho máy đọc)');
  assert.ok(body.includes('/blog/'), 'llms.txt phải có link blog');
});

test('homepage đọc /blog.json theo cấu trúc JSON Feed, không theo mảng', async () => {
  // /blog.json từng đổi sang JSON Feed ({ title, items: [...] }) khiến homepage
  // vỡ: app.js coi phản hồi là mảng, posts.filter ném TypeError và trang hiện
  // "Không thể tải bài viết." — fix: đọc data.items + extension đa ngữ.
  const src = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(src, /data\.items/, 'homepage phải đọc mảng items của JSON Feed');
  assert.match(src, /post\._titleVi/, 'homepage phải đọc extension field _titleVi cho tiếng Việt');
  assert.match(src, /post\._titleEn/, 'homepage phải đọc extension field _titleEn cho tiếng Anh');
});
