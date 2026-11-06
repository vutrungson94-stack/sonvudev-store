// Extract a bundled dictionary (vi/en) out of public/i18n.js by executing it
// in a sandboxed VM.
//
// public/i18n.js cannot be imported in Node - it reads window/document at load
// time and boots on DOMContentLoaded - and public/locales/vi.json / en.json
// are deliberately not committed as full copies, because two homes for one
// string is where the two drift. So the server, the audit and the sync test
// all need the single dictionary that ships to the browser; executing it with
// the browser API stubbed is how they all get the same one.
//
// Usage:
//   import { extractBundledDict } from "./lib/i18n-bundled.mjs";
//   const dict = extractBundledDict("en");
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const selfRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A browser element the dictionary's boot path can talk to without crashing. */
const stubElement = () => ({
  setAttribute() {},
  addEventListener() {},
  removeAttribute() {},
  appendChild() {},
  removeChild() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
  style: {},
  dataset: {},
  classList: { add() {}, remove() {}, toggle() {} },
  hidden: false,
});

/**
 * Execute public/i18n.js in a vm with a minimal stubbed browser.
 *
 * Two source substitutions make the dump deterministic and useful server-side:
 *   - the wall-clock year is replaced by the {{year}} token, so the computed
 *     strings still carry a placeholder the renderer fills at request time
 *     instead of baking the year the file was loaded in;
 *   - supportAddress() and the dump hook use placeholders the renderer already
 *     fills ({{support}}) and a window export for the dictionary itself.
 *
 * @param {"vi"|"en"} lang which bundled language to return
 * @returns {Record<string, unknown>} the dictionary exactly as the browser sees it
 */
export function extractBundledDict(lang) {
  const source = fs.readFileSync(path.join(selfRoot, "public", "i18n.js"), "utf8");
  const patched = source
    .replace("const YEAR = new Date().getFullYear();", 'const YEAR = "{{year}}";')
    .replace(
      "const supportAddress = () => document.body?.dataset?.support || '';",
      "const supportAddress = () => '{{support}}';",
    )
    .replace(
      "window.I18N = I18N;",
      `window.I18N = I18N; window.__DUMP = DICT[${JSON.stringify(lang)}];`,
    );
  if (!patched.includes("window.__DUMP =")) {
    throw new Error("could not hook the dictionary dump into public/i18n.js - the I18N export line moved");
  }

  const document = {
    readyState: "loading", // boot never runs: we only want the DICT constant
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return stubElement(); },
    createTextNode() { return {}; },
    addEventListener() {},
    removeEventListener() {},
    body: { dataset: {} },
    documentElement: { lang: "vi" },
  };
  const window = {
    location: { pathname: "/", search: "", hash: "", href: "/" },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    CustomEvent: function CustomEvent(type, options) { return { type, detail: options && options.detail }; },
    I18N: null,
  };
  const sandbox = {
    window,
    document,
    navigator: { language: "vi-VN" },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    location: window.location,
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    CustomEvent: window.CustomEvent,
    fetch: () => Promise.resolve({ ok: false, json: async () => ({}) }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(patched, { filename: "public/i18n.js" }).runInContext(sandbox, { timeout: 5000 });
  const dict = sandbox.window.__DUMP;
  if (!dict || typeof dict !== "object") {
    throw new Error(`failed to extract the ${lang} dictionary from public/i18n.js`);
  }
  // The vm realm's objects have their own Object.prototype, which trips
  // assert.deepStrictEqual and confuses consumers that do prototype checks.
  // Round through JSON to hand back an ordinary object of ordinary strings.
  return JSON.parse(JSON.stringify(dict));
}
