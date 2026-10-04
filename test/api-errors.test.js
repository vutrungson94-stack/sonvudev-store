import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first. See
// helpers/env.mjs for what a missing entry once cost.
import './helpers/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(root, name), 'utf8');

// The failure this file exists to prevent.
//
// Every API refusal is written twice: once in src/ as the `error`
// field refuse() sends — the sentence a curl user and a log line
// read — and once in public/i18n.js as the dictionary entry the
// browser translates from the `code`. Nothing connected the two
// copies. They had already drifted: the server interpolated the
// offending slug into "Đường dẫn /product/{slug} đã có sản phẩm
// khác dùng rồi." while the dictionary said "Đường dẫn này đã có
// sản phẩm khác dùng rồi.", so the owner reading curl saw a
// different sentence from the one the admin panel showed, and
// neither could tell which one was current.
//
// So the invariant is mechanical. A plain message must equal its
// dictionary entry byte for byte, and a message built from a
// template must match the entry with its interpolated parts
// wild-carded — the entry fills the same hole with its own
// {placeholder}, so the two can only disagree by drifting.

const refuseSites = async () => {
  const sources = [await read('src/app.js'), await read('src/reviews.js')];
  const sites = [];
  for (const source of sources) {
    for (const m of source.matchAll(/refuse\(\s*"([\w.]+)"\s*,\s*(`[^`]*`|"(?:[^"\\]|\\.)*")/g)) {
      sites.push({ key: m[1], message: m[2] });
    }
  }
  return sites;
};

const viDictionary = async () => {
  const source = await read('public/i18n.js');
  const start = source.indexOf('  vi: {');
  const end = source.indexOf('  en: {', start);
  assert.ok(start !== -1 && end > start, 'không tìm thấy khối từ điển vi trong public/i18n.js');
  const entries = {};
  for (const m of source.slice(start, end).matchAll(/'([\w.]+)':\s*'((?:[^'\\]|\\.)*)'/g)) {
    entries[m[1]] = m[2];
  }
  return entries;
};

const templatePattern = (template) => {
  const body = template.slice(1, -1).replace(/\$\{[^}]*\}/g, '(.+)');
  return new RegExp(`^${body}$`);
};

test('mỗi refusal của API có một câu tiếng Việt khớp với từ điển', async () => {
  const sites = await refuseSites();
  const dict = await viDictionary();
  assert.ok(sites.length > 40, `chỉ tìm thấy ${sites.length} refuse() — biểu thức tìm kiếm có lẽ đã lỗi thời`);
  for (const { key, message } of sites) {
    assert.ok(dict[key],
      `refuse("${key}") không có mục nào trong từ điển tiếng Việt — trình duyệt sẽ rơi về câu tiếng Việt của server thay vì dịch nó`);
    if (message.startsWith('"')) {
      const literal = JSON.parse(message);
      assert.equal(dict[key], literal,
        `refuse("${key}") gửi "${literal}" nhưng từ điển ghi "${dict[key]}" — hai bản sao của một câu đã lệch nhau`);
      continue;
    }
    assert.ok(templatePattern(message).test(dict[key]),
      `refuse("${key}") gửi ${message} nhưng từ điển ghi "${dict[key]}" — phần chữ phải khớp, chỉ phần nội suy mới được khác`);
  }
});
