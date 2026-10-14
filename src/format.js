// The formatters every HTML-producing module in this project needs.
//
// They were each written twice in this repository — once in pages.js and once in
// notify.js, byte for byte identical — and the reason two identical copies of an
// escape function are dangerous is not that today's copy is wrong. It is that the
// day someone extends one of them, there is nothing stopping the other from
// quietly disagreeing about what counts as escaped, and the two are used in the
// same sentence: the page a crawler reads and the email a buyer reads.
//
// initials and formatBytes are here for the same reason: they were written once
// for the server card, once for the browser card and once for the admin panel,
// and the admin panel's size formatter had already dropped a decimal place the
// server one kept.
//
// Kept free of imports on purpose. Anything that needs to know the site URL, the
// catalogue or the configuration does not belong here, and a module with no
// dependencies cannot end up in a cycle.

/**
 * The initials shown in place of a product icon before its image exists.
 *
 * Used by the server-rendered catalogue card, the browser catalogue and the
 * admin panel — three call sites in two runtimes, which is why it lives here
 * next to the other shared formatters rather than being written a fourth time.
 * The browser twin in public/format.js is held in step by scripts/metrics.mjs,
 * the same way esc and money are.
 */
export const initials = (name) => String(name || "SV").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

/**
 * A release file's size, in the unit a person reads it in.
 *
 * Bytes below 1024 are shown whole — "999 B", not "999.0 B" — and anything at
 * or above a hundred in a unit drops to one decimal so "1.0 GB" does not sit
 * beside "120 MB" and look like it rounds worse than it does.
 */
export const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size >= 100 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
};

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

/**
 * A URL slug from a display name.
 *
 * There were two of these in src/app.js and they disagreed about the edges: one
 * stripped every leading and trailing hyphen, the other stripped exactly one of
 * each. A name already wrapped in dashes came out clean under one and with the
 * dashes still on under the other, and the second spelling is the one that
 * reached the R2 object key, the sitemap URL and the link the buyer is emailed.
 * A slug with a stray hyphen names a different object, so the edges are stripped
 * properly here, once.
 *
 * Non-Latin names collapse to an empty string rather than to dashes. That is the
 * honest answer: there is no ASCII spelling of a Vietnamese product name, and the
 * caller already decides what to do about an empty one.
 *
 * @param {string} value the display name
 * @returns {string} a lowercase slug, possibly empty
 */
export const slugify = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
