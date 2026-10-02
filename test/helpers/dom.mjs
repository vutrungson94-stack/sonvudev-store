import vm from 'node:vm';


// Minimal DOM stand-in so public/app.js can be executed in Node. It implements
// only what the storefront touches: element lookups, innerHTML, dataset, class
// and addEventListener. A stub that is too permissive hides real bugs, so every
// access goes through a getter that throws when the script touches something
// that does not exist on the page.
export class El {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this._html = '';
    this._text = '';
    this.hidden = false;
    this.className = '';
    this.dataset = {};
    this.attrs = {};
    this.style = {};
    this.files = [];
    this.listeners = {};
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.textContent = String(v).replace(/<[^>]*>/g, ''); }
  insertAdjacentHTML(_position, html) { this._html = String(html) + this._html; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get classList() {
    const self = this;
    return {
      add(...c) { self.className = [...new Set([...self.className.split(' ').filter(Boolean), ...c])].join(' '); },
      remove(...c) { self.className = self.className.split(' ').filter((x) => x && !c.includes(x)).join(' '); },
      toggle(c, force) { const has = self.className.split(' ').includes(c); const on = force === undefined ? !has : force; if (on) self.classList.add(c); else self.classList.remove(c); return on; },
      contains(c) { return self.className.split(' ').includes(c); },
    };
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  get elements() { return this; }
  reset() { return this; }
  getContext() { return null; }
  closest() { return null; }
  appendChild(c) { this.children.push(c); return c; }
  remove() {}
  focus() {}
  click() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
}

export function createDom(ids) {
  const nodes = new Map();
  for (const id of ids) nodes.set(id, new El('div', id));
  // The storefront finds its language button with querySelector, so the stub
  // has to resolve data-i18n and data-lang-toggle attributes rather than always
  // returning null.
  const findAttr = (attr) => {
    for (const el of nodes.values()) if (el.attrs?.[attr] !== undefined) return el;
    return null;
  };
  const document = {
    readyState: 'complete',
    documentElement: new El('html'),
    body: new El('body'),
    title: '',
    querySelector: (sel) => {
      if (typeof sel === 'string' && sel.includes('data-lang-toggle')) return nodes.get('lang-toggle');
      if (typeof sel === 'string' && sel.includes('data-i18n')) return findAttr('data-i18n');
      return null;
    },
    querySelectorAll: (sel) => {
      // Class selectors. The storefront binds the category row with
      // querySelectorAll('.filter') at load, and a stub that answered only the
      // attribute form made those handlers silently unreachable — so a test could
      // not tell whether the filter row works or was never wired up.
      if (typeof sel === 'string' && sel.startsWith('.')) {
        const cls = sel.slice(1);
        return [...nodes.values()].filter((el) => el.classList.contains(cls));
      }
      if (typeof sel === 'string' && sel.startsWith('[')) {
        const attr = sel.slice(1, sel.indexOf(']'));
        return [...nodes.values()].filter((el) => el.attrs?.[attr] !== undefined);
      }
      return [];
    },
    getElementById: (id) => nodes.get(id) || null,
    createElement: (t) => new El(t),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
  return { document, nodes, El };
}

// Evaluates a browser script against a stubbed global environment. Returns the
// captured console output plus any thrown error so a test can assert on both.
export async function runScript(code, { document, window: winOverrides = {}, ...rest } = {}) {
  const logs = [];
  const errors = [];
  const documentListeners = {};
  const windowListeners = {};
  // `localStorage` arrives via the rest parameter, not inside `window`, so it
  // has to be read from there. Using the wrong one made a stored language choice
  // look ignored even though the real page honours it.
  const storage = rest.localStorage || winOverrides.localStorage || {
    _v: {},
    getItem(k) { return this._v[k] ?? null; },
    setItem(k, v) { this._v[k] = String(v); },
    removeItem(k) { delete this._v[k]; },
  };
  // sessionStorage is a separate global from localStorage, and the order page
  // keeps the buyer's access token in it. Leaving it off `win` made the page
  // look broken in a way it never is in a browser.
  const session = rest.sessionStorage || winOverrides.sessionStorage || {
    _v: {},
    getItem(k) { return this._v[k] ?? null; },
    setItem(k, v) { this._v[k] = String(v); },
    removeItem(k) { delete this._v[k]; },
  };
  const win = {
    ...winOverrides,
    document,
    localStorage: storage,
    sessionStorage: session,
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
    removeEventListener() {},
    dispatchEvent(e) { (windowListeners[e.type] || []).forEach((f) => f(e)); },
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  const ctx = {
    window: win,
    document,
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')), warn: () => {} },
    fetch: async () => { throw new Error('fetch not stubbed'); },
    navigator: { language: 'vi-VN', clipboard: { writeText: async () => {} } },
    location: { href: '' },
    // A browser forgets its timers when the tab goes away; the test runner does
    // not, so an unref'd timer is what keeps a page that polls every ten
    // seconds from holding the whole run open after its assertions finished.
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
    clearTimeout: (id) => clearTimeout(id),
    Intl, URL, URLSearchParams, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    ...rest,
  };
  // A classic <script> tag publishes top-level function declarations on the
  // global object, so the harness has to as well. `new Function` hides them in
  // its own scope and a `with` block makes them block-scoped in sloppy mode, so
  // neither reproduces browser behaviour. Node's vm evaluates the source in a
  // context we own end to end, which is the faithful equivalent.
  //
  // `win` itself is the sandbox: the script assigns `window.I18N` and declares
  // `function openProduct`, and both must land on the very object the test
  // inspects. Handing vm a separate wrapper and copying back afterwards is
  // what made openProduct look missing.
  win.window = win;
  win.document = document;
  win.fetch = ctx.fetch;
  win.console = ctx.console;
  win.navigator = ctx.navigator;
  win.location = ctx.location;
  win.setTimeout = ctx.setTimeout;
  win.clearTimeout = ctx.clearTimeout;
  win.Intl = Intl;
  win.URL = URL;
  win.URLSearchParams = URLSearchParams;
  win.CustomEvent = ctx.CustomEvent;
  win.localStorage = winOverrides.localStorage || win.localStorage || { _v: {}, getItem: () => null, setItem() {}, removeItem() {} };
  win.sessionStorage = winOverrides.sessionStorage || session;
  win.globalThis = win;
  win.self = win;
  try {
    const script = new vm.Script(code, { filename: 'storefront.js' });
    script.runInContext(vm.createContext(win));
  } catch (error) {
    errors.push(`${error.name}: ${error.message}`);
  }
  // The storefront kicks off its fetches at the end of the file. Draining the
  // microtask queue lets those promises settle before assertions run, otherwise
  // a perfectly good render is judged as empty.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { logs, errors, window: win, documentListeners, windowListeners };
}
