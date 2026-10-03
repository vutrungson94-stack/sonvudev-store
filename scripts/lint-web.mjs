// Every file in the project parses.
//
// A syntax check proves the least interesting thing about a file, and it is still
// worth automating: a file that does not parse takes the whole process down at
// import time, on a page, in production, with no partial result.
//
// The list of files comes from scripts/lib/files.mjs so that this, the build and
// the metrics all measure the same source. They used to carry three private
// copies of the walk and disagreed about what to skip, which made the count in
// the log depend on whether the machine happened to have a scratch file or a
// previous build lying around.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walkProjectFiles, JS_EXTENSIONS } from './lib/files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = await walkProjectFiles(root, { extensions: JS_EXTENSIONS });

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`[lint] FAIL: ${path.relative(root, file)}\n${result.stderr}`);
    process.exit(1);
  }
}
console.log(`[lint] PASS: ${files.length} JavaScript files checked.`);
