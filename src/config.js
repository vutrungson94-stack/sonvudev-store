import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaypalEnvironment } from "./paypal-environment.js";

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
const NOT_SET = "Chưa cập nhật";

/**
 * Whether a value is a placeholder rather than something somebody filled in.
 *
 * This is the one answer to that question in the whole repository, and it used to be
 * four. src/config.js had two (looksUnset anchored at the start, configured matching
 * anywhere) and scripts/production-check.mjs had two more (placeholder, filledIn),
 * and they did not agree on eight of eight representative values:
 *
 *   "your_account_number"  config: real, so bank transfer was offered
 *                         check:  missing, so it failed
 *   "example"              config: real    check: missing
 *   "your-secret"          config: real    check: configured
 *   "x-replace-with-y"     config: real    check: configured
 *
 * That is the precise failure the comment on NOT_SET describes, still happening —
 * the shop offers a payment rail it cannot honour while its own pre-deploy check
 * reports it as unconfigured, and which one you believe depends on which file you
 * read. Four implementations also meant four places for the next reword to land in
 * three.
 *
 * Matching is by substring rather than from the start, which is the stricter of the
 * two old behaviours: a template that has been decorated (x-replace-with-y) is
 * still a template. Nothing a buyer would genuinely supply contains these tokens.
 */
const PLACEHOLDER_TOKENS = [
  NOT_SET.toLowerCase(),
  "not configured",
  "replace-with",
  "replace_with",
  "example",
  "your_",
  "your-",
  "yourproject",
  "your-bucket",
];
export const looksPlaceholder = (item) => {
  const text = String(item ?? "").trim().toLowerCase();
  if (!text) return true;
  return PLACEHOLDER_TOKENS.some((token) => text.includes(token));
};

const configured = (name) => !looksPlaceholder(value(name));
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
  // Token phụ cho RBAC tối thiểu: "name:token:role, token2@2027-01-01".
  // Không bắt buộc; để trống thì chỉ có ADMIN_API_TOKEN (admin, không expiry)
  // như trước đây. Chi tiết format xem src/admin-auth.js.
  adminTokens: value("ADMIN_API_TOKENS"),
  // How many proxies between the buyer and this process to trust for req.ip.
  // Behind Caddy (or Render) the client address arrives in X-Forwarded-For, and
  // the rate limiter counts by it — trusting zero hops makes every visitor share
  // one address and one budget; trusting hops that do not exist lets a caller
  // spoof theirs. The deploy template used to carry TRUST_PROXY while the server
  // ignored it and hardcoded 1, so setting the variable changed nothing.
  trustProxy: Math.max(0, numberValue("TRUST_PROXY", 1)),
  // Where the JSON fallback keeps its files. Read here rather than in src/store.js,
  // which reached for process.env.DATA_DIR directly — the only two places in src/
  // that bypassed this module, and therefore the only two places no test could hold
  // to the same contract as everything else. Unset means the project's data/ folder.
  dataDir: value("DATA_DIR"),
  // Who the shop is to the outside world. The brand used to be typed into the
  // templates, the PayPal call and the order emails separately, so renaming the
  // shop meant editing four files and forgetting one. Everything that speaks to
  // a person or to a crawler now reads it from here.
  brand: {
    name: value("BRAND_NAME", "SonVuDev"),
    // One line about what the shop is. Read by the Organization schema and
    // /llms.txt — the two places a crawler or an assistant learns the shop
    // from — instead of being typed into the markup. A reword in one place
    // reaches both.
    description: value("BRAND_DESCRIPTION", "Công cụ và tiện ích phần mềm cho doanh nghiệp và cá nhân tại Việt Nam."),
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
  analytics: {
    // Cloudflare Web Analytics token. Empty disables the beacon entirely, so a
    // checkout that is being run without the variable simply serves no tag
    // rather than one that fails to load.
    webAnalyticsToken: value("CF_WEB_ANALYTICS_TOKEN"),
  },
  geo: {
    // "off" disables the country lookup entirely and the storefront falls back
    // to listing every payment method without a recommendation.
    lookup: /^off$/i.test(value("GEO_LOOKUP", "auto")) ? "off" : "auto",
    cacheHours: numberValue("GEO_CACHE_HOURS", 24),
    provider1UrlTemplate: value("GEO_PROVIDER_1_URL", "https://ipapi.co/{ip}/country/"),
    provider2UrlTemplate: value("GEO_PROVIDER_2_URL", "https://ipwho.is/{ip}"),
  },
  rates: {
    sourceUrls: value("RATES_SOURCE_URLS", "https://open.er-api.com/v6/latest/USD,https://api.exchangerate-api.com/v4/latest/USD")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  indexNow: {
    endpoint: value("INDEXNOW_ENDPOINT", "https://api.indexnow.org/indexnow"),
  },
  notify: {
    resendApiUrl: value("RESEND_API_URL", "https://api.resend.com/emails"),
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
    sweepIntervalMs: Math.max(5000, numberValue("ORDER_SWEEP_INTERVAL_MS", 60000)),
    // Turns the background sweep off for a host where something else does it. Read
    // here rather than from process.env at the point of use: it used to be read only
    // by /api/health, which then reported the flag back as if it were the state of
    // the timer, and by nothing that actually decided whether to start one. Now
    // startSweeper() honours it and the health endpoint reports the timer itself.
    sweepDisabled: /^(1|true|yes|on)$/i.test(value("ORDER_SWEEP_DISABLED")),
  },
  email: {
    // Resend is a plain REST API, so no dependency and no SMTP server is needed.
    resendKey: value("RESEND_API_KEY"),
    from: value("EMAIL_FROM", `${value("BRAND_NAME", "SonVuDev")} <no-reply@sonvudev.com>`),
    supportEmail: value("SUPPORT_EMAIL", "hello@sonvudev.com"),
  },
  paypal: {
    environment: resolvePaypalEnvironment(value("PAYPAL_ENVIRONMENT")).environment,
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

// Which PayPal this shop talks to, and whether that answer was given or assumed.
//
// It used to fall back to "sandbox" when the variable was absent, and to sandbox
// again for anything that was not exactly the string "live". Both defaults are
// quiet, and quiet is the problem: a host missing the variable — a Render service
// where it was never synced, a VPS whose env file predates the setting — would
// create its PayPal orders against the sandbox API. Client credentials still
// authenticate there, the checkout page renders normally, the buyer pays, and the
// capture is refused because a sandbox order has no real money behind it. Every log
// looks healthy and the order simply never completes.
//
// So an unset or unrecognised value is not a default, it is an absence: the shop
// keeps running — bank transfer still works — but PayPal reports as unconfigured,
// which hides the option from the checkout form. A buyer is never offered a rail
// that cannot take their money. /api/health names which one is in force, so the
// question can be answered against a running host rather than an env file on a
// different machine.
const paypalEnv = resolvePaypalEnvironment(value("PAYPAL_ENVIRONMENT"));
export const paypalEnvironmentIsSet = paypalEnv.isSet;

export const isConfigured = {
  admin: configured("ADMIN_API_TOKEN"),
  r2: configured("R2_ACCOUNT_ID") && configured("R2_ACCESS_KEY_ID") && configured("R2_SECRET_ACCESS_KEY") && configured("R2_BUCKET_NAME"),
  supabase: hasSupabaseProjectUrl() && configured("SUPABASE_SERVICE_ROLE_KEY"),
  paypal: paypalEnv.isSet && configured("PAYPAL_CLIENT_ID") && configured("PAYPAL_CLIENT_SECRET") && ["USD", "EUR", "GBP", "AUD", "CAD", "SGD", "JPY"].includes(env.paypal.currency),
  paypalWebhook: configured("PAYPAL_WEBHOOK_ID"),
  // Without a key the mailer falls back to writing each message to
  // data/outbox, so the flow is testable end to end before an account exists.
  email: configured("RESEND_API_KEY"),
  bank: [env.bank.name, env.bank.accountName, env.bank.accountNumber].every((item) => !looksPlaceholder(item)),
};
