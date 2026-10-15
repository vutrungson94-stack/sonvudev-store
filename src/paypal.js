import crypto from "node:crypto";
import { env, isConfigured } from "./config.js";
import { rateForCharge, vndPerUsd } from "./rates.js";
import { PAYPAL_CURRENCIES, PAYPAL_ZERO_DECIMAL, resolvePaypalEnvironment } from "./paypal-environment.js";

// One resolver, not two literals written out again. This function existed here as
// a second copy of the endpoint list in src/paypal-environment.js, which is the
// file that exists specifically so there is only one — so it was imported by
// config.js and never by the module that actually calls PayPal.
//
// The two agreed, so nothing was broken. The failure mode was the one the shared
// file was written to prevent: a future change to how the environment maps to an
// endpoint (a region, a new sandbox) would be made in the resolver, config.js
// would pick it up and report the right endpoint in /api/health, and this module
// would keep calling the old one.
const base = () => resolvePaypalEnvironment(env.paypal.environment).apiBase;
const authHeader = () => `Basic ${Buffer.from(`${env.paypal.clientId}:${env.paypal.clientSecret}`).toString("base64")}`;

// How long any one call to PayPal may take.
//
// Node's fetch has no timeout of its own: a request that is accepted and then
// stalls holds the socket until the platform gives up, which on Render is minutes
// and on a single free instance is long enough for every concurrent buyer to be
// stuck behind it. Every other outbound call in this codebase already sets one —
// supabase-http.js, rates.js, geo.js, indexnow.js, notify.js — and this file was
// the only one that did not, on the one integration where the buyer's money is
// involved and the order row is already written.
//
// Ten seconds for the token and the reads, twenty for creating and capturing an
// order: those two are the slow ones on PayPal's side, and a caller that times out
// here can still reconcile from readOrder() rather than being stuck on a hung
// socket.
const TOKEN_TIMEOUT_MS = 10000;
const ORDER_TIMEOUT_MS = 20000;
const call = (url, options, timeoutMs = ORDER_TIMEOUT_MS) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });

// JPY, HUF and TWD are quoted in whole units: "1200.00" is a rejected amount and
// "1200" is the one PayPal expects. The rule sits next to the list it applies to.
const amountFor = (amount, currency = "USD") => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error("PayPal amount is invalid");
  if (PAYPAL_ZERO_DECIMAL.has(currency)) return String(Math.ceil(numeric));
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

async function token() {
  if (!isConfigured.paypal) throw new Error("PayPal chưa được cấu hình");
  const response = await call(`${base()}/v1/oauth2/token`, { method: "POST", headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" }, TOKEN_TIMEOUT_MS);
  if (!response.ok) throw new Error(`PayPal OAuth ${response.status}`);
  return (await response.json()).access_token;
}

/**
 * The currencies PayPal can charge in, and the ones with no minor unit, come from
 * src/paypal-environment.js — the one list. They used to be written out here, and
 * config.js had a third, shorter copy of its own; see the comment there.
 */
const validateCurrency = (currency) => {
  if (!PAYPAL_CURRENCIES.has(currency)) throw new Error(`PayPal currency is not supported: ${currency}`);
};

export function paypalChargeFor(product, vndPerUsd = env.paypal.vndToUsdRate) {
  const sourceCurrency = String(product.currency || "VND").toUpperCase();
  const price = Number(product.price);
  if (sourceCurrency === env.paypal.currency) return { currency: sourceCurrency, amount: price };
  if (sourceCurrency === "VND" && env.paypal.currency === "USD" && Number(vndPerUsd) > 0) {
    return { currency: "USD", amount: Math.ceil((price / Number(vndPerUsd)) * 100) / 100 };
  }
  throw new Error(`Không thể chuyển giá ${sourceCurrency} sang ${env.paypal.currency} cho PayPal`);
}

/** Same as paypalChargeFor but resolves a live VND/USD rate first. */
export async function paypalChargeForProduct(product) {
  if (String(product.currency || "VND").toUpperCase() === env.paypal.currency) {
    return { charge: paypalChargeFor(product), rate: null };
  }
  const { rate, source } = await vndPerUsd();
  return { charge: paypalChargeFor(product, rateForCharge(rate)), rate: { vndPerUsd: rate, source } };
}

export function paymentMatchesOrder(resource, order) {
  const purchaseUnit = resource?.purchase_units?.[0] || {};
  const customId = purchaseUnit.custom_id || resource?.custom_id;
  if (customId !== order.id) return false;
  const item = order.items?.[0] || {};
  // The charged amount is frozen on the order at checkout, so verification never
  // depends on the rate in effect right now.
  if (item.paypalCurrency && item.paypalAmount !== null && item.paypalAmount !== undefined) {
    const paid = purchaseUnit.amount || resource?.amount;
    return paid?.currency_code === item.paypalCurrency
      && Math.abs(Number(paid?.value) - Number(item.paypalAmount)) < 0.005;
  }
  try {
    const expected = paypalChargeFor({ price: order.amount, currency: order.currency }, env.paypal.rateFallback);
    const paid = purchaseUnit.amount || resource?.amount;
    return paid?.currency_code === expected.currency
      && Math.abs(Number(paid?.value) - expected.amount) < 0.005;
  } catch { return false; }
}

export async function createOrder({ orderId, product, customerEmail, returnUrl, cancelUrl, amount, currency = env.paypal.currency }) {
  validateCurrency(currency);
  const accessToken = await token();
  const response = await call(`${base()}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "PayPal-Request-Id": orderId },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ reference_id: product.id, custom_id: orderId, description: product.name, amount: { currency_code: currency, value: amountFor(amount, currency) } }],
      payment_source: { paypal: { experience_context: { brand_name: env.brand.name, user_action: "PAY_NOW", return_url: returnUrl, cancel_url: cancelUrl } } },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `PayPal order ${response.status}`);
  return data;
}

export async function captureOrder(providerOrderId) {
  const accessToken = await token();
  const response = await call(`${base()}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/capture`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message || `PayPal capture ${response.status}`);
    // PayPal refuses to capture an order it already captured. That is exactly
    // the shape of a lost response, so the caller needs to tell it apart from a
    // payment that genuinely never happened.
    error.name = data.name || `PAYPAL_${response.status}`;
    error.details = data.details || [];
    throw error;
  }
  return data;
}

/**
 * Reads the current state of a PayPal order without changing it. Used to
 * reconcile when a capture call failed: the money may already be captured even
 * though the buyer never saw a response, and only the provider can settle that.
 */
export async function readOrder(providerOrderId) {
  const accessToken = await token();
  const response = await call(`${base()}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}`, { headers: { Authorization: `Bearer ${accessToken}` } }, TOKEN_TIMEOUT_MS);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `PayPal order ${response.status}`);
  return data;
}

export async function verifyWebhook(rawBody, headers) {
  if (!isConfigured.paypalWebhook) throw new Error("PAYPAL_WEBHOOK_ID chưa được cấu hình");
  const accessToken = await token();
  const response = await call(`${base()}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ auth_algo: headers["paypal-auth-algo"], cert_url: headers["paypal-cert-url"], transmission_id: headers["paypal-transmission-id"], transmission_sig: headers["paypal-transmission-sig"], transmission_time: headers["paypal-transmission-time"], webhook_id: env.paypal.webhookId, webhook_event: JSON.parse(rawBody.toString("utf8")) }) }, TOKEN_TIMEOUT_MS);
  const data = await response.json();
  return response.ok && data.verification_status === "SUCCESS";
}

export const newToken = () => crypto.randomBytes(24).toString("hex");
export const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
export const newOrderId = () => `SVD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
