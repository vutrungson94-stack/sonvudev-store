// Fills in the "other products" strip at the foot of a product page, or the
// product list on the 404 page.
//
// This used to be an inline <script> inside the template that produced the page.
// The server sends `script-src 'self'` with no 'unsafe-inline' and no nonce, so
// every browser refused to run it and both sections sat on their loading text for
// good. Keeping it here is what makes the strict policy possible at all.
//
// One loader for both pages. The escaping below is the second reason: both copies
// concatenated product names straight into innerHTML, which is only safe while the
// person filling the catalogue is also the person who can approve an account.
(function () {
  var script = document.currentScript;
  if (!script) return;
  var box = document.getElementById(script.getAttribute('data-target') || 'related');
  if (!box) return;
  var selfId = script.getAttribute('data-self') || '';

  var text = function (value, fallback) {
    var raw = String(value == null ? '' : value).trim();
    return raw || fallback;
  };

  // The language the page is actually being read in, read off the document
  // rather than assumed.
  //
  // Two copies of this file's mistake used to sit one apart: the empty message
  // had a Vietnamese and an English form and always printed the Vietnamese one,
  // so the English product page and every 404 greeted the reader in a language
  // they had not chosen.
  //
  // Prices are not grouped by this language at all: money follows the
  // currency, the rule public/format.js and the server both apply, so a VND
  // price keeps its dot grouping on an English page exactly as it does on the
  // receipt. This file is loaded on pages that do not include i18n.js (the
  // 404 has no language switch at all), so it cannot read the shared
  // dictionary. It reads the <html lang> the server already put there, which
  // is the same answer the dictionary would give. Escaping and money come from
  // public/format.js, loaded just before this file: this loader used to carry
  // its own copies of both, and the money one disagreed with the dictionary
  // about grouping.
  var lang = (String((document.documentElement && document.documentElement.lang) || 'vi').toLowerCase().indexOf('en') === 0) ? 'en' : 'vi';

  var escapeHtml = function (value) { return window.SVDFormat.esc(value); };

  var money = function (value, currency) { return window.SVDFormat.money(value, currency); };

  var empty = {
    vi: 'Đây là sản phẩm duy nhất hiện tại.',
    en: 'This is the only product right now.',
  };

  fetch('/api/products')
    .then(function (response) { return response.json(); })
    .then(function (data) {
      var others = (data.products || []).filter(function (p) { return p.id !== selfId; });
      if (!others.length) {
        box.innerHTML = '<p class="related-empty">' + escapeHtml(empty[lang]) + '</p>';
        return;
      }
      box.innerHTML = others.slice(0, 6).map(function (p) {
        var href = '/product/' + encodeURIComponent(p.slug || '');
        var version = text(p.version, '1.0');
        return '<a class="related-card" href="' + escapeHtml(href) + '">' +
          '<b>' + escapeHtml(text(p.name, '')) + '</b>' +
          '<span>v' + escapeHtml(version) + ' · ' + escapeHtml(text(p.platform, 'Windows')) + '</span>' +
          '<span>' + escapeHtml(money(p.price, p.currency)) + '</span>' +
          '</a>';
      }).join('');
    })
    .catch(function () { box.textContent = ''; });
})();
