import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load. See helpers/env.mjs.
import './helpers/env.mjs';
import { closeTest } from './helpers/teardown.mjs';

process.env.NODE_ENV = 'test';
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-slash-'));
process.env.DATA_DIR = tempDir;
process.env.APP_URL = 'https://shop.example';

const { createApp } = await import('../src/app.js');
let server;
let base;
let slug;

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  // The seed products carry no release file, so isSellable() is false and their
  // pages answer 404. A real product is created here so the product page exists.
  const created = await fetch(`${base}/api/admin/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
    body: JSON.stringify({
      name: 'Slash Probe',
      category: 'Tiện ích',
      platform: 'Windows',
      version: '1.0.0',
      price: 99000,
      currency: 'VND',
      description: 'Sản phẩm kiểm tra trailing slash.',
      shortDescription: 'Kiểm tra trailing slash.',
      fileKey: 'products/slash/1.0.0/slash.exe',
      status: 'active',
    }),
  });
  assert.equal(created.status, 201);
  slug = (await created.json()).product.slug;
});
test.after(async () => { await closeTest(server, tempDir); });

// redirect: 'manual' so a 308 is observable rather than followed into the page it
// points at — following it would test the destination, not the normalization.
const probe = async (url) => {
  const res = await fetch(`${base}${url}`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') };
};

test('trailing slash: /terms/ redirects to /terms (308)', async () => {
  const r = await probe('/terms/');
  assert.equal(r.status, 308, 'bản /terms/ phải chuyển hướng, không được 200');
  assert.equal(r.location, '/terms');
});

test('trailing slash: /product/<slug>/ redirects to /product/<slug> (308)', async () => {
  const r = await probe(`/product/${slug}/`);
  assert.equal(r.status, 308, 'bản /product/<slug>/ phải chuyển hướng');
  assert.equal(r.location, `/product/${slug}`);
});

test('trailing slash: query string survives the redirect', async () => {
  const r = await probe('/terms/?utm_source=gsc');
  assert.equal(r.status, 308);
  assert.equal(r.location, '/terms?utm_source=gsc');
});

test('locale root: /en and /en/ both answer 200 (registered routes, canonical /en/)', async () => {
  const bare = await probe('/en');
  assert.equal(bare.status, 200, '/en là route đã đăng ký, không chuyển hướng');
  const root = await probe('/en/');
  assert.equal(root.status, 200, '/en/ là canonical');
});

test('root stays 200 — no redirect on /', async () => {
  const r = await probe('/');
  assert.equal(r.status, 200);
});

test('non-slash pages are 200 and carry their own canonical', async () => {
  const res = await fetch(`${base}/product/${slug}`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, new RegExp(`<link rel="canonical" href="https://shop\\.example/product/${slug}">`),
    'canonical phải là bản không trailing slash');
});

test('buy links carry rel=nofollow so /?buy= is not crawled as a duplicate', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /href="\/\?buy=[^"]*"[^>]*rel="nofollow"|rel="nofollow"[^>]*href="\/\?buy=/,
    'link mua trên store phải có rel="nofollow"');
});
