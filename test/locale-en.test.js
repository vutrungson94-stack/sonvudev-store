import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// public/locales/en.json is generated from public/i18n.js's DICT (see
// scripts/lib/i18n-bundled.mjs). This test is what keeps the generated copy
// honest: a hand-edit that drifts from the browser's dictionary fails here,
// before the server and the browser end up speaking different English.
import './helpers/env.mjs';
import { extractBundledDict } from '../scripts/lib/i18n-bundled.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('public/locales/en.json matches the dictionary bundled in public/i18n.js', async () => {
  const fromDisk = JSON.parse(await readFile(path.join(root, 'public', 'locales', 'en.json'), 'utf8'));
  const fromSource = extractBundledDict('en');
  assert.deepEqual(
    fromDisk,
    fromSource,
    'public/locales/en.json is generated from the DICT in public/i18n.js. Regenerate it instead of editing it by hand.',
  );
});
