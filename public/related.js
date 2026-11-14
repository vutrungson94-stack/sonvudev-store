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
  // The server renders these cards itself.
  //
  // On the product page the "Sản phẩm khác" strip is already in the HTML the
  // server sent, and this loader used to fetch the whole catalogue again — 14 KB
  // and 549 ms — to replace that list with the same one. It was the longest
  // chain in the network tree of every product page: HTML -> related.js ->
  // /api/products.
  //
  // So the loader only does its job where the server had nothing to show: the
  // 404 page, whose product list is a loading line waiting to be replaced.
  // The test is "are there already links in here", not "is the box empty" —
  // the 404 page's box holds a <p> while it waits, and that is not a product
  // list.
  if (box.querySelector('a')) return;
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
  // The language this page is being read in. The server declares it on the
  // request (data-lang) when the loader is included; otherwise the dictionary
  // (or <html lang>) answers. Coercing everything non-en to vi — as this file
  // used to do — made de/es/fr/ja/zh-CN readers read Vietnamese cards under a
  // foreign heading, and quietly dropped the whole localisation branch below.
  var attrLang = script.getAttribute('data-lang') || '';
  var dictionary = window.I18N || null;
  var lang = attrLang || (dictionary && dictionary.lang ? String(dictionary.lang) : null) ||
    String((document.documentElement && document.documentElement.lang) || 'vi').toLowerCase();
  lang = String(lang).toLowerCase();
  var prefix = attrLang ? (script.getAttribute('data-prefix') || '') : (lang && lang !== 'vi' ? '/' + lang : '');

  var escapeHtml = function (value) { return window.SVDFormat.esc(value); };

  var money = function (value, currency) { return window.SVDFormat.money(value, currency); };

  // Mirrors public/app.js priceFor: non-vi readers see the USD figure PayPal
  // charges; without priceUsd the shelf number is shown (never an invented sum).
  var priceFor = function (p) {
    return lang !== 'vi' && p.priceUsd !== undefined && p.priceUsd !== null
      ? money(p.priceUsd, 'USD')
      : money(p.price, p.currency);
  };

  // ---------------------------------------------------------------------------
  // SHARED TRANSLATION MECHANISM
  //
  // This function is the single entry point for translating a product record
  // before it is rendered in the related-products strip or the 404 list.
  //
  // Rules (same as public/app.js and src/pages.js):
  //   - Vietnamese ('vi') is the catalogue source language: return as-is.
  //   - English ('en') prefers the dedicated English columns (nameEn,
  //     descriptionEn, featuresEn, etc.) and falls back to the Vietnamese
  //     source when a column is missing.
  //   - Japanese/Chinese and any other non-vi, non-en locale use the
  //     per-locale dictionary overlay (public/locales/<lang>.json) through
  //     dictionary.productCopy(p). The overlay only carries fields that were
  //     actually translated, so the fallback chain is: overlay -> English
  //     column -> Vietnamese source.
  //
  // Related-card links keep the reader inside their language: the server
  // declared the locale prefix on the <script> tag, so a `/fr/` page links
  // to `/fr/product/<slug>` rather than dropping the reader back to the
  // Vietnamese root.

  var localizeProduct = function (p) {
    if (!p || lang === 'vi') return p;

    // English page: use the dedicated English columns when they exist.
    // A product that has never been translated keeps its Vietnamese copy,
    // so no card is ever blank.
    if (lang === 'en') {
      var en = { ...p };
      if (p.nameEn || p.name_en) en.name = p.nameEn || p.name_en;
      if (p.shortDescriptionEn || p.short_description_en) en.shortDescription = p.shortDescriptionEn || p.short_description_en;
      if (p.descriptionEn || p.description_en) en.description = p.descriptionEn || p.description_en;
      if (p.requirementsEn || p.requirements_en) en.requirements = p.requirementsEn || p.requirements_en;
      if (Array.isArray(p.featuresEn) || Array.isArray(p.features_en)) en.features = p.featuresEn || p.features_en;
      return en;
    }

    // Non-English, non-Vietnamese locale (Japanese, Chinese, etc.):
    // the per-locale dictionary overlay carries the translated name, then the
  // English column, then the Vietnamese source. The overlay is the only place
  // per-locale product copy lives for languages the catalogue schema does not
  // have. A page that never loaded the dictionary (the product page) keeps
  // whatever the server rendered in the card below, and this stays a no-op.
  var overlay = dictionary && dictionary.productCopy ? dictionary.productCopy(p) : null;
  if (overlay) {
    var merged = { ...p };
    for (var field of ['name', 'shortDescription', 'description', 'requirements']) {
      if (overlay[field] !== undefined) merged[field] = overlay[field];
    }
    if (Array.isArray(overlay.features)) merged.features = overlay.features;
    return merged;
  }

  var enCol = p.nameEn || p.name_en;
  return enCol && enCol !== p.name ? { ...p, name: enCol } : p;
};

  var EMPTY = 'products.noRelated';
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
    return lang === 'en' ? 'No related products yet.' : 'Chưa có sản phẩm liên quan.';
  };

  // Maps a product through localizeProduct and picks the right field for the
  // card text. The card only shows name, platform, version and price, so we
  // do not touch description or features here — those belong to the modal.
  var cardName = function (p) { return escapeHtml(text(localizeProduct(p).name, '')); };
  var cardPlatform = function (p) { return escapeHtml(text(localizeProduct(p).platform, 'Windows')); };
  var cardVersion = function (p) { return escapeHtml(text(p.version, '1.0')); };

  fetch('/api/products')
    .then(function (response) { return response.json(); })
    .then(function (data) {
      var others = (data.products || []).filter(function (p) { return p.id !== selfId; });
      if (!others.length) {
        box.innerHTML = '<p class="related-empty">' + escapeHtml(emptyText()) + '</p>';
        return;
      }
      box.innerHTML = others.slice(0, 6).map(function (p) {
        var href = prefix + '/product/' + encodeURIComponent(p.slug || '');
        var version = cardVersion(p);
        return '<a class="related-card" href="' + escapeHtml(href) + '">' +
          '<b>' + cardName(p) + '</b>' +
          '<span>v' + version + ' · ' + cardPlatform(p) + '</span>' +
          '<span>' + escapeHtml(priceFor(p)) + '</span>' +
          '</a>';
      }).join('');
    })
    .catch(function () { box.textContent = ''; });
})();
