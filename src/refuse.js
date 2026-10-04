// Every refusal the API makes, in one shape.
//
// This module exists because the same answer was being given in three
// incompatible ways, and the one the buyer saw was decided by which route
// happened to fail.
//
//   { error: "VN sentence" }              what 43 call sites sent, and
//   { code: "review.err.notFound" }        what src/reviews.js sent, and
//   { error: "Internal server error" }     what a handful of admin routes sent
//
// Only the second one is translatable. The browser reads the first and prefers it
// over its own dictionary — public/app.js:282 is `throw Error(json.error ||
// T('cart.errCreate'))`, where `json.error` is a Vietnamese sentence chosen by the
// server — so the visitor who switched the shop to English was told, by the shop,
// that "Email không hợp lệ". On the checkout form. That is the single worst place
// for it to happen, because it is where the buyer already suspects something is
// wrong and now cannot find out what.
//
// So the shape is settled on the one src/reviews.js already used, and lifted into
// a module rather than left in one file:
//
//   code   a dictionary key, written out in full at the call site
//   error  the Vietnamese sentence, for curl, a log line, and the audit
//   status the HTTP code
//
// Two properties of the key are load-bearing and both come from reviews.js:
//
// The key is the whole name, never an assembled suffix. `refuse("api.err.rateLimited",
// …)` is greppable and the audit can see it connected to the dictionary; a client
// building `api.err.${code}` means no key name appears in any file, and the audit
// then reports working translations as dead — which is how a correct change gets
// "fixed" back into a hardcode.
//
// Both fields stay. Dropping `error` would break every human reading the API, and
// dropping `code` would put this file back where it started.

/**
 * A refusal the browser can translate and a person can read.
 *
 * @param {string} code a full dictionary key, e.g. "api.err.rateLimited"
 * @param {string} error the Vietnamese sentence, for logs and for curl
 * @param {number} status the HTTP status code
 * @returns {{code: string, error: string, status: number}}
 */
export const refuse = (code, error, status) => ({ code, error, status });

// This module used to also export `refuseWith`, the same shape with extra fields
// merged in, for the refusals that carry more than a sentence — a PayPal debug id,
// an order reference. Nothing ever imported it: every one of the ~60 call sites in
// src/app.js builds its body by hand, because the fields they carry differ per
// route. Two ways to make the same object, one of which nothing uses, is two places
// for the shape to drift. If a route ever needs a field in the refusal itself, the
// shape belongs in the one function rather than beside it.