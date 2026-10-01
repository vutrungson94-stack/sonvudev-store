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
 * Everything a person or a database supplied goes through this on its way out. The
 * two clients — i18n.js and admin.js — have their own copies for the same reason
 * they have their own code: neither is served by this process, so importing a
 * server module is not an option for them.
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
 */
export const money = (amount, currency) => new Intl.NumberFormat(
  currency === "USD" ? "en-US" : "vi-VN",
  currency === "USD" ? { style: "currency", currency } : { maximumFractionDigits: 0 },
).format(Number(amount) || 0);
