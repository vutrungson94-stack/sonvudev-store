// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first.
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

// The page loads no analytics script from anyone.
//
// Cloudflare Web Analytics was 10 KB of third-party JavaScript carrying its own
// polyfills for Array.prototype.at/findLast/includes — which is what Lighthouse
// lists as "Legacy JavaScript" — and cached for a single day, which is the "Use
// efficient cache lifetimes" finding.
//
// GA4's gtag.js is blocked outright by every tracker blocker and privacy
// setting: in the visitor's own network tab the request failed with
// ERR_BLOCKED_BY_CLIENT, on every page, for every visitor who has one. A tag
// that fails for those visitors collects nothing for them and only leaves a red
// line in their console.
//
// What the shop measures instead is its own: the RUM beacon in
// public/quality.js posts the URL, the Core Web Vitals and the page errors to
// /api/quality — same origin, navigator.sendBeacon, so it survives the visitor
// leaving the page and no proxy or blocker can stop it.
test('trang không nạp script analytics của bên thứ ba nào', async () => {
  const pages = await read(path.join('src', 'pages.js'));
  assert.ok(!/googletagmanager\.com/.test(pages),
    'không được nạp gtag.js — nó bị trình chặn tracker chặn (ERR_BLOCKED_BY_CLIENT) ở mọi khách có trình chặn');
  assert.ok(!/static\.cloudflareinsights\.com/.test(pages),
    'không được nạp beacon của Cloudflare — 10 KB legacy JS, cache 1 ngày');

  const app = await read(path.join('src', 'app.js'));
  assert.ok(!/googletagmanager\.com/.test(app),
    'CSP không được mở cho www.googletagmanager.com khi không có script nào dùng nó');
  assert.ok(!/google-analytics\.com/.test(app),
    'CSP không được mở cho google-analytics.com khi không có script nào dùng nó');
  assert.ok(!/cloudflareinsights\.com/.test(app),
    'CSP không được mở cho cloudflareinsights.com khi không có script nào dùng nó');
});

// The RUM beacon is the site's own measurement, and it must stay on the page.
test('RUM của chính site vẫn được nạp trên mọi trang', async () => {
  const index = await read(path.join('public', 'index.html'));
  assert.ok(index.includes('/quality.js'), 'trang chủ phải nạp public/quality.js');
  const quality = await read(path.join('public', 'quality.js'));
  assert.ok(quality.includes('/api/quality'), 'RUM phải gửi về /api/quality (cùng origin)');
  assert.ok(quality.includes('sendBeacon'), 'RUM phải dùng navigator.sendBeacon để an toàn khi trang kết thúc');
});
