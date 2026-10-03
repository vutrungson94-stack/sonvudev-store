import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';
import { report } from '../scripts/health-check.mjs';

// A complete host. If a check fails against this, the check is wrong.
const HEALTHY = {
  ok: true,
  persistence: 'supabase',
  checks: { database: 'ok', storage: 'skipped (supabase)' },
  r2: true,
  paypal: true,
  paypalWebhook: true,
  paypalWebhookId: '7CXZV26ZRB62C4Q3',
  paypalEnvironment: 'live',
  bank: true,
  momo: true,
  zalopay: true,
  admin: true,
  appUrl: 'https://sonvudev.com',
  email: 'resend',
};

const text = (result) => result.lines.map((line) => line.text).join('\n');

test('một host đầy đủ không báo thiếu gì', () => {
  const result = report(HEALTHY);
  assert.equal(result.failures, 0, `không có dòng XX nào được phép xuất hiện:\n${text(result)}`);
  assert.ok(result.lines.every((line) => line.state === 'ok'), 'mọi dòng phải là OK khi đủ cấu hình');
});

test('sandbox không được báo là đủ — đây là dòng đáng giá nhất', () => {
  // Every other field on /api/health can be green while this one is wrong.
  // Sandbox credentials authenticate against the sandbox API without complaint:
  // the shop looks healthy, accepts the order, and the capture is refused for
  // money that is never real. It is also the field a mistyped variable name
  // fails to set — PAYPAL_ENVIRONMENT missing falls back to sandbox by design.
  for (const value of ['sandbox', 'unset (treated as sandbox)', undefined]) {
    const result = report({ ...HEALTHY, paypalEnvironment: value });
    assert.equal(result.failures, 1, `paypalEnvironment=${value} phải báo thiếu`);
    assert.match(text(result), /PAYPAL_ENVIRONMENT=live/,
      'dòng lỗi phải chỉ đúng tên biến để sửa');
  }
});

test('mỗi tích hợp bắt buộc đều có thể phát hiện khi thiếu', () => {
  // One removal at a time. A check that cannot fail is decoration, and this file
  // exists because the failure it is for produced no error anywhere.
  const cases = [
    ['persistence', { persistence: 'local-json' }, /SUPABASE_URL/],
    ['database', { checks: { database: '!supabase', storage: 'skipped (supabase)' } }, /service role key/],
    ['paypal', { paypal: false }, /PAYPAL_CLIENT_ID/],
    ['paypalWebhook', { paypalWebhook: false }, /PAYPAL_WEBHOOK_ID/],
    // A webhook id that is set but absent from the payload means the host predates
    // this field. Not a failure of the host — but the report has to say so, or the
    // mismatch check silently stops covering anyone who has not redeployed yet.
    ['paypalWebhookId', { paypalWebhookId: null }, /PAYPAL_WEBHOOK_ID/],
    ['email', { email: 'outbox' }, /RESEND_API_KEY/],
    ['bank', { bank: false }, /BANK_ACCOUNT_NUMBER/],
    ['r2', { r2: false }, /R2_ACCOUNT_ID/],
    ['admin', { admin: false }, /ADMIN_API_TOKEN/],
    ['appUrl', { appUrl: 'http://sonvudev-store.onrender.com' }, /APP_URL=https/],
  ];
  for (const [name, patch, mustMention] of cases) {
    const result = report({ ...HEALTHY, ...patch });
    assert.equal(result.failures, 1, `bỏ ${name} thì phải báo đúng 1 thiếu`);
    assert.match(text(result), mustMention,
      `dòng lỗi của ${name} phải nêu tên biến để sửa được, không chỉ nói "không có"`);
  }
});

test('tích hợp tuỳ chọn thiếu thì báo "không ảnh hưởng", không tính vào lỗi', () => {
  const result = report({ ...HEALTHY, momo: false, zalopay: false });
  assert.equal(result.failures, 0, 'thiếu MoMo/ZaloPay không phải lỗi');
  const skipped = text(result);
  assert.match(skipped, /MoMo .*không ảnh hưởng/);
  assert.match(skipped, /ZaloPay .*không ảnh hưởng/);
  // And it still says something — a line that is not printed is not information.
  assert.ok(result.lines.some((line) => line.state === 'skip'));
});

test('checks.storage "skipped (supabase)" là kết quả ĐÚNG trên host read-only', () => {
  // Every serverless platform deploys the code as a bundle, so no writable disk
  // anywhere except /tmp. Treating "skipped" as a failure would report a healthy
  // host as broken on every platform that hosts it for free.
  const result = report({ ...HEALTHY, checks: { database: 'ok', storage: 'skipped (supabase)' } });
  assert.equal(result.failures, 0, '"skipped" nghĩa là probe không cần chạy, không phải là hỏng');

  // But a genuine failure still fails.
  const broken = report({ ...HEALTHY, checks: { database: 'ok', storage: '!data not writable' } });
  assert.equal(broken.failures, 1, 'storage hỏng thật thì phải báo');
});

test('báo cáo chỉ in tên biến, không in giá trị', () => {
  // The whole input is public — /api/health needs no token — so there is nothing
  // secret to leak from here. What matters is that if this is ever extended to
  // show more of the payload, it still cannot echo a credential.
  //
  // The test feeds it credential-shaped strings and checks they do not come back
  // out. Asserting on the word "token" instead would be wrong, and was: the report
  // is *supposed* to print ADMIN_API_TOKEN, because naming the variable is the
  // entire reason the line is useful. A name is not a value.
  const secrets = {
    r2Secret: 'SUPERSECRETVALUE1',
    databaseUrl: 'postgresql://user:hunter2@db.internal/svprod',
    webhookSecret: 'whsec_0123456789abcdef',
    liveKey: 'sk_live_0123456789abcdef',
  };
  const output = text(report({ ...HEALTHY, ...secrets }));
  for (const value of Object.values(secrets)) {
    assert.ok(!output.includes(value), `báo cáo lọt ra giá trị: ${value}`);
  }

  // And it must still name the variables — that is what makes a failure fixable.
  // One integration is removed here so the fix line actually prints; against a
  // fully healthy payload there is nothing to name.
  const missing = text(report({ ...HEALTHY, admin: false }));
  assert.match(missing, /ADMIN_API_TOKEN/, 'phải nêu tên biến, không phải chỉ nói "thiếu gì đó"');
  assert.doesNotMatch(missing, /SUPERSECRETVALUE1|hunter2|whsec_0123|sk_live_0123/,
    'dòng lỗi vẫn không được lọt giá trị nào ra');
});
