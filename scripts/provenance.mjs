// Provenance + SBOM nội bộ, không cần cosign/trivy.
// Ghi ai build cái gì bằng gì: commit, node, thời gian, sha256 từng file artifact
// và danh sách dependency từ package-lock. Đủ để truy vết release mà không
// thêm tool ngoài làm hỏng CI offline.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkProjectFiles } from './lib/files.mjs';
import { ARTIFACT_DIRECTORIES, ARTIFACT_FILES } from './lib/artifact.mjs';
import { gitCommand } from '../src/lib/git.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
// The same call src/pages.js and scripts/build-web.mjs use. This file carried its
// own copy for as long as the shared module existed, which is the pattern that
// produced the duplication the module was written to remove — and it went
// unnoticed because the gate over the other two named them explicitly.
const git = (...args) => gitCommand(args, root);

const files = [];
for (const d of ARTIFACT_DIRECTORIES) {
  try {
    for (const f of await walkProjectFiles(path.join(root, d))) files.push(f);
  } catch { /* thư mục thiếu sẽ bị build-web chặn sau */ }
}
for (const f of ARTIFACT_FILES) files.push(path.join(root, f));

const entries = [];
for (const abs of files) {
  try {
    const rel = path.relative(root, abs).replaceAll('\\', '/');
    if (rel.includes('/.wrangler/') || rel.includes('/.gbuildcache/')) continue;
    const buf = await readFile(abs);
    entries.push({ file: rel, sha256: sha256(buf), bytes: buf.length });
  } catch { /* file thiếu: build gate sẽ báo */ }
}
entries.sort((a, b) => a.file.localeCompare(b.file));

let sbom = [];
try {
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  for (const [p, m] of Object.entries(lock.packages || {})) {
    if (!p || !m?.version) continue;
    sbom.push({ package: p.replace(/^node_modules\//, ''), version: m.version, license: m.license || '' });
  }
  sbom.sort((a, b) => a.package.localeCompare(b.package));
} catch { sbom = []; }

const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const provenance = {
  application: manifest.name,
  version: manifest.version,
  generatedAt: new Date().toISOString(),
  gitCommit: git('rev-parse', 'HEAD'),
  gitBranch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  gitDirty: git('status', '--short') !== '',
  node: process.version,
  files: entries,
  filesSha256: sha256(Buffer.from(entries.map((e) => `${e.sha256}  ${e.file}`).join('\n'))),
};
await mkdir(path.join(root, 'build-reports'), { recursive: true });
await writeFile(path.join(root, 'build-reports', 'provenance.json'), JSON.stringify(provenance, null, 2));
await writeFile(path.join(root, 'build-reports', 'sbom.json'), JSON.stringify({ generatedAt: provenance.generatedAt, packages: sbom }, null, 2));
console.log(`[provenance] PASS: ${entries.length} files, ${sbom.length} packages, commit ${provenance.gitCommit.slice(0, 8) || 'n/a'}.`);
