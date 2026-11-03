// Auto-detect browser language and redirect to the appropriate locale.
// Vietnamese browsers stay on the Vietnamese page.
// All other browsers are redirected to the English page.
// Stored preference in localStorage is always respected.
//
// Language-prefixed paths (/de/, /es/, /fr/, /ja/, /zh-CN/) are preserved
// so the blog's language switcher is not overridden on page load.
(function () {
  try {
    var STORAGE_KEY = 'sonvudev_lang';
    var stored = localStorage.getItem(STORAGE_KEY);
    var path = window.location.pathname;
    var browser = String(navigator.language || '').toLowerCase();
    var wantsEn = stored && stored !== 'vi' || (!stored && browser.indexOf('vi') !== 0);
    var hasLangPrefix = path.indexOf('/en/') === 0 ||
                        path.indexOf('/de/') === 0 ||
                        path.indexOf('/es/') === 0 ||
                        path.indexOf('/fr/') === 0 ||
                        path.indexOf('/ja/') === 0 ||
                        path.indexOf('/zh-CN/') === 0;

    if (wantsEn && !hasLangPrefix) {
      window.location.replace('/en' + path);
    } else if (!wantsEn && path.indexOf('/en/') === 0) {
      window.location.replace(path.replace('/en', '') || '/');
    }
  } catch (_) { /* private mode: fall through */ }
})();
