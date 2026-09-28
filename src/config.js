import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: path.join(projectRoot, ".env"), override: true });
} else {
  dotenv.config({ path: path.join(projectRoot, ".env") });
}

const value = (name, fallback = "") => (process.env[name] || fallback).trim();
const configured = (name) => {
  const v = value(name);
  const placeholders = ["your_", "your-project", "your-service", "your-account", "your-secret", "your_paypal", "your_bucket"];
  return v.length > 0 && !placeholders.some((item) => v.toLowerCase().includes(item)) && !v.includes("replace-with");
};
const numberValue = (name, fallback) => {
  const parsed = Number.parseInt(value(name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const liveRateValue = (name, fallbackNumber) => {
  const raw = value(name);
  if (/^(live|auto|true|1)$/i.test(raw)) return "live";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackNumber;
};
const hasSupabaseProjectUrl = () => {
  const raw = value("SUPABASE_URL");
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname);
  } catch { return false; }
};

export const env = {
  host: value("HOST", "0.0.0.0"),
  port: numberValue("PORT", 3000),
  appUrl: value("APP_URL", "http://localhost:3000").replace(/\/$/, ""),
  adminToken: value("ADMIN_API_TOKEN"),
  r2: {
    accountId: value("R2_ACCOUNT_ID"),
    accessKeyId: value("R2_ACCESS_KEY_ID"),
    secretAccessKey: value("R2_SECRET_ACCESS_KEY"),
    bucket: value("R2_BUCKET_NAME"),
    uploadTtl: numberValue("R2_UPLOAD_URL_TTL_SECONDS", 900),
    downloadTtl: numberValue("R2_DOWNLOAD_URL_TTL_SECONDS", 600),
  },
  supabase: {
    url: value("SUPABASE_URL").replace(/\/$/, ""),
    serviceRoleKey: value("SUPABASE_SERVICE_ROLE_KEY"),
  },
  geo: {
    // "off" disables the country lookup entirely and the storefront falls back
    // to listing every payment method without a recommendation.
    lookup: /^off$/i.test(value("GEO_LOOKUP", "auto")) ? "off" : "auto",
    cacheHours: numberValue("GEO_CACHE_HOURS", 24),
  },
  paypal: {
    environment: value("PAYPAL_ENVIRONMENT", "sandbox"),
    currency: value("PAYPAL_CURRENCY", "USD").toUpperCase(),
    vndToUsdRate: liveRateValue("PAYPAL_VND_TO_USD_RATE", 26000),
    rateFallback: numberValue("PAYPAL_VND_TO_USD_FALLBACK", 26000),
    rateTtlSeconds: numberValue("PAYPAL_RATE_TTL_SECONDS", 3600),
    rateMarginPercent: numberValue("PAYPAL_RATE_MARGIN_PERCENT", 0),
    clientId: value("PAYPAL_CLIENT_ID"),
    clientSecret: value("PAYPAL_CLIENT_SECRET"),
    webhookId: value("PAYPAL_WEBHOOK_ID"),
    accountEmail: value("PAYPAL_ACCOUNT_EMAIL"),
  },
  bank: {
    name: value("BANK_NAME", "Chưa cập nhật"),
    accountName: value("BANK_ACCOUNT_NAME", "SonVuDev"),
    accountNumber: value("BANK_ACCOUNT_NUMBER", "Chưa cập nhật"),
    notePrefix: value("BANK_TRANSFER_NOTE_PREFIX", "SonVuDev"),
    bin: value("BANK_BIN", "970436"),
    momo: value("MOMO_ACCOUNT_NUMBER"),
    momoQr: value("MOMO_QR_IMAGE"),
    momoQrAmount: value("MOMO_QR_AMOUNT_IMAGE"),
    momoDeepLink: value("MOMO_DEEP_LINK"),
    zalopay: value("ZALOPAY_ACCOUNT_NUMBER"),
    zalopayQr: value("ZALOPAY_QR_IMAGE"),
  },
};

export const isConfigured = {
  admin: configured("ADMIN_API_TOKEN"),
  r2: configured("R2_ACCOUNT_ID") && configured("R2_ACCESS_KEY_ID") && configured("R2_SECRET_ACCESS_KEY") && configured("R2_BUCKET_NAME"),
  supabase: hasSupabaseProjectUrl() && configured("SUPABASE_SERVICE_ROLE_KEY"),
  paypal: configured("PAYPAL_CLIENT_ID") && configured("PAYPAL_CLIENT_SECRET") && ["USD", "EUR", "GBP", "AUD", "CAD", "SGD", "JPY"].includes(env.paypal.currency),
  paypalWebhook: configured("PAYPAL_WEBHOOK_ID"),
  bank: Boolean(env.bank.name && env.bank.accountName && env.bank.accountNumber)
    && !/^(chưa cập nhật|not configured|replace-with)/i.test(`${env.bank.name} ${env.bank.accountNumber}`.trim()),
};
