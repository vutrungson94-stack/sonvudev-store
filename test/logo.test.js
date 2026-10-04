import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/env.mjs';
import { ICON_LINKS, LOGO_PATH, iconLinkMarkup } from '../src/pages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(root, name), 'utf8');
const exists = async (relative) => Boolean(await stat(path.join(root, relative)).catch(() => null));

// A logo is shown in more places than a website has pages. The tab, the iOS home
// screen, the Windows taskbar, an installed PWA, a Safari pinned tab, a knowledge
// panel and the inside of every order email each want the mark in a different shape
// and a different size. This project had exactly one of those filled in — the tab —
// so every other slot was either empty or showing a different drawing of the same
// idea.
//
// The rule these tests hold: one source image, every slot derived from it, every
// slot a file that exists. A slot that is declared but missing fails here rather
// than 404ing in a browser that does not warn anyone.
test('mọi icon slot khai báo đều có file thật trong public/', async () => {
  for (const link of ICON_LINKS) {
    // The manifest is the one slot that is a route and not a file, because it names
    // the brand and a brand written into a committed JSON file is a second place to
    // forget to change it. It is asserted below instead, against the server.
    if (link.rel === 'manifest') continue;
    assert.ok(await exists(path.join('public', link.href)),
      `${link.rel} trỏ tới ${link.href} nhưng file không tồn tại — trình duyệt sẽ 404 và không báo ai`);
  }
  const app = await read('src/app.js');
  assert.match(app, /app\.get\("\/site\.webmanifest"/,
    'site.webmanifest phải được phục vụ từ src/config.js, không phải file tĩnh');
});

test('có đủ các slot mà một trình duyệt hoặc hệ điều hành thực sự hỏi', () => {
  const hrefs = ICON_LINKS.map((link) => link.href);
  // What was missing before, each for a reason:
  //   apple-touch-icon  iOS discards the alpha channel and composites on black, so
  //                    without this an installed app is a black square
  //   favicon.ico       Windows and anything that predates SVG favicons
  //   manifest          names the icon for an Android launcher and makes the shop
  //                    installable at all
  //   mask-icon         Safari pinned tabs recolour a single-colour silhouette and
  //                    render a full-colour mark invisible there
  for (const required of ['/apple-touch-icon.png', '/favicon.ico', '/site.webmanifest', '/mask-icon.png']) {
    assert.ok(hrefs.includes(required), `thiếu slot ${required}`);
  }
  // And the sizes attribute, which is what the browser uses to choose. Chrome warns
  // in the console without it and then guesses. mask-icon is the exception: Safari
  // takes a single silhouette and has no sizes attribute to give it.
  for (const link of ICON_LINKS.filter((l) => l.href.endsWith('.png') && l.rel !== 'mask-icon')) {
    assert.ok(link.sizes, `${link.href} phải khai báo sizes`);
  }
});

test('mọi trang đều nhận đủ bộ icon, không viết tay link nào', async () => {
  const pages = ['index.html', 'about.html', 'terms.html', 'privacy.html', 'refund.html',
    '404.html', 'lookup.html', 'order.html', 'paypal-return.html', 'admin.html'];
  for (const page of pages) {
    const html = await read(path.join('public', page));
    assert.ok(!/<link rel="icon"/.test(html),
      `public/${page} còn <link rel="icon"> gõ tay — phải dùng {{iconLinks}} để một danh sách duy nhất`);
    assert.ok(html.includes('{{iconLinks}}'),
      `public/${page} thiếu {{iconLinks}}`);
  }
});

test('iconLinks render ra đủ 9 link, mỗi link một dòng', () => {
  const markup = iconLinkMarkup();
  assert.equal(markup.length, ICON_LINKS.length);
  for (const line of markup) {
    assert.match(line, /^<link rel="[a-z-]+" href="\//);
    assert.ok(line.endsWith('>'));
  }
});

test('logo trong structured data đủ lớn cho knowledge panel', async () => {
  assert.ok(await exists(path.join('public', LOGO_PATH)), `${LOGO_PATH} phải tồn tại thật`);
  const width = Number(LOGO_PATH.match(/-(\d+)\.png/)?.[1]);
  // Google asks for at least 112x112. This pointed at /favicon.svg — a 64x64 SVG
  // built for a browser tab — so the field was present and unusable.
  assert.ok(width >= 112, `logo phải rộng >= 112px, ${LOGO_PATH} là ${width}`);
  assert.notEqual(LOGO_PATH, '/favicon.svg', 'logo structured data không được trỏ về favicon 64px');
});

test('mọi bản logo đều sinh từ một file nguồn duy nhất', async () => {
  const source = path.join('public', 'img', 'sonvudev.logo.png');
  assert.ok(await exists(source), 'public/img/sonvudev.logo.png là file nguồn của mọi logo');
  // The generator is what keeps them the same logo. Two hand-drawn copies is how the
  // tab icon and the home screen icon end up being different logos.
  const generator = await read('scripts/make-logo-assets.ps1');
  assert.match(generator, /public\\img\\sonvudev\.logo\.png/,
    'scripts/make-logo-assets.ps1 phải đọc từ file nguồn');
  for (const derived of ['favicon.svg', 'apple-touch-icon.png', 'favicon.ico', 'mask-icon.png', 'logo-1024.png']) {
    assert.match(generator, new RegExp(derived.replace(/\./g, '\\.')),
      `${derived} phải do make-logo-assets.ps1 sinh ra`);
  }
  // The icon sizes come from a loop rather than one line each, so the sizes that
  // ICON_LINKS publishes have to be the sizes that loop actually writes.
  const sizes = [...generator.matchAll(/foreach \(\$size in @\(([^)]+)\)/g)]
    .flatMap((m) => m[1].split(',').map((n) => Number(n.trim())))
    .filter((n) => Number.isInteger(n));
  for (const link of ICON_LINKS.filter((l) => /^icon-\d+\.png$/.test(l.href))) {
    const declared = Number(l.href.match(/icon-(\d+)\.png/)[1]);
    assert.ok(sizes.includes(declared),
      `${l.href} được khai báo nhưng make-logo-assets.ps1 không sinh ra kích thước ${declared} (loop sinh: ${sizes.join(', ')})`);
  }
  // And the share card reads the same source rather than painting its own mark.
  const og = await read('scripts/make-og-image.ps1');
  assert.match(og, /sonvudev\.logo\.png/,
    'make-og-image.ps1 phải vẽ logo từ file nguồn, không tự vẽ chữ');
  assert.ok(!/DrawString\('S'/.test(og),
    "make-og-image.ps1 không được vẽ chữ 'S' thủ công làm logo");
});

test('build chặn artifact chứa file .env* ngoài .env.example', async () => {
  const build = await read('scripts/build-web.mjs');
  assert.match(build, /shippedEnv/, 'build-web.mjs phải kiểm tra artifact sau khi đóng gói');
  assert.match(build, /\.env\.example/, 'phải nêu rõ .env.example là ngoại lệ duy nhất');
  // The gate has to look at the files it wrote, not at a maintained list.
  assert.match(build, /walkProjectFiles\(publishRoot\)/,
    'phải quét artifact thực tế, không kiểm tra một danh sách riêng');
});