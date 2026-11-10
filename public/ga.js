// Optional Google Analytics 4 loader. Only active when the server renders
// <meta name="ga-measurement-id" content="G-..."> (env GA_MEASUREMENT_ID).
// Kept external so the site's CSP does not need unsafe-inline scripts.
//
// The tag is started after the page has loaded, not while it is loading.
//
// It used to be started while the page was still arriving, and the network tab
// showed a red 499 for https://www.googletagmanager.com/gtag/js: the browser
// closed the request before the server answered. 499 is the code servers use
// for "the client went away" — a visitor who clicked a product link before
// the analytics script had finished downloading took the request down with
// them, and the page recorded it as a failed request.
//
// The same thing happens with a tracker blocker, and there the request never
// reaches Google at all. Nothing on the storefront depends on this request:
// the shop's own measurements (LCP, CLS, TTFB, errors) go to /api/quality with
// navigator.sendBeacon, which is unload-safe by design.
//
// So the change is not "make the analytics work harder", it is "stop asking
// for a request that the visitor is not waiting for".
(function () {
  var meta = document.querySelector('meta[name="ga-measurement-id"]');
  var id = meta && meta.getAttribute('content');
  if (!id || !/^G-[A-Z0-9]{4,20}$/i.test(id)) return;

  function start() {
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = window.gtag || gtag;
    gtag('js', new Date());
    gtag('config', id, { anonymize_ip: true, send_page_view: true });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
  }

  // After load: the page is painted, the visitor is reading, and a request
  // that is still in flight is no longer competing with the first render.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}());
