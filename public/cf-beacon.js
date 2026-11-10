// Loads Cloudflare Web Analytics after the page has loaded.
//
// The beacon used to be a module script in the <head>, which put a
// request to a third-party host on the critical path: the browser fetched
// static.cloudflareinsights.com while it was still working out how to paint
// the page, and the beacon's own endpoint request outlived the paint. It was
// the longest branch in the network tree.
//
// Analytics are not worth delaying a first paint for, so this waits for the
// load event and only then injects the beacon. The tag stays external — the
// page loads this file, and this file creates the beacon element — so the
// Content-Security-Policy still needs no 'unsafe-inline' and no hash.
//
// The token comes from the data-cf-token attribute rather than from a
// constant here: one definition, in src/pages.js, for every page.
(function () {
  var script = document.currentScript;
  var token = script && script.getAttribute("data-cf-token");
  if (!token) return;

  function loadBeacon() {
    if (document.querySelector("script[data-cf-beacon]")) return;
    var beacon = document.createElement("script");
    beacon.type = "module";
    beacon.async = true;
    beacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
    beacon.setAttribute("data-cf-beacon", JSON.stringify({ token: token }));
    document.head.appendChild(beacon);
  }

  if (document.readyState === "complete") loadBeacon();
  else window.addEventListener("load", loadBeacon, { once: true });
})();
