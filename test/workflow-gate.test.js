import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// The shop's test environment, applied before anything imports src/.
import './helpers/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

// The gate that reads .github/workflows/ as YAML, and why it has to be real.
//
// A `//` line inside a step list is not a YAML comment. GitHub will not parse the
// file, so it starts no jobs at all, and the run finishes `conclusion: failure`
// with nothing in it — no jobs, no steps, no logs. It looks exactly like a red
// build, and the first move anyone makes with a red build is open the logs of the
// job that failed, which here is a dead end. That typo cost two red runs before
// it could be explained.
//
// Every other gate was green throughout, because none of them parses YAML:
// `lint` reads JavaScript, the audit reads the workflow as text hunting for a
// hardcoded domain, and the workflow guard tests regex the same file for the
// patterns they care about — `secrets.APP_URL`, `exit 1`, `continue-on-error` —
// which are all still just text to a broken file.
//
// These tests pin the gate itself in place, and pin it to the shape that cannot
// be quietly broken. Without them the gate is one `git rm` away from gone, and the
// class of bug it exists for is invisible until it costs another afternoon.

test('gate YAML tồn tại, được CI chạy, và không kéo dependency vào', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.ok(pkg.scripts.workflow,
    'package.json thiếu script `workflow` — gate cú pháp YAML không ai chạy nữa');

  // A gate nobody invokes is a comment with extra steps.
  const workflow = await read('.github/workflows/checks.yml');
  assert.match(workflow, /- name: workflows\n\s+run: npm run workflow/,
    'checks.yml không chạy `npm run workflow` — gate tồn tại nhưng không ai gọi trong CI');

  // And it must stay dependency-free. `npm run metrics` counts every entry in
  // `dependencies` and `devDependencies` and treats an increase as a regression,
  // so the obvious fix — add a YAML parser — fails the build on the same day for a
  // different reason. The gate therefore scans; the tests make sure it keeps
  // scanning rather than going shopping.
  const script = await read('scripts/check-workflows.mjs');
  assert.ok(!/\bfrom ['"]yaml['"]|\brequire\(['"]yaml['"]\)/.test(script),
    'check-workflows.mjs không được import parser bên ngoài — npm run metrics coi đó là regression');
  // The invariant that keeps it that way: every import must be a `node:` builtin
  // or a repo-relative path. Anything else is a package, and a package shows up in
  // `npm run metrics` as a regression the same day it is added.
  const scriptDeps = [...script.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const source of scriptDeps) {
    assert.ok(/^node:|^\.{1,2}\//.test(source),
      `check-workflows.mjs import \`${source}\` — mọi import phải là node: builtin hoặc đường dẫn trong repo`);
  }
});

test('gate đỏ trên từng lớp lỗi, xanh trên repo sạch', async () => {
  const gate = path.join(root, 'scripts', 'check-workflows.mjs');
  const run = () => spawnSync(process.execPath, [gate], { encoding: 'utf8', timeout: 30000, cwd: root });

  const clean = run();
  assert.equal(clean.status, 0, `repo sạch mà gate đỏ thì gate hỏng:\n${clean.stdout}${clean.stderr}`);
  assert.match(clean.stdout, /\[workflow\] PASS/);

  // The throwaway lives in the real directory so the assertion is about the real
  // path, not a copy of the script in a temp tree.
  const temp = path.join(root, '.github', 'workflows', 'zz-gate-cases.yml');
  const { writeFile, rm } = await import('node:fs/promises');
  const HEAD = 'name: t\non: [push]\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n';

  const CASES = {
    '// comment': '      // comment kieu JS\n',
    'tab indent': '\t- run: echo hi\n',
    'unbalanced flow': "      node-version: ['20', '22'\n",
    'odd quote count': '      run: echo "chua dong\n',
    'no steps': '  y:\n    runs-on: ubuntu-latest\n',
    'inert step': '      - name: khong lam gi\n',
  };

  try {
    for (const [name, body] of Object.entries(CASES)) {
      await writeFile(temp, HEAD + body, 'utf8');
      const bad = run();
      assert.equal(bad.status, 1, `lỗi "${name}" phải làm gate ĐỎ`);
      assert.match(bad.stdout + bad.stderr, new RegExp(`zz-gate-cases\\.yml`),
        `lỗi "${name}" phải nêu đúng file bị lỗi`);
    }
    // And it has to say why, not just that. A failure the reader cannot act on is
    // the same dead end as a red run with no logs.
    await writeFile(temp, HEAD + '      // comment kieu JS\n', 'utf8');
    const why = run();
    assert.match(why.stdout + why.stderr, /comment của YAML/,
      'phải chỉ nguyên nhân cụ thể, không chỉ báo lỗi');
  } finally {
    await rm(temp, { force: true });
  }

  // The throwaway must really be gone: every later gate in this run — build,
  // audit, case, metrics — would read a repository that is not the committed one.
  const after = run();
  assert.equal(after.status, 0, 'file self-test còn sót lại trong .github/workflows/');
});
