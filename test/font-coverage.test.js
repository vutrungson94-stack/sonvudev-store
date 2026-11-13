// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first.
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The two subsets the shop ships, and the only two a page may need.
//
// The stylesheet declares no latin-ext face on purpose: with one declared, the
// browser downloads it (14 KB and 19 KB) while it looks for a character it does
// not need, and it downloads it late, on the critical path.
//
// The price of that decision is that a character outside these two ranges
// renders in the system face. That is fine as long as nothing in the content
// is such a character — and this test is what makes it visible instead of
// silent.
const RANGES = {
  latin: '0000-00FF,0131,0152-0153,02BB-02BC,02C6,02DA,02DC,0304,0308,0329,2000-206F,20AC,2122,2191,2193,2212,2215,FEFF,FFFD',
  vietnamese: '0102-0103,0110-0111,0128-0129,0168-0169,01A0-01A1,01AF-01B0,0300-0301,0303-0304,0308-0309,0323,0329,1EA0-1EF9,20AB',
};

const parse = (list) => list.split(',').map((part) => {
  const values = part.split('-').map((value) => parseInt(value, 16));
  return values.length === 2 ? [values[0], values[1]] : [values[0], values[0]];
});

// flatMap, not map: parse returns a list of ranges, so map would leave one list
// per subset and the comparison below would compare against a list.
const COVERED = Object.values(RANGES).flatMap(parse);
const isCovered = (codePoint) => COVERED.some(([from, to]) => codePoint >= from && codePoint <= to);

// Characters that are not text: the icons the shop draws with CSS or with the
// characters a browser draws itself. They never render in the brand font.
const IGNORED = new Set([0x200b, 0x200c, 0x200d, 0xfeff, 0xfffd]);

// Scripts the shop does not ship a webfont for.
//
// Japanese and Chinese are in the catalogue (the blog posts carry both), and
// they are rendered in the reader's system font — a CJK webfont would be
// megabytes, and every reader of those locales already has one. So a character
// outside Latin is not a problem here.
//
// What IS a problem is a Latin-script character the two subsets do not cover: a
// Turkish dotted capital I, a Latin Extended letter nobody here writes. That is
// the case this test exists to catch.
const NON_LATIN_FROM = 0x0370;

const findUncovered = (text) => {
  const found = new Map();
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 0x80) continue;
    if (IGNORED.has(codePoint)) continue;
    if (codePoint >= NON_LATIN_FROM) continue;
    if (isCovered(codePoint)) continue;
    found.set(character, `U+${codePoint.toString(16).toUpperCase()}`);
  }
  return [...found.entries()];
};

test('nội dung của shop chỉ dùng ký tự mà hai subset phủ hết', async () => {
  const sources = [];

  const catalogue = await fs.readFile(path.join(root, 'data', 'products.json'), 'utf8');
  sources.push(['data/products.json', catalogue]);

  const blogDir = path.join(root, 'src', 'blog-posts');
  for (const name of await fs.readdir(blogDir)) {
    sources.push([`src/blog-posts/${name}`, await fs.readFile(path.join(blogDir, name), 'utf8')]);
  }

  for (const name of await fs.readdir(path.join(root, 'public'))) {
    if (!name.endsWith('.html')) continue;
    sources.push([`public/${name}`, await fs.readFile(path.join(root, 'public', name), 'utf8')]);
  }

  const problems = [];
  for (const [name, text] of sources) {
    for (const [character, code] of findUncovered(text)) {
      problems.push(`${name}: "${character}" (${code})`);
    }
  }
  assert.deepEqual(problems, [],
    'ký tự này không có trong subset latin/vietnamese nên sẽ rơi về font hệ thống: '
    + problems.join('; '));
});
