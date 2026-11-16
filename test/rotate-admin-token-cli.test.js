import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's shared test environment (see test/env-contract.test.js).
import './helpers/env.mjs';

// The rotation script touches production (Render env vars + a deploy + email).
// These tests lock the two properties that make it safe to keep in the repo:
//   1. the default command is a dry-run and never calls the API;
//   2. the workflow has no fixture domain fallback, so a missing secret fails
//      before any API call instead of rotating a real token against a fake URL.
// The a48fef6 CI run failed exactly here: the audit gate flagged
// `ci-fixture.example` hardcoded in the workflow.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'rotate-admin-token.mjs');

test('rotate:admin-token mặc định là dry-run, không gọi API', () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    // Bare environment: the assertion is about the no-flag path, and a
    // developer's .env must not be able to make it look like an apply run.
    env: { PATH: process.env.PATH },
    timeout: 30000,
  });
  assert.equal(result.status, 0, `phai thoat 0, thuc te ${result.status}\n${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /Chưa có --apply/);
  assert.match(result.stdout, /để xoay thật: npm run rotate:admin-token:apply/);
  assert.doesNotMatch(result.stdout, /SUCCESS|FAILURE/, 'dry-run không được in kết quả xoay');
});

test('script preflight từ chối xoay khi không đọc được token cũ', () => {
  const source = readFileSync(script, 'utf8');
  assert.match(source, /--bootstrap/, 'phải có opt-in tạo token mới');
  assert.match(source, /Từ chối xoay/, 'không có token cũ thì phải từ chối, không được im lặng ghi đè');
  // Render's documented schema for PUT /env-vars/{key} is { value }.
  assert.match(source, /value: nextValue/, 'PUT body phải là { value } theo schema Render');
});

test('workflow rotate không dùng fixture domain', () => {
  const source = readFileSync(path.join(root, '.github', 'workflows', 'rotate-admin-token.yml'), 'utf8');
  assert.doesNotMatch(source, /ci-fixture\.example/, 'không được gõ cứng domain fixture (audit gate a48fef6 đỏ vì việc này)');
  assert.doesNotMatch(source, /secrets\.\w+\s*\|\|/, 'không được fallback secret bằng giá trị giả');
  assert.match(source, /\$\{\{\s*secrets\.RENDER_API_KEY\s*\}\}/);
  assert.match(source, /\$\{\{\s*secrets\.APP_URL\s*\}\}/);
  assert.match(source, /\$\{\{\s*secrets\.SUPPORT_EMAIL\s*\}\}/);
});