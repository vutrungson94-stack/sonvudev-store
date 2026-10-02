// Which PayPal a host talks to, decided once.
//
// The rule used to exist in two files. src/config.js defaulted an unset value to
// "sandbox" and accepted only the exact string "live"; scripts/production-check.mjs
// did the same. They agreed by luck rather than by construction, which is how the
// pair of them quietly agreed to disagree with whatever a given host was actually
// configured for.
//
// Both defaults are the dangerous direction. Sandbox credentials authenticate
// against the sandbox API without complaint, so a host that was never told which
// PayPal to use — a Render service where the variable was never synced, a VPS whose
// env file predates the setting — looks completely healthy while creating orders
// that can never capture real money. A buyer pays, the capture is refused, the order
// sits pending, and no log anywhere says why.
//
// So this returns what was *decided*, not what to assume:
//
//   environment  "live" | "sandbox" — what to use when nothing else is known
//   isSet        false when the value is absent or unrecognised
//   apiBase      the endpoint that matches
//   reason       why isSet is false, in words a log reader can act on
//
// isSet false means "do not offer PayPal". The shop keeps running — bank transfer
// still works, and taking an order for a file it cannot deliver would be worse —
// but the checkout form must not present a rail that cannot take money.

const LIVE = "https://api-m.paypal.com";
const SANDBOX = "https://api-m.sandbox.paypal.com";

/**
 * @param {string|undefined|null} raw the value of PAYPAL_ENVIRONMENT
 * @returns {{environment: 'live'|'sandbox', isSet: boolean, apiBase: string, reason: string}}
 */
export function resolvePaypalEnvironment(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "live") return { environment: "live", isSet: true, apiBase: LIVE, reason: "" };
  if (value === "sandbox") return { environment: "sandbox", isSet: true, apiBase: SANDBOX, reason: "" };
  return {
    // Unset and unrecognised are the same thing here, and both land on sandbox
    // because that is the only choice that cannot charge anyone by accident.
    environment: "sandbox",
    isSet: false,
    apiBase: SANDBOX,
    reason: value
      ? `PAYPAL_ENVIRONMENT="${value}" không phải "live" hay "sandbox"`
      : "thiếu PAYPAL_ENVIRONMENT",
  };
}