// Quality monitoring beacon (client-side).
//
// Measures LCP, CLS, TTFB, INP/FID and JavaScript errors, then sends a single
// beacon via navigator.sendBeacon to /api/quality (same origin, no CSP change).
//
// Only runs on production-like hosts (never localhost/127.0.0.1/.local).
// Sends no PII: only metric names/numeric values, the pathname, and error type +
// filename (never error messages, which can contain user data).
//
// Kept external so the site's CSP does not need unsafe-inline scripts.
(function () {
  var host = window.location && window.location.hostname;
  if (!host) return;
  // Only send on production-like hosts: never localhost, 127.0.0.1, or .local.
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) return;
  if (!window.navigator || !window.navigator.sendBeacon) return;
  if (!window.PerformanceObserver) return;

  var endpoint = "/api/quality";
  var metrics = {};
  var errors = [];

  function observe(type, callback) {
    try {
      var observer = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) callback(entries[i]);
      });
      observer.observe({ type: type, buffered: true });
    } catch (e) {
      // Browser may not support this metric; silently skip.
    }
  }

  // Largest Contentful Paint.
  observe("largest-contentful-paint", function (entry) {
    metrics.lcp = Math.round(entry.startTime);
  });
  // Cumulative Layout Shift (exclude shifts caused by recent user input).
  observe("layout-shift", function (entry) {
    if (!entry.hadRecentInput) {
      metrics.cls = Math.round((metrics.cls || 0) + entry.value);
    }
  });
  // First Input Delay.
  observe("first-input", function (entry) {
    metrics.fid = Math.round(entry.processingTime - entry.startTime);
  });
  // Interaction to Next Paint (EventTiming).
  observe("event", function (entry) {
    if (entry.interactionId) {
      metrics.inp = Math.round(Math.max(metrics.inp || 0, entry.processingTime - entry.startTime));
    }
  });

  // Time to first byte from navigation timing.
  //
  // `responseStart - requestStart` leaves out everything before the request was
  // sent: the redirect, the DNS lookup, the TLS handshake. On a page that
  // redirects (the language redirect sends an English browser to /en/) that is
  // most of the wait, so the number this reported was smaller than the wait a
  // visitor actually had.
  //
  // Navigation Timing Level 2 measures from the start of the navigation, so the
  // whole chain is included. The old expression stays as the fallback for the
  // browsers that only have performance.timing.
  var ttfb = null;
  if (window.performance && typeof window.performance.getEntriesByType === "function") {
    var entries = window.performance.getEntriesByType("navigation");
    if (entries && entries.length && entries[0].responseStart > 0) {
      ttfb = Math.round(entries[0].responseStart - entries[0].startTime);
    }
  }
  if (ttfb === null && window.performance && window.performance.timing) {
    var nav = window.performance.timing;
    if (nav.responseStart && nav.requestStart) {
      ttfb = Math.round(nav.responseStart - nav.requestStart);
    }
  }
  if (ttfb !== null) metrics.ttfb = ttfb;

  function send() {
    var payload = JSON.stringify({
      url: window.location && window.location.pathname,
      lcp: metrics.lcp,
      cls: metrics.cls,
      ttfb: metrics.ttfb,
      fid: metrics.fid,
      inp: metrics.inp,
      errors: errors
    });
    window.navigator.sendBeacon(endpoint, new Blob([payload], { type: "application/json" }));
  }

  // Flush when the page is hidden or unloaded.
  if (window.addEventListener) {
    window.addEventListener("pagehide", send, { once: true });
    window.addEventListener("beforeunload", send, { once: true });
  }

  // JavaScript errors / unhandled rejections (type + filename only, no message).
  window.onerror = function (_msg, url, _line) {
    errors.push({ type: "error", file: url });
    return false;
  };
  window.addEventListener("unhandledrejection", function (ev) {
    errors.push({ type: "rejection", file: ev.target && ev.target.src });
  });
}());
