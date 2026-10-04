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

// Node's test runner defaults to one worker per reported CPU, and every file here
// boots an Express server and shells out to build/audit at least once. On a 16 GB
// developer machine with a browser open that is enough to exhaust the heap: the run
// died with "Zone Allocation failed" and then "spawn UNKNOWN" across all 42 files,
// which reads exactly like 42 broken tests and is not one. A suite that cannot be
// run on the machine it was written on is a suite people stop running.
//
// Four is deliberate rather than a guess at the fastest number: it keeps the wall
// clock close to the unbounded run on CI while leaving the heap room for the parent
// runner and the servers the workers start. Override with TEST_CONCURRENCY, or by
// passing --test-concurrency yourself — extra arguments come after this one, so
// yours wins.
const concurrency = process.env.TEST_CONCURRENCY || '4';

// A heap cap per worker, and the reason is reservation rather than real usage.
//
// V8 reserves virtual address space for its old generation up front, so every Node
// process asks the OS for a large slice of memory whether or not it touches it.
// With one process per test file, that reservation — not the test data — is what
// exhausts a machine. On a 16 GB box with a browser and an editor open, the suite
// died with "Zone Allocation failed" and then "spawn UNKNOWN" across all 42 files,
// which reads exactly like 42 broken tests and is not one. No individual file here
// needs more than a small fraction of this: the heaviest is the admin panel suite,
// which parses a 100 KB script in a vm.
const heap = process.env.TEST_HEAP || '768';

const result = spawnSync(process.execPath, ['--test', `--test-concurrency=${concurrency}`, `--max-old-space-size=${heap}`, ...extra, ...found], { stdio: 'inherit', cwd: root });
process.exit(result.status === null ? 1 : result.status);