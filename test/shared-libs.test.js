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
