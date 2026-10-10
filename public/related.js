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
  // Prices are chosen by the language the page is being read in, but the
  // currency a number is *written* in never follows the language: money() keeps
  // each currency in its own locale, so a VND price keeps its dot grouping on an
  // English page exactly as it does on the receipt. What changed is which number
  // an English page quotes — it now shows the USD figure PayPal actually charges
  // (see priceFor below), because a shelf price divided by the raw rate is a sum
  // no buyer is charged.
  //
  // The dictionary is used when the page has it. It used to be reasoned that this
  // file could not: the comment here claimed the 404 has no language switch and no
  // i18n.js, and both were false — public/404.html has loaded the dictionary and
  // shown a working toggle for some time. So this file carried a private
  // two-language table for one sentence and re-derived the current language by
  // sniffing <html lang>, which is a second answer to a question
  // window.I18N.lang already answers, and one that cannot see a locale added
  // later. Where the dictionary is present it is now asked; the fallback stays for
  // a page that genuinely has not got it, so the loader still cannot fail.
  //
  // Escaping and money come from public/format.js, loaded just before this file:
  // this loader used to carry its own copies of both, and the money one disagreed
  // with the dictionary about grouping.
  var dictionary = window.I18N || null;
  var lang = dictionary && dictionary.lang
    ? String(dictionary.lang).toLowerCase().indexOf('en') === 0 ? 'en' : 'vi'
    : (String((document.documentElement && document.documentElement.lang) || 'vi').toLowerCase().indexOf('en') === 0 ? 'en' : 'vi');

  var escapeHtml = function (value) { return window.SVDFormat.esc(value); };

  var money = function (value, currency) { return window.SVDFormat.money(value, currency); };

  // The price follows the language the reader chose, and only when the server
  // also sent the USD figure it actually charges. priceUsd is resolved through
  // the same conversion checkout uses, so an English page quotes the number
  // PayPal takes instead of the shelf price divided by the raw rate — a sum
  // nobody pays. Without priceUsd the shelf price is shown: wrong for the
  // language, but never a number the buyer is not charged.
  //
  // money() still formats each currency in its own locale (en-US for USD,
  // vi-VN for VND), so a dong amount keeps its dot grouping on an English page
  // exactly as it does on the receipt.
  var priceFor = function (p) {
    if (lang === 'en' && p && p.priceUsd !== undefined && p.priceUsd !== null) {
      return money(p.priceUsd, 'USD');
    }
    return money(p && p.price, p && p.currency);
  };

  var EMPTY = 'products.onlyOne';
  var emptyText = function () {
    if (dictionary && dictionary.t) {
      // The shared sentence, resolved in the reader's language rather than chosen
      // from a table beside the page it appears on.
      var text = dictionary.t(EMPTY);
      // An unresolved key comes back with its braces; falling back then keeps the
      // sentence readable rather than printing the key name at a visitor.
      return /\{[\w]+\}/.test(text) ? emptyFallback() : text;
    }
    return emptyFallback();
  };
  var emptyFallback = function () {
    return lang === 'en' ? 'This is the only product right now.' : 'Đây là sản phẩm duy nhất hiện tại.';
  };

  fetch('/api/products')
    .then(function (response) { return response.json(); })
    .then(function (data) {
      var others = (data.products || []).filter(function (p) { return p.id !== selfId; });
      if (!others.length) {
        box.innerHTML = '<p class="related-empty">' + escapeHtml(emptyText()) + '</p>';
        return;
      }
      box.innerHTML = others.slice(0, 6).map(function (p) {
        var href = '/product/' + encodeURIComponent(p.slug || '');
        var version = text(p.version, '1.0');
        return '<a class="related-card" href="' + escapeHtml(href) + '">' +
          '<b>' + escapeHtml(text(p.name, '')) + '</b>' +
          '<span>v' + escapeHtml(version) + ' · ' + escapeHtml(text(p.platform, 'Windows')) + '</span>' +
          '<span>' + escapeHtml(priceFor(p)) + '</span>' +
          '</a>';
      }).join('');
    })
    .catch(function () { box.textContent = ''; });
})();
