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
  var escapeHtml = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // The language the page is actually being read in, read off the document
  // rather than assumed.
  //
  // Two copies of this file's mistake used to sit one apart: the empty message
  // had a Vietnamese and an English form and always printed the Vietnamese one,
  // so the English product page and every 404 greeted the reader in a language
  // they had not chosen. The prices had the same defect independently — they were
  // always grouped with a dot, which is right for a Vietnamese reader and wrong
  // for an English one.
  //
  // This file is loaded on pages that do not include i18n.js (the 404 has no
  // language switch at all), so it cannot read the shared dictionary. It reads the
  // <html lang> the server already put there, which is the same answer the
  // dictionary would give.
  var lang = (String((document.documentElement && document.documentElement.lang) || 'vi').toLowerCase().indexOf('en') === 0) ? 'en' : 'vi';
  var locale = lang === 'en' ? 'en-US' : 'vi-VN';

  var money = function (value, currency) {
    var amount = Number(value) || 0;
    var options = currency === 'USD'
      ? { style: 'currency', currency: 'USD' }
      : { maximumFractionDigits: 0 };
    try {
      return new Intl.NumberFormat(locale, options).format(amount);
    } catch (e) {
      return amount + ' ' + (currency || '');
    }
  };

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
