import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/env.mjs';
import { closeTest } from './helpers/teardown.mjs';
import TEST_ENV from './helpers/env.mjs';

// The server has to answer with pages whose own words belong to the language in
// the URL. Before these routes existed, /en/ 404'd, /de/ served a Vietnamese
// page, and the legal pages existed in no language but Vietnamese - the build
// passed and every gate was green while the shop was monolingual at the edges.

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-static-i18n-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET_NAME = 'test-private-bucket';
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';

const { createApp } = await import('../src/app.js');
const APP = TEST_ENV.APP_URL.replace(/\/$/, '');
let server;
let base;
test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await closeTest(server, tempDir);
});

const get = async (pathname, headers = {}) => {
  const res = await fetch(base + pathname, { headers, redirect: 'manual' });
  return { status: res.status, body: await res.text(), location: res.headers.get('location') };
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('every locale answers its own homepage with its own words', async () => {
  const cases = [
    ['/', 'vi', 'kiểm tra dung'],
    ['/en/', 'en', 'real USB capacity'],
    ['/de/', 'de', 'echte USB-Kapazität'],
    ['/es/', 'es', 'capacidad real'],
    ['/fr/', 'fr', 'vraie capacité'],
    ['/ja/', 'ja', 'USB容量'],
    ['/zh-CN/', 'zh-CN', '真实容量'],
  ];
  for (const [pathname, lang, needle] of cases) {
    const { status, body } = await get(pathname);
    assert.equal(status, 200, `GET ${pathname} must answer 200`);
    assert.match(body, new RegExp(`<html lang="${escapeRe(lang)}">`), `GET ${pathname} must carry its own html lang`);
    // The templates once used href="styles.css", which a prefixed URL resolves
    // to /de/styles.css and /en/styles.css - both 404. Absolute is the only
    // shape that survives a language prefix.
    // The stylesheet travels inside the page (src/lib/inline-styles.mjs), so
    // there is no stylesheet link to check — what has to be true is that the
    // page carries the styles, and that nothing asset-shaped is relative: a
    // prefixed page would resolve a relative URL to /de/<asset> and 404.
    assert.ok(body.includes('<style id="site-styles">') || body.includes('<link rel="stylesheet" href="/styles.min.css"'),
      `GET ${pathname} must carry the stylesheet (inline or as an absolute link)`);
    assert.ok(!/href="(?!\/|#|https?:)[^"]+\.(css|js)"/.test(body),
      `GET ${pathname} must not use a relative asset URL`);
    assert.ok(body.includes(needle), `GET ${pathname} must carry its own head copy (looking for "${needle}")`);
    assert.match(body, new RegExp(`<link rel="canonical" href="${escapeRe(APP)}/?(${escapeRe(lang)}/?)?"`),
      `GET ${pathname} canonical must name its own URL`);
    assert.ok(body.includes('hreflang="vi"'), `GET ${pathname} must declare the full hreflang set (vi)`);
    assert.ok(body.includes('hreflang="zh-CN"'), `GET ${pathname} must declare the full hreflang set (zh-CN)`);
    assert.match(body, /hreflang="x-default"/, `GET ${pathname} must declare x-default`);
  }
});

test('/en/ exists - the redirect target cannot be a dead end', async () => {
  const { status, body } = await get('/en');
  assert.equal(status, 200, '/en must answer (or /en/ must at least exist)');
  // and its sibling form answers too
  const { status: slash } = await get('/en/');
  assert.equal(slash, 200);
  assert.match(body, /<html lang="en">/);
  assert.ok(!body.includes('Kiểm tra dung'), '/en/ must not ship the Vietnamese title');
});

test('the legal pages exist in every locale, server-rendered in that language', async () => {
  const cases = [
    ['/en/terms', 'en', 'Terms of use'],
    ['/de/terms', 'de', 'Sie lesen die Bedingungen'],
    ['/fr/terms', 'fr', 'Vous lisez les conditions'],
    ['/ja/terms', 'ja', 'これは'],
    ['/zh-CN/terms', 'zh-CN', '您正在阅读'],
    ['/es/terms', 'es', 'Está leyendo los términos'],
    ['/en/privacy', 'en', 'We respect your data'],
    ['/fr/privacy', 'fr', 'Nous respectons vos données'],
    ['/de/privacy', 'de', 'Wir respektieren Ihre Daten'],
    ['/en/refund', 'en', 'Refund'],
    ['/fr/refund', 'fr', 'remboursement'],
    ['/de/refund', 'de', 'Rückerstattung'],
    ['/en/about', 'en', 'About SonVuDev'],
    ['/ja/about', 'ja', 'このソフトを作ったか'],
  ];
  for (const [pathname, lang, needle] of cases) {
    const { status, body } = await get(pathname);
    assert.equal(status, 200, `GET ${pathname} must answer 200`);
    assert.match(body, new RegExp(`<html lang="${escapeRe(lang)}">`), `GET ${pathname} html lang`);
    assert.ok(body.includes(needle), `GET ${pathname} must carry the ${lang} copy (looking for "${needle}")`);
    assert.match(body, new RegExp(`rel="canonical" href="${escapeRe(APP + '/' + lang + '/' + pathname.split('/').pop())}"`),
      `GET ${pathname} canonical`);
  }
});

test('chrome links on a localized legal page stay in the language', async () => {
  const { body } = await get('/de/terms');
  // Footer links point at the localized legal routes, not the Vietnamese ones,
  // and they are labelled in German.
  assert.match(body, /href="\/de\/privacy"/, 'footer must link to /de/privacy');
  assert.match(body, /href="\/de\/refund"/, 'footer must link to /de/refund');
  assert.match(body, /href="\/de\/about"/, 'footer must link to /de/about');
  // The current page's own link is excluded from its footer (a footer linking
  // back at the page the reader is on is a wasted click).
  assert.ok(!/class="footer-links"[^>]*>[\s\S]*?href="\/de\/terms"/.test(body), 'the footer must not link back to itself');
  // The Vietnamese words must not survive anywhere on the German page.
  assert.ok(!body.includes('Điều khoản'), 'the German terms page must not ship Vietnamese chrome');
});

test('the sitemap lists every locale homepage and legal page with hreflang', async () => {
  const { status, body } = await get('/sitemap.xml');
  assert.equal(status, 200);
  for (const loc of ['/', '/en/', '/de/', '/es/', '/fr/', '/ja/', '/zh-CN/',
    '/terms', '/en/terms', '/de/terms', '/fr/terms', '/privacy', '/ja/refund', '/zh-CN/about']) {
    assert.ok(body.includes(`<loc>${APP}${loc}</loc>`), `sitemap must list ${APP}${loc}`);
  }
  assert.ok(body.includes('hreflang="x-default"'), 'sitemap must carry x-default');
});

test('/api/health reports the deployed commit', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  const json = JSON.parse(body);
  assert.ok(json.commit === null || /^[0-9a-f]{7,40}$/.test(json.commit), `commit must be a sha or null, got: ${String(json.commit)}`);
});
