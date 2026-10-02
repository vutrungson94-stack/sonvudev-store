import test from 'node:test';
import assert from 'node:assert/strict';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';

// No INDEXNOW_KEY in this run. The store has to work exactly the same without
// it, and a store that quietly phones a third party on every product save when
// nobody asked for that is the problem this guards against.
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'https://sonvudev.com';
// Set to an empty string rather than deleted. src/config.js loads .env without
// overriding what the test already set, and dotenv skips a key that is already
// present on process.env. Deleting it therefore let the developer's real
// INDEXNOW_KEY out of .env, and the test below quietly stopped testing the case
// it exists for as soon as the owner configured IndexNow on their own machine.
process.env.INDEXNOW_KEY = '';

const { pingIndexNow, isIndexNowConfigured } = await import('../src/indexnow.js');

test('không có khoá thì coi như chưa cấu hình', () => {
  assert.equal(isIndexNowConfigured(), false);
});

test('không có khoá thì không gửi gói tin nào ra ngoài', async () => {
  let called = false;
  const result = await pingIndexNow(['/', '/product/spark'], { fetchImpl: async () => { called = true; return { ok: true, status: 200 }; } });
  assert.equal(called, false, 'không được gọi ra ngoài khi chưa cấu hình');
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'not-configured');
});
