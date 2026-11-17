// Regression tests for the 2026-11-17 L5 audit and its follow-up:
//  1. admin config must be true from the single ADMIN_API_TOKEN credential.
//  2. ensureSeed() pushed six development demo products into a live Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './helpers/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFile(path.join(root, rel), 'utf8');

// A child process is required: config.js snapshots process.env at import time and
// the suite's helpers/env.mjs already set ADMIN_API_TOKEN for this process.
const adminFlag = (extra) => {
  const url = pathToFileURL(path.join(root, 'src', 'config.js')).href;
  const code = `import(${JSON.stringify(url)}).then(m => process.stdout.write(String(m.isConfigured.admin)))`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, NODE_ENV: 'test', ADMIN_API_TOKEN: '', ...extra },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test('isConfigured.admin bật khi có ADMIN_API_TOKEN', () => {
  assert.equal(adminFlag({ ADMIN_API_TOKEN: 'owner-token' }), 'true',
    'mối admin duy nhất phải báo admin:true trên owner /api/health');
});

test('isConfigured.admin vẫn là false khi ADMIN_API_TOKEN trống', () => {
  assert.equal(adminFlag({}), 'false',
    'không được báo đã cấu hình khi token admin trống');
});

test('ensureSeed() không ghi sản phẩm mẫu vào Supabase production', async () => {
  const source = await read('src/store.js');
  const start = source.indexOf('export async function ensureSeed');
  const end = source.indexOf('// The one way this project talks to Postgres', start);
  assert.ok(start >= 0 && end > start, 'phải tìm thấy thân hàm ensureSeed()');
  const fn = source.slice(start, end);
  const localAt = fn.indexOf('if (local)');
  assert.ok(localAt >= 0, 'nhánh local phải còn — máy dev vẫn cần catalogue mẫu');
  const localBranch = fn.slice(localAt, fn.indexOf('try {', localAt));
  assert.match(localBranch, /seedProducts/, 'máy local được phép giữ sản phẩm mẫu');

  const supabaseBranch = fn.slice(fn.indexOf('try {', localAt));
  assert.ok(!supabaseBranch.includes('seedProducts'),
    'nhánh Supabase không được ghi 6 sản phẩm demo (AGENTS.md §4)');
  assert.ok(!/method:\s*["']POST["']/.test(supabaseBranch),
    'nhánh Supabase chỉ probe kết nối, không tự tạo catalogue');
});
