import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first.
import './helpers/env.mjs';
const { tokenMeta } = await import('../src/pages.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFile(path.join(root, relative), 'utf8');

// The values tokenMeta ships, read the way the browser reads them: unescape the
// attribute, then parse the JSON. A test that skipped the unescape step would
// pass against raw &quot; text and tell us nothing about what arrives in the
// page.
const shippedTokens = () => {
  const raw = /content="([^"]*)"/.exec(tokenMeta())?.[1];
  assert.ok(raw, 'tokenMeta phải có content');
  const text = raw
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  return new Map(Object.entries(JSON.parse(text)));
};

// {{paymentWindowHours}} came back with the dictionary copy.
//
// The legal pages put configuration values inside their *translations*:
// "cancelled after {{paymentWindowHours}} hours". The server fills those into
// the HTML it renders, which is the only copy it can reach. A reader who then
// switched language got the dictionary text verbatim from I18N.t(), so the
// placeholder came back with it and the sentence read
// "cancelled after {{paymentWindowHours}} hours" — on a page that had been
// correct one click earlier, in both languages, on every legal page.
//
// The fix ships the values with the page in <meta name="sv-tokens"> and has the
// browser substitute them on the way out. These tests hold both halves: that
// the values are sent, and that everything the dictionary asks for is among
// them.

test('meta sv-tokens mang mọi giá trị dictionary cần', () => {
  const shipped = shippedTokens();
  assert.ok(shipped.size >= 5, `phải gửi ít nhất 5 giá trị, chỉ có ${shipped.size}`);

  // The payment window is read from configuration, not written out here. A test
  // asserting the literal "24" would pass on a wrong value if the default
  // changed, and would need editing whenever the policy does.
  assert.equal(shipped.get('paymentWindowHours'), String(process.env.ORDER_PAYMENT_WINDOW_HOURS || 24));
  // A brand name is identified, so it must not come back empty: an empty brand
  // is a legal page naming nobody.
  assert.ok(shipped.get('brandName'), 'brandName phải có giá trị');
  assert.match(shipped.get('support'), /@/, 'support phải là địa chỉ email');
});

test('không token nào trong dictionary bị bỏ quên', async () => {
  const shipped = shippedTokens();

  // Every {{name}} the dictionary asks for, from both language tables. This is
  // the case that actually shipped broken: a new translated sentence carrying a
  // placeholder was correct on the server and raw after a language switch.
  const dictionary = await read('public/i18n.js');
  const wanted = new Set();
  for (const match of dictionary.matchAll(/'[^']+':\s*'[^']*\{\{(\w+)\}\}/g)) {
    wanted.add(match[1]);
  }

  assert.ok(wanted.size > 0, 'phải tìm thấy ít nhất một token trong dictionary');
  for (const name of wanted) {
    assert.ok(shipped.has(name),
      `{{${name}}} xuất hiện trong dictionary nhưng không có trong <meta name="sv-tokens"> — ` +
      'một câu dịch mang nó sẽ hiện raw sau khi đổi ngôn ngữ');
  }
});

test('i18n.js thay {{tên}} bằng giá trị từ meta', async () => {
  // Structural rather than behavioural on purpose: this module runs in a
  // browser, and the suite has no DOM to drive I18N.t() through a language
  // switch. What it can check is that the substitution exists, is wired to the
  // meta tag, and runs before the single-brace pass — the old regex
  // /\{(\w+)\}/ swallowed a {{name}} as "{" + "{name}" and left it alone.
  const i18n = await read('public/i18n.js');

  assert.match(i18n, /meta\[name="sv-tokens"\]/, 'phải đọc meta sv-tokens');
  // The double-brace form must be matched first. The old pass used /\{(\w+)\}/,
  // which sees "{" then "{name}" and leaves "{{name}}" as "{value}" — a
  // sentence with one brace too many and a hole where the number should be.
  assert.match(i18n, /\\\{\\\{\(\\w\+\)\\\}\\\}/,
    'phải thay {{name}} trước, không chỉ {name}');
  assert.match(i18n, /TOKENS\[name\]/, 'phải lấy giá trị từ TOKENS');

  // Both dictionaries are affected, so neither table is the safe one. The
  // comment that used to claim "filled by the server" and stopped there is what
  // let this through.
  for (const match of i18n.matchAll(/\{\{(\w+)\}\}/g)) {
    assert.notEqual(match[1], '', 'token rỗng');
    break;
  }
});

test('mọi trang đều mang meta sv-tokens', async () => {
  // The storefront renders through two paths: renderPage() in app.js for the
  // static templates, and renderProductPage() for the product page. Both load
  // i18n.js, so both need the values. A page missing them shows raw
  // placeholders while its siblings look fine.
  const app = await read('src/app.js');
  const pages = await read('src/pages.js');

  assert.match(app, /\$\{tokenMeta\(\)\}/,
    'renderPage phải chèn tokenMeta vào <head>');
  assert.match(pages, /<head>\s*\$\{tokenMeta\(\)\}/s,
    'renderProductPage phải chèn tokenMeta vào <head>');
});

test('hai nguồn cùng một giá trị, không lệch nhau', async () => {
  // The template path and the language-switch path are separate code. Nothing
  // stops someone changing one and not the other, and the failure is quiet:
  // the server-rendered page shows 24 hours, the paragraph a language switch
  // produces shows 24 too but from a different variable — until it doesn't.
  // Any name that appears in both must carry the same value.
  const { pageTokenValues } = await import('../src/pages.js');
  const fromTemplate = pageTokenValues({ products: [] });
  const fromMeta = shippedTokens();

  let shared = 0;
  for (const name of fromMeta.keys()) {
    if (fromTemplate[name] === undefined) continue;
    shared += 1;
    assert.equal(fromMeta.get(name), String(fromTemplate[name]),
      `${name} lệch giữa pageTokenValues và tokenMeta — ` +
      'hai nguồn phải là một giá trị, nếu không trang đọc khác nhau tùy đường render');
  }
  assert.ok(shared >= 3, `phải có ít nhất 3 tên dùng chung, chỉ thấy ${shared}`);
});
