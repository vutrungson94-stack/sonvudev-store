import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Shared shop environment first, like every other test file.
import './helpers/env.mjs';
import { closeTest } from './helpers/teardown.mjs';

process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-canary-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';
process.env.CANARY_PERCENT = '0';
process.env.CANARY_FILE = '';

const { createApp } = await import('../src/app.js');
const { canaryPercent, canaryAssignment, resetCanaryCache } = await import('../src/canary.js');

let server;
let base;
let app;

test.before(async () => {
  app = await createApp();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await closeTest(server, tempDir);
  delete process.env.CANARY_FILE;
  delete process.env.CANARY_PERCENT;
});

const clearCache = () => {
  resetCanaryCache();
};

// The failure this file exists to prevent.
//
// The canary middleware was inserted inside the request-logging middleware by an
// edit that moved a brace instead of a block. It parsed, it set the header, and
// every request appended another copy of itself to the Express router. Nothing
// noticed until the array was large enough to matter: the shop got slower the
// longer it stayed up, and a restart "fixed" it.
test('middleware canary được đăng ký một lần, không lớn dần theo request', async () => {
  const layers = () => app._router?.stack?.length ?? 0;
  const before = layers();
  assert.ok(before > 0, 'ứng dụng phải có router sau khi khởi tạo');
  for (let i = 0; i < 5; i += 1) {
    const response = await fetch(`${base}/api/products`);
    assert.equal(response.status, 200);
  }
  assert.equal(layers(), before, 'số lớp middleware không được tăng sau mỗi request');
});

test('phần trăm canary đọc từ tệp điều khiển và kẹp trong khoảng 0..100', async () => {
  const file = path.join(tempDir, 'canary-percent');
  process.env.CANARY_FILE = file;
  process.env.CANARY_PERCENT = '0';
  await fs.writeFile(file, '25\n', 'utf8');
  clearCache();
  assert.equal(canaryPercent(), 25, 'tệp điều khiển phải thắng biến môi trường');

  await fs.writeFile(file, '250', 'utf8');
  clearCache();
  assert.equal(canaryPercent(), 100, 'giá trị lớn hơn 100 phải bị kẹp');

  await fs.writeFile(file, 'không phải số', 'utf8');
  clearCache();
  assert.equal(canaryPercent(), 0, 'giá trị rác phải quay về 0, không phải 100');

  await fs.rm(file, { force: true });
  process.env.CANARY_PERCENT = '40';
  clearCache();
  assert.equal(canaryPercent(), 40, 'thiếu tệp thì dùng CANARY_PERCENT');
});

test('người đã có cookie canary giữ nguyên kênh, không bị chia lại', () => {
  process.env.CANARY_FILE = '';
  process.env.CANARY_PERCENT = '10';
  clearCache();
  const sticky = canaryAssignment({ ip: '203.0.113.9', headers: { cookie: 'a=1; svd_canary=1' } });
  assert.equal(sticky.assignment, 'canary');
  assert.equal(sticky.assign, false, 'đã có cookie thì không đặt lại');

  process.env.CANARY_PERCENT = '100';
  clearCache();
  const fresh = canaryAssignment({ ip: '203.0.113.9', headers: {} });
  assert.equal(fresh.assignment, 'canary');
  assert.equal(fresh.assign, true);
});

test('rollback xóa cookie để người dùng quay lại bản ổn định', async () => {
  process.env.CANARY_PERCENT = '0';
  process.env.CANARY_FILE = '';
  clearCache();
  const response = await fetch(`${base}/api/products`, { headers: { cookie: 'svd_canary=1' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-canary-assignment'), 'off');
  const cookie = response.headers.get('set-cookie') || '';
  assert.match(cookie, /svd_canary=;/, 'phải trả cookie hết hạn');
  assert.match(cookie, /Max-Age=0/);
});

test('chia traffic đặt cookie và báo đúng kênh đang phục vụ', async () => {
  process.env.CANARY_PERCENT = '100';
  process.env.CANARY_FILE = '';
  clearCache();
  const response = await fetch(`${base}/api/products`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-canary-assignment'), 'canary');
  // The instance itself is still the stable build in this test; the header says
  // where this response came from, the cookie says where the next one goes.
  assert.equal(response.headers.get('x-deployment-channel'), 'stable');
  assert.match(response.headers.get('set-cookie') || '', /svd_canary=1/);
});
