import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first.
import './helpers/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFile(path.join(root, relative), 'utf8');

// The commit used for CSS cache-busting was written out twice — once in
// scripts/build-web.mjs and once in src/pages.js, byte for byte identical. Two
// copies of a git call do not have to be wrong today to disagree tomorrow: the
// build stamps the packaged HTML and the server stamps the rendered page, and if
// the two derive the version differently a visitor is served a stylesheet URL
// that no longer matches the one a different page cached. One module now owns it.
test('commit dùng cho cache-busting chỉ có một implementation', async () => {
  const git = await read('src/lib/git.mjs');
  assert.ok(/export const commitHash/.test(git), 'src/lib/git.mjs phải xuất commitHash');

  for (const [name, file] of [['pages.js', await read('src/pages.js')], ['build-web.mjs', await read('scripts/build-web.mjs')]]) {
    assert.ok(/from ["'](?:\.\.\/)*src\/lib\/git\.mjs["']|from ["']\.\/lib\/git\.mjs["']/.test(file),
      `${name} phải import commitHash từ src/lib/git.mjs`);
    assert.ok(!/spawnSync\(\s*['"]git['"]/.test(file),
      `${name} không được gọi git trực tiếp — dùng commitHash từ src/lib/git.mjs`);
  }
});

// A module that only re-exports another and is imported by nothing is dead
// weight with two homes for the same symbol: it looks like the public entry
// point, so the next edit lands there and the real module silently keeps the old
// behaviour. src/lib/format.mjs was exactly this — it re-exported esc/money from
// src/format.js and no file imported it, while pages.js, notify.js and
// fill-static-text.mjs all imported src/format.js directly. This walks every
// src/lib/*.mjs and fails if one has no importer anywhere in src/, public/,
// scripts/ or test/.
test('không có module src/lib nào là re-export mồ côi (orphan)', async () => {
  const libDir = path.join(root, 'src', 'lib');
  const libFiles = (await fs.readdir(libDir)).filter((name) => name.endsWith('.mjs'));

  // Every source file a module could be imported from, read once.
  const searchRoots = ['src', 'public', 'scripts', 'test'];
  const sources = [];
  for (const dir of searchRoots) {
    const walk = async (current) => {
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        if (entry.isDirectory()) { await walk(path.join(current, entry.name)); continue; }
        if (/\.(js|mjs)$/.test(entry.name)) sources.push({ rel: path.join(current, entry.name), text: await fs.readFile(path.join(current, entry.name), 'utf8') });
      }
    };
    await walk(path.join(root, dir));
  }

  const orphans = [];
  for (const lib of libFiles) {
    const self = path.join(libDir, lib);
    const importedSomewhere = sources.some(({ rel, text }) => {
      if (path.resolve(rel) === path.resolve(self)) return false; // a file does not import itself
      // Either "from './lib/<name>'" (a sibling under src/lib) or the path ending
      // in "/<name>" from anywhere else — the only two shapes an importer can take.
      return new RegExp(`from ["'][^"']*${lib.replace('.', '\\.')}["']`).test(text);
    });
    if (!importedSomewhere) orphans.push(`src/lib/${lib}`);
  }

  assert.deepEqual(orphans, [],
    `module src/lib không được import ở đâu (orphan): ${orphans.join(', ')} — dùng nó, hoặc xóa`);
});

// initials and formatBytes were the two helpers this project shared across three
// call sites and guarded nowhere: src/pages.js on the server, public/app.js in
// the browser, and a full second implementation inside public/admin.js. The
// panel's copy had already drifted — it took the first two characters of a
// product's name, so "Ram Cleaner" showed "RA" against the storefront's "RC".
//
// They now live beside esc and money, one implementation per runtime, the same
// arrangement this file already pins for the cache-busting commit. This test is
// the half a counter cannot do: it runs the browser file in the harness the
// other page tests use and compares what it prints, byte for byte, against
// what the server prints.
test('initials và định dạng byte: một bản mỗi runtime, và hai runtime in ra cùng một thứ', async () => {
  const { runScript } = await import('./helpers/dom.mjs');

  // One declaration per runtime, and the browser one published on the object
  // every page already calls through.
  const server = await read('src/format.js');
  assert.ok(/export const initials\s*=/.test(server), 'src/format.js phải xuất initials');
  assert.ok(/export const formatBytes\s*=/.test(server), 'src/format.js phải xuất formatBytes');
  const browser = await read('public/format.js');
  assert.ok(/function initials\(/.test(browser), 'public/format.js phải có initials');
  assert.ok(/function formatBytes\(/.test(browser), 'public/format.js phải có formatBytes');
  assert.ok(/window\.SVDFormat = \{ esc: esc, money: money, initials: initials, formatBytes: formatBytes \};/.test(browser),
    'public/format.js phải xuất bốn hàm dùng chung trên window.SVDFormat');

  // And the three consumers call through, each in the shape its file uses.
  const pages = await read('src/pages.js');
  assert.ok(/import \{ esc, money, formatBytes, initials \} from "\.\/format\.js";/.test(pages),
    'pages.js phải import bốn hàm từ format.js');
  for (const [name, file] of [['app.js', await read('public/app.js')], ['admin.js', await read('public/admin.js')]]) {
    assert.ok(new RegExp(`window\\.SVDFormat\\.initials\\(|window\\.SVDFormat\\.formatBytes\\(`).test(file),
      `${name} phải gọi bộ dùng chung, không tự viết lại`);
    assert.ok(!/\.split\(\/\\s\+\/\)/.test(file), `${name} không được giữ bản sao của initials`);
    assert.ok(!/\[.B., .KB., .MB., .GB.\]/.test(file), `${name} không được giữ bản sao của formatBytes`);
  }

  // The half that matters: the two runtimes print the same thing for the same
  // input. The admin icon shows a product's initials next to the storefront's
  // card, so "Ram Cleaner" is "RC" in both places or the panel is describing a
  // product the shop is not selling.
  const { initials, formatBytes } = await import('../src/format.js');
  const { window } = await runScript('');
  const cases = [
    ['initials', 'Ram Cleaner', 'RC'],
    ['initials', 'trung sơn', 'TS'],
    ['initials', 'SonVuDev', 'S'],
    // The fallback "SV" is one word, so its initials are "S" — which is what
    // both runtimes produce, and the case where a wrong "SV" expectation here
    // would have "corrected" a working implementation.
    ['initials', '', 'S'],
    ['initials', null, 'S'],
    ['formatBytes', 0, ''],
    ['formatBytes', -5, ''],
    ['formatBytes', 512, '512 B'],
    ['formatBytes', 1536, '1.5 KB'],
    ['formatBytes', 5 * 1024 * 1024, '5.0 MB'],
    ['formatBytes', 150 * 1024 * 1024, '150 MB'],
  ];
  for (const [fn, input, expected] of cases) {
    const fromServer = fn === 'initials' ? initials(input) : formatBytes(input);
    const fromBrowser = window.SVDFormat[fn](input);
    assert.equal(fromBrowser, expected, `public/format.js ${fn}(${JSON.stringify(input)}) phải ra ${JSON.stringify(expected)}`);
    assert.equal(fromServer, expected, `src/format.js ${fn}(${JSON.stringify(input)}) phải ra ${JSON.stringify(expected)}`);
  }
});
