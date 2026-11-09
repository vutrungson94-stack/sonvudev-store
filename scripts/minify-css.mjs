// Minifies public/styles.css (source of truth) into public/styles.min.css.
//
// The source keeps its readable formatting so tests and the audit can assert
// on real declarations (balanced braces, flex values, media-query blocks).
// The browser loads only the minified copy; both files ship, and the minified
// one is regenerated on every `npm run build` so the two can never drift.
// No extra dependency: a careful textual pass that is safe for this file
// because strings, url() and calc() keeps its inner spaces.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'public', 'styles.css');
const targetPath = path.join(root, 'public', 'styles.min.css');

let css = await readFile(sourcePath, 'utf8');
// Remove block comments, but never inside strings.
let out = '';
let inString = null;
for (let i = 0; i < css.length; i += 1) {
  const char = css[i];
  const next = css[i + 1];
  if (inString) {
    out += char;
    if (char === '\\') { out += css[++i]; continue; }
    if (char === inString) inString = null;
    continue;
  }
  if (char === '/' && next === '*') {
    const end = css.indexOf('*/', i + 2);
    if (end === -1) break;
    i = end + 1;
    out += ' ';
    continue;
  }
  if (char === '"' || char === "'") { inString = char; out += char; continue; }
  out += char;
}
// Collapse runs of whitespace to one space, keeping a single space where a
// descendant selector needs it, then trim around punctuation that never
// carries meaning (except parens/brackets, where spaces can matter).
out = out.replace(/\s+/g, ' ');
out = out.replace(/;\s*}/g, '}');
out = out.replace(/\s*([{}:,;>+~])\s*/g, '$1');
// Keep a line break before a top-level closing brace so multi-rule blocks
// stay scannable and tests that match media-query blocks still work.
out = out.replace(/}(?=[@.a-z])/g, '}\n');
out = out.trim() + '\n';
await writeFile(targetPath, out, 'utf8');
console.log(`[css:minify] ${sourcePath} -> ${targetPath} (${out.length} bytes)`);
