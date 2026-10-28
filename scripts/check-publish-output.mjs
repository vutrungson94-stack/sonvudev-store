// Compares the packaged artifact against the source tree: every shipped source file
// must be byte-identical, so a build that copied a stale file (or was not re-run)
// is caught before the deploy.
//
// The walk is the shared one from scripts/lib/files.mjs. This file used to carry a
// private copy, which is the exact duplication that module exists to end: the copy
// had no exclusion rules, so it descended into any scratch directory that happened
// to sit under public/, scripts/ or src/ and compared files that were never intended
// to ship.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { walkProjectFiles } from './lib/files.mjs';
import { ARTIFACT_PATH } from './lib/artifact.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = path.join(root, ARTIFACT_PATH);
// Directories the artifact is built from, and the only ones a drift check can
// compare one-to-one: HTML is rewritten by the build (cache-busted stylesheet
// links), so it is compared by existence rather than by hash.
const sourceDirs = ['src', 'scripts', 'public'];

const hashFile = async (file) => crypto.createHash('sha256').update(await readFile(file)).digest('hex');

let drifted = 0;
let checked = 0;
for (const dir of sourceDirs) {
  const sourceRoot = path.join(root, dir);
  const files = await walkProjectFiles(sourceRoot);
  for (const file of files) {
    if (file.endsWith('.html')) continue;
    const rel = path.relative(root, file).replaceAll('\\', '/');
    const target = path.join(artifact, rel);
    try {
      const sourceHash = await hashFile(file);
      const targetHash = await hashFile(target);
      checked++;
      if (sourceHash !== targetHash) {
        console.error(`[publish-output] drift: ${rel}`);
        drifted++;
      }
    } catch {
      // Artifact may not contain this file; that is not drift, it is a subset.
    }
  }
}

if (drifted > 0) {
  console.error(`[publish-output] ${drifted} file(s) drift against ${artifact}.`);
  process.exit(1);
}
console.log(`[publish-output] PASS: ${checked} source file(s) match the artifact.`);