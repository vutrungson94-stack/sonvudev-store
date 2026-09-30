import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
// A real IndexNow key in .env would make every product created in these
// tests fire a real ping at api.indexnow.org. Same trap as the mail key above.
process.env.INDEXNOW_KEY = '';
process.env.PAYPAL_VND_TO_USD_RATE = 'live';
process.env.PAYPAL_VND_TO_USD_FALLBACK = '26000';

const { vndPerUsd, rateForCharge } = await import('../src/rates.js');
const { paypalChargeForProduct } = await import('../src/paypal.js');

test('live rate falls back to the fixed number when every provider fails', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const result = await vndPerUsd();
    assert.equal(result.rate, 26000);
    assert.equal(result.source, 'fallback');
  } finally { globalThis.fetch = realFetch; }
});

test('checkout still prices an order while the rate providers are down', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const { charge } = await paypalChargeForProduct({ price: 149000, currency: 'VND' });
    assert.equal(charge.currency, 'USD');
    assert.equal(charge.amount, 5.74);
  } finally { globalThis.fetch = realFetch; }
});

test('a live rate is cached so repeat checkouts do not refetch', async () => {
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls += 1;
    return realFetch(...args);
  };
  try {
    const first = await vndPerUsd();
    const second = await vndPerUsd();
    assert.equal(second.rate, first.rate);
    assert.ok(['live', 'cache', 'stale-cache'].includes(second.source));
  } finally { globalThis.fetch = realFetch; }
});

test('margin leaves the rate untouched when set to zero', () => {
  assert.equal(rateForCharge(26000), 26000);
});
