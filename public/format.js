// The one escape, money, initials and size implementation every browser page
// shares.
//
// admin.js, related.js and i18n.js each carried their own copy, and two of them
// had already drifted: admin formatted VND without a currency argument and
// related.js grouped prices for the wrong locale on English pages. One order
// read differently depending on which screen showed it. app.js and admin.js
// also had a private copy of the product initials and the byte formatter, and
// the admin copy of the byte formatter had already lost a decimal place the
// server's keeps. Both now live here beside the two that were always shared.
//
// One plain classic script rather than a module, because these pages run under
// script-src 'self' with no bundler: every page loads this file first, then
// calls window.SVDFormat. It declares no top-level let or const of its own, so
// the audit's shared-global check keeps passing no matter which pages combine
// it with other scripts.
//
// money applies the same rule as src/format.js on the server: the locale
// follows the currency, never the page language. The two files cannot share
// code — one runs in Node, the other in the browser — so they are held in
// step by scripts/metrics.mjs, which counts real implementations, and by the
// tests that format the same amount on both sides and compare the bytes.
(function () {
  var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (c) { return ESCAPES[c]; });
  }
  function money(value, currency) {
    var amount = Number(value) || 0;
    // USD is styled on its own rail; anything else is grouped whole, the same
    // rule the server applies so a price on the page, in the cart and on the
    // receipt is the same number written the same way.
    var tag = currency === 'USD' ? 'en-US' : 'vi-VN';
    var options = currency === 'USD'
      ? { style: 'currency', currency: 'USD' }
      : { style: 'currency', currency: currency, maximumFractionDigits: 0 };
    try {
      return new Intl.NumberFormat(tag, options).format(amount);
    } catch (e) {
      return amount + ' ' + (currency || '');
    }
  }
  function initials(name) {
    return String(name || 'SV').split(/\s+/).map(function (p) { return p[0]; }).join('').slice(0, 2).toUpperCase();
  }
  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value <= 0) return '';
    var units = ['B', 'KB', 'MB', 'GB'];
    var size = value;
    var unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
    return (size >= 100 || unit === 0 ? size.toFixed(0) : size.toFixed(1)) + ' ' + units[unit];
  }
  window.SVDFormat = { esc: esc, money: money, initials: initials, formatBytes: formatBytes };
})();
