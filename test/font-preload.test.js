// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first.
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-fonts-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET_NAME = 'test-private-bucket';
process.env.APP_URL = 'https://fonts-fixture.example';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';

const { createApp } = await import('../src/app.js');

let server;
let base;
test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const blogDir = path.join(tempDir, 'data', 'blog');
  await fs.mkdir(blogDir, { recursive: true });
  await fs.writeFile(path.join(blogDir, 'mau-bai-viet.json'), JSON.stringify({
    slug: 'mau-bai-viet',
    titleVi: 'Mẫu bài viết tiếng Việt',
    titleEn: 'Sample English post',
    descriptionVi: 'Mô tả ngắn.',
    descriptionEn: 'Short description.',
    contentVi: '<p>Nội dung tiếng Việt.</p>',
    contentEn: '<p>English content.</p>',
    section: 'Kinh doanh',
    sectionEn: 'Business',
    date: '2026-01-01',
    author: 'SonVuDev',
    tags: ['mau'],
  }));
});
test.after(() => server?.close());

// The four fonts a Vietnamese page uses, and the four it must preload.
//
// A page that does not preload them discovers them only when the browser
// reaches the @font-face rules, and the fonts then arrive a third of a second
// after the HTML — the longest chain on the page. The blog pages were rendered
// in code and had no preloads at all, so their fonts were the last thing to
// arrive.
const PRELOADS = [
  '/fonts/be-vietnam-pro-latin.woff2',
  '/fonts/be-vietnam-pro-vietnamese.woff2',
  '/fonts/space-grotesk-latin.woff2',
  '/fonts/space-grotesk-vietnamese.woff2',
];

test('mọi trang đều preload đúng 4 file font thương hiệu', async () => {
  const pages = ['/', '/blog', '/blog/mau-bai-viet', '/en/blog'];
  for (const pathname of pages) {
    const body = await (await fetch(`${base}${pathname}`, { redirect: 'manual' })).text();
    for (const font of PRELOADS) {
      assert.ok(
        body.includes(`<link rel="preload" as="font" type="font/woff2" href="${font}`),
        `${pathname} phải preload ${font} — không có nó thì font chỉ được phát hiện khi trình duyệt đọc tới @font-face`,
      );
    }
    // crossorigin is required on a font preload: the fetch is a CORS request
    // even on the same origin, and without it the preload is fetched twice.
    const preloads = [...body.matchAll(/<link rel="preload" as="font"[^>]*>/g)].map((m) => m[0]);
    for (const tag of preloads) {
      assert.match(tag, /crossorigin/,
        `${pathname}: preload font phải có crossorigin, nếu không trình duyệt tải file đó hai lần`);
    }
  }
});
