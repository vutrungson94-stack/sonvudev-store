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
  var money = function (value, currency) {
    var amount = Number(value) || 0;
    try {
      return new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'vi-VN', currency === 'USD' ? { style: 'currency', currency: 'USD' } : { maximumFractionDigits: 0 }).format(amount);
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
        box.innerHTML = '<p class="related-empty">' + escapeHtml(empty.vi) + '</p>';
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
