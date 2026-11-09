// Applies preloaded stylesheets once the document has been parsed.
// Kept external (defer) so the site's strict CSP (script-src without
// 'unsafe-inline') never needs an inline onload handler on
// <link rel="preload" as="style">. Running after parse avoids render-blocking
// while the preload fetch still gives the sheets high priority.
(function () {
  var links = document.querySelectorAll('link[rel="preload"][as="style"]');
  for (var i = 0; i < links.length; i++) {
    links[i].rel = "stylesheet";
  }
})();
