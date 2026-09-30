import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Site ownership. This file sets the tokens that production will carry, because
// the whole point of the feature is that a search engine can reach a working
// proof from the public internet, and the only way to know the routes answer is
// to run a server that has them switched on.
process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-verify-'));
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
process.env.GOOGLE_SITE_VERIFICATION = 'a1b2c3d4e5f6a7b8c9d0';
process.env.BING_SITE_VERIFICATION = 'b1b2c3d4e5f6a7b8c9d0';
process.env.INDEXNOW_KEY = 'c1d2e3f4a5b6c7d8e9f0';

const { createApp } = await import('../src/app.js');
const { isValidIndexNowKey } = await import('../src/indexnow.js');

let server;
let base;
test.before(async () => { server = (await createApp()).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server?.close(); await fs.rm(tempDir, { recursive: true, force: true }); });

const get = (route) => fetch(`${base}${route}`, { redirect: 'manual' });
const text = async (route) => (await get(route)).text();

const GOOGLE = 'a1b2c3d4e5f6a7b8c9d0';
const BING = 'b1b2c3d4e5f6a7b8c9d0';
const INDEXNOW = 'c1d2e3f4a5b6c7d8e9f0';
// Both the route name and the file body are derived from the same token on the
// server, so spelling the URL out by hand here could only ever prove that a
// hand-written string matches itself.
const googleFile = `google${GOOGLE}.html`;

test('trang chủ chứa thẻ xác minh của cả Google và Bing', async () => {
  const html = await text('/');
  assert.ok(html.includes(`<meta name="google-site-verification" content="${GOOGLE}">`), 'thiếu thẻ Google');
  assert.ok(html.includes(`<meta name="msvalidate.01" content="${BING}">`), 'thiếu thẻ Bing');
  // It has to be in the head. A tag in the body is not seen.
  assert.ok(html.indexOf('google-site-verification') < html.indexOf('</head>'), 'thẻ xác minh phải nằm trong head');
  assert.equal((html.match(/google-site-verification/g) || []).length, 1, 'không được lặp thẻ');
});

test('file xác minh HTML của Google trả đúng tên và đúng nội dung', async () => {
  const response = await get(`/${googleFile}`);
  assert.equal(response.status, 200, `thiếu file /${googleFile}`);
  assert.match(response.headers.get('content-type'), /text\/plain/);
  // Google fetches the file and compares the name to the body. A body that only
  // contains the token passes the fetch and still fails the check.
  assert.equal((await response.text()).trim(), `google-site-verification: ${googleFile}`);
});

test('file xác minh của Bing trả về đúng khoá', async () => {
  const response = await get(`/ms${BING}.txt`);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).trim(), BING);
});

test('file khoá IndexNow phục vụ đúng khoá đã cấu hình', async () => {
  const response = await get(`/${INDEXNOW}.txt`);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).trim(), INDEXNOW);
  assert.equal(isValidIndexNowKey(INDEXNOW), true);
});

test('không phục vụ file xác minh không có trong cấu hình', async () => {
  // A catch-all that answered every /google*.html would publish an unbounded set
  // of files that exist for nobody, and would answer a wrong token with a
  // plausible-looking proof of ownership.
  for (const route of ['/googledeadbeef.html', '/msdeadbeef.txt', '/notconfigured.txt', '/anythingelse.txt']) {
    assert.equal((await get(route)).status, 404, `${route} phải là 404`);
  }
});

test('/api/health nói thẳng là đã hay chưa xác minh', async () => {
  const health = await (await get('/api/health')).json();
  assert.equal(health.search.google, true);
  assert.equal(health.search.bing, true);
  assert.equal(health.search.indexNow, true);
  // Nothing secret here: these are booleans, and the point is for a dashboard or
  // a health probe to see at a glance that the site is not claimed yet.
  assert.equal(JSON.stringify(health).includes('a1b2c3d4'), false, 'không được lộ token xác minh ra health');
});

test('mọi trang lập chỉ mục đều nhận thẻ xác minh, kể cả trang pháp lý', async () => {
  for (const route of ['/', '/terms', '/privacy', '/refund']) {
    const html = await text(route);
    assert.ok(html.includes('google-site-verification'), `${route} thiếu thẻ xác minh`);
    assert.ok(!html.includes('{{site}}'), `${route} còn token chưa thay`);
  }
});
