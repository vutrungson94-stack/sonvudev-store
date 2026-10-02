import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The dictionary as a reader sees it, in one named language.
//
// i18n.js keeps DICT private and publishes only t()/set(), which is the point of
// it: one place decides what a key says, so tests go through the same door the
// page does rather than reaching into a file for a string. It also means a test
// that asserts on copy is asserting on exactly the bytes that get printed.
//
// The point of the helper at all is the second language. A server module that
// hands the browser a key has to name keys that exist in both, and the only way
// to know that is to ask the dictionary. That is how the payment form ended up
// labelling its rails in Vietnamese for an English buyer: the keys were fine, the
// sentence behind them was in one language, and nothing looked in the other.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(root, 'public', 'i18n.js'), 'utf8');

const storage = () => ({
  _v: {},
  getItem(k) { return this._v[k] ?? null; },
  setItem(k, v) { this._v[k] = String(v); },
  removeItem(k) { delete this._v[k]; },
});

/** @returns {{ t: (key: string, fallback?: string, vars?: object) => string }} */
export function dictionary(lang) {
  const local = storage();
  const document = {
    readyState: 'loading',
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { lang },
    body: { dataset: {} },
    dispatchEvent() {},
  };
  const win = {
    document,
    localStorage: local,
    sessionStorage: storage(),
    navigator: { language: lang },
    location: { href: '' },
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 0,
    clearTimeout() {},
    Intl,
    URL,
    URLSearchParams,
    console,
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  vm.runInNewContext(source, win, { filename: 'public/i18n.js' });
  win.I18N.set(lang);
  return { t: (key, fallback, vars) => win.I18N.t(key, fallback, vars) };
}
