// Loads the two largest storefront scripts after window.load so they do not
// block first paint or contribute to Total Blocking Time. i18n.js must load
// before app.js because app.js uses window.I18N.
(function () {
  function load(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
  }
  window.addEventListener('load', function () {
    load('/i18n.js').then(function () { return load('/app.js'); });
  });
})();