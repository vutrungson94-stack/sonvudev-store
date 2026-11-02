import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers/env.mjs';

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
  // Seed one blog post directly into the temp data dir used by the app
  const blogDir = path.join(tempDir, 'data', 'blog');
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

test('blog slug không tồn tại trả về 404', async () => {
  const res = await get('/blog/khong-ton-tai');
  assert.equal(res.status, 404);
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

test('blog.json feed trả về cấu trúc hợp lệ', async () => {
  const data = await json('/blog.json');
  assert.ok(Array.isArray(data.items), 'phải có mảng items');
  assert.ok(data.items.length >= 1, 'phải có ít nhất 1 bài viết');
  const postItem = data.items.find((i) => i.url.includes('kiem-tra-dung-luong-usb'));
  assert.ok(postItem, 'phải có bài viết USB trong feed');
  assert.ok(postItem.title.includes('USB'), 'tiêu đề phải chứa USB');
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
