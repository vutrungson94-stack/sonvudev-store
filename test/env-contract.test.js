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

// Variables that belong to the machine, not to the shop. config.js reads them so
// there is one rule about what an unset value means, and pushing them to a host
// would be the bug rather than the fix: a Render service must not inherit a local
// DATA_DIR, and ORDER_SWEEP_DISABLED is only ever set by a test or by an operator
// who has a second sweeper. PORT and HOST belong to the platform; NODE_ENV is read
// by Node and by the branches it selects.
const platformOwned = new Set(['PORT', 'HOST', 'NODE_ENV', 'DATA_DIR', 'ORDER_SWEEP_DISABLED']);

test('mọi biến mà config.js đọc đều được ghi trong .env.example', () => {
  const missing = [...readKeys].filter((key) => !documentedKeys.has(key)).sort();
  assert.deepEqual(missing, [], `thiếu trong .env.example: ${missing.join(', ')}`);
});

test('mọi biến mà config.js đọc đều được đẩy lên Render trước mỗi lần deploy', () => {
  // PORT is the one deliberate omission: Render assigns it, and pushing a local one
  // would make the service bind somewhere it was not given. Everything else that
  // config.js reads has to travel, or that host silently runs on defaults.
  const missing = [...readKeys].filter((key) => !allowedKeys.has(key) && !platformOwned.has(key)).sort();
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
  const platform = new Set(['PORT', 'HOST', 'NODE_ENV']);
  const unknown = [...allowedKeys].filter((key) => !readKeys.has(key) && !platform.has(key)).sort();
  assert.deepEqual(unknown, [], `sync-render.mjs đẩy biến không ai đọc: ${unknown.join(', ')}`);
});

test('không có biến nào bị bỏ sót ở cả hai danh sách', () => {
  // platformOwned is the only way a variable can escape being pushed to Render. That
  // is a real hole in the contract — a variable listed nowhere is exactly how
  // BRAND_FOUNDER_NAME went missing for months — so each exemption says why, and
  // this test fails if a name is exempted without anyone reading it.
  assert.deepEqual(
    [...platformOwned].filter((key) => !readKeys.has(key) && key !== 'NODE_ENV'),
    [],
    'platformOwned chỉ được chứa biến config.js thật sự đọc — không thêm tên để lách test',
  );
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

test('template deploy không chứa biến không ai đọc', () => {
  // The reverse direction of the test above. GEOIP_ENABLED sat in this template
  // promising an on/off switch for the country lookup while no code read it — the
  // real switch is GEO_LOOKUP, so setting the documented variable changed nothing
  // and an operator had every reason to believe it did. A template key nobody
  // reads is a promise the shop will not keep.
  //
  // Each exception names its reader, so a new one is a deliberate act: SITE_DOMAIN
  // belongs to the Caddyfile, the RENDER_* keys belong to scripts/sync-render.mjs,
  // and SUPABASE_ACCESS_TOKEN belongs to scripts/db-migrate.mjs. None of them is
  // read by src/config.js, and none of them may travel anywhere else.
  const template = read(path.join('deploy', 'sonvudev-store.env.example'));
  const templateKeys = new Set([...template.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const infraReaders = {
    SITE_DOMAIN: path.join('deploy', 'Caddyfile'),
    RENDER_API_KEY: path.join('scripts', 'sync-render.mjs'),
    RENDER_SERVICE: path.join('scripts', 'sync-render.mjs'),
    RENDER_SERVICE_ID: path.join('scripts', 'sync-render.mjs'),
    SUPABASE_ACCESS_TOKEN: path.join('scripts', 'db-migrate.mjs'),
  };
  const orphaned = [...templateKeys].filter((key) => !readKeys.has(key) && !(key in infraReaders)).sort();
  assert.deepEqual(orphaned, [], `deploy/sonvudev-store.env.example chứa biến không ai đọc: ${orphaned.join(', ')}`);
  for (const [key, reader] of Object.entries(infraReaders)) {
    if (!templateKeys.has(key)) continue;
    assert.ok(read(reader).includes(key), `${key} phải thật sự được ${reader} đọc — nếu không, nó là orphan mang tên ngoại lệ`);
  }
});

// The R2 bucket's origin list is the one deployment setting in this project that no
// code reads: cloudflare/r2-cors.json is applied to the bucket by hand, with wrangler,
// and nothing in the server looks at it. Until now no gate could see it either, and
// what it breaks is the admin panel's release upload — public/admin.js fetches a
// presigned URL from the server and then PUTs to *.r2.cloudflarestorage.com from the
// browser, so a stale AllowedOrigins refuses the only release-publishing action in
// the shop, on the only page the owner can open, with nothing on the page saying why.
//
// What this test cannot do is compare the file against the real domain: CI sets
// APP_URL to https://ci-fixture.example precisely so a fresh clone and a developer
// machine run the same checks, and a reserved .example host is by definition not a
// shop anybody buys from. So the comparison runs where a real .env exists — in the
// audit (which skips and says so on a fixture host) and in check:production, which is
// the pre-deploy gate. What is asserted here is everything a fixture can judge: that
// the file parses, that it is a usable CORS rule, and that it names exactly one shop.
test('cloudflare/r2-cors.json là một quy tắc CORS dùng được, và chỉ cho một shop', () => {
  const rules = JSON.parse(read(path.join('cloudflare', 'r2-cors.json')));
  assert.ok(Array.isArray(rules) && rules.length > 0, 'phải là mảng quy tắc CORS không rỗng');

  const origins = rules.flatMap((rule) => rule.AllowedOrigins || []);
  assert.ok(origins.length > 0, 'AllowedOrigins không được rỗng — bucket sẽ chặn mọi upload');
  for (const rule of rules) {
    for (const method of rule.AllowedMethods || []) {
      assert.ok(['GET', 'PUT', 'HEAD'].includes(method), `method không cần thiết trong CORS: ${method}`);
    }
    assert.ok((rule.AllowedHeaders || []).some((header) => header.toLowerCase() === 'content-type'),
      'phải cho phép Content-Type — upload đặt header này và sẽ bị chặn nếu không');
  }

  // Exactly one registrable domain, plus loopback. Two domains means the file was
  // half-updated after a rename and still lets the old host publish files; that is a
  // wider bucket than anybody intended and nothing else in the project would say so.
  const domains = new Set(origins
    .filter((origin) => !/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/.test(origin))
    .map((origin) => {
      try { return new URL(origin).hostname.replace(/^www\./, '').toLowerCase(); } catch { return origin.toLowerCase(); }
    }));
  assert.equal(domains.size, 1, `một tên miền duy nhất được phép, tìm thấy: ${[...domains].join(', ')}`);
  assert.ok(![...domains][0].endsWith('.example'), 'không được để lại tên miền ví dụ trong file áp dụng cho bucket thật');
  // Loopback is not optional: it is where a developer's browser runs, and dropping it
  // breaks local development with no visible cause.
  assert.ok(origins.some((origin) => origin.includes('localhost')), 'phải giữ http://localhost:3000 cho phát triển cục bộ');
});

test('quy tắc origin của R2 được suy ra từ APP_URL, không gõ tay', async () => {
  // The check and its repair have to read the same function, or the audit reports a
  // mismatch that `npm run r2:cors:write` then refuses to fix.
  const { requiredOrigins, corsDiff, isFixtureHost } = await import('../scripts/lib/cors.mjs');
  for (const appUrl of ['https://shop.example.org', 'https://www.shop.example.org']) {
    const required = requiredOrigins(appUrl);
    assert.ok(required.includes('http://localhost:3000'), 'loopback luôn phải có');
    assert.ok(required.some((origin) => new URL(origin).hostname.endsWith('shop.example.org')),
      `phải suy ra origin của ${appUrl}`);
    // Either half of an apex/www pair has to produce both, or renaming a domain
    // silently loses whichever form the admin panel happens to be open on.
    assert.equal(required.filter((origin) => origin.includes('shop.example.org')).length, 2,
      'apex và www phải cùng có mặt');
    assert.deepEqual(corsDiff([{ AllowedOrigins: required }], appUrl).missing, [],
      'origin suy ra từ APP_URL phải tự khớp với chính nó');
    assert.ok(corsDiff([], appUrl).missing.length > 0, 'một danh sách rỗng phải bị báo thiếu');
  }
  // .example is reserved by RFC 2606 and cannot be registered, which is what makes it
  // safe to skip on: a real shop cannot live there.
  assert.ok(isFixtureHost('https://ci-fixture.example'), 'APP_URL giả của CI phải nhận ra được');
  assert.ok(!isFixtureHost('https://sonvudev.com'), 'một domain thật không được nhận là giả');
});
