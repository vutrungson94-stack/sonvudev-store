import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';
import { looksPlaceholder } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(root, name), 'utf8');

// .env holds the shop's real credentials and has to stay on the machine: it is what
// `npm run production-check`, `render:sync`, `seo:check` and the local server read.
// So it cannot be deleted, and a secret scanner that walks the working tree will
// always report it.
//
// It is also the one file in the tree that cannot leak, and these are the three
// reasons that is true rather than assumed. gbuild.config.json excludes .env from
// the security scan on the strength of them, so if any one stops holding, the
// exclusion becomes an unsound silence instead of a decision — which is exactly what
// these tests are for.
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { status: result.status, out: (result.stdout || '').trim() };
};

test('.env và mọi bản sao .env.* đều bị .gitignore loại trừ .env.example', async () => {
  const ignore = await read('.gitignore');
  assert.match(ignore, /^\.env$/m, '.gitignore phải loại .env');
  assert.match(ignore, /^\.env\.\*$/m, '.gitignore phải loại .env.*');
  // The exception is the point: without it .env.example would be ignored too and the
  // deploy would have no template to read.
  assert.match(ignore, /^!\.env\.example$/m, '.gitignore phải giữ .env.example');
});

test('không file .env* nào bị git theo dõi — đây là điều khiến việc loại .env khỏi quét là hợp lý', () => {
  const tracked = git('ls-files');
  assert.equal(tracked.status, 0, 'git ls-files phải chạy được');
  const offenders = tracked.out
    .split('\n')
    .filter((file) => /(^|\/)\.env($|\.)/.test(file) && !file.endsWith('.env.example'));
  assert.deepEqual(offenders, [],
    `file .env* đang bị git theo dõi — loại nó khỏi quét secret sẽ che mất sự cố thật:\n  ${offenders.join('\n  ')}`);
});

test('không biến bí mật nào trong .env.example mang giá trị thật', async () => {
  const example = await read('.env.example');
  // .env.example is supposed to carry real defaults — HOST=127.0.0.1, BANK_BIN,
  // BRAND_NAME — so "every value must be empty" would be wrong. The precise rule is
  // narrower: the keys whose whole purpose is to hold a credential must not carry a
  // working one, because that file is the one everybody can read.
  const SECRET_KEY = /(SECRET|TOKEN|API_KEY|ACCESS_KEY|PASSWORD|WEBHOOK_ID|_KEY$|^KEY$)/;
  const values = new Map();
  for (const raw of example.split(/\r?\n/)) {
    const line = raw.trim();
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values.set(match[1], match[2].trim());
  }

  const offenders = [...values]
    .filter(([key, value]) => SECRET_KEY.test(key) && value && !looksPlaceholder(value))
    .map(([key, value]) => `${key}=${value.slice(0, 24)}…`);
  assert.deepEqual(offenders, [],
    `biến bí mật trong .env.example phải để trống hoặc dùng giá trị mẫu:\n  ${offenders.join('\n  ')}`);

  // And the strongest form of the same check: nothing in the example file may equal a
  // value the machine is actually using. This catches the case no rule catches —
  // someone pasting a working key in to "document" it.
  const live = await stat('.env').then(() => read('.env'), () => null);
  if (!live) return;
  const leaked = [];
  for (const raw of live.split(/\r?\n/)) {
    const line = raw.trim();
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!value || !SECRET_KEY.test(key)) continue;
    if (values.get(key) === value) leaked.push(key);
  }
  assert.deepEqual(leaked, [],
    `giá trị thật của ${leaked.join(', ')} đang nằm trong .env.example — file này được commit và đọc công khai`);
});

test('gbuild.config.json chỉ loại .env khỏi quét, không loại thư mục nguồn', async () => {
  const config = JSON.parse(await read('gbuild.config.json'));
  const excluded = config.security?.excludeDirs;
  assert.ok(Array.isArray(excluded) && excluded.includes('.env'),
    'gbuild.config.json phải loại .env khỏi quét secret — đây là test biện minh cho việc đó');
  // Excluding .git or src would blind the scanner to everything that actually ships.
  for (const forbidden of ['src', 'public', 'scripts', '.git', 'cloudflare', 'deploy', 'supabase']) {
    assert.ok(!excluded.includes(forbidden),
      `không được loại ${forbidden} khỏi quét secret — đó là nơi secret thật sự có thể lọt vào`);
  }
});

test('danh sách license cho phép phủ hết license thực sự có trong lockfile', async () => {
  // gbuild chặn build khi một dependency có license nằm ngoài danh sách cho phép.
  // Đó là control đúng — nhưng nó chỉ đáng tin khi danh sách được viết có chủ ý, và
  // mặc định của gbuild thiếu 0BSD, nên `tslib` (kéo về gián tiếp bởi AWS SDK) chặn
  // build dù nó là license OSI và cấp quyền rộng nhất trong danh sách.
  //
  // Test này giữ danh sách bám sát lockfile theo cả hai chiều: license đang dùng mà
  // không có trong danh sách là lỗi, và license nằm trong danh sách mà không ai dùng
  // là mục thừa để dọn. Dependency mới phải được duyệt có chủ ý, không tự lọt.
  const lock = JSON.parse(await read('package-lock.json'));
  const used = new Set();
  for (const [path, meta] of Object.entries(lock.packages || {})) {
    if (path && meta && meta.license) used.add(meta.license);
  }
  assert.ok(used.size > 0, 'lockfile phải còn ghi license, nếu không test này không kiểm tra gì cả');

  const config = JSON.parse(await read('gbuild.config.json'));
  const allowed = new Set(config.license?.allowed || []);
  assert.ok(allowed.size > 0, 'phải khai báo license.allowed, không được để rỗng để bỏ qua gate');

  const unapproved = [...used].filter((lic) => !allowed.has(lic));
  assert.deepEqual(unapproved, [],
    `dependency dùng license chưa được duyệt: ${unapproved.join(', ')} — thêm vào license.allowed sau khi đã đọc license đó`);

  const unused = [...allowed].filter((lic) => !used.has(lic));
  assert.deepEqual(unused, [],
    `license nằm trong danh sách cho phép nhưng không dependency nào dùng: ${unused.join(', ')} — bỏ đi cho danh sách nói đúng hiện trạng`);
});

// gbuild.config.json is JSON, so it cannot carry the reasoning itself — JSON has no
// comments, and a config file that breaks on the first `//` is a config file nobody
// edits. The reasoning lives here instead, which is where a reader will look when the
// list needs a new entry.
test('mỗi license được duyệt đều có lý do ghi lại, không phải bấm bừa thêm vào', async () => {
  const config = JSON.parse(await read('gbuild.config.json'));
  const allowed = config.license?.allowed || [];

  // MIT, Apache-2.0, BSD and ISC are the standard permissive set every project starts
  // with; they need no individual argument.
  const unremarkable = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD']);
  // Everything else has to be explained here, by name, or it does not belong.
  const explained = new Set(['MIT AND OFL-1.1']);

  const unexplained = allowed.filter((lic) => !unremarkable.has(lic) && !explained.has(lic));
  assert.deepEqual(unexplained, [],
    `license này được duyệt mà không có lý do: ${unexplained.join(', ')} — ` +
    'thêm một dòng giải thích vào test này trước khi đưa vào danh sách');

  // And the reverse: an explanation for a licence nobody uses is a comment about
  // nothing, which is how a list drifts from the lockfile in the first place.
  const lock = JSON.parse(await read('package-lock.json'));
  const used = new Set(Object.values(lock.packages || {}).map((meta) => meta && meta.license).filter(Boolean));
  const stale = [...explained].filter((lic) => !used.has(lic));
  assert.deepEqual(stale, [],
    `có lý do cho ${stale.join(', ')} nhưng lockfile không còn dependency nào dùng — gỡ cả license lẫn lý do`);

  // MIT AND OFL-1.1 is one npm value, not two. Listing the halves would pass this
  // file's own `unapproved` check and still block every build, which is the failure
  // mode the compound value invites.
  assert.ok(allowed.includes('MIT AND OFL-1.1'),
    'Space Grotesk (OFL-1.1) phải được duyệt dưới đúng chuỗi npm ghi, không phải hai entry tách rời');
  assert.ok(!allowed.includes('OFL-1.1'),
    'OFL-1.1 riêng lẻ không khớp license field nào trong lockfile — sẽ chặn build mà không báo lý do');
});

test('gbuild.config.json không tắt bất kỳ kiểm tra bảo mật nào của gbuild', async () => {
  const config = JSON.parse(await read('gbuild.config.json'));
  const security = config.security || {};
  // These flags are absent rather than false, because they are gbuild's own defaults
  // and restating them here would freeze today's behaviour into this file. So the
  // check is one-directional: the project config may add, and may never switch off.
  // Writing an explicit false is the thing that has to fail.
  for (const gate of ['scanSecrets', 'checkVulnerablePackages', 'validateLicenses']) {
    assert.notEqual(security[gate], false,
      `gbuild.config.json không được tắt ${gate} — đó là một control, không phải một tuỳ chọn`);
  }
  assert.equal(security.sbom?.policy?.enforcement, 'block',
    'SBOM policy phải giữ enforcement=block');
});