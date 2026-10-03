import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/.
import './helpers/env.mjs';

// case-check catches what nothing else can: an import whose capitalisation
// matches on Windows (NTFS) and fails on Linux (deploy, CI). node --check
// does not resolve imports, the audit reads text, and the suite only runs
// when it is already green — so without this gate the failure hides behind
// whatever else is red.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The script stays in the repo so its own imports resolve; --root points it
// at a fixture tree, the same shape audit-web.mjs uses for its own tests.
const runCase = (root = projectRoot) => spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'case-check.mjs'), ...(root === projectRoot ? [] : ['--root', root])], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: { ...process.env, NODE_ENV: 'test' },
});

test('case-check chạy sạch trên chính dự án này', () => {
  const result = runCase();
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, `case-check phải sạch:\n${output}`);
  assert.match(result.stdout, /\[case\] PASS/);
});

test('case-check bắt import sai hoa/thường mà Windows không thấy', async () => {
  // A check that cannot be made to fail is a check that does nothing. The
  // file on disk is y.js, the import asks for Y.js: identical on NTFS,
  // a missing module on ext4. The comparison is string-based, so the fixture
  // fails on both filesystems.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-case-'));
  try {
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src', 'y.js'), 'export const y = 1;\n', 'utf8');
    await fs.writeFile(path.join(dir, 'src', 'x.js'), 'import { y } from "./Y.js";\nconsole.log(y);\n', 'utf8');
    const result = runCase(dir);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'phải FAIL');
    assert.match(output, /\[case\] FAIL/, 'phải báo FAIL');
    assert.match(output, /Y\.js/, 'phải nêu tham chiếu sai');
    assert.match(output, /src[\/\\]x\.js/, 'phải nêu file chứa tham chiếu sai');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('case-check bỏ qua import đúng hoa/thường', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-case-'));
  try {
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src', 'y.js'), 'export const y = 1;\n', 'utf8');
    await fs.writeFile(path.join(dir, 'src', 'x.js'), 'import { y } from "./y.js";\nconsole.log(y);\n', 'utf8');
    const result = runCase(dir);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, `cây đúng phải sạch:\n${output}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
