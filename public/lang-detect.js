// Auto-detect the reader's language for the blog pages, which are the one
// place the main dictionary is not what answers first.
//
// Priority: stored preference (localStorage) > browser language > Vietnamese.
// Vietnamese readers stay on the unprefixed page; everyone else is moved to
// their own language route, which the server renders (or, for product copy that
// only exists in vi/en, falls back to English with a notice).
//
// Language-prefixed URLs are authoritative: a /de/ page is German, even if the
// stored preference says otherwise, so a prefixed URL is never rewritten by
// this script. The stored preference still wins when the visitor navigates to a
// URL with a *different* prefix than their choice - the choice is honored on
// the next page load, gently, instead of fighting them on the page they are
// reading right now.
(function () {
  try {
    var STORAGE_KEY = 'sonvudev_lang';
    var SUPPORTED = ['vi', 'en', 'de', 'es', 'fr', 'ja', 'zh-CN'];
    var path = window.location.pathname;
    var stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (_) { /* private mode */ }

    var browser = String(navigator.language || '').toLowerCase();
    var detected = 'en';
    if (browser.indexOf('ja') === 0) detected = 'ja';
    else if (browser.indexOf('zh') === 0) detected = 'zh-CN';
    else if (browser.indexOf('vi') === 0) detected = 'vi';
    else if (browser.indexOf('de') === 0) detected = 'de';
    else if (browser.indexOf('es') === 0) detected = 'es';
    else if (browser.indexOf('fr') === 0) detected = 'fr';
    var wanted = (stored && SUPPORTED.indexOf(stored) >= 0) ? stored : detected;

    var m = path.match(/^\/([a-z]{2}(-[A-Z]{2})?)(\/|$)/);
    var urlLocale = m && SUPPORTED.indexOf(m[1]) >= 0 ? m[1] : null;

    if (urlLocale) {
      // The URL answers for the page the reader is looking at. Adopt it when it
      // disagrees with storage, so the dictionary and storage stay consistent.
      if (stored && stored !== urlLocale) {
        try { localStorage.setItem(STORAGE_KEY, urlLocale); } catch (_) { /* private mode */ }
      }
      return;
    }
    if (wanted && wanted !== 'vi') {
      window.location.href = '/' + wanted + (path === '/' ? '/' : path) + window.location.search + window.location.hash;
    }
  } catch (_) { /* private mode: fall through */ }
})();
