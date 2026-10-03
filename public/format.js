// The one escape and money implementation every browser page shares.
//
// admin.js, related.js and i18n.js each carried their own copy, and two of them
// had already drifted: admin formatted VND without a currency argument and
// related.js grouped prices for the wrong locale on English pages. One order
// read differently depending on which screen showed it.
//
// A plain classic script rather than a module, because these pages run under
// script-src 'self' with no bundler: every page loads this file first, then
// calls window.SVDFormat. It declares no top-level let or const of its own, so
// the audit's shared-global check keeps passing no matter which pages combine
// it with other scripts.
(function () {
  var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (c) { return ESCAPES[c]; });
  }
  function money(value, currency, locale) {
    var amount = Number(value) || 0;
    var tag = locale || 'vi-VN';
    // USD is styled on its own rail; anything else is grouped whole, the same
    // rule the server applies so the receipt and the ledger always agree.
    var options = currency === 'USD'
      ? { style: 'currency', currency: 'USD' }
      : { maximumFractionDigits: 0 };
    try {
      return new Intl.NumberFormat(tag, options).format(amount);
    } catch (e) {
      return amount + ' ' + (currency || '');
    }
  }
  window.SVDFormat = { esc: esc, money: money };
})();
