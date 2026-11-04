import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import './helpers/env.mjs';
import { extractViDictionary } from '../src/translate-service.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localized = ['de', 'es', 'fr', 'ja', 'zh-CN'];
const readJson = (name) => readFile(path.join(root, 'public', 'locales', `${name}.json`), 'utf8').then(JSON.parse);
const allEntries = (dict) => Object.entries(dict).flatMap(([key, value]) => {
  if (Array.isArray(value)) return value.map((item, index) => [`${key}[${index}]`, item]);
  return typeof value === 'string' ? [[key, value]] : [];
});

test('locale assets contain no unresolved JavaScript expressions', async () => {
  for (const name of localized) {
    const dict = await readJson(name);
    const leaked = allEntries(dict).filter(([, value]) => /\$\{[^}]+}|(?:YEAR|host|supportAddress)\(\)/.test(String(value)));
    assert.deepEqual(leaked, [], `${name}.json has raw generator expressions: ${leaked.map(([key]) => key).join(', ')}`);
  }
});

test('localized assets have exactly the same keys in every language', async () => {
  const keys = await Promise.all(localized.map(async (name) => Object.keys(await readJson(name)).sort()));
  const expected = keys[0];
  for (let i = 1; i < localized.length; i += 1) {
    assert.deepEqual(keys[i], expected, `${localized[i]}.json and ${localized[0]}.json differ`);
  }
});

test('translation source normalises dynamic expressions instead of leaking them', async () => {
  const source = await readFile(path.join(root, 'public', 'i18n.js'), 'utf8');
  const { dictionary, skippedDynamic } = extractViDictionary(source);
  assert.match(dictionary['brand.rights'], /\{\{year\}\}.*\{\{brandName\}\}/, 'brand.rights must keep translatable placeholders');
  assert.equal(dictionary['brand.supportEmail'], '{{support}}');
  assert.deepEqual(skippedDynamic, [], 'unknown dynamic dictionary values must be reported');
  for (const [key, value] of Object.entries(dictionary)) assert.doesNotMatch(value, /\$\{[^}]+}/, `${key} leaked a raw template expression`);
});

test('dynamic copyright and support placeholders stay translatable', async () => {
  for (const name of localized) {
    const dict = await readJson(name);
    assert.equal(dict['brand.rights']?.includes('{{year}}'), true, `${name}.json lost the year token`);
    assert.equal(dict['brand.rights']?.includes('{{brandName}}'), true, `${name}.json lost the brand token`);
    assert.equal(dict['brand.supportEmail'], '{{support}}', `${name}.json must keep the support token`);
  }
});
