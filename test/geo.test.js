import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentOptions } from '../src/payments.js';
import { isRoutable, createGeoResolver } from '../src/geo.js';

const both = { bank: true, momo: true, zalopay: true, paypal: true };
const ids = (list) => list.map((o) => o.id);

test('a Vietnamese visitor sees the bank transfer first', () => {
  const options = paymentOptions('VN', both);
  assert.equal(options[0].id, 'bank_transfer');
  assert.match(options[0].hint, /VietQR/);
});

test('an overseas visitor sees PayPal first', () => {
  const options = paymentOptions('US', both);
  assert.equal(options[0].id, 'paypal');
  assert.match(options[0].hint, /quốc tế|thẻ/i);
});

test('the country only reorders, it never removes a method', () => {
  // This is the point of the feature: a domestic buyer may still want PayPal
  // and an overseas buyer may still hold a Vietnamese bank account.
  for (const country of ['VN', 'US', 'JP', 'DE', null, undefined]) {
    assert.deepEqual(ids(paymentOptions(country, both)).sort(), ['bank_transfer', 'paypal'], `country=${country}`);
  }
});

test('an overseas visitor is warned that the bank rail needs a Vietnamese account', () => {
  const bank = paymentOptions('US', both).find((o) => o.id === 'bank_transfer');
  assert.equal(bank.available, false);
  assert.match(bank.hint, /ngân hàng Việt Nam/);
  const local = paymentOptions('VN', both).find((o) => o.id === 'bank_transfer');
  assert.equal(local.available, true);
});

test('an unknown country falls back to the domestic layout without a hint', () => {
  const options = paymentOptions(null, both);
  assert.equal(options[0].id, 'bank_transfer');
  assert.ok(options.every((o) => o.available === true));
});

test('only configured methods are offered', () => {
  assert.deepEqual(ids(paymentOptions('VN', { bank: true, paypal: false })), ['bank_transfer']);
  assert.deepEqual(ids(paymentOptions('US', { bank: false, paypal: true })), ['paypal']);
  assert.deepEqual(ids(paymentOptions('VN', { bank: false, paypal: false })), []);
});

test('the wallet hint only appears when a wallet is configured', () => {
  assert.match(paymentOptions('VN', { bank: true, momo: false, zalopay: false, paypal: true })[0].hint, /VietQR trong app/);
  assert.match(paymentOptions('VN', { bank: true, momo: true, zalopay: false, paypal: true })[0].hint, /MoMo/);
});

test('private and malformed addresses are never sent to a lookup provider', () => {
  for (const ip of ['', null, undefined, '127.0.0.1', '::1', '10.0.0.5', '192.168.1.1', '172.16.4.4', '169.254.1.1', 'not-an-ip', '999.1.1.1']) {
    assert.equal(isRoutable(ip), false, `expected ${ip} to be rejected`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '113.161.7.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isRoutable(ip), true, `expected ${ip} to be accepted`);
  }
});

test('the resolver returns null instead of failing when no provider answers', async () => {
  const failing = createGeoResolver({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(await failing({ ip: '8.8.8.8' }), null);
});

test('the resolver falls through to the second provider and caches the answer', async () => {
  const calls = [];
  const resolver = createGeoResolver({
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('ipapi.co')) return { ok: false, text: async () => '' };
      return { ok: true, text: async () => JSON.stringify({ success: true, country_code: 'vn' }) };
    },
  });
  assert.equal(await resolver({ ip: '8.8.8.8' }), 'VN');
  // A repeat visit must not hit the network again.
  assert.equal(await resolver({ ip: '8.8.8.8' }), 'VN');
  assert.equal(calls.length, 2);
});
