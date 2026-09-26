import crypto from "node:crypto";
import { env, isConfigured } from "./config.js";

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

export function paypalChargeFor(product) {
  const sourceCurrency = String(product.currency || "VND").toUpperCase();
  const price = Number(product.price);
  if (sourceCurrency === env.paypal.currency) return { currency: sourceCurrency, amount: price };
  if (sourceCurrency === "VND" && env.paypal.currency === "USD" && env.paypal.vndToUsdRate > 0) {
    return { currency: "USD", amount: Math.ceil((price / env.paypal.vndToUsdRate) * 100) / 100 };
  }
  throw new Error(`Không thể chuyển giá ${sourceCurrency} sang ${env.paypal.currency} cho PayPal`);
}

export function paymentMatchesOrder(resource, order) {
  const purchaseUnit = resource?.purchase_units?.[0] || {};
  const customId = purchaseUnit.custom_id || resource?.custom_id;
  if (customId !== order.id) return false;
  try {
    const item = order.items?.[0] || {};
    const expected = {
      currency: item.paypalCurrency || paypalChargeFor({ price: order.amount, currency: order.currency }).currency,
      amount: item.paypalAmount ?? paypalChargeFor({ price: order.amount, currency: order.currency }).amount
    };
    const amount = purchaseUnit.amount || resource?.amount;
    return amount?.currency_code === expected.currency
      && Math.abs(Number(amount?.value) - expected.amount) < 0.01;
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
  if (!response.ok) throw new Error(data.message || `PayPal capture ${response.status}`);
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
