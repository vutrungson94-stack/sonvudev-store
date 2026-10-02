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

/**
 * What a setting that was never filled in looks like from the inside.
 *
 * It is a value, not an absence, so that anything reading env.bank.name gets
 * something printable. Which means "not set" has to be recognisable, and the rule
 * for recognising it was a second copy of the same Vietnamese sentence: the string
 * appeared here as a default, again in the check that decides whether bank
 * transfer is available, and a third time in scripts/production-check.mjs, with
 * its own regex. Changing the wording in one place left the other two deciding the
 * opposite thing, and the shop would happily accept bank transfers it had no
 * account details for.
 *
 * Exported so that isConfigured, the production check and anything else asking the
 * same question read the same value.
 */
export const NOT_SET = "Chưa cập nhật";
const looksUnset = (item) => new RegExp(`^(${NOT_SET}|not configured|replace-with)`, "i").test(String(item).trim());

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
  // Who the shop is to the outside world. The brand used to be typed into the
  // templates, the PayPal call and the order emails separately, so renaming the
  // shop meant editing four files and forgetting one. Everything that speaks to
  // a person or to a crawler now reads it from here.
  brand: {
    name: value("BRAND_NAME", "SonVuDev"),
    // Shown on the legal pages, so a buyer has something to hold the shop to.
    legalEntity: value("BRAND_LEGAL_ENTITY", ""),
    // The person behind the shop. Models weight a named human far more heavily
    // than an anonymous storefront, and schema.org has a slot for exactly this.
    founderName: value("BRAND_FOUNDER_NAME", ""),
    founderUrl: value("BRAND_FOUNDER_URL", ""),
    // Profile URLs for the same accounts elsewhere. This is what links the shop
    // to the wider web in a knowledge graph; an empty sameAs makes the brand an
    // island that no model can corroborate.
    socialLinks: value("BRAND_SOCIAL_LINKS")
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter((item) => /^https:\/\//i.test(item)),
  },
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
  orders: {
    // Unpaid orders are cancelled once this many hours have passed. The window
    // is what the checkout form promises the buyer, so it is shown in the UI
    // and in the terms page rather than being a silent server rule.
    //
    // Clamped here, once. It used to be read raw and then re-guarded with
    // `Math.max(1, ... || 24)` in three modules that each had their own idea of
    // the fallback number, so a typo in the env var produced three different
    // answers to "how long does a buyer have".
    paymentWindowHours: Math.max(1, numberValue("ORDER_PAYMENT_WINDOW_HOURS", 24)),
    // How long before the deadline the "about to expire" notice is sent.
    expiringWarnHours: Math.max(0, numberValue("ORDER_EXPIRY_WARN_HOURS", 1)),
    sweepIntervalMs: numberValue("ORDER_SWEEP_INTERVAL_MS", 60000),
  },
  email: {
    // Resend is a plain REST API, so no dependency and no SMTP server is needed.
    resendKey: value("RESEND_API_KEY"),
    from: value("EMAIL_FROM", `${value("BRAND_NAME", "SonVuDev")} <no-reply@sonvudev.com>`),
    supportEmail: value("SUPPORT_EMAIL", "hello@sonvudev.com"),
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
    name: value("BANK_NAME", NOT_SET),
    accountName: value("BANK_ACCOUNT_NAME", value("BRAND_NAME", "SonVuDev")),
    accountNumber: value("BANK_ACCOUNT_NUMBER", NOT_SET),
    notePrefix: value("BANK_TRANSFER_NOTE_PREFIX", value("BRAND_NAME", "SonVuDev")),
    bin: value("BANK_BIN", "970436"),
    momo: value("MOMO_ACCOUNT_NUMBER"),
    momoQr: value("MOMO_QR_IMAGE"),
    momoQrAmount: value("MOMO_QR_AMOUNT_IMAGE"),
    momoDeepLink: value("MOMO_DEEP_LINK"),
    zalopay: value("ZALOPAY_ACCOUNT_NUMBER"),
    zalopayQr: value("ZALOPAY_QR_IMAGE"),
  },
  // Search engine ownership. All three are optional and independent: leaving
  // them blank changes nothing at all, and each one switches on exactly one
  // mechanism. They are read from config rather than written into the markup so
  // a token can be rotated without editing a file and redeploying.
  site: {
    // Google Search Console and Bing Webmaster Tools each hand out a token. The
    // same value works for the meta-tag method and the HTML-file method, so
    // whichever the dashboard offers can be used without changing the code.
    googleVerification: value("GOOGLE_SITE_VERIFICATION"),
    bingVerification: value("BING_SITE_VERIFICATION"),
    // IndexNow key file. Also proves ownership for IndexNow, and is what lets a
    // product change be pushed to Bing, Yandex and Naver the moment it happens
    // rather than waiting for the next crawl.
    indexNowKey: value("INDEXNOW_KEY"),
  },
};

export const isConfigured = {
  admin: configured("ADMIN_API_TOKEN"),
  r2: configured("R2_ACCOUNT_ID") && configured("R2_ACCESS_KEY_ID") && configured("R2_SECRET_ACCESS_KEY") && configured("R2_BUCKET_NAME"),
  supabase: hasSupabaseProjectUrl() && configured("SUPABASE_SERVICE_ROLE_KEY"),
  paypal: configured("PAYPAL_CLIENT_ID") && configured("PAYPAL_CLIENT_SECRET") && ["USD", "EUR", "GBP", "AUD", "CAD", "SGD", "JPY"].includes(env.paypal.currency),
  paypalWebhook: configured("PAYPAL_WEBHOOK_ID"),
  // Without a key the mailer falls back to writing each message to
  // data/outbox, so the flow is testable end to end before an account exists.
  email: configured("RESEND_API_KEY"),
  bank: Boolean(env.bank.name && env.bank.accountName && env.bank.accountNumber)
    && !looksUnset(`${env.bank.name} ${env.bank.accountNumber}`.trim()),
};
