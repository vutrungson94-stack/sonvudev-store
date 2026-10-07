// The two formatters that every HTML-producing module in this project needs.
//
// They were each written twice in this repository — once in pages.js and once in
// notify.js, byte for byte identical — and the reason two identical copies of an
// escape function are dangerous is not that today's copy is wrong. It is that the
// day someone extends one of them, there is nothing stopping the other from
// quietly disagreeing about what counts as escaped, and the two are used in the
// same sentence: the page a crawler reads and the email a buyer reads.
//
// Kept free of imports on purpose. Anything that needs to know the site URL, the
// catalogue or the configuration does not belong here, and a module with no
// dependencies cannot end up in a cycle.

/**
 * Escapes a value for interpolation into HTML text or an attribute value.
 *
 * Everything a person or a database supplied goes through this on its way out.
 * The browser side shares one implementation in public/format.js rather than
 * importing this module, which the static file server cannot provide — the two
 * are held identical by scripts/metrics.mjs, which counts real implementations
 * instead of aliases.
 */
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

/**
 * Formats an amount the way the buyer is charged.
 *
 * USD is styled and localised to en-US because that is the rail it is charged on —
 * a buyer who sees "$3.81" and a buyer who sees "3,81 $" are looking at two
 * different amounts. Everything else is VND, grouped with a dot and no decimals,
 * because a price like "99.000 ₫" is what the buyer was quoted.
 *
 * Never a buyer's own locale: the amount on the receipt and the amount in the
 * ledger have to be the same number written the same way, or reconciling them
 * against a bank statement means converting currencies by eye.
 *
 * The try/catch is not defensive padding. Intl.NumberFormat throws RangeError for a
 * currency code the runtime has no data for, and an uncaught throw inside a
 * template literal takes the whole response with it — a 500 for a page that
 * rendered fine a moment ago, over an amount rather than over anything the buyer
 * did. The fallback is the same bare number and code the browser side prints, so
 * the two implementations agree on the failure path too: they used to disagree
 * exactly here, the server throwing where the browser degraded quietly.
 */
export const money = (amount, currency) => {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(
      currency === "USD" ? "en-US" : "vi-VN",
      currency === "USD" ? { style: "currency", currency } : { style: "currency", currency, maximumFractionDigits: 0 },
    ).format(value);
  } catch {
    return `${value} ${currency || ""}`.trim();
  }
};
