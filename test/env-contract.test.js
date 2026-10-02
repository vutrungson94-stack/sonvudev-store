import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('file env cho VPS được ship kèm, không phải tự đoán', () => {
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
