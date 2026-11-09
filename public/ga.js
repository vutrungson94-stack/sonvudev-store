// Optional Google Analytics 4 loader. Only active when the server renders
// <meta name="ga-measurement-id" content="G-..."> (env GA_MEASUREMENT_ID).
// Kept external so the site's CSP does not need unsafe-inline scripts.
(function () {
  var meta = document.querySelector('meta[name="ga-measurement-id"]');
  var id = meta && meta.getAttribute('content');
  if (!id || !/^G-[A-Z0-9]{4,20}$/i.test(id)) return;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag('js', new Date());
  gtag('config', id, { anonymize_ip: true, send_page_view: true });
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
  document.head.appendChild(s);
}());