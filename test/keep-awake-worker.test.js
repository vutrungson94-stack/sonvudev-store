import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';
import { withinWindow, ping } from '../cloudflare/keep-awake/worker.js';

// Asia/Ho_Chi_Minh is UTC+7 year-round. The helper under test answers in
// shop-local time, so instants are built here from UTC arithmetic and never from
// the test machine's zone — otherwise these tests pass on a machine set to ICT
// and fail on one set to anything else, which is the mirror image of the bug they
// exist to catch.
//
// atIct(h) is the instant at which it is exactly h o'clock in the shop's timezone.
const atIct = (ictHour, minute = 0) => Date.UTC(2026, 2, 10, ictHour - 7, minute);
const utcHourOf = (ictHour) => new Date(atIct(ictHour)).getUTCHours();

test('giờ ICT được tính đúng, không phụ thuộc múi giờ máy chạy test', () => {
  assert.equal(utcHourOf(19), 12, '19:00 ICT là 12:00 UTC');
  assert.equal(utcHourOf(5), 22, '05:00 ICT là 22:00 UTC hôm trước');
  assert.equal(utcHourOf(12), 5, '12:00 ICT là 05:00 UTC');

  assert.equal(withinWindow(atIct(19), 5, 24), true, '19:00 ICT nằm trong cửa sổ 05-24');
  assert.equal(withinWindow(atIct(4), 5, 24), false, '04:00 ICT nằm ngoài cửa sổ 05-24');
  assert.equal(withinWindow(atIct(5), 5, 24), true, 'đúng giờ mở cửa sổ thì thức');
});

test('cửa sổ thức là nửa mở, và bằng nhau thì không phải cả ngày', () => {
  // [from, to). An inclusive comparison would make AWAKEN_FROM == AWAKEN_TO mean
  // "always", which is the opposite of what an operator narrowing the window to
  // nothing intends — and it would do it by spending 744 of 750 monthly hours.
  assert.equal(withinWindow(atIct(9), 9, 9), false,
    'from == to nghĩa là không bao giờ thức, không phải luôn thức');
  assert.equal(withinWindow(atIct(12), 9, 17), true, 'giữa cửa sổ thì thức');
  assert.equal(withinWindow(atIct(9), 9, 17), true, 'đầu cửa sổ thì thức');
  assert.equal(withinWindow(atIct(17), 9, 17), false, 'cuối cửa sổ thì ngủ');
  assert.equal(withinWindow(atIct(8), 9, 17), false, 'trước cửa sổ thì ngủ');
});

test('cửa sổ xuyên qua nửa đêm vẫn hoạt động', () => {
  // A shop selling software to another timezone trades late. Expressing that as
  // from > to — 22 to 6 — is what a cron expression does, and rejecting it at
  // configuration time would leave that shop with no keeper at all.
  assert.equal(withinWindow(atIct(23), 22, 6), true, '23:00 ICT trong 22-06');
  assert.equal(withinWindow(atIct(2), 22, 6), true, '02:00 ICT trong 22-06');
  assert.equal(withinWindow(atIct(6), 22, 6), false, '06:00 ICT là cuối cửa sổ');
  assert.equal(withinWindow(atIct(21), 22, 6), false, '21:00 ICT ngoài 22-06');
  assert.equal(withinWindow(atIct(12), 22, 6), false, '12:00 ICT ban ngày, ngoài 22-06');
});

test('cửa sổ mặc định 05-24 giữ shop thức trong giờ mua hàng, và chừa dư địa', () => {
  // A 31-day month is 744 hours. Always-awake therefore fits — 744 of 750 — but
  // with six hours of margin, under one percent. That is the whole argument for a
  // window: the failure mode when the allowance runs out is not a bill, it is
  // Render suspending every free service in the workspace until the first of the
  // next month, which for a shop is a month of downtime. Six hours of margin is
  // not enough to be comfortable with a month of downtime as the downside.
  const HOURS_IN_MONTH = 31 * 24;
  const FREE_INSTANCE_HOURS = 750;

  const awake = Array.from({ length: 24 }, (_, hour) => hour)
    .filter((hour) => withinWindow(atIct(hour), 5, 24));
  assert.equal(awake.length, 19, '00:00-04:59 ICT ngủ, 05:00-23:59 thức');

  const windowed = awake.length * 31;
  assert.ok(windowed < FREE_INSTANCE_HOURS,
    `cửa sổ mặc định phải nằm dưới trần 750 giờ, đang là ${windowed}`);
  assert.ok(FREE_INSTANCE_HOURS - windowed > 100,
    `cửa sổ mặc định phải chừa hơn 100 giờ dự phòng, đang chừa ${FREE_INSTANCE_HOURS - windowed}`);

  // And the always-on case, as the number it actually is.
  const alwaysOn = HOURS_IN_MONTH;
  assert.equal(alwaysOn, 744, '24/7 là 744 giờ trong tháng 31 ngày');
  assert.ok(FREE_INSTANCE_HOURS - alwaysOn < HOURS_IN_MONTH * 0.01,
    `24/7 chỉ chừa ${FREE_INSTANCE_HOURS - alwaysOn} giờ — dưới 1% — nên một sự cố kéo dài vài giờ là đủ vượt trần`);
});

// `ping` uses the global fetch, so the stub replaces it and is put back afterwards.
// The tests below never touch the network: the repo's own rule is that a test which
// reaches out is a test that fails on someone else's machine.

test('ping coi ok:false là hỏng, không chỉ nhìn mã HTTP', async () => {
  // /api/health answers 200 with ok:false when R2 or the database is unreachable —
  // the shop is up and unable to take an order. A keeper that looked only at the
  // status code would call that success, every minute, forever.
  const answer = async (status, body) => {
    globalThis.fetch = async () => new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
  };
  const original = globalThis.fetch;
  try {
    await answer(200, { ok: true, checks: { database: 'ok', storage: 'ok' } });
    assert.deepEqual(await ping('https://shop.example'), { ok: true, status: 200, detail: 'ok' });

    await answer(200, { ok: false, checks: { database: '!supabase unreachable' } });
    const degraded = await ping('https://shop.example');
    assert.equal(degraded.ok, false, 'ok:false phải là hỏng dù HTTP là 200');
    assert.match(degraded.detail, /ok:false/);
    assert.match(degraded.detail, /supabase/, 'phải nêu phần nào hỏng, không chỉ báo đỏ');

    await answer(503, { ok: false, checks: {} });
    const down = await ping('https://shop.example');
    assert.equal(down.ok, false);
    assert.match(down.detail, /HTTP 503/);
  } finally {
    globalThis.fetch = original;
  }
});

test('ping trả về kết quả thay vì ném, kể cả khi host không trả lời', async () => {
  // A keeper that throws on a slow response is retried on Cloudflare's own
  // schedule, turning one slow health check into a loop against a shop that is
  // merely slow.
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new Error('fetch failed'), { name: 'TypeError' }); };
  try {
    const result = await ping('https://shop.example', 2000);
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.ok(result.detail.length > 0, 'phải nói lý do, không phải chỉ "false"');
  } finally {
    globalThis.fetch = original;
  }
});

test('ping bỏ dấu / ở cuối để không sinh //api/health', async () => {
  const original = globalThis.fetch;
  let called = '';
  globalThis.fetch = async (url) => {
    called = String(url);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    await ping('https://shop.example/');
    assert.equal(called, 'https://shop.example/api/health');
    await ping('https://shop.example');
    assert.equal(called, 'https://shop.example/api/health');
  } finally {
    globalThis.fetch = original;
  }
});