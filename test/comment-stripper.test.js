import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../scripts/lib/source.mjs';
// The shared shop environment every test file loads, so this one is configured
// exactly like the rest rather than inheriting whatever the machine happens to
// have exported.
import './helpers/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every gate that reads code as data goes through this one function: the
// diacritics audit, the refuse-key scan and the case checker. It had no test of
// its own, which is why two defects in it stayed invisible for as long as they
// did — the stripper stopped stripping, and because what it failed to strip was
// English comments rather than Vietnamese, nothing went red.
//
// It went red the day a comment in public/format.js happened to contain a phrase
// the diacritics audit also knows, so the failure surfaced as a false positive in
// an unrelated check. A helper every gate depends on is checked here instead.

test('chuỗi có dấu gạch chéo hai bên trong vẫn là dữ liệu, không phải chú thích', () => {
  assert.equal(stripComments('const url = "https://example.test/a";'), 'const url = "https://example.test/a";');
  assert.equal(stripComments("const url = 'https://example.test/a';"), "const url = 'https://example.test/a';");
  assert.equal(stripComments('const t = `https://example.test/a`;'), 'const t = `https://example.test/a`;');
});

test('dấu gạch chéo chạm nhau ngoài chuỗi vẫn mở đầu chú thích', () => {
  // The case this replaced: the heuristic looked for a colon before the slashes,
  // so a bare "//" with nothing in front of it was read as a URL and kept.
  const first = (source) => stripComments(source).split('\n')[0];
  assert.equal(first('// a comment\nconst a = 1;'), ' '.repeat('// a comment'.length));
  assert.equal(first('a // trailing\nb'), 'a' + ' '.repeat(' // trailing'.length));
  assert.equal(first('/* block */\ncode'), ' '.repeat('/* block */'.length));
});

test('mẫu biểu thức chính quy có thể chứa dấu nháy, và đó không phải là chuỗi', () => {
  // This is the escaper's own pattern in public/format.js. Read as strings, the
  // `"` inside the class opens a string that never closes, and every comment
  // after that line is scanned as code.
  const source = 'var esc = String(v).replace(/[&<>"\']]/g, fn);\n// a comment here\nconst after = 1;';
  const stripped = stripComments(source);
  assert.equal(stripped.length, source.length, 'độ lệch byte phải giữ nguyên để số dòng báo cáo không lệch');
  assert.ok(!stripped.includes('a comment here'), 'chú thích sau mẫu biểu thức vẫn phải bị xoá');
  assert.ok(stripped.includes('const after = 1;'), 'mã sau mẫu biểu thức phải còn nguyên');
});

test('mẫu lồng nhau trong ${} là chữ, không phải dấu nháy đóng', () => {
  // The second way this scanner used to stop working, and the one that broke
  // src/pages.js: counting backticks closes a template on its own nested one, and
  // everything after that is read as one long string.
  const source = [
    'const html = block.split("\\n")',
    '  .map((line) => `<li>${esc(line.replace(/^-/, "").trim())}</li>`)',
    '  .join("");',
    '// a comment after a nested template',
    'const after = 1;',
  ].join('\n');
  const stripped = stripComments(source);
  assert.ok(!stripped.includes('a comment after'), 'chú thích sau mẫu lồng nhau phải bị xoá');
  assert.ok(stripped.includes('const after = 1;'), 'mã sau mẫu lồng nhau phải còn nguyên');
  assert.equal(stripped.length, source.length);
});

test('ngoặc nhọn bên trong ${} không được trả quyền điều khiển về cho mẫu', () => {
  const source = 'const s = `a${fn({ x: 1 }).y}b`;\n// still a comment\nconst after = 2;';
  const stripped = stripComments(source);
  assert.ok(!stripped.includes('still a comment'), 'dấu } của object literal không được đóng ${}');
  assert.ok(stripped.includes('const after = 2;'));
});

test('phân biệt chia và biểu thức chính quy khi gặp dấu gạch chéo', () => {
  // Division: a slash after a value. The slashes are data and must survive.
  assert.equal(stripComments('const half = total / 2;'), 'const half = total / 2;');
  assert.equal(stripComments('const half = (a + b) / 2;'), 'const half = (a + b) / 2;');
  assert.equal(stripComments('f(x) / 2'), 'f(x) / 2');
  // Regex: a slash where an operand is expected, including after a keyword —
  // `return` ends in a letter, so the last character alone calls it division.
  assert.equal(stripComments('const re = /a\\/b/;'), 'const re = /a\\/b/;');
  assert.equal(stripComments('return /[a-z]+/.test(s);'), 'return /[a-z]+/.test(s);');
  // A slash inside a character class does not close the literal.
  assert.equal(stripComments('const re = /[/]/;'), 'const re = /[/]/;');
  // `/**` after a `}` is a JSDoc block, not a division followed by a multiply.
  assert.equal(stripComments('}\n/** doc */\nconst a = 1;'), '}\n          \nconst a = 1;');
});

test('offset không đổi, nên dòng báo cáo vẫn chỉ đúng dòng', () => {
  const source = [
    'const a = 1;',
    '// một dòng tiếng Việt có dấu',
    '/* và một khối',
    '   nhiều dòng */',
    'const b = 2;',
  ].join('\n');
  const stripped = stripComments(source);
  assert.equal(stripped.length, source.length);
  assert.equal(stripped.split('\n').length, source.split('\n').length);
  assert.equal(stripped.split('\n')[0], 'const a = 1;');
  assert.equal(stripped.split('\n')[1].trim(), '');
  assert.equal(stripped.split('\n')[4], 'const b = 2;');
});

test('không file thật nào trong repo còn sót lại chú thích', () => {
  // The property that was false for 28 files, stated over the whole tree so it
  // cannot go false again quietly. A file may legitimately hold "//" inside a
  // string or a regex, so the check is for a "//" that starts a line's trimmed
  // text, which is what a comment always looks like.
  const dirs = ['src', 'public', 'scripts', 'test', 'deploy', 'cloudflare'];
  const offenders = [];
  for (const dir of dirs) {
    if (!fs.existsSync(path.join(root, dir))) continue;
    const walk = (full) => {
      for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const target = path.join(full, entry.name);
        if (entry.isDirectory()) { walk(target); continue; }
        if (!/\.(mjs|js)$/.test(entry.name)) continue;
        const raw = fs.readFileSync(target, 'utf8');
        const relative = path.relative(root, target).replaceAll('\\', '/');
        stripComments(raw).split('\n').forEach((line, index) => {
          if (line.trim().startsWith('//')) offenders.push(`${relative}:${index + 1}`);
        });
      }
    };
    walk(path.join(root, dir));
  }
  assert.deepEqual(offenders, [],
    `các chú thích này không bị xoá — máy quét đang đọc chú thích như mã:\n${offenders.join('\n')}`);
});