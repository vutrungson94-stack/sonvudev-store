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
