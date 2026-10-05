import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePaypalEnvironment } from '../src/paypal-environment.js';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';

// PAYPAL_ENVIRONMENT decides whether the shop can take real money, and it used to
// fall back to "sandbox" when unset — or when a typo made it anything but the exact
// string "live". Both defaults are quiet, and quiet is the whole problem: sandbox
// credentials authenticate against the sandbox API without complaint, so the check
// printed "authenticated" for a shop that cannot capture a single real payment. The
// order sat pending, the buyer had paid, and nothing anywhere said why.
//
// An unset or unrecognised value has to fail. These tests exercise the rule itself
// rather than the script that reads it, because the script loads .env with override
// and a test cannot set a variable that is about to be replaced.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFile(path.join(root, relative), 'utf8');

test('thiếu biến thì không được coi là đã quyết, dù vẫn dùng sandbox để an toàn', () => {
  for (const value of [undefined, null, '', '   ']) {
    const result = resolvePaypalEnvironment(value);
    assert.equal(result.isSet, false, `"${value}" phải là chưa quyết`);
    // Sandbox is still the endpoint, because it is the only choice that cannot charge
    // anyone by accident. That is a safety floor, not a decision.
    assert.equal(result.environment, 'sandbox');
    assert.equal(result.apiBase, 'https://api-m.sandbox.paypal.com');
    assert.match(result.reason, /thiếu PAYPAL_ENVIRONMENT/);
  }
});

test('sai chính tả thì cũng không được coi là đã quyết', () => {
  // Only the two words count. "prod", "production" and "true" all read as "live" to
  // a person in a hurry, and every one of them used to mean sandbox — the direction
  // that fails quietly rather than loudly. "live-ish" is the shape of a config value
  // someone wrote while unsure.
  for (const value of ['prod', 'production', 'sandbox2', 'true', 'false', 'live-ish', 'l ive', 'test']) {
    const result = resolvePaypalEnvironment(value);
    assert.equal(result.isSet, false, `"${value}" phải bị từ chối`);
    assert.match(result.reason, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('chữ hoa và khoảng trắng thừa vẫn được chấp nhận', () => {
  // Deliberately not a typo. "LIVE" is the same word with the shift key held, and
  // rejecting it would teach people that this variable is fussy while "prod" — which
  // genuinely means something different — still passed. How people actually type
  // these matters; guessing at intent does not.
  assert.equal(resolvePaypalEnvironment('Live').isSet, true);
  assert.equal(resolvePaypalEnvironment('LIVE').isSet, true);
  assert.equal(resolvePaypalEnvironment(' live ').environment, 'live');
  assert.equal(resolvePaypalEnvironment('SANDBOX').environment, 'sandbox');
});

test('hai giá trị hợp lệ thì dùng đúng endpoint', () => {
  assert.deepEqual(resolvePaypalEnvironment('live'), {
    environment: 'live', isSet: true, apiBase: 'https://api-m.paypal.com', reason: '',
  });
  assert.deepEqual(resolvePaypalEnvironment('sandbox'), {
    environment: 'sandbox', isSet: true, apiBase: 'https://api-m.sandbox.paypal.com', reason: '',
  });
});

test('config và production-check dùng chung một quy tắc', async () => {
  // The rule used to be written out twice, and the two copies agreed by accident.
  // That is how a host could be configured one way and checked another, which is the
  // same class of drift this project keeps removing elsewhere.
  const config = await read('src/config.js');
  const check = await read('scripts/production-check.mjs');
  assert.match(config, /resolvePaypalEnvironment\(value\("PAYPAL_ENVIRONMENT"\)\)/, 'config.js phải dùng hàm chung');
  assert.match(check, /resolvePaypalEnvironment\(value\("PAYPAL_ENVIRONMENT"\)\)/, 'production-check phải dùng hàm chung');
  assert.ok(!/environment: value\("PAYPAL_ENVIRONMENT", "sandbox"\)/.test(config), 'không được mặc định im lặng là sandbox trong config');
  assert.ok(!/PAYPAL_ENVIRONMENT"\) \|\| "sandbox"/.test(check), 'production-check không được tự đặt mặc định');
});

// setup-paypal.mjs was the third copy, and the worst-placed one: it is the script
// that verifies a credential set and registers the webhook. Defaulting to sandbox
// there meant it authenticated against sandbox and printed "Credential hợp lệ"
// while the shop was configured for live — so the tool whose whole job is to catch
// that disagreement was the one making it.
test('setup-paypal cũng dùng chung quy tắc, không tự mặc định sandbox', async () => {
  const setup = await read('scripts/setup-paypal.mjs');
  assert.match(setup, /resolvePaypalEnvironment\(env\("PAYPAL_ENVIRONMENT"\)\)/,
    'setup-paypal phải hỏi đúng hàm chung');
  assert.ok(!/PAYPAL_ENVIRONMENT"\)\s*\|\|\s*"sandbox"/.test(setup),
    'setup-paypal không được tự mặc định sandbox');
  assert.match(setup, /if \(!resolved\.isSet\)/,
    'khi chưa quyết được thì phải báo và không tạo webhook ở môi trường nào');
  // And no fetch in it without a timeout: a stalled endpoint used to hang the script
  // to the OS TCP timeout with nothing on screen.
  const fetches = [...setup.matchAll(/fetch\(([\s\S]*?)\n\s*\}\);/g)];
  assert.ok(fetches.length > 0, 'phải còn fetch trong script');
  for (const [, body] of fetches) {
    assert.match(body, /signal:\s*AbortSignal\.timeout\(/,
      'mọi fetch trong setup-paypal phải có timeout');
  }
});

test('môi trường không rõ thì PayPal bị coi là chưa cấu hình, nên không mở lựa chọn đó', async () => {
  // The shop keeps running — bank transfer still works — but the checkout form must
  // not offer a rail that cannot take money. Offering it is the failure; hiding it is
  // the fix, and it belongs where the option is decided.
  const config = await read('src/config.js');
  assert.match(config, /paypal: paypalEnv\.isSet && configured\("PAYPAL_CLIENT_ID"\)/, 'isConfigured.paypal phải đòi biến môi trường rõ ràng');
  const app = await read('src/app.js');
  assert.match(app, /paypalEnvironment: paypalEnvironmentIsSet/, 'health phải báo môi trường PayPal');
  assert.match(app, /unset \(treated as sandbox\)/, 'phải phân biệt "chưa đặt" với "đã đặt sandbox"');
});