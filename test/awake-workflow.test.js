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
// Both shapes a schedule here can take, because the cadence changed once already
// and a checker that only understood the old one would have blocked the fix.
//   "*/30 * * * *"  every 30 minutes
//   "0 5 * * *"     once a day, at 05:00
// GitHub rounds every job on a private repository up to a whole minute, so the
// number of jobs per month IS the number of minutes spent. That is the constraint,
// not a guideline.
const jobsPerMonth = (expression) => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return 0;
  const [minute, hour] = parts;
  if (minute.startsWith('*/')) {
    const every = Number(minute.slice(2));
    return Number.isFinite(every) && every > 0 ? (60 * 24 * 30) / every : 0;
  }
  // A pinned minute and hour, every day. Anything with a day-of-month or day-of-week
  // field is not a daily schedule and is not counted here, so an exotic expression
  // reports 0 and fails loudly instead of passing unnoticed.
  if (hour === '*' || minute === '*') return 0;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return 0;
  if (parts[2] !== '*' || parts[3] !== '*' || parts[4] !== '*') return 0;
  return 30;
};

test('nhịp giám sát phải nằm trong hạn mức GitHub Actions miễn phí', () => {
  assert.ok(cron, 'phải có một lịch chạy');
  const jobs = jobsPerMonth(cron);
  assert.ok(jobs > 0, `không tính được số job/tháng từ cron "${cron}" — thêm dạng mới vào jobsPerMonth()`);
  assert.ok(
    jobs <= 2000,
    `${jobs} job/tháng × 1 phút làm tròn = ${jobs} phút, vượt hạn mức 2000 phút miễn phí của repo private. Render free sẽ ngủ và job sẽ bị chặn.`,
  );
  // And the headroom is deliberate, not luck: the daily cadence is what pays for
  // `checks.yml`, which runs the real suite on three Node versions.
  assert.ok(jobs <= 200,
    `${jobs} job/tháng là quá nhiều cho một lưới an toàn — Worker đã giữ thức mỗi phút, lịch này chỉ còn báo động`);
});

test('file này phải nói rõ mình không phải thứ đánh thức', () => {
  // A daily check is even more obviously not a waker than a thirty-minute one was,
  // so the file has to say so in its own words. A reader who skims to the cron line
  // and assumes it keeps the instance up would not notice anything wrong for weeks —
  // the instance would simply be slow, sometimes, and eventually cold.
  assert.ok(!/workflow_dispatch:[\s\S]*?cron/.test(source), 'cron phải nằm trong schedule');
  assert.match(source, /it cannot be that|is not the waker|Waking is therefore/i, 'phải nói rõ đây không phải thứ đánh thức');
  assert.match(source, /Cloudflare Worker/i, 'phải chỉ ra ai đảm nhiệm việc đánh thức');
  // UptimeRobot was named here for months and is not configured anywhere in this
  // repository. A comment that credits the wrong component is worse than none: it
  // sends the next person to inspect a service that does not exist, and it hides the
  // fact that the real waker is one file away in cloudflare/keep-awake.
  assert.ok(!/UptimeRobot/.test(source), 'UptimeRobot không được cấu hình ở đâu — đừng ghi nó là thứ đánh thức');
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
  //
  // This test used to assert that the string "SHOP_URL" appears in the file, and to
  // whitelist the hardcoded onrender.com address as the one permitted literal. Both
  // were satisfiable by a workflow in which the configuration did nothing at all —
  // and it did nothing at all, because SHOP_URL was a shell variable that GitHub never
  // put in the step's environment. The test was named "not hardcoded", whitelisted the
  // hardcoded address, and stayed green on the broken file. A test that passes while the
  // property in its name is false is worse than no test, because it is trusted.
  //
  // So it now asserts the wiring instead of the name: the repository variable has to
  // be declared into the job's environment, which is the only way `${SHOP_URL:-...}`
  // in the run step can ever see it.
  assert.match(source, /SHOP_URL:\s*\$\{\{\s*vars\.SHOP_URL\s*\}\}/,
    'phải khai báo SHOP_URL từ vars.SSHOP_URL để bước run thấy được — nếu không, đặt biến repo không có tác dụng gì');
  // And the declaration has to be on the job that runs the step, not merely somewhere
  // in the file, since a workflow-level or unrelated-job env would not reach it.
  // Read the job's own env: block rather than pattern-matching through it, so a comment
  // explaining the declaration does not make the assertion stop matching.
  const job = source.slice(source.indexOf('\n  check:'));
  const envBlock = (job.match(/^ {4}env:\n([\s\S]*?)^ {4}\S/m) || [])[1] || '';
  assert.match(envBlock, /SHOP_URL:\s*\$\{\{\s*vars\.SHOP_URL\s*\}\}/,
    'khai báo phải nằm trong env của job `check`, không phải ở workflow hay job khác');

  // No fallback address may exist anywhere in this file.
  //
  // The test used to permit exactly one — the Render host the shop ran on before
  // it moved to a VPS — on the reasoning that a default is useful until someone
  // sets the variable. In practice nobody set the variable, so the watch spent
  // every scheduled run probing a host that still answered and was no longer the
  // shop. Green every time, and the monitoring had been disarmed by a domain
  // change without a single red run.
  //
  // A default that outlives the thing it defaults for is not a fallback, it is a
  // silent opt-out. So: no address is written in this file at all, and the run
  // step reports that it checked nothing when the variable is absent. Exiting 0
  // there is deliberate and matches the PayPal warning lower in the same file —
  // a schedule that goes red for something nobody can fix from the log teaches
  // people not to read the log.
  assert.ok(
    !/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(source),
    'workflow không được gõ bất kỳ địa chỉ nào — kể cả địa chỉ dự phòng. Địa chỉ dự phòng tồn tại lâu hơn thứ nó dự phòng cho, và khi đó bộ theo dõi âm thầm trỏ sang máy chủ cũ.',
  );
  // `${SHOP_URL:-}` with an empty default is the idiom for "read it safely under
  // `set -u`" and is fine. What must not appear is a default with a value in it,
  // which is the same as writing the address down.
  //
  // Comments are stripped first. The header of this file discusses the very
  // pattern by name, and a check that reads its own documentation as a violation
  // is a check that will be "fixed" by deleting the explanation.
  const runnable = source.replace(/^\s*#.*$/gm, '');
  for (const match of runnable.matchAll(/\$\{SHOP_URL:-([^}]*)\}/g)) {
    assert.equal(match[1].trim(), '',
      `SHOP_URL có giá trị mặc định "${match[1]}" — tức là địa chỉ đã bị gõ cứng, dù nó nằm trong cú pháp \${VAR:-}`);
  }
  assert.match(runnable, /url="\$SHOP_URL"/,
    'sau khi kiểm tra rỗng thì dùng $SHOP_URL trực tiếp, không bọc lại trong \${...:-}');

  // And the absent case has to be handled, not left to `set -u` killing the step.
  assert.match(source, /if \[ -z "\$\{SHOP_URL:-\}" \]/,
    'phải xử lý trường hợp SHOP_URL rỗng trước khi dùng, nếu không `set -u` sẽ dừng bước run');
  assert.match(source, /exit 0\s*\n\s*fi/,
    'khi chưa cấu hình thì báo rõ và exit 0 — không fail, vì đây là cấu hình còn thiếu chứ không phải shop hỏng');
});