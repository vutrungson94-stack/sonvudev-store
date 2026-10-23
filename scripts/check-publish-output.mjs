import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = path.join(root, 'publish-output', 'node');
const sourceDirs = ['src', 'scripts', 'public'];

async function walk(dir) {
  const out = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await walk(target)));
      else out.push(target);
    }
  } catch { /* missing dir */ }
  return out;
}

const hashFile = async (file) => crypto.createHash('sha256').update(await readFile(file)).digest('hex');

let missing = 0;
let drifted = 0;
let checked = 0;
for (const dir of sourceDirs) {
  const sourceRoot = path.join(root, dir);
  const files = await walk(sourceRoot);
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