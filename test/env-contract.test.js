import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';

// Three files in this project hold the same list of environment variable names:
// src/config.js (which reads them), .env.example (which documents them) and
// scripts/sync-render.mjs (which pushes them to the Render host before every
// deploy). Nothing tied them together, and the third one had quietly fallen behind
// by five — the brand name, the legal entity, the founder and the social links.
//
// The consequence was invisible by construction. On Render those five kept their
// defaults from config.js while every other host had the real values, so the shop
// name on a buyer's statement, the entity named in the terms they accept, and the
// profile links that make the homepage and the product pages one shop to a crawler
// all disagreed — on exactly one host, and only after a deploy that claimed to push
// the environment.
//
// A list with no test is a list that rots quietly, so it is checked against the
// code that reads it.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const configSource = read('src/config.js');
const envExample = read('.env.example');
const syncSource = read(path.join('scripts', 'sync-render.mjs'));

// Every variable config.js reads, in all four of the accessor shapes it uses.
const readKeys = new Set([
  ...[...configSource.matchAll(/(?:value|numberValue|liveRateValue|configured|hasSupabaseProjectUrl)\(\s*"([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]),
]);
const documentedKeys = new Set([...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
const allowedKeys = new Set((syncSource.match(/const ALLOWED = \[([\s\S]*?)\];/)[1].match(/"([A-Z][A-Z0-9_]+)"/g) || []).map((x) => x.replace(/"/g, '')));

test('mọi biến mà config.js đọc đều được ghi trong .env.example', () => {
  const missing = [...readKeys].filter((key) => !documentedKeys.has(key)).sort();
  assert.deepEqual(missing, [], `thiếu trong .env.example: ${missing.join(', ')}`);
});

test('mọi biến mà config.js đọc đều được đẩy lên Render trước mỗi lần deploy', () => {
  // PORT is the one deliberate omission: Render assigns it, and pushing a local one
  // would make the service bind somewhere it was not given. Everything else that
  // config.js reads has to travel, or that host silently runs on defaults.
  const missing = [...readKeys].filter((key) => !allowedKeys.has(key) && key !== 'PORT').sort();
  assert.deepEqual(missing, [], `sync-render.mjs chưa đẩy: ${missing.join(', ')}`);
});

test('BRAND_* không bị bỏ sót — đây là năm biến đã từng bị bỏ sót', () => {
  // Named on its own so that removing one of them again is a deliberate act rather
  // than an edit to a long list nobody reads.
  for (const key of ['BRAND_NAME', 'BRAND_LEGAL_ENTITY', 'BRAND_FOUNDER_NAME', 'BRAND_FOUNDER_URL', 'BRAND_SOCIAL_LINKS']) {
    assert.ok(readKeys.has(key), `config.js phải đọc ${key}`);
    assert.ok(documentedKeys.has(key), `.env.example phải có ${key}`);
    assert.ok(allowedKeys.has(key), `sync-render.mjs phải đẩy ${key}`);
  }
});

test('danh sách không đẩy gì không tồn tại', () => {
  // PORT and HOST belong to the platform rather than to config.js, and NODE_ENV is
  // read by Node and by the code paths it selects rather than by name.
  const platform = new Set(['PORT', 'HOST', 'NODE_ENV']);
  const unknown = [...allowedKeys].filter((key) => !readKeys.has(key) && !platform.has(key)).sort();
  assert.deepEqual(unknown, [], `sync-render.mjs đẩy biến không ai đọc: ${unknown.join(', ')}`);
});

// The suite grew one file at a time and each new file set only the variables it
// happened to need. That works on the machine it was written on, where .env fills in
// whatever a file forgot — and fails on a fresh clone, where nothing is filled in.
// Twenty-six tests passed here and failed there, which is the worst thing a test
// suite can do: it reports the health of the machine instead of the code.
//
// So the environment is one file now, imported by every test before anything loads
// src/. This test is what stops it drifting apart again — a new test file that rolls
// its own environment reintroduces the whole failure, and nothing else would notice.
test('mọi file test dùng chung một môi trường', async () => {
  const dir = new URL('./', import.meta.url);
  const names = (await fs.promises.readdir(dir)).filter((name) => name.endsWith('.test.js'));
  const without = [];
  for (const name of names) {
    const source = await fs.promises.readFile(new URL(name, dir), 'utf8');
    if (!/helpers\/env\.mjs/.test(source)) without.push(name);
  }
  assert.deepEqual(without, [], `các file test chưa dùng môi trường chung: ${without.join(', ')}`);
});

test('môi trường test tự đủ, không phụ thuộc .env của máy', async () => {
  // Every value that would reach a real service has to be blanked, not merely absent:
  // dotenv is loaded with override, and a key the file does not mention survives that.
  // A test run once created real products in the real catalogue because of it.
  const source = await fs.promises.readFile(new URL('./helpers/env.mjs', import.meta.url), 'utf8');
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'INDEXNOW_KEY']) {
    assert.match(source, new RegExp(`${key}: ''`), `${key} phải được đặt rỗng — không được để .env của máy điền vào`);
  }
  // And the shop still has to be sellable, or every checkout in the suite answers 503
  // and the failures look like a product bug rather than a missing key.
  for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'ADMIN_API_TOKEN']) {
    assert.match(source, new RegExp(`${key}: `), `${key} phải có giá trị trong môi trường test`);
  }
});

test('file env cho VPS được ship kèm, không phải tự đoán', async () => {
  // deploy.sh copies /etc/sonvudev-store.env into place and refuses to run without
  // it, and the repository shipped no template for it: the first thing a new owner
  // had to do was reverse-engineer the list from the service unit and the error
  // message. It also has to be in step with config.js, or it is a second list that
  // rots the same way this one did.
  const template = read(path.join('deploy', 'sonvudev-store.env.example'));
  const templateKeys = new Set([...template.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const missing = [...readKeys].filter((key) => !templateKeys.has(key)).sort();
  assert.deepEqual(missing, [], `deploy/sonvudev-store.env.example thiếu: ${missing.join(', ')}`);
  // SITE_DOMAIN is not read by the application — it is read by the Caddyfile, which
  // is why the two are separate values. Checked here so the reason is written down.
  assert.match(template, /^SITE_DOMAIN=/m, 'template phải nêu SITE_DOMAIN cho Caddy');
});
