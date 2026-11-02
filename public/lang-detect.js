// Auto-detect browser language and redirect to the appropriate locale.
// Vietnamese browsers stay on the Vietnamese page.
// All other browsers are redirected to the English page.
// Stored preference in localStorage is always respected.
(function () {
  try {
    var STORAGE_KEY = 'sonvudev_lang';
    var stored = localStorage.getItem(STORAGE_KEY);
    var path = window.location.pathname;
    var isEn = path.indexOf('/en/') === 0;
    var browser = String(navigator.language || '').toLowerCase();
    var wantsEn = stored && stored !== 'vi' || (!stored && browser.indexOf('vi') !== 0);

    if (wantsEn && !isEn) {
      window.location.replace('/en' + path);
    } else if (!wantsEn && isEn) {
      window.location.replace(path.replace('/en', '') || '/');
    }
  } catch (_) { /* private mode: fall through */ }
})();
