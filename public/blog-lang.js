// Blog language switcher: remember the user's choice so lang-detect.js
// on the next page load does not override it.
(function () {
  try {
    document.querySelectorAll('.blog-lang a[href]').forEach(function (link) {
      link.addEventListener('click', function () {
        var code = this.getAttribute('data-blog-lang');
        if (code) localStorage.setItem('sonvudev_lang', code);
      });
    });
  } catch (_) {
    // ignore
  }
})();
