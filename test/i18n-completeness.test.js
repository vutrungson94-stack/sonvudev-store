// i18n completeness test - prevents translation regressions.
//
// The storefront ships two kinds of dictionary:
//   1. public/i18n.js  - vi + en bundled inline (source + fallback).
//      These two MUST be in lockstep: every vi key exists in en and vice versa.
//   2. public/locales/<lang>.json - de/es/fr/ja/zh-CN fetched on demand.
//      Each MUST cover every UI key; they may carry extra product-catalogue
//      keys (product.copy.* / product.label.*) which the UI dictionary does
//      not have, so equality is not required - only coverage.
//
// Parsing is static (scripts/lib/i18n-dict.mjs); i18n.js is never executed.
//
// Usage:
//   node --test test/i18n-completeness.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import './helpers/env.mjs';
import { parseDict } from '../scripts/lib/i18n-dict.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const i18nFile = path.join(root, 'public', 'i18n.js');
const localesDir = path.join(root, 'public', 'locales');

const EXTRA_LOCALES = ['de', 'es', 'fr', 'ja', 'zh-CN'];

const dictSource = readFileSync(i18nFile, 'utf8');
const bundled = parseDict(dictSource);

const viKeys = bundled.get('vi');
const enKeys = bundled.get('en');

function missing(sourceKeys, targetSet) {
  return sourceKeys.filter((k) => !targetSet.has(k));
}

if (!viKeys) {
  test('vi dictionary is present in i18n.js', () => {
    assert.fail('parseDict did not find a vi section in public/i18n.js');
  });
} else {
  test('vi dictionary is non-empty', () => {
    assert.ok(viKeys.length > 0, 'vi dictionary has no keys');
  });

  test('en dictionary covers every vi key', () => {
    assert.ok(enKeys, 'en dictionary is missing from public/i18n.js');
    const missingKeys = missing(viKeys, new Set(enKeys));
    assert.deepEqual(missingKeys, [], `en missing keys: ${missingKeys.join(', ')}`);
  });

  test('vi dictionary covers every en key', () => {
    assert.ok(enKeys, 'en dictionary is missing from public/i18n.js');
    const missingKeys = missing(enKeys, new Set(viKeys));
    assert.deepEqual(missingKeys, [], `vi missing keys: ${missingKeys.join(', ')}`);
  });

  for (const lang of EXTRA_LOCALES) {
    const localeFile = path.join(localesDir, `${lang}.json`);
    let localeDict = null;
    try {
      localeDict = JSON.parse(readFileSync(localeFile, 'utf8'));
    } catch (err) {
      test(`${lang}.json parses`, () => {
        assert.fail(`${lang}.json cannot be parsed: ${err.message}`);
      });
      continue;
    }

    test(`${lang}.json is a plain object`, () => {
      assert.ok(localeDict && typeof localeDict === 'object' && !Array.isArray(localeDict),
        `${lang}.json must be a JSON object keyed by translation key`);
    });

    if (localeDict && typeof localeDict === 'object' && !Array.isArray(localeDict)) {
      const targetSet = new Set(Object.keys(localeDict));
      const missingKeys = missing(viKeys, targetSet);
      test(`${lang} covers all ${viKeys.length} UI keys`, () => {
        assert.deepEqual(missingKeys, [], `${lang} missing keys: ${missingKeys.join(', ')}`);
      });
    }
  }
}
