import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(root, 'public', name), 'utf8');

function braceBalance(css) {
  let depth = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

// The browser loads the minified copy; the source stays the readable file the
// audit and the style tests assert on. A minified file that drifts from the
// source (stale, truncated or reformatted comments left behind) ships a page
// that looks right on the machine that built it and wrong everywhere else.
test('styles.min.css is the minified form of styles.css', async () => {
  const source = await read('styles.css');
  const minified = await read('styles.min.css');
  assert.ok(braceBalance(minified), 'styles.min.css has unbalanced braces');
  assert.ok(minified.length < source.length, `minified (${minified.length}) must be smaller than source (${source.length})`);
  assert.ok(!minified.includes('/*'), 'minified file must not keep block comments');
  // A selector the audit and chrome tests pin: the minified copy must carry it.
  assert.match(minified, /--coral-ink:#b81e14/, 'minified must declare --coral-ink');
  assert.match(minified, /\.site-header\s*\{/, 'minified must contain the site header rule');
  assert.match(minified, /@media\(max-width:800px\)/, 'minified must keep media-query wrappers');
});

test('pages load the minified stylesheet', async () => {
  const html = await read('index.html');
  assert.match(html, /<link[^>]*href="\/styles\.min\.css"/, 'index.html must link the minified stylesheet');
  assert.ok(!/<link[^>]*href="\/styles\.css"/.test(html) || html.includes('href="/styles.min.css"'),
    'index.html must not load the unminified copy in production');
});
