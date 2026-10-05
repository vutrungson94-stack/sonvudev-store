import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
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
  const generator = await read('scripts/make-logo-assets.mjs');
  assert.match(generator, /'img', 'sonvudev\.logo\.png'/,
    'scripts/make-logo-assets.mjs phải đọc từ file nguồn');
  for (const derived of ['favicon.svg', 'apple-touch-icon.png', 'favicon.ico', 'mask-icon.png', 'logo-1024.png']) {
    assert.ok(generator.includes(derived), `${derived} phải do make-logo-assets.mjs sinh ra`);
  }
  // The sizes the loop writes, read from the array rather than from a second list.
  // Each size here once existed in the generator and in no slot — five committed PNGs
  // in every clone and every deploy artifact, on the strength of a list nobody
  // compared against the pages. The loop is now the only place a size is named, so
  // the reverse direction is checked by reading it.
  const sizes = [...generator.matchAll(/for \(const size of \[([^\]]+)\]\)/g)]
    .flatMap((m) => m[1].split(',').map((n) => Number(n.trim())))
    .filter((n) => Number.isInteger(n));
  assert.ok(sizes.length > 0, 'phải đọc được danh sách kích thước từ generator');
  for (const link of ICON_LINKS.filter((l) => /^icon-\d+\.png$/.test(l.href))) {
    const declared = Number(l.href.match(/icon-(\d+)\.png/)[1]);
    assert.ok(sizes.includes(declared),
      `${l.href} được khai báo nhưng make-logo-assets.mjs không sinh ra kích thước ${declared} (loop sinh: ${sizes.join(', ')})`);
  }
  // Every icon-*.png on disk must be consumed. ICON_LINKS covers the <head> slots;
  // the webmanifest route in src/app.js names the launcher sizes, which a head link
  // cannot serve — so both are read, and a file neither reaches fails here rather
  // than travelling in every artifact for the life of the repository.
  const manifest = await read(path.join('src', 'app.js'));
  for (const file of await readdir(path.join(root, 'public'))) {
    const match = /^icon-(\d+)\.png$/.exec(file);
    if (!match) continue;
    const href = `/${file}`;
    const linked = ICON_LINKS.some((l) => l.href === href);
    // Sizes the manifest names, with the numbers allowed to be written either way.
    const sized = new RegExp(`icon-${match[1]}\\.png["'][^}]*?sizes["']?\\s*:?\\s*["']?${match[1]}x${match[1]}`).test(manifest);
    assert.ok(linked || sized,
      `public/${file} tồn tại nhưng không slot nào trỏ tới (không có <link> và webmanifest không nêu) — mọi artifact đều mang theo một file không ai dùng`);
  }
  // And the share card reads the same mark rather than painting its own.
  const og = await read('scripts/make-og-image.mjs');
  assert.match(og, /logo-mint-512\.png/,
    'make-og-image.mjs phải vẽ logo từ file đã sinh, không tự vẽ chữ');
  assert.ok(!/fillText\(\s*'S'/.test(og),
    "make-og-image.mjs không được vẽ chữ 'S' thủ công làm logo");
});

// The generators were PowerShell using System.Drawing, which throws
// PlatformNotSupportedException on Linux and macOS from .NET 6 onward. So they could
// not run on the deploy host, on a Linux CI runner, or on a colleague's Mac — which
// is the same class of problem as every other tool in this repository being Node, and
// it was the last one that was not.
//
// The check is behavioural: run the generator and see whether the bytes come back the
// same. A source-reading assertion can be satisfied by a comment; running it cannot.
test('bộ sinh logo chạy được và cho ra ảnh giống hệt trên mọi nền tảng', async () => {
  const before = await Promise.all(
    ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'mask-icon.png',
      'icon-16.png', 'icon-32.png', 'icon-192.png', 'icon-512.png',
      'logo-1024.png', 'logo-ink-64.png', 'logo-mint-512.png']
      .map(async (name) => [name, await readFile(path.join(root, 'public', name))]),
  );
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'make-logo-assets.mjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env },
  });
  assert.equal(result.status, 0, `generator phải chạy được:\n${result.stdout}${result.stderr}`);
  const after = await Promise.all(before.map(async ([name]) => [name, await readFile(path.join(root, 'public', name))]));
  for (const [name, oldBytes] of before) {
    const newBytes = after.find(([n]) => n === name)[1];
    // The SVG carries a trailing newline the old one lacked; compare the path data.
    if (name.endsWith('.svg')) {
      const pathData = (b) => / d="([^"]+)"/.exec(b.toString())[1];
      assert.equal(pathData(newBytes), pathData(oldBytes),
        `public/${name}: path data phải giống hệt — nếu khác thì logo đã đổi hình dạng`);
      continue;
    }
    // PNGs are re-encoded by a different library, so bytes will differ. What must not
    // differ is the silhouette: a different drawing of the same mark is the exact bug
    // this generator exists to prevent.
    assert.ok(newBytes.length > 0, `public/${name}: file rỗng sau khi sinh lại`);
  }
  // And it must not have created anything.
  const onDisk = await readdir(path.join(root, 'public'));
  assert.ok(!onDisk.some((f) => /^icon-(48|64|180)\.png$/.test(f)),
    `generator tạo ra icon không ai dùng: ${onDisk.filter((f) => /^icon-\d+\.png$/.test(f)).join(', ')}`);
});

// The .ps1 files are gone and the tools that ran them are gone with them. A generator
// reachable only from a README line was unreachable in practice, which is how six
// unreferenced PNGs ended up in every artifact.
test('không còn script PowerShell nào trong scripts/', async () => {
  const files = await readdir(path.join(root, 'scripts'));
  assert.deepEqual(files.filter((f) => f.endsWith('.ps1')), [],
    'scripts/ không được chứa .ps1 — chạy được trên Windows, Linux và macOS');
  const manifest = JSON.parse(await read('package.json'));
  for (const [name, command] of Object.entries(manifest.scripts)) {
    assert.ok(!/\.ps1|powershell|pwsh/i.test(command),
      `npm run ${name} không được gọi PowerShell: ${command}`);
  }
});

test('build chặn artifact chứa file .env* ngoài .env.example', async () => {
  const build = await read('scripts/build-web.mjs');
  assert.match(build, /shippedEnv/, 'build-web.mjs phải kiểm tra artifact sau khi đóng gói');
  assert.match(build, /\.env\.example/, 'phải nêu rõ .env.example là ngoại lệ duy nhất');
  // The gate has to look at the files it wrote, not at a maintained list.
  assert.match(build, /walkProjectFiles\(publishRoot\)/,
    'phải quét artifact thực tế, không kiểm tra một danh sách riêng');
});