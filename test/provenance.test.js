import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('provenance chạy trong build và ghi sha256', () => {
  assert.match(read('scripts/build-web.mjs'), /provenance\.mjs/, 'build phải chạy provenance');
  assert.match(read('scripts/provenance.mjs'), /sha256/, 'provenance phải băm file');
});

test('artifact loại scratch và deploy từ chối scratch', async () => {
  const { ARTIFACT_EXCLUDE_DIRS } = await import('../scripts/lib/artifact.mjs');
  assert.ok(ARTIFACT_EXCLUDE_DIRS.includes('.wrangler'));
  assert.match(read('deploy/deploy.sh'), /\.wrangler/, 'deploy phải từ chối .wrangler');
});

test('Dockerfile tồn tại và không copy secret', () => {
  const dock = read('Dockerfile');
  assert.match(dock, /FROM node:22-alpine/);
  assert.ok(!/^COPY .*\.env$/m.test(dock), 'Dockerfile không được COPY .env');
  assert.match(dock, /HEALTHCHECK/, 'Dockerfile phải có HEALTHCHECK');
});
