// Runs the whole suite with a bounded number of workers, and reports a failure
// well enough to act on.
//
// What this file is actually for: on the first cold full run of this repository
// after the suite had grown, `test/order-expiry.test.js` was reported as a
// single red file with the message "test failed" — no test names, no assertion,
// no stack, and the file itself passed when run alone. Node's spec reporter had
// nothing to print because the file's worker process died at load, on a machine
// that was cold-caching 74 test files under a real-time scanner.
//
// Three whole runs afterwards passed clean, which is the point: the failure was
// real but not reproducible on demand, and a failure you cannot reproduce is
// only diagnosable from what the machine captured at the time. So the capture
// is the feature — stderr goes to a file on every run and to the console on a
// red one, and a red run with no captured output says so in words rather than
// looking like a broken test.
//
// Everything else here is unchanged from before: one `node --test` process with
// its own worker pool, so Node keeps the per-file isolation it already does —
// this file only bounds the pool and owns the reporting around it.
import { spawnSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every *.test.js in test/, sorted so two runs on two machines list the files
// in the same order.
//
// The list is computed here rather than globbed by a shell, and that is load-
// bearing knowledge this file has carried since it was written:
//   `node --test test/*.test.js` — the shell expands the glob on Linux, so CI
//   works; PowerShell passes `*` through untouched, so it reaches Node as a
//   literal, which only works on Node 22 and up. On Node 20 — the version
//   package.json promises to support — it is a filename that does not exist and
//   the whole run fails before a single assertion.
//   `node --test test/` — Node treats the argument as a file, not a directory,
//   and fails with MODULE_NOT_FOUND.
// helpers/ holds the fixtures the tests import; it is not a test file, and
// running it would load a module that only has side effects.
const found = (await readdir(path.join(root, "test")))
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join(root, "test", name));

if (!found.length) {
  console.error("[test] FAIL: không tìm thấy file test nào trong test/");
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

// stdout is inherited so the reporter's lines arrive live, in order, exactly as
// before. stderr is piped: a worker that dies mid-run writes there, and the
// default behaviour of forwarding it straight to the terminal means it scrolls
// past with the other output and is gone by the time anyone scrolls back.
const result = spawnSync(
  process.execPath,
  ['--test', `--test-concurrency=${concurrency}`, `--max-old-space-size=${heap}`, ...extra, ...found],
  { stdio: ['inherit', 'inherit', 'pipe'], cwd: root, maxBuffer: 64 * 1024 * 1024 },
);

const stderr = String(result.stderr || '');
try {
  // logs/ is gitignored. The point of the file is the morning after: a red run
  // whose scrollback is gone still has this to read.
  await mkdir(path.join(root, 'logs'), { recursive: true });
  await writeFile(path.join(root, 'logs', 'test-stderr.log'), stderr);
} catch { /* a read-only checkout must not turn a green suite red over a log file */ }

if (result.status !== 0) {
  console.error(`\n[test] FAIL — ${found.length} file test, exit=${result.status ?? 'signal ' + result.signal}.`);
  console.error('[test] stderr của worker đã lưu ở logs/test-stderr.log.');
  if (stderr.trim()) {
    // The tail rather than the whole thing: the first lines of a long run are the
    // success it had before the failure, which is the part nobody needs.
    const lines = stderr.trimEnd().split('\n');
    console.error(`\n[test] ${lines.length} dòng stderr, 40 dòng cuối:`);
    for (const line of lines.slice(-40)) console.error(line);
  } else {
    // The exact shape of the failure this runner was changed for: the worker
    // died without writing a line. Saying so is worth more than a blank space
    // where an error should be, because the two obvious readings — "the test is
    // broken" and "the machine died" — lead to opposite first moves.
    console.error('\n[test] Worker process kết thúc bất thường KHÔNG để lại dòng stderr nào.');
    console.error('[test] Không phải bằng chứng test hỏng: một tiến trình con chết im lặng thường là');
    console.error('[test] máy (thiếu RAM, ổ đĩa, phần mềm diệt virus quét thư mục tạm) chứ không phải mã.');
    console.error('[test] Chạy lại: npm test. Vẫn đỏ thì chạy từng file để tìm file bị:');
    console.error(`[test]   node --test test/<tên-file>.test.js`);
  }
  process.exit(typeof result.status === 'number' ? result.status : 1);
}

console.log(`\n[test] ${found.length} file test, tất cả xanh.`);
