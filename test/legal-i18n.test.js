import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDom, runScript } from './helpers/dom.mjs';

// This file reads public/i18n.js as text and never imports src/, so on its own it
// needs no shop configuration. It still loads the shared environment, because the rule
// is not "this file happens to need it today": a test that starts needing src/config.js
// later and reaches for the helper then is the good case, and one that skipped it
// because it did not need it yet would fail the suite on the day it did.
import './helpers/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = (name) => readFile(path.join(root, 'public', name), 'utf8');

// about, terms, privacy and refund are the pages a buyer reads before paying, and they
// were the only ones a buyer could not read in the language they had chosen. Each
// carried no dictionary at all: no script tag, no toggle, and every sentence as literal
// Vietnamese. An English buyer who mistyped /terms was told, in Vietnamese, what they
// had agreed to.
//
// The checks below are about the wiring, not the prose: the dictionary is loaded, the
// toggle exists, and — the part that matters — pressing the toggle changes the
// sentences. A page that loads i18n.js and has no data-i18n anywhere passes every other
// check in the repository and is still Vietnamese-only.
const LEGAL_PAGES = ['about.html', 'terms.html', 'privacy.html', 'refund.html'];

// Drives the real dictionary over the keys a page declares.
//
// One stub element per key, wired into the document's querySelectorAll the way a browser
// would, so this exercises i18n.js's own apply() rather than a reimplementation of it.
// Each element starts holding the Vietnamese text that is actually on the page — which is
// the fallback for a reader whose browser says nothing, and therefore the sentence that
// has to survive being wrong about.
//
// The stored language is part of the test, not decoration: these pages have no switch of
// their own, so the only reason an English reader sees English here is that the choice
// made on the homepage is sitting in localStorage. A page that ignored it would render
// Vietnamese while every other check in the repository passed.
const render = async (name, stored = null) => {
  const html = await page(name);
  const keys = [...html.matchAll(/data-i18n="([\w.]+)"/g)].map((m) => m[1]);
  const { document, nodes } = createDom([]);

  const vi = await readFile(path.join(root, 'public', 'i18n.js'), 'utf8');
  const viTable = tableOf(vi, 'vi');
  const enTable = tableOf(vi, 'en');

  const elements = keys.map((key) => {
    const node = document.createElement('div');
    node.setAttribute('data-i18n', key);
    // Both, because the page does too: apply() walks the nodes with
    // querySelectorAll('[data-i18n]') and then reads the key back off el.dataset. The
    // stub El keeps attributes and dataset in separate objects, so setting only one
    // makes apply() look up the key as undefined and fall back to the text already on
    // the element — which is to say, make every assertion below pass for the wrong
    // reason.
    node.dataset.i18n = key;
    node.textContent = viTable.get(key) ?? '';
    return node;
  });
  document.querySelectorAll = (selector) => (selector === '[data-i18n]' ? elements : []);

  const store = { v: {}, getItem: (k) => store.v[k] ?? null, setItem: (k, v) => { store.v[k] = String(v); } };
  if (stored) store.v.sonvudev_lang = stored;
  const i18n = await runScript(vi, { document, window: {}, localStorage: store });

  const atBoot = elements.map((el) => el.textContent.trim());
  i18n.window.I18N.set('vi');
  const before = elements.map((el) => el.textContent.trim());
  i18n.window.I18N.set('en');
  const after = elements.map((el) => el.textContent.trim());
  return { html, keys, before, after, atBoot, enTable, nodes };
};

// Reads one locale out of the dictionary as a Map, from the source rather than from a
// live I18N: the point is to know what the file says, independently of whether the
// loader found it.
function tableOf(source, lang) {
  const start = source.indexOf(`\n  ${lang}: {`);
  const body = source.slice(start + 1, source.indexOf('\n  },', start));
  const map = new Map();
  for (const m of body.matchAll(/^\s{4}'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gm)) {
    map.set(m[1], m[2].replace(/\\'/g, "'"));
  }
  return map;
}

for (const name of LEGAL_PAGES) {
  test(`${name} nói được cả hai ngôn ngữ`, async () => {
    const html = await page(name);

    assert.match(html, /src="(?:format\.js|"\/format\.js)"/,
      `${name} phải nạp format.js — i18n.js gọi window.SVDFormat.esc`);
    assert.match(html, /src="i18n\.js"/,
      `${name} phải nạp từ điển`);
    // No switch of its own: the language is chosen on the homepage and every page
    // reads it from localStorage before it paints. What matters here is that the page
    // still honours a stored choice, which is the behaviour below.
    assert.ok(!/data-lang-switch|data-lang-toggle/.test(html),
      `${name} không được có nút đổi ngôn ngữ riêng — chọn ở trang chủ, các trang này đọc lựa chọn đó`);

    const { keys, before, after } = await render(name);
    assert.ok(keys.length > 0, `${name} không có data-i18n nào — nạp từ điển mà không dùng thì vẫn chỉ tiếng Việt`);

    // Every keyed sentence must actually change. One that does not is a key pointing at
    // the Vietnamese text, which passes every other check in the repository.
    const stuck = after.filter((text, i) => text === before[i] && /[À-ỹ]/.test(text));
    assert.deepEqual(stuck, [],
      `${name}: ${stuck.length} câu vẫn ra tiếng Việt sau khi bấm nút — ví dụ: ${stuck.slice(0, 2).join(' / ')}`);

    // And no sentence may come back as a bare key name, which is what a typo produces.
    const unresolved = after.filter((text) => /^[a-z]+\.[a-zA-Z0-9]+$/.test(text));
    assert.deepEqual(unresolved, [],
      `${name}: có câu ra đúng tên khoá, tức khoá không tồn tại: ${unresolved.join(', ')}`);

    // A reader who chose English on the homepage lands here with no switch to find, so
    // the stored choice has to be read before the first paint. If it is not, this page
    // greets them in the language they switched away from — with nothing on screen to
    // correct it.
    const { atBoot } = await render(name, 'en');
    const stillVietnamese = atBoot.filter((text) => /[À-ỹ]/.test(text));
    assert.deepEqual(stillVietnamese, [],
      `${name}: lựa chọn 'en' đã lưu vẫn ra tiếng Việt khi mở trang (${stillVietnamese.length}/${atBoot.length} câu) — trang này không có nút để sửa lại`);
  });
}

// The Vietnamese on disk is the fallback for a reader whose browser says nothing, so it is
// the sentence that has to stay correct. Read from the dictionary file directly: the
// render's own source of truth is that same file, and a test that only checks the render
// cannot tell a correct fallback from a wrong one that happens to be self-consistent.
// brand.rights uses a template literal (backticks) which the static parser can't read;
// it is handled at runtime by the I18N loader. Skip it in the static check.
const STATIC_SKIP_KEYS = new Set(['brand.rights']);

test('khoá tiếng Việt tồn tại ở cả hai ngôn ngữ, và tiếng Việt khớp trang', async () => {
  const source = await readFile(path.join(root, 'public', 'i18n.js'), 'utf8');
  const vi = tableOf(source, 'vi');
  const en = tableOf(source, 'en');

  for (const name of LEGAL_PAGES) {
    const html = await page(name);
    const keys = new Set([...html.matchAll(/data-i18n="([\w.]+)"/g)].map((m) => m[1]));
    for (const key of keys) {
      if (STATIC_SKIP_KEYS.has(key)) continue;
      assert.ok(vi.has(key), `${name}: khoá ${key} không có trong DICT.vi`);
      assert.ok(en.has(key), `${name}: khoá ${key} không có trong DICT.en — nút đổi ngôn ngữ sẽ chỉ hiện tiếng Việt`);
    }
  }
});

// A key that is never referenced by any page is dead weight, and the reverse — a
// sentence written as literal Vietnamese on a page that now claims to be translated —
// is the failure this whole file exists to prevent.
test('không có khoá pháp lý nào mồ côi, và không câu tiếng Việt nào bỏ sót ngoài từ điển', async () => {
  const source = await readFile(path.join(root, 'public', 'i18n.js'), 'utf8');
  const vi = tableOf(source, 'vi');
  const allHtml = (await Promise.all(LEGAL_PAGES.map(page))).join('\n');
  const used = new Set([...allHtml.matchAll(/data-i18n="([\w.]+)"/g)].map((m) => m[1]));

  const legalKeys = [...vi.keys()].filter((k) => /^(legal|about)\./.test(k));
  assert.ok(legalKeys.length > 50, `chỉ tìm thấy ${legalKeys.length} khoá pháp lý — có lẽ đọc sai bảng từ điển`);

  const orphaned = legalKeys.filter((k) => !used.has(k));
  assert.deepEqual(orphaned, [],
    `khoá pháp lý không trang nào dùng: ${orphaned.join(', ')} — hoặc là câu đó chưa được gắn data-i18n, hoặc khoá thừa`);

  // Paragraph text on these pages must be reachable by the switch. The attribute is
  // allowed to sit on the <p> or on a <span> inside it — which is the pattern
  // index.html already uses, and which the legal pages need because a clause like
  // §1 wraps "a personal, non-transferable licence" in <strong>: putting data-i18n on
  // the <p> would replace its textContent and throw the markup away.
  //
  // So what is checked is whether the paragraph's whole text can change, which is what
  // "contains a keyed element" means here — not whether one particular tag carries it.
  const paragraphs = [...allHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => ({ markup: m[0], inner: m[1] }))
    .filter(({ inner }) => /[a-zà-ỹ]{3,}/i.test(inner.replace(/<[^>]+>/g, '')));
  const unkeyed = paragraphs
    .filter(({ markup }) => !/data-i18n/.test(markup))
    .map(({ inner }) => inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    // Sentences the renderer fills server-side stay Vietnamese by design: a {{token}}
    // inside one is the reason there is no dictionary entry for it.
    .filter((text) => /[a-zà-ỹ]{3,}/i.test(text) && !text.includes('{{'));
  assert.deepEqual(unkeyed, [],
    `câu tiếng Việt còn nằm thẳng trong HTML, nút đổi ngôn ngữ không tới được:\n  ${unkeyed.join('\n  ')}`);
});