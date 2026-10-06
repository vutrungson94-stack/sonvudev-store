import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.mjs';
import { createRateLimiter, checkoutThrottled } from '../src/rate-limit.js';

test('rate limiter giữ đúng ngưỡng cũ: lookup 10, checkout 30/12', () => {
  const { tooMany } = createRateLimiter();
  for (let i = 0; i < 10; i += 1) assert.equal(tooMany('ip:x', 10), false);
  assert.equal(tooMany('ip:x', 10), true);
  for (let i = 0; i < 30; i += 1) assert.equal(tooMany('checkout-ip:y', 30), false);
  assert.equal(tooMany('checkout-ip:y', 30), true);
});

test('checkoutThrottled tách ngân sách IP và email', () => {
  const req = { ip: '10.9.9.9' };
  for (let i = 0; i < 12; i += 1) assert.equal(checkoutThrottled(req, 'a@ex.com'), false);
  // Email vượt nhưng IP khác vẫn cho IP khác đi qua ở lần đầu.
  assert.equal(checkoutThrottled({ ip: '10.9.9.10' }, 'b@ex.com'), false);
});
