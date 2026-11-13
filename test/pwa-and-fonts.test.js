// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first.
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createApp } = await import('../src/app.js');

// The install dialog needs a picture of the shop, and Chrome says so when it
// is missing:
//
//   "Richer PWA install UI won't be available on desktop. Add at least one
//    screenshot with the form_factor set to wide."
//   "Richer PWA install UI won't be available on mobile. Add at least one
//    screenshot for which form_factor isn't set or set to a value other than
//    wide."
//
// The warning appears in DevTools, not in a Lighthouse score, so nothing else
// in the build would ever notice it. These two assertions are the gate.
//
// The pictures are committed (scripts/make-pwa-screenshots.mjs refreshes them),
// so the manifest may only name files that are really there, with the size the
// manifest claims — a manifest that points at a missing file turns the install
// prompt into an empty box.
// The manifest is registered by quality.js after load, and nothing about it is
// in the head. `as="manifest"` is not a valid preload destination: Chrome logs a
// warning against that exact <link> and ignores it, so the preload bought nothing
// and cost a console error. A real <link rel="manifest"> in the head would put the
// fetch on the critical tree instead, which is why it is injected later.
test('head không có link hay preload manifest', async () => {
  const app = await createApp();
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(!/<link[^>]*rel="manifest"/i.test(head),
      'head không được chứa <link rel="manifest"> — quality.js thêm sau khi tải xong');
    assert.ok(!/<link[^>]*as="manifest"/i.test(head),
      'as="manifest" không phải preload destination hợp lệ — Chrome cảnh báo và bỏ qua');
    // And the registration still happens, from the script that was always meant
    // to do it.
    const quality = await readFile(path.join(root, 'public', 'quality.js'), 'utf8');
    assert.match(quality, /manifestLink\.rel\s*=\s*['"]manifest['"]/,
      'quality.js phải gắn <link rel="manifest"> sau khi tải');
  } finally {
    server.close();
  }
});

test('webmanifest có ảnh cho cả desktop và mobile, và ảnh tồn tại đúng kích thước', async () => {
  const app = await createApp();
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/site.webmanifest`);
    assert.equal(response.status, 200, '/site.webmanifest phải trả về 200');
    const manifest = await response.json();

    const shots = manifest.screenshots || [];
    const wide = shots.filter((s) => s.form_factor === 'wide');
    const narrow = shots.filter((s) => s.form_factor !== 'wide');

    assert.ok(wide.length > 0,
      'phải có ít nhất một ảnh form_factor=wide — nếu không, Chrome báo "Richer PWA install UI won\'t be available on desktop"');
    assert.ok(narrow.length > 0,
      'phải có ít nhất một ảnh form_factor khác wide — nếu không, Chrome báo "Richer PWA install UI won\'t be available on mobile"');

    for (const shot of shots) {
      assert.match(shot.src, /^\//, 'ảnh phải trỏ bằng đường dẫn tuyệt đối');
      assert.ok(shot.sizes, `ảnh ${shot.src} phải khai báo sizes`);
      assert.equal(shot.type, 'image/png', `ảnh ${shot.src} phải là image/png`);

      const file = path.join(root, 'public', shot.src.replace(/^\//, ''));
      const bytes = await readFile(file);
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a',
        `${shot.src} không phải PNG hợp lệ`);
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      const [declaredWidth, declaredHeight] = shot.sizes.split('x').map(Number);
      assert.equal(width, declaredWidth,
        `${shot.src} rộng ${width}px nhưng manifest khai báo ${declaredWidth}px`);
      assert.equal(height, declaredHeight,
        `${shot.src} cao ${height}px nhưng manifest khai báo ${declaredHeight}px`);
    }
  } finally {
    server.close();
  }
});

// The font subsets overlap: ư đ Đ ơ ă Ư ũ and the dong sign ₫ are in both the
// vietnamese and the latin-ext range. When two faces of the same family cover
// one codepoint, the browser uses the one declared LAST.
//
// So the vietnamese rule has to be declared last for each family, or the
// browser downloads a latin-ext file that no character on the page needs: it
// did, and /fonts/space-grotesk-latin-ext.woff2 (20 KB) sat on the critical
// path of the homepage.
test('mỗi font có rule tiếng Việt đứng cuối, và không có rule trùng lặp', async () => {
  const css = await readFile(path.join(root, 'public', 'styles.css'), 'utf8');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const body = m[1];
    return {
      family: body.match(/font-family:\s*'([^']+)'/)?.[1] || '',
      // The last declaration in a rule needs no semicolon before the closing
      // brace, so the range is read up to a semicolon OR the brace.
      range: body.match(/unicode-range:\s*([^;}]+)/)?.[1] || '',
      src: body.match(/url\('([^']+)'\)/)?.[1] || '',
    };
  });

  for (const family of ['Be Vietnam Pro', 'Space Grotesk']) {
    const own = faces.filter((f) => f.family === family);
    assert.ok(own.length >= 2, `thiếu @font-face cho ${family}`);

    // The vietnamese rule carries U+1EA0-1EF9, the block of Vietnamese letters.
    const vietnamese = own.filter((f) => /U\+1EA0/i.test(f.range));
    assert.equal(vietnamese.length, 1,
      `${family} phải có đúng một rule chứa khối chữ tiếng Việt (U+1EA0), đang có ${vietnamese.length}`);
    assert.equal(own[own.length - 1].src, vietnamese[0].src,
      `rule tiếng Việt của ${family} phải đứng CUỐI: khi hai rule cùng phủ một ký tự, trình duyệt dùng rule khai báo sau cùng`);

    // No duplicates: the same file declared twice is a rule that says nothing
    // and a chance for the order to be wrong.
    const sources = own.map((f) => f.src);
    assert.equal(new Set(sources).size, sources.length,
      `${family} khai báo trùng file: ${sources.join(', ')}`);
  }
});
