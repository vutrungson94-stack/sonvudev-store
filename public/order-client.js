// The order session, and the two things every page does with it.
//
// Four pages need the buyer's access token after a payment: the storefront (to
// resume an interrupted checkout), the recovery form (to hand it back after a
// lookup), the order page (to show it), and the PayPal return (which is where a
// buyer arrives first and has nothing else). Each of them wrote its own copy of
// the same four things:
//
//   the sessionStorage key  — a brand literal in three files, so a rename meant
//                              finding three
//   "is this order finished?" — an identical predicate in two files
//   download, then tell the server the file was handed over — an identical pair
//                              of calls in three files
//
// The last one is the expensive duplicate. Calling /delivered is what resets the
// order so a second download is possible and what stops the same file being handed
// over twice; getting it right on one page and not the next means an order that
// can be downloaded forever next to one that can be downloaded once. The middle one
// is subtler and worse: both copies read `status !== 'paid'`, and delivering an
// order deliberately resets that status, so a rule written from `status` alone
// would close an order that has only just been paid.
//
// No bundler here, so this is a plain script loaded before the page script that
// uses it, publishing exactly one global. The pages keep their own names and their
// own logic; only what they all do identically moved here.
(function () {
  'use strict';

  // The session lives in sessionStorage, not localStorage, on purpose: the token
  // unlocks a paid download, and it should not outlive the tab.
  var KEY = 'sonvudev_order';

  function parse() {
    try {
      return JSON.parse(window.sessionStorage.getItem(KEY) || 'null');
    } catch (e) {
      // A corrupt value must read as "no session", not as a broken page. The
      // buyer can always get a new token from the lookup form with the same email.
      return null;
    }
  }

  window.OrderClient = {
    /** Where the session is kept, so a page can clear it. */
    storageKey: KEY,

    read: parse,

    write: function (id, token) {
      try { window.sessionStorage.setItem(KEY, JSON.stringify({ id: id, token: token })); } catch (e) { /* private mode */ }
    },

    clear: function () {
      try { window.sessionStorage.removeItem(KEY); } catch (e) { /* nothing to clear */ }
    },

    /**
     * Whether the order is finished with, for the purpose of offering another
     * download.
     *
     * Delivering an order resets its status to pending on purpose, so that a
     * second download is possible. Which means "delivered" cannot be read from the
     * status, and `paid` is the only state that still means money is expected.
     * Every page that decides whether to keep offering the download has to make
     * that same reading, or they disagree about the same order.
     */
    isClosed: function (order) {
      return Boolean(order && order.deliveredAt) && order.status !== 'paid';
    },

    /**
     * Hands the file over: asks for a fresh URL, sends the browser to it, and
     * records that the file was given out.
     *
     * These two steps always travel together. Opening the file alone leaves the
     * order looking unfulfilled, so the buyer cannot download again and their
     * review never appears. Recording it alone hands over nothing.
     *
     * The URL is fetched rather than linked directly because a presigned one is
     * short-lived, and a page left open for a day would otherwise offer a dead
     * link. The record is sent after the navigation starts and is never awaited or
     * surfaced: the file is already on its way, and a buyer who is told "we could
     * not confirm your download" while the file is landing in their folder is
     * worse off than one told nothing. The order sweep closes out anything that
     * was never confirmed.
     *
     * Errors are returned rather than thrown, so each page can put its own message
     * where its own reader will see it — and a dropped connection is reported as
     * its own case, because `response.ok` on a failed fetch says nothing useful.
     */
    download: async function (orderId, token) {
      let response;
      let payload;
      try {
        response = await window.fetch('/api/orders/' + encodeURIComponent(orderId) + '/download', { headers: { 'x-order-token': token } });
        payload = await response.json();
      } catch (error) {
        return { ok: false, offline: true };
      }
      // The whole payload is passed through, not just `error`. It used to forward
      // the Vietnamese sentence alone, which meant the translation key the server
      // sends alongside it was discarded here — so the page that called this had
      // nothing to translate and fell back to whatever language the sentence was
      // written in. Returning the body keeps the key and the sentence together,
      // which is what I18N.apiError expects.
      if (!response.ok) return { ok: false, ...(payload || {}), error: (payload && payload.error) || '' };
      window.location.href = payload.url;
      window.OrderClient.markDelivered(orderId, token);
      return { ok: true, url: payload.url };
    },

    /** The half of download() that must not block the transfer. */
    markDelivered: function (orderId, token) {
      window.fetch('/api/orders/' + encodeURIComponent(orderId) + '/delivered', {
        method: 'POST',
        headers: { 'x-order-token': token, 'content-type': 'application/json' },
      }).catch(function () { /* see above: the file is what matters */ });
    },
  };
})();
