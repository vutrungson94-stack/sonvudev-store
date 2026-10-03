import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = () => readFile(path.join(root, '.github', 'workflows', 'checks.yml'), 'utf8');

// The deployed-site job is the only thing in the repository that ever looks at
// the running site. Everything else — 362 tests, 29 audit checks, the build —
// verifies source, and source being correct says nothing about whether the
// process that source was deployed into is answering.
//
// That makes its failure modes worth more attention than a typical CI job's, and
// the one that matters is the quiet one.
//
// seo:check exits 0 with a "skipped" line when it has no URL. That is right for
// a developer running it locally with no .env, and it was the reason the earlier
// version of this file could go green while inspecting nothing at all: the
// secret was absent, the script declined to guess, it exited 0, and the run said
// nothing about the fact that the live site had never been contacted.
//
// So the workflow now fails on the absent secret explicitly. The check and the
// checker's own fallbacks are two different things, and only the first one is
// allowed to decide.

test('job kiểm tra site thật sẽ FAIL khi thiếu secret APP_URL', async () => {
  const yaml = await workflow();

  // NOTE: `secrets` không dùng được trong `if:` (GitHub báo
  // "Unrecognized named-value: 'secrets'" và fail cả workflow với 0 job).
  // Nên secret được truyền qua `env` rồi kiểm tra rỗng trong `run`.
  // Test này khóa cơ chế đó lại, không khóa cú pháp cũ đã từng làm đỏ main.
  assert.match(yaml, /CHECK_URL:\s*\$\{\{\s*secrets\.APP_URL\s*\}\}/,
    'phải truyền secrets.APP_URL qua env cho bước kiểm tra');
  assert.match(yaml, /if\s*\[\s*-z\s*"\$CHECK_URL"\s*\]/,
    'phải có bước kiểm tra secret rỗng trong run');
  assert.match(yaml, /exit 1/,
    'bước đó phải exit 1 — không có secret thì bỏ chạy KHÔNG được báo xanh');

  // And it has to say which secret and where, or the run is a dead end.
  assert.match(yaml, /::error::[^\n]*APP_URL/,
    'phải nêu tên secret trong log');
  assert.match(yaml, /Secrets and variables/,
    'phải chỉ người đọc log tới đúng chỗ cài secret');
});

test('bước kiểm tra site vẫn chạy seo:check với secret, không tự gõ địa chỉ', async () => {
  const yaml = await workflow();

  assert.match(yaml, /npm run seo:check -- "\$\{\{\s*secrets\.APP_URL\s*\}\}"/,
    'phải truyền secret cho seo:check');

  // The same reason keep-awake.yml lost its Render fallback: a hardcoded address
  // outlives the thing it defaults for. After a domain change it keeps probing a
  // host that answers perfectly and is nobody's shop, and every run is green.
  //
  // The one exemption is a reserved name. The job sets APP_URL and SUPPORT_EMAIL
  // to https://ci-fixture.example so that a checkout without a real domain still
  // runs the audit instead of failing on a value the audit is right to complain
  // about. `.example` is reserved by RFC 2606 precisely so it can never resolve,
  // which makes it a fixture rather than an address — and the distinction is the
  // whole test. `ci-fixture.com` in the same position would be a real domain
  // pointed at by nothing, checked instead of the shop.
  const noHardcodedHost = yaml
    .replace(/\$\{\{\s*secrets\.APP_URL\s*\}\}/g, '')
    .replace(/^\s*#.*$/gm, '');
  const RESERVED = /\.(example|test|invalid|localhost)\b/;
  for (const found of noHardcodedHost.match(/https?:\/\/[^\s'"`]+/gi) || []) {
    // A template placeholder is not an address. The guard step's own error
    // message contains `https://<domain-cua-ban>` to show where the value comes
    // from, and that is the one place a URL-shaped string is supposed to appear.
    if (/[<>]/.test(found)) continue;
    assert.ok(RESERVED.test(found),
      `checks.yml gõ địa chỉ thật: ${found} — địa chỉ gõ cứng tồn tại lâu hơn thứ nó dự phòng cho. `
      + 'Chỉ được dùng tên dành riêng (.example/.test/.invalid) vì RFC 2606 bảo đảm nó không bao giờ phân giải.');
  }
  // And the exemption has to still be there — removing the fixture would make the
  // audit fail on every checkout, which is the other way this goes wrong.
  assert.match(yaml, /APP_URL:\s*https:\/\/ci-fixture\.example/,
    'fixture APP_URL cho CI phải còn, nếu không audit sẽ fail trên mọi checkout');
});

test('job chỉ chạy trên nhánh đang phục vụ, và có giới hạn thời gian', async () => {
  const yaml = await workflow();

  assert.match(yaml, /if:\s*github\.ref == 'refs\/heads\/(main|master)'/,
    'chỉ kiểm tra trên nhánh đang live — mọi nhánh khác sẽ báo về một URL không ai truy cập');
  assert.match(yaml, /timeout-minutes:\s*\d+/,
    'mọi job phải có timeout — một job không có trần là một job có thể treo');

  // The Node matrix was added because the project claimed >=20 while testing one
  // version and deploying another. Pinning it back to one would quietly undo that.
  assert.match(yaml, /matrix:[\s\S]*node-version:\s*\['20',\s*'22',\s*'24'\]/,
    'ma trận Node 20/22/24 phải còn — đó là thứ đã bắt được test glob hỏng trên Node 20');
});

test('không job nào có thể bỏ qua lỗi để báo xanh', async () => {
  const yaml = await workflow();

  // `continue-on-error` and a `|| true` are the two ways a pipeline reports
  // success for work that failed. Either one appearing here means a gate in this
  // repository has been turned into a comment.
  assert.doesNotMatch(yaml, /continue-on-error:\s*true/,
    'không được continue-on-error: true — gate hỏng rồi báo xanh chính là loại lỗi này');
  assert.doesNotMatch(yaml, /\|\|\s*true/,
    'không được dùng `|| true` trong run step — nó nuốt exit code của chính lệnh đó');
});