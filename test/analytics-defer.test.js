// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first.
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// The analytics scripts must not ask a third party for anything while the page
// is still arriving.
//
// The network tab showed a red 499 for googletagmanager.com/gtag/js: the
// browser closed the request before the server answered it. 499 is the code
// for "the client went away" — the visitor had already clicked on to a product
// page, and the analytics request went down with them. Nothing on the
// storefront depends on that request (the shop's own measurements go to
// /api/quality through navigator.sendBeacon, which is unload-safe), so the
// fix is to stop asking for it during the load.
//
// Both scripts are checked the same way, because the Cloudflare beacon had the
// same shape: a third-party script in the <head> that competed with the first
// paint and was cancelled by whoever left the page early.
function runLoader(source, { readyState }) {
  const requested = [];
  const listeners = {};
  const document = {
    querySelector: (selector) => {
      if (selector === 'meta[name="ga-measurement-id"]') return { getAttribute: () => 'G-TEST12345' };
      if (selector === 'script[data-cf-beacon]') return null;
      return null;
    },
    createElement: () => {
      const element = { attributes: {} };
      Object.defineProperty(element, 'src', { set(value) { requested.push(value); } });
      Object.defineProperty(element, 'type', { set(value) { element.attributes.type = value; } });
      Object.defineProperty(element, 'async', { set(value) { element.attributes.async = value; } });
      element.setAttribute = (name, value) => { element.attributes[name] = value; };
      return element;
    },
    head: { appendChild: () => {} },
    // The beacon loader reads its token from the script tag that loaded it.
    currentScript: { getAttribute: (name) => (name === 'data-cf-token' ? 'test-token' : null) },
    readyState,
  };
  const window = {
    addEventListener: (type, handler) => { listeners[type] = handler; },
    location: { hostname: 'shop.example' },
    navigator: {},
  };
  window.window = window;
  vm.runInNewContext(source, { document, window, Date, JSON, String, Number, Boolean, Math, encodeURIComponent });
  return { requested, listeners };
}

test('public/ga.js chỉ hỏi gtag sau khi trang đã load', async () => {
  const source = await readFile(new URL('../public/ga.js', import.meta.url), 'utf8');

  const loading = runLoader(source, { readyState: 'loading' });
  assert.equal(loading.requested.length, 0,
    'không được gọi googletagmanager trước khi trang load xong');
  assert.equal(typeof loading.listeners.load, 'function',
    'phải chờ sự kiện load');

  loading.listeners.load();
  assert.equal(loading.requested.length, 1, 'sau load thì phải gọi gtag đúng một lần');
  assert.match(loading.requested[0], /googletagmanager\.com\/gtag\/js/);
});

test('trang không nạp script analytics của bên thứ ba nào', async () => {
  // Cloudflare Web Analytics is gone.
  //
  // Its beacon was 10 KB of third-party JavaScript carrying its own polyfills
  // for Array.prototype.at/findLast/includes — which is exactly what Lighthouse
  // lists under "Legacy JavaScript" — and it was cached for a single day, which
  // is the "Use efficient cache lifetimes" finding. It was the last third-party
  // script on the page.
  //
  // The shop measures itself instead: public/quality.js posts the URL and the
  // Core Web Vitals to /api/quality on this origin, with sendBeacon, so no
  // proxy, tracker blocker or corporate network can stop it.
  const pages = await readFile(new URL('../src/pages.js', import.meta.url), 'utf8');
  assert.ok(!/cloudflareinsights\.com/.test(pages),
    'không được nạp beacon của Cloudflare — nó là 10 KB legacy JS cache 1 ngày');
  assert.ok(!/cf-beacon\.js/.test(pages),
    'không được tham chiếu public/cf-beacon.js');

  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.ok(!/static\.cloudflareinsights\.com/.test(app),
    'CSP không được mở cho static.cloudflareinsights.com khi không có script nào dùng nó');
  assert.ok(!/cloudflareinsights\.com/.test(app),
    'CSP không được mở cho cloudflareinsights.com khi không có script nào dùng nó');
});
