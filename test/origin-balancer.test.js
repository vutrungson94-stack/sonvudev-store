// The free origin balancer has no local runtime, so its decisions are pure
// functions tested here. These are the negative controls: a selection that
// always returns the first origin, or one that never drops a cooling-down host,
// re-opens the exact incident that suspended the workspace — all traffic lands
// on one free host and burns its 5 GB.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.mjs';
import {
  parseOrigins,
  isDown, markDown, markUp,
  pickOrigin, orderOrigins,
  isCacheable, isSuspension, staleKey,
  clientAddress, apexRedirect,
  localeOf, maintenanceUntil, retryAfterSeconds, formatReturnDate,
  maintenancePage, rateLimitPage, isRateLimited, browserNavigation,
} from '../cloudflare/origin-balancer/worker.js';
import worker from '../cloudflare/origin-balancer/worker.js';

const ORIGINS = ['https://alpha.example', 'https://beta.example', 'https://gamma.example'];

test('parseOrigins accepts urls, dedupes, trims slashes and rejects junk', () => {
  assert.deepEqual(
    parseOrigins(' https://a.example/ , https://b.example  https://a.example  not-a-url '),
    ['https://a.example', 'https://b.example'],
  );
  assert.deepEqual(parseOrigins(''), []);
  assert.deepEqual(parseOrigins(undefined), []);
});

test('visits spread across origins instead of piling on one', () => {
  const counts = new Map(ORIGINS.map((origin) => [origin, 0]));
  for (let visitor = 0; visitor < 3000; visitor += 1) {
    counts.set(pickOrigin(ORIGINS, `${visitor}.1.2.3|/`), counts.get(pickOrigin(ORIGINS, `${visitor}.1.2.3|/`)) + 1);
  }
  // A constant-first implementation would leave beta/gamma at zero.
  for (const [origin, count] of counts) {
    assert.ok(count > 300 && count < 1700, `${origin} got ${count} of 3000 visits — not balanced`);
  }
});

test('a cooling-down origin is skipped and tried last, restored after cooldown', () => {
  const now = 1_000_000;
  markDown(ORIGINS[0], 120_000, now);
  assert.equal(isDown(ORIGINS[0], now), true);
  assert.equal(isDown(ORIGINS[0], now + 120_001), false);
  assert.equal(pickOrigin(ORIGINS, 'fixed|/', now), ORIGINS[1], 'dead origin must not receive traffic');
  const order = orderOrigins(ORIGINS, 'fixed|/', now);
  assert.equal(order[0], ORIGINS[1]);
  assert.equal(order[order.length - 1], ORIGINS[0], 'dead origin tried last when nothing healthy');
  markUp(ORIGINS[0]);
  assert.equal(isDown(ORIGINS[0], now), false);
});

test('all-cooling rotation still probes an origin rather than returning nothing', () => {
  const now = 2_000_000;
  ORIGINS.forEach((origin) => markDown(origin, 120_000, now));
  assert.ok(ORIGINS.includes(pickOrigin(ORIGINS, 'x|/', now)));
  assert.equal(orderOrigins(ORIGINS, 'x|/', now).length, ORIGINS.length);
  ORIGINS.forEach(markUp);
});

test('cache policy: GET pages cached, API/admin never', () => {
  assert.equal(isCacheable('GET', '/'), true);
  assert.equal(isCacheable('GET', '/product/pc-cleanup'), true);
  assert.equal(isCacheable('GET', '/api/health'), false);
  assert.equal(isCacheable('GET', '/admin'), false);
  assert.equal(isCacheable('POST', '/'), false);
});

test('www redirects to the apex before the upstream host is rewritten', () => {
  const apex = process.env.APP_URL.replace(/\/$/, '');
  const host = new URL(apex).hostname;
  const www = `https://www.${host}`;
  assert.equal(apexRedirect(`${www}/product/pc-cleanup?buy=1`), `${apex}/product/pc-cleanup?buy=1`);
  assert.equal(apexRedirect(`${apex}/`), null);
  assert.equal(apexRedirect(`${www}:443/`), `${apex}/`);
  // Cloudflare may rewrite the URL to the apex before the Worker runs; the
  // original Host header is then the only signal that the buyer typed www.
  assert.equal(apexRedirect(`${apex}/`, `www.${host}`), `${apex}/`);
  assert.equal(apexRedirect(`${apex}/`, 'www.evil.example'), null, 'a spoofed Host must not redirect');
  assert.equal(apexRedirect(`${apex}/`, host), null);
});

test('the routing identity uses the edge header, never a forged forwarded chain', () => {
  const incoming = new Headers({
    'cf-connecting-ip': '203.0.113.9',
    'x-forwarded-for': '10.0.0.1, 10.0.0.2',
    'cf-ray': 'a5ccfabdcdc95ddc-HKG',
  });
  assert.equal(clientAddress(incoming), '203.0.113.9');
});

test('client address falls back honestly when the edge sent none', () => {
  assert.equal(clientAddress(new Headers()), 'anon');
  assert.equal(clientAddress(new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' })), '198.51.100.7');
});

test('suspension detection covers 5xx and the provider page, not a normal 404', () => {
  assert.equal(isSuspension(503, ''), true);
  assert.equal(isSuspension(200, 'This service has been suspended by its owner'), true);
  assert.equal(isSuspension(404, 'page not found'), false);
  assert.equal(isSuspension(200, 'Welcome'), false);
});

test('stale key is distinct from the live key and stable', () => {
  const url = `${process.env.APP_URL}/?buy=abc`;
  const key = staleKey(url);
  assert.notEqual(key, url);
  assert.equal(key, staleKey(url));
  assert.equal(new URL(key).searchParams.get('buy'), 'abc', 'original query preserved');
});

test('maintenance flag is parsed only when it is in the future', () => {
  const now = 1_800_000_000_000;
  assert.equal(maintenanceUntil({ MAINTENANCE_UNTIL: new Date(now + 60_000).toISOString() }, now), now + 60_000);
  assert.ok(maintenanceUntil({ MAINTENANCE_UNTIL: new Date(now - 60_000).toISOString() }, now) <= now, 'expired flag must not degrade the shop');
  assert.equal(maintenanceUntil({}, now), 0);
  assert.equal(maintenanceUntil({ MAINTENANCE_UNTIL: 'not-a-date' }, now), 0);
  assert.ok(retryAfterSeconds(now + 90_000, now) >= 90);
});

test('URL prefix picks the locale before Accept-Language', () => {
  const base = process.env.APP_URL.replace(/\/$/, '');
  const req = (path, language = 'en-US,en;q=0.9') => new Request(`${base}${path}`, { headers: { 'accept-language': language } });
  assert.equal(localeOf(req('/de/product/x')), 'de');
  assert.equal(localeOf(req('/', 'vi-VN,vi;q=0.9')), 'vi');
  assert.equal(localeOf(req('/')), 'en', 'Accept-Language is the fallback when the URL has no prefix');
});

test('maintenance page is localized, dated and non-cacheable', async () => {
  const until = Date.parse('2026-12-01T10:00:00+07:00');
  const body = maintenancePage({ locale: 'vi', until, reason: 'nâng cấp hạ tầng' });
  assert.match(body, /SonVuDev đang bảo trì/);
  assert.match(body, /nâng cấp hạ tầng/);
  assert.match(body, /noindex,follow/);
  assert.match(body, /<html lang="vi">/);
  assert.match(formatReturnDate('vi', until), /2026/);
  assert.match(rateLimitPage({ locale: 'en' }), /A little too fast/);
});

test('only browser navigations get an HTML rate-limit page', () => {
  assert.equal(isRateLimited(429), true);
  assert.equal(isRateLimited(200), false);
  assert.equal(browserNavigation(new Headers({ accept: 'text/html', 'sec-fetch-mode': 'navigate' })), true);
  assert.equal(browserNavigation(new Headers({ accept: 'application/json' })), false);
});

test('an active maintenance flag short-circuits the Worker before any origin fetch', async () => {
  const until = Date.now() + 600_000;
  const request = new Request(`${process.env.APP_URL.replace(/\/$/, '')}/en/`, { headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' } });
  const response = await worker.fetch(request, {
    ORIGINS: 'https://unused.example',
    MAINTENANCE_UNTIL: new Date(until).toISOString(),
    MAINTENANCE_REASON: 'bảo trì định kỳ',
  }, { waitUntil() {} });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-svd-origin'), 'maintenance');
  assert.ok(Number(response.headers.get('retry-after')) > 0);
  assert.match(await response.text(), /SonVuDev is under maintenance/);
});
