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

// What actually gets deployed, and what gets published to npm, are two lists
// that have to name the same files. They drifted once: the build packaged
// deploy/ and the deploy script read deploy/sonvudev-store.service from it,
// while package.json "files" had no deploy at all — so `npm publish` and
// `npm run build` produced two different artifacts and neither one was checked
// against the other.
//
// The failure this guards against is not subtle once it has happened: a systemd
// unit missing from the published package means a fresh install has no service
// definition, and nothing notices until someone tries to start it.

const ARTIFACT_DIRECTORIES = ['src', 'public', 'scripts', 'supabase', 'cloudflare', 'deploy'];
const ARTIFACT_FILES = ['package.json', 'package-lock.json', '.env.example', 'README.md', 'render.yaml'];
// npm always ships package.json and package-lock.json, and always ignores dotfiles
// including .env.example — so those three are named in the build and cannot be
// named in "files". README.md is the one that genuinely has to be listed.
const ALWAYS_SHIPPED = new Set(['package.json', 'package-lock.json', '.env.example']);

test('package.json "files" và danh sách đóng gói của build là một', async () => {
  const manifest = JSON.parse(await read('package.json'));
  const published = manifest.files || [];
  const build = await read('scripts/build-web.mjs');

  for (const entry of ARTIFACT_DIRECTORIES) {
    assert.ok(published.includes(entry),
      `package.json "files" thiếu ${entry} — npm publish sẽ không ship thư mục mà build đóng gói`);
  }
  for (const entry of ARTIFACT_FILES) {
    if (ALWAYS_SHIPPED.has(entry)) continue;
    assert.ok(published.includes(entry),
      `package.json "files" thiếu ${entry}`);
  }

  // And the build must still be packaging exactly that set, not a second list.
  const buildList = build.match(/ARTIFACT_DIRECTORIES = \[([^\]]+)\]/);
  const buildFiles = build.match(/ARTIFACT_FILES = \[([^\]]+)\]/);
  assert.ok(buildList && buildFiles, 'build-web.mjs phải khai ARTIFACT_DIRECTORIES và ARTIFACT_FILES');
  assert.equal(
    buildList[1].replaceAll("'", '').replaceAll(' ', ''),
    ARTIFACT_DIRECTORIES.join(','),
    'build-web.mjs đang đóng gói một danh sách khác với danh sách trong test này',
  );
  assert.equal(
    buildFiles[1].replaceAll("'", '').replaceAll(' ', ''),
    ARTIFACT_FILES.join(','),
    'build-web.mjs đang đóng gói một danh sách file khác với danh sách trong test này',
  );
});

test('deploy.sh chỉ deploy thư mục build tạo ra, không deploy cả cây nguồn', async () => {
  const script = await read('deploy/deploy.sh');

  // The old default was $(pwd), which silently packaged whatever directory the
  // script happened to be run from.
  assert.ok(!/SOURCE_DIR="\$\{1:-\$\(pwd\)\}"/.test(script),
    'deploy.sh không được mặc định lấy pwd làm thư mục deploy');

  assert.match(script, /publish-output\/node/,
    'deploy.sh phải mặc định deploy artifact do build tạo ra');

  // Copying the tree wholesale is what carried .env.backup-*, the build tool's
  // secret cache and .git into a live release directory.
  assert.match(script, /compgen -G "\$SOURCE_DIR\/\.env\.\*"/,
    'deploy.sh phải từ chối artifact chứa .env.* — bản sao secret nằm trong thư mục phục vụ');
  for (const forbidden of ['.env', '.git', 'data', 'logs', 'publish-output']) {
    assert.ok(script.includes(`"$SOURCE_DIR/$forbidden"`),
      `deploy.sh phải từ chối artifact chứa ${forbidden}`);
  }

  // A release that does not answer 200 is a failed deploy, not a successful one
  // that an uptime monitor will notice ten minutes later.
  assert.match(script, /\/api\/health/,
    'deploy.sh phải gọi /api/health sau khi khởi động lại');
  assert.ok(!/echo "Health: curl/.test(script),
    'dòng "Health: curl ..." chỉ in ra lệnh để chạy tay — nó không kiểm tra gì cả');
});

test('deploy/.env.example đặt DATA_DIR vào thư mục systemd cho phép ghi', async () => {
  const example = await read('deploy/sonvudev-store.env.example');
  const unit = await read('deploy/sonvudev-store.service');

  const writable = (unit.match(/^ReadWritePaths=(.*)$/m) || [])[1];
  assert.ok(writable, 'unit phải khai ReadWritePaths');
  const dataDir = (example.match(/^DATA_DIR=(.*)$/m) || [])[1];
  assert.ok(dataDir && dataDir.trim(),
    'DATA_DIR trong deploy/sonvudev-store.env.example phải có giá trị');

  // ProtectSystem=strict makes everything outside ReadWritePaths read-only, so a
  // DATA_DIR outside that list means /api/health answers 503 on every request
  // and the shop cannot take an order. It passes on a developer machine, where
  // the working directory is always writable.
  for (const allowed of writable.split(/\s+/).filter(Boolean)) {
    assert.ok(dataDir.startsWith(allowed),
      `DATA_DIR=${dataDir} nằm ngoài ReadWritePaths=${writable}; ProtectSystem=strict sẽ khiến /api/health trả 503 vĩnh viễn`);
  }
  assert.match(unit, /^ProtectSystem=strict$/m,
    'giả định trên chỉ đúng khi unit vẫn dùng ProtectSystem=strict');
});