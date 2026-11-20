// The free origin balancer has no local runtime, so its decisions are pure
// functions tested here. These are the negative controls: a selection that
// always returns the first origin, or one that never drops a cooling-down host,
// re-opens the exact incident that suspended the workspace — all traffic lands
// on one free host and burns its 5 GB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import './helpers/env.mjs';
import {
  parseOrigins,
  isDown, markDown, markUp,
  pickOrigin, orderOrigins,
  isCacheable, isSuspension, staleKey,
  clientAddress, apexRedirect,
  withHeader, upstreamHeaders, acceptsGzip, gzipHtmlResponse, isCurrentCache,
} from '../cloudflare/origin-balancer/worker.js';

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

test('the worker asks the origin for identity bytes so it cannot decompress them', () => {
  const headers = upstreamHeaders(new Headers({
    'accept-encoding': 'gzip, deflate, br',
    'x-visitor': 'kept',
  }));
  assert.equal(headers.get('accept-encoding'), 'identity');
  assert.equal(headers.get('x-visitor'), 'kept');
  assert.equal(acceptsGzip(new Headers({ 'accept-encoding': 'gzip, deflate, br' })), true);
  assert.equal(acceptsGzip(new Headers({ 'accept-encoding': 'br' })), false);
  assert.equal(acceptsGzip(new Headers()), false);
});

test('a cache entry from before the gzip change is ignored', () => {
  const old = new Response('plain', { headers: { 'x-svd-origin': 'edge-cache' } });
  const current = withHeader(old, 'X-SVD-Cache-V', 'gzip-20261120');
  assert.equal(isCurrentCache(old), false, 'unversioned entries must be refetched');
  assert.equal(isCurrentCache(current), true);
  assert.equal(isCurrentCache(null), false);
});

test('the worker gzips HTML once and advertises the variant', async () => {
  const html = '<html><body>SonVuDev</body></html>'.repeat(50);
  const source = new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  const gz = gzipHtmlResponse(source);
  assert.equal(gz.status, 200);
  assert.equal(gz.headers.get('content-encoding'), 'gzip');
  assert.match(gz.headers.get('vary') || '', /accept-encoding/i);
  const wire = Buffer.from(await gz.arrayBuffer());
  assert.equal(gunzipSync(wire).toString('utf8'), html, 'exactly one layer of gzip');
  assert.ok(wire.length < Buffer.byteLength(html) / 2, `${wire.length}B must be smaller than ${Buffer.byteLength(html)}B`);
});

test('tagging an encoded response keeps its body and the manual encoding contract', async () => {
  const source = new Response('<html>encoded</html>', {
    status: 201,
    headers: { 'content-type': 'text/html', 'x-existing': 'yes' },
  });
  const encoded = gzipHtmlResponse(source);
  const tagged = withHeader(encoded, 'X-SVD-Origin', 'alpha.example');
  assert.equal(tagged.status, 201);
  assert.equal(tagged.headers.get('content-encoding'), 'gzip');
  assert.equal(tagged.headers.get('x-existing'), 'yes');
  assert.equal(tagged.headers.get('x-svd-origin'), 'alpha.example');
  assert.equal(gunzipSync(Buffer.from(await tagged.arrayBuffer())).toString('utf8'), '<html>encoded</html>');
});

test('stale key is distinct from the live key and stable', () => {
  const url = `${process.env.APP_URL}/?buy=abc`;
  const key = staleKey(url);
  assert.notEqual(key, url);
  assert.equal(key, staleKey(url));
  assert.equal(new URL(key).searchParams.get('buy'), 'abc', 'original query preserved');
});
