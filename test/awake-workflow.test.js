import test from 'node:test';
import assert from 'node:assert/strict';
// The shop's test environment, applied before anything imports src/.
import './helpers/env.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This workflow began as the thing that keeps Render's free instance awake, and the
// arithmetic said it could not be:
//
//   waking needs a ping under 15 minutes = at least 4,320 jobs a month
//   GitHub rounds each job on a private repo up to a whole minute
//   a private repository gets 2,000 free minutes a month
//
// So it exhausts its quota halfway through the month, GitHub stops running the rest,
// and the instance sleeps anyway — while the monitor that was supposed to notice has
// also stopped. That last part is why it is worth a test: the failure is silent, and
// the natural edit is to put the interval back to ten minutes, which looks obviously
// more correct than what is there.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, '.github', 'workflows', 'keep-awake.yml');
const source = await fs.readFile(file, 'utf8');

const cron = (source.match(/cron:\s*"([^"]+)"/) || [])[1] || '';
const minutesBetween = (expression) => {
  if (!expression.startsWith('*/')) return null;
  return Number(expression.slice(2).split(' ')[0]);
};

test('nhịp giám sát phải nằm trong hạn mức GitHub Actions miễn phí', () => {
  // A private repository gets 2,000 minutes a month and GitHub rounds every job up
  // to one. So the number of jobs per month is the number of minutes, and this is
  // the whole constraint — not a guideline that can be nudged.
  assert.ok(cron, 'phải có một lịch chạy');
  const every = minutesBetween(cron);
  assert.ok(every, `cron "${cron}" phải là một khoảng phút cụ thể để tính được — ví dụ "*/30 * * * *"`);
  const jobsPerMonth = (60 * 24 * 30) / every;
  assert.ok(
    jobsPerMonth <= 2000,
    `${jobsPerMonth} job/tháng × 1 phút làm tròn = ${jobsPerMonth} phút, vượt hạn mức 2000 phút miễn phí của repo private. Render free sẽ ngủ và job sẽ bị chặn.`,
  );
});

test('file này phải nói rõ mình không phải thứ đánh thức', () => {
  // Thirty minutes is correct here and would be wrong in a waker, which is why the
  // file says so in its own words. A reader who skims to the cron line and assumes it
  // keeps the instance up would not notice anything wrong for weeks — the instance
  // would simply be slow, sometimes, and eventually cold.
  assert.ok(!/workflow_dispatch:[\s\S]*?cron/.test(source), 'cron phải nằm trong schedule');
  assert.match(source, /it cannot be that|is not the waker|Waking is therefore/i, 'phải nói rõ đây không phải thứ đánh thức');
  assert.match(source, /UptimeRobot/, 'phải chỉ ra ai đảm nhiệm việc đánh thức');
  // And the reason has to be the arithmetic, so that nobody re-derives it by hand.
  assert.match(source, /4[.,]?320/, 'phải ghi con số tính ra');
  assert.match(source, /2[.,]?000/, 'phải ghi hạn mức');
});

test('không được đưa secret vào lịch chạy định kỳ', () => {
  // A schedule that can read ADMIN_API_TOKEN is a schedule that could refund orders.
  // The endpoint being watched is public, so nothing needs it.
  assert.match(source, /permissions:\s*\n\s+contents: read/, 'phải giới hạn quyền');
  const secrets = [...source.matchAll(/secrets\.\w+/g)];
  assert.deepEqual(secrets.map((m) => m[0]), [], 'lịch chạy định kỳ không được đọc secret nào');
  assert.ok(!/ADMIN_API_TOKEN\s*=\s*\$/.test(source), 'không được chuyền admin token vào job');
});

test('phải phân biệt "trả lời" với "đang bán"', () => {
  // The endpoint answers 503 when a dependency is down, and can answer 200 with
  // ok:false. A check that only looks at the status code passes a shop with no
  // database, which is the case worth catching.
  assert.match(source, /"ok":true/, 'phải đọc trường ok, không chỉ mã HTTP');
  assert.match(source, /code.*!=.*"200"/s, 'phải kiểm mã HTTP');
  // And the two questions have to be separate failures, not one combined condition.
  assert.match(source, /ok=false/, 'trường hợp ok=false phải được nêu riêng');
});

test('địa chỉ lấy từ cấu hình repo, không gõ cứng trong workflow', () => {
  // A domain change should be one edit. A hardcoded address here means the watch is
  // pointed at last year's host and nobody notices, because it keeps reporting on
  // something perfectly healthy.
  assert.match(source, /SHOP_URL/, 'phải đọc từ biến SHOP_URL của repo');
  assert.ok(
    !/https:\/\/(?!sonvudev-store\.onrender\.com)[a-z0-9.-]+\.[a-z]{2,}/i.test(source.replace(/sonvudev-store\.onrender\.com/g, '')),
    'không được gõ một địa chỉ khác vào workflow',
  );
});