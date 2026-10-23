import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.mjs';
import { createRateLimiter, checkoutThrottled } from '../src/rate-limit.js';

test('rate limiter giu dung nguong cu: lookup 10, checkout 30/12', async () => {
  const { tooMany } = createRateLimiter();
  for (let i = 0; i < 10; i += 1) assert.equal(await tooMany('ip:x', 10), false);
  assert.equal(await tooMany('ip:x', 10), true);
  for (let i = 0; i < 30; i += 1) assert.equal(await tooMany('checkout-ip:y', 30), false);
  assert.equal(await tooMany('checkout-ip:y', 30), true);
});

test('checkoutThrottled tach ngan sach IP va email', async () => {
  const req = { ip: '10.9.9.9' };
  for (let i = 0; i < 12; i += 1) assert.equal(await checkoutThrottled(req, 'a@ex.com'), false);
  assert.equal(await checkoutThrottled({ ip: '10.9.9.10' }, 'b@ex.com'), false);
});