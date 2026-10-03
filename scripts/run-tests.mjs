// Runs every test file, on every supported Node version, on every operating
// system. It exists because the two obvious ways to say it are each broken in one
// place, and the project needed both fixed at once.
//
//   node --test test/*.test.js
//     The shell expands the glob on Linux, so CI works. PowerShell passes `*`
//     through untouched, so it reaches Node as a literal — which works on Node 22
//     and up, because the test runner grew its own glob support there. On Node 20
//     it is a filename that does not exist, so the whole run fails before a single
//     assertion. That is the version package.json promises to support and CI
//     pinned as its only one.
//
//   node --test test/
//     Node treats the argument as a file to run, not a directory to search, and
//     fails with MODULE_NOT_FOUND.
//
// So the list is computed here, from the same walk every other tool uses, and
// handed to Node as an explicit argument vector. No shell is involved, so there is
// nothing to expand and nothing to quote — which is also what lets the same command
// work in cmd.exe, PowerShell, bash and on a CI runner.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walkProjectFiles } from './lib/files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'test');

const found = (await walkProjectFiles(testDir))
  // helpers/ holds the fixtures the tests import. It is not a test file, and
  // running it would load a module that only has side effects.
  .filter((file) => file.endsWith('.test.js'))
  .sort();

if (!found.length) {
  console.error('[test] FAIL: không tìm thấy file test nào trong test/');
  process.exit(1);
}

const extra = process.argv.slice(2);
const result = spawnSync(process.execPath, ['--test', ...extra, ...found], { stdio: 'inherit', cwd: root });
process.exit(result.status === null ? 1 : result.status);