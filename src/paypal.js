import crypto from "node:crypto";
import { env, isConfigured } from "./config.js";
import { rateForCharge, vndPerUsd } from "./rates.js";

const base = () => env.paypal.environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const authHeader = () => `Basic ${Buffer.from(`${env.paypal.clientId}:${env.paypal.clientSecret}`).toString("base64")}`;

async function token() {
  if (!isConfigured.paypal) throw new Error("PayPal chưa được cấu hình");
  const response = await fetch(`${base()}/v1/oauth2/token`, { method: "POST", headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!response.ok) throw new Error(`PayPal OAuth ${response.status}`);
  return (await response.json()).access_token;
}

const supportedCurrencies = new Set(["AUD", "BRL", "CAD", "CNY", "CZK", "DKK", "EUR", "HKD", "HUF", "ILS", "JPY", "MYR", "MXN", "TWD", "NZD", "NOK", "PHP", "PLN", "GBP", "RUB", "SGD", "SEK", "CHF", "THB", "USD"]);
const amountFor = (amount, currency = "USD") => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error("PayPal amount is invalid");
  const value = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
  return currency === "JPY" || currency === "HUF" || currency === "TWD" ? String(Math.ceil(numeric)) : value;
};
const validateCurrency = (currency) => {
  if (!supportedCurrencies.has(currency)) throw new Error(`PayPal currency is not supported: ${currency}`);
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
  const response = await fetch(`${base()}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "PayPal-Request-Id": orderId },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ reference_id: product.id, custom_id: orderId, description: product.name, amount: { currency_code: currency, value: amountFor(amount, currency) } }],
      payment_source: { paypal: { experience_context: { brand_name: "SonVuDev", user_action: "PAY_NOW", return_url: returnUrl, cancel_url: cancelUrl } } },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `PayPal order ${response.status}`);
  return data;
}

export async function captureOrder(providerOrderId) {
  const accessToken = await token();
  const response = await fetch(`${base()}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/capture`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } });
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
  const response = await fetch(`${base()}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `PayPal order ${response.status}`);
  return data;
}

export async function verifyWebhook(rawBody, headers) {
  if (!isConfigured.paypalWebhook) throw new Error("PAYPAL_WEBHOOK_ID chưa được cấu hình");
  const accessToken = await token();
  const response = await fetch(`${base()}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ auth_algo: headers["paypal-auth-algo"], cert_url: headers["paypal-cert-url"], transmission_id: headers["paypal-transmission-id"], transmission_sig: headers["paypal-transmission-sig"], transmission_time: headers["paypal-transmission-time"], webhook_id: env.paypal.webhookId, webhook_event: JSON.parse(rawBody.toString("utf8")) }) });
  const data = await response.json();
  return response.ok && data.verification_status === "SUCCESS";
}

export const newToken = () => crypto.randomBytes(24).toString("hex");
export const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
export const newOrderId = () => `SVD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
