import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Shared shop environment first, like every other test file.
import './helpers/env.mjs';

// Writing env vars to Render restarts the service, so the sync script is a
// deploy script and must be gated like one. These hold that gate in place:
// a mutating run that skips the build or the tests ships red code with a
// green log, and nothing else would notice the gate had been removed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('mọi lệnh deploy đều đi qua sync-render.mjs', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const name of ['render:sync', 'render:sync:apply', 'render:sync:deploy', 'render:deploy']) {
    assert.ok(scripts[name]?.includes('scripts/sync-render.mjs'), `${name} phải chạy scripts/sync-render.mjs`);
  }
});

test('ghi lên Render thì phải xanh build và test trước', () => {
  const source = read(path.join('scripts', 'sync-render.mjs'));
  assert.match(source, /build-web\.mjs/, 'deploy phải chạy build trước khi ghi');
  assert.match(source, /"--test"/, 'deploy phải chạy test suite trước khi ghi');
  // The gate aborts the run; a warning that continues is not a gate.
  assert.match(source, /Build thất bại[\s\S]{0,120}chưa ghi gì lên Render/, 'build đỏ phải dừng trước khi ghi');
  assert.match(source, /Test thất bại[\s\S]{0,120}chưa ghi gì lên Render/, 'test đỏ phải dừng trước khi ghi');
  // And the gate only guards runs that change something: a dry run is read-only.
  assert.match(source, /if \(apply \|\| redeploy\)/, 'chỉ các lệnh ghi mới bị chặn, dry run không bị chặn oan');
});

test('dry run không ghi gì và nói rõ điều đó', () => {
  const source = read(path.join('scripts', 'sync-render.mjs'));
  assert.match(source, /if \(!apply\)/, 'dry run phải dừng trước mọi lệnh ghi');
  assert.match(source, /Chưa ghi gì lên Render/, 'dry run phải nói rõ là chưa ghi gì');
});
