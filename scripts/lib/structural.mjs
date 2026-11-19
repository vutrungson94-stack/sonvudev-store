// Structural static analysis: cross-module name-collision detection (C9).
//
// Two modules exporting the same name is a real footgun: when app.js imports
// the name without renaming, ESM gives the last-writer-wins binding, so the
// identifier resolves to a different function depending on which module the
// import site resolves first. That flips a developer's mental model and is a
// classic "the page suddenly calls the wrong function" class of defect. Doing
// it at static-analysis time makes the collision a CI finding, not a runtime
// surprise.
//
// One implementation per concern (C9): shared by lint and audit so they cannot
// drift.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function walkDir(dir) {
  const names = new Map(); // name -> [files]
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.js') && !entry.name.endsWith('.mjs')) continue;
    const filePath = path.join(dir, entry.name);
    const relPath = path.relative(root, filePath).split(path.sep).join('/');
    const source = await readFile(filePath, 'utf8').catch(() => "");
    for (const match of source.matchAll(/export\s+(?:async\s+function|function|const)\s+([A-Za-z0-9_$]+)/g)) {
      const name = match[1];
      const list = names.get(name) || [];
      if (!list.includes(relPath)) list.push(relPath);
      names.set(name, list);
    }
  }
  const findings = [];
  for (const [name, files] of names) {
    if (files.length > 1) {
      findings.push({
        check: 'duplicate-export',
        file: files[0],
        detail: `tên exported "${name}" cũng bị xuất trong: ${files.slice(1).join(', ')} — import site không có điều kiện chọn, last-writer-wins từ số hình`,
      });
    }
  }
  return findings;
}

export const structuralFindings = () => walkDir(path.join(root, 'src'));
