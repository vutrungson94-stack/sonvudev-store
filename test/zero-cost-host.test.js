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
const read = (name) => readFile(path.join(root, name), 'utf8');

// What it costs to run the shop somewhere that hands out a read-only filesystem.
//
// The shop has to be deployable without a VPS, and every zero-cost host that allows
// selling anything deploys the code as a bundle rather than a checkout — the
// process gets no writable disk anywhere except /tmp. Two consequences, and
// neither was visible until there was no server to hide behind:
//
//   ensureSeed() called fs.mkdir(data/) before it checked whether it was even the
//   datastore, so a Supabase-configured host — which is exactly the host that
//   should be writing nothing locally — died at boot with EROFS.
//
//   /api/health probed storage unconditionally, and returned 503 on every request
//   from any read-only filesystem. Worse than a false alarm: the database probe
//   one line above it said "ok", so the monitor saw a store that was up and
//   refusing orders, and the two lines sat in the same JSON object contradicting
//   each other.
//
// These assertions are structural — they read the source rather than boot the app
// against a live database. A test that proved them properly would need Supabase
// credentials and a real request, which is why they were not written that way and
// why this file says so rather than implying more coverage than it has.

test('ensureSeed() không tạo thư mục khi Supabase đang là nơi lưu trữ', async () => {
  const source = await read('src/store.js');
  const body = source.slice(source.indexOf('export async function ensureSeed'));
  const fn = body.slice(0, body.indexOf('\n}\n'));

  const mkdirAt = fn.indexOf('fs.mkdir');
  const localAt = fn.indexOf('if (local)');
  assert.ok(localAt >= 0, 'ensureSeed() phải còn nhánh local — nếu không, máy local ghi file cũng hỏng');
  assert.ok(mkdirAt > localAt,
    'fs.mkdir phải nằm SAU `if (local)`. Trước `if` thì host đã cấu hình Supabase cũng tạo thư mục dữ liệu, '
    + 'và trên filesystem read-only (mọi nền tảng serverless) EROFS giết tiến trình ngay lúc khởi động.');

  // And the Supabase path must not reach for the filesystem at all.
  const afterLocalBranch = fn.slice(fn.indexOf('return;', localAt) + 'return;'.length);
  assert.ok(!/fs\.(mkdir|writeFile)/.test(afterLocalBranch),
    'nhánh Supabase không được gọi fs.mkdir/fs.writeFile');
});

test('/api/health chỉ probe storage khi host này thật sự là nơi lưu trữ', async () => {
  const source = await read('src/app.js');
  const probeAt = source.indexOf('checks.storage = await probe');
  const gateAt = source.lastIndexOf('if (isConfigured.supabase) checks.storage', probeAt);
  const skipAt = source.indexOf('checks.storage = "skipped (supabase)"');

  assert.ok(probeAt > 0, 'phải còn probe storage');
  assert.ok(skipAt >= 0 && gateAt >= 0,
    'phải có nhánh bỏ qua probe storage khi Supabase được cấu hình');
  assert.ok(skipAt < probeAt,
    'nhánh bỏ qua phải đứng trước probe — nếu không, probe chạy trước rồi mới ghi đè kết quả');

  // The probe itself must still be tested. The 503 contract is covered for real in
  // observability.test.js, which breaks the data directory on purpose.
  assert.match(source, /fs\.access\(dataDir, fs\.constants\.W_OK\)/,
    'probe storage local phai hoi xem thu muc co ghi duoc khong, khong tao no');
  assert.match(source, /isDirectory/, 'probe storage phai kiem tra directory, khong chi permission');
  assert.equal(/fs\.mkdir\(dataDir/.test(source), false, 'storage probe khong duoc goi mkdir tren moi lan poll');
});

test('ghi outbox thất bại không được làm hỏng đơn hàng', async () => {
  const source = await read('src/notify.js');
  const at = source.indexOf('await fs.mkdir(outboxDir');
  assert.ok(at > 0, 'vẫn phải ghi outbox khi không có Resend — đó là nơi lưu email khi test');
  const guarded = source.slice(Math.max(0, at - 400), at);
  assert.match(guarded, /try \{/,
    'fs.mkdir(outboxDir) phải nằm trong try. Không có try thì host read-only ném ra, và vì luồng đặt hàng '
    + 'await hàm này, khách đã bị trừ tiền rồi nhận 500.');
  assert.match(source, /outbox-unavailable/,
    'phải báo rõ là không ghi được outbox, không im lặng nuốt lỗi');
});

test('render.yaml không chứa secret nào', async () => {
  const yaml = await read('render.yaml');

  // The file is committed, so it has to be safe to commit. A secret here would be
  // in git history from the moment it was pushed, and the first person to clone it
  // would have the shop's production credentials.
  //
  // Every `value:` has to be short and human-readable. Render API keys and
  // Supabase service keys are 40+ characters of base64; nothing a human types
  // into a config file is. So the length is the test — a name that slipped through
  // as a literal would be long, and everything legitimate here is a word.
  for (const line of yaml.split('\n')) {
    const value = /\s+value:\s*(.+?)\s*$/.exec(line);
    if (!value) continue;
    assert.ok(value[1].length <= 24,
      `render.yaml gõ một giá trị dài trực tiếp (${value[1].length} ký tự): ${line.trim()} — `
      + 'đây là hình dạng của một secret bị commit');
    assert.doesNotMatch(line, /secret|token|password|api[_-]?key|private/i,
      `render.yaml có vẻ ghi secret vào giá trị: ${line.trim()}`);
  }

  // Every secret must be marked as not-in-this-file.
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'PAYPAL_CLIENT_SECRET', 'RESEND_API_KEY', 'ADMIN_API_TOKEN', 'R2_SECRET_ACCESS_KEY']) {
    assert.match(yaml, new RegExp(`key:\\s*${key}\\s*\\n\\s*(sync:\\s*false|generateValue:\\s*true)`),
      `${key} phải là sync: false hoặc generateValue — không được gõ giá trị vào repo`);
  }

  // And the plan has to be the free one, or the "zero cost" claim is not true.
  assert.match(yaml, /plan:\s*free/,
    'render.yaml phải khai plan: free — file này tồn tại để deploy miễn phí');
  assert.match(yaml, /healthCheckPath:\s*\/api\/health/,
    'phải có healthCheckPath — deploy mà không kiểm tra /api/health không chứng minh được gì');
});

test('render.yaml nằm trong artifact được deploy', async () => {
  const build = await read('scripts/build-web.mjs');
  assert.match(build, /'render\.yaml'/,
    'render.yaml phải được đóng gói — nếu không, một bản build chạy trên Render sẽ không có nó');
  const manifest = JSON.parse(await read('package.json'));
  assert.ok(manifest.files.includes('render.yaml'),
    'package.json "files" phải có render.yaml để khớp với danh sách build');
});
