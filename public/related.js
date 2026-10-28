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
  // Category and badge are free-text columns, so they cannot be looked up by
  // a fixed key. They are mapped from the Vietnamese value the catalogue stores
  // to the English equivalent, then passed to dictionary.productLabel() which
  // derives a key and returns the translated label for the current locale.
  // ---------------------------------------------------------------------------
  var CATEGORIES_VI_TO_EN = {
    'Công cụ': 'Tools',
    'Tiện ích': 'Utilities',
    'Phần mềm': 'Software',
    'Khác': 'Other',
    'Bundle': 'Bundle',
  };
  var BADGES_VI_TO_EN = {
    'Mới': 'New',
    'Bán chạy': 'Best seller',
    'Cập nhật': 'Updated',
    'Phát hành': 'Release',
    'Phổ biến': 'Popular',
    'Chuyên nghiệp': 'Professional',
    'Tiết kiệm': 'Value',
    'Doanh nghiệp': 'Enterprise',
    'Ưu đãi sớm': 'Early Bird',
  };

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
    // start from the dictionary overlay, then fall back to the English
    // columns, then to the Vietnamese source. The overlay is the only place
    // per-locale copy lives for languages the catalogue schema does not have.
    var overlay = (dictionary && dictionary.productCopy) ? dictionary.productCopy(p) : null;
    var overlayFeatures = overlay && Array.isArray(overlay.features) ? overlay.features : null;

    var localized = { ...p };
    if (overlay) {
      if (overlay.name) localized.name = overlay.name;
      if (overlay.shortDescription) localized.shortDescription = overlay.shortDescription;
      if (overlay.description) localized.description = overlay.description;
      if (overlay.requirements) localized.requirements = overlay.requirements;
      if (overlayFeatures) localized.features = overlayFeatures;
    }

    // Fall back to English columns if the overlay did not cover a field.
    var enCol = localized.nameEn || localized.name_en;
    if (!localized.name || localized.name === p.name) localized.name = enCol || localized.name;
    var enShort = localized.shortDescriptionEn || localized.short_description_en;
    if (!localized.shortDescription || localized.shortDescription === p.shortDescription) localized.shortDescription = enShort || localized.shortDescription;
    var enDesc = localized.descriptionEn || localized.description_en;
    if (!localized.description || localized.description === p.description) localized.description = enDesc || localized.description;
    var enReq = localized.requirementsEn || localized.requirements_en;
    if (!localized.requirements || localized.requirements === p.requirements) localized.requirements = enReq || localized.requirements;
    var enFeat = localized.featuresEn || localized.features_en;
    if (!localized.features || localized.features === p.features) localized.features = enFeat || localized.features;

    // Category and badge: map the Vietnamese catalogue value to English,
    // then ask the dictionary for the current locale's label.
    var rawCat = String(localized.category || '').trim();
    var catEn = CATEGORIES_VI_TO_EN[rawCat] || rawCat;
    localized.category = (dictionary && dictionary.productLabel) ? dictionary.productLabel('category', catEn) || catEn : catEn;

    var rawBadge = String(localized.badge || '').trim();
    if (rawBadge) {
      var badgeEn = BADGES_VI_TO_EN[rawBadge] || rawBadge;
      localized.badge = (dictionary && dictionary.productLabel) ? dictionary.productLabel('badge', badgeEn) || badgeEn : badgeEn;
    }

    return localized;
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
        var href = '/product/' + encodeURIComponent(p.slug || '');
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
