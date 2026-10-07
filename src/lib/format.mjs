// The two formatters that every HTML-producing module in this project needs.
//
// They were each written twice in this repository — once in pages.js and once in
// notify.js, byte for byte identical — and the reason two identical copies of an
// escape function are dangerous is not that today's copy is wrong. It is that the
// day someone extends one of them, there is nothing stopping the other from
// quietly disagreeing about what counts as escaped, and the two are used in the
// same sentence: the page a crawler reads and the email a buyer reads.
//
// This module re-exports the single shared implementation from src/format.js.
// The browser side keeps its own copy in public/format.js because the static file
// server cannot serve this module to a browser; the two are held identical by
// scripts/metrics.mjs, which counts real implementations instead of aliases.
//
// Kept free of imports on purpose. The shared module has no dependencies, so this
// re-export stays cycle-free.

export { esc, money } from "../format.js";