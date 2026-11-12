import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/. See
// helpers/env.mjs; every test file must import it first.
import './helpers/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The failure this holds: on Render the checkout directory is itself named
// `src` (/opt/render/project/src), so `f.includes('/src/')` matched EVERY file
// in the repository. The duplication counters then counted the test suite as
// source — escCopies 2→4, moneyCopies 2→3, initialsCopies 2→4, sizeCopies 2→3 —
// and the build failed on Render while passing on every developer machine.
// A gate that answers differently depending on who ran it is an observation,
// not a gate.
test('metrics lọc file theo đường dẫn tương đối, không phải chuỗi tuyệt đối', async () => {
  const src = await readFile(path.join(root, 'scripts', 'metrics.mjs'), 'utf8');
  assert.doesNotMatch(src, /includes\(`\$\{path\.sep\}src\$\{path\.sep\}`\)/,
    'metrics không được lọc bằng chuỗi tuyệt đối — sẽ sai trên host có thư mục checkout tên src (Render)');
  assert.doesNotMatch(src, /includes\(`\$\{path\.sep\}public\$\{path\.sep\}`\)/,
    'metrics không được lọc public bằng chuỗi tuyệt đối');
  assert.match(src, /relative\(f\)\.startsWith\('src\/'\)/,
    'metrics phải lọc src theo đường dẫn tương đối');
  assert.match(src, /relative\(f\)\.startsWith\('public\/'\)/,
    'metrics phải lọc public theo đường dẫn tương đối');
});
