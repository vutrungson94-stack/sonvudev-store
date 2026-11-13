// Auto-detect the reader's language for the blog pages, which are the one
// place the main dictionary is not what answers first.
//
// Priority: stored preference (localStorage) > the URL the reader opened.
// Vietnamese readers stay on the unprefixed page; a reader who picked another
// language is moved to their own route, which the server renders (or, for
// product copy that only exists in vi/en, falls back to English with a notice).
//
// Browser language is deliberately NOT used as a redirect signal. It used to be,
// and the first request a crawler, Lighthouse or PageSpeed Insights makes — a
// fresh browser with an en-US locale — was answered with a redirect from /blog
// to /en/blog. That made the Vietnamese page impossible to audit, hid it from a
// tool that cannot see the difference, and contradicts hreflang's x-default.
// Google's own guidance is not to redirect on language detection; the visible
// switcher and the hreflang links are what that guidance asks for instead.
//
// Language-prefixed URLs are authoritative: a /de/ page is German, even if the
// stored preference says otherwise, so a prefixed URL is never rewritten by
// this script.
(function () {
  try {
    var STORAGE_KEY = 'sonvudev_lang';
    var SUPPORTED = ['vi', 'en', 'de', 'es', 'fr', 'ja', 'zh-CN'];
    var path = window.location.pathname;
    var stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (_) { /* private mode */ }

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
    // Only an explicit choice moves the reader; an empty storage never does.
    if (stored && stored !== 'vi' && SUPPORTED.indexOf(stored) >= 0) {
      window.location.href = '/' + stored + (path === '/' ? '/' : path) + window.location.search + window.location.hash;
    }
  } catch (_) { /* private mode: fall through */ }
})();
