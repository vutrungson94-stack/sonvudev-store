import test from 'node:test';
import assert from 'node:assert/strict';
// The shop's test environment, applied before anything imports src/.
import './helpers/env.mjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/seo-check.mjs is the one gate that reads a deployed site rather than the
// code, and it is wired to a job that runs on every push to the live branch. That
// combination is what makes its exit code matter more than any other in the project.
//
// It used to exit 1 when there was no APP_URL. The runner has no .env and the
// repository had no APP_URL secret, so the job printed "Thiếu APP_URL" and went red
// on every single push — six in a row before anybody asked why. A gate that is always
// red is a gate nobody reads, and that is not a cosmetic problem: the push where the
// sitemap really does list a 404 arrives in exactly the same email as the other six.
//
// So the rule is that "nothing to check" and "checked and failed" must not look alike.
// Both of the halves are asserted here, because asserting only the easy one would let
// the script drift back to "skip everything when the network looks odd".
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'seo-check.mjs');

const run = (args, env) => spawnSync(process.execPath, [script, ...args], {
  encoding: 'utf8',
  // A deliberately bare environment: this test is about what happens when APP_URL is
  // absent, so it must not be answered by the developer's .env.
  env: { PATH: process.env.PATH, ...env },
  timeout: 60000,
});

test('khong co APP_URL thi bo qua, khong phai fail', () => {
  // APP_URL is set to an empty string rather than deleted, because dotenv does not
  // overwrite a key that is already present — an absent key would let the script's
  // own dotenv.config() fill it in from .env and the test would pass for the wrong
  // reason on a machine that has one.
  const result = run([], { APP_URL: '' });
  assert.equal(result.status, 0, `phai bo qua (exit 0), thuc te exit ${result.status}\n${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /Bỏ qua/, 'phải nói rõ là bỏ qua chứ không phải pass');
  // The distinction that matters: a skipped run must not look like a checked one.
  assert.doesNotMatch(result.stdout, /\d+\/\d+ kiểm tra SEO đạt/, 'một lần bỏ qua không được in ra bảng điểm');
  assert.doesNotMatch(result.stdout, /\bPASS\b/, 'không được in PASS khi không kiểm tra gì');
  assert.match(result.stdout, /seo:check -- https/, 'phải chỉ ra cách chạy thật');
});

test('có APP_URL mà trang không trả lời thì vẫn fail', () => {
  // The half that must not regress. Port 1 on loopback refuses immediately, so this
  // costs nothing and needs no network. A skip here would mean a dead site passes
  // because the checker could not reach it, which is the failure the exit code exists
  // to prevent.
  const result = run(['http://127.0.0.1:1'], { APP_URL: '' });
  assert.equal(result.status, 1, `một URL cho sẵn mà hỏng thì phải đỏ, thực tế exit ${result.status}\n${result.stdout}${result.stderr}`);
  assert.match(result.stdout + result.stderr, /FAIL/, 'phải báo FAIL');
});

test('đúng lệnh CI chạy trên runner sạch thì không đỏ', async () => {
  // Đây là bản tái hiện nguyên văn lỗi đã báo: workflow chạy
  //   npm run seo:check -- "${{ secrets.APP_URL }}"
  // và trên runner chưa có secret đó, tham số là chuỗi rỗng. Không có .env trên
  // runner. Kết quả cũ: exit 1, đỏ, sáu lần liên tiếp.
  //
  // Chạy đúng hình dạng đó — có tham số rỗng, không phải không có tham số — vì
  // `npm run x -- ""` và `npm run x` là hai lệnh khác nhau và chỉ một trong hai
  // là thứ workflow thật sự làm.
  const result = run([''], { APP_URL: '' });
  assert.equal(result.status, 0, `lệnh của workflow không được đỏ trên runner sạch, thực tế exit ${result.status}\n${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /Bỏ qua/, 'phải báo là bỏ qua');
});

test('workflow truyền secret vào đúng chỗ, nên tự khỏi đỏ khi secret có mặt', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync(path.join(root, '.github', 'workflows', 'checks.yml'), 'utf8');
  // Không đòi secret tồn tại — đó là việc của chủ repo và không ai test được. Đòi
  // cái khác: khi secret có mặt, nó phải thật sự chạy vào script, chứ không bị
  // nuốt. Một workflow đỏ vĩnh viễn vì đọc sai chỗ sẽ không bao giờ tự hết.
  assert.match(workflow, /npm run seo:check -- "\$\{\{\s*secrets\.APP_URL\s*\}\}"/,
    'workflow phải truyền secrets.APP_URL làm tham số cho seo:check');
  // Job checks đặt APP_URL cố định để audit có ý nghĩa. Job deployed-site thì không
  // được: nếu nó cũng đặt APP_URL, thì tham số rỗng sẽ bị nuốt và script sẽ kiểm
  // tra một domain giả thay vì báo bỏ qua.
  const deployed = workflow.slice(workflow.indexOf('deployed-site:'));
  assert.ok(!/^\s{4}APP_URL:/m.test(deployed), 'job deployed-site không được đặt APP_URL cứng — nó sẽ thắng giá trị secret');
});