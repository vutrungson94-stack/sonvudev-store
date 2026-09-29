import dns from "node:dns/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), override: true });
const value = (key) => (process.env[key] || "").trim();
const placeholder = (item) => !item || /^(your_|replace-with|example)/i.test(item);
const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
const appUrl = value("APP_URL");

add("APP_URL", appUrl === "https://sonvudev.com", appUrl || "missing");
add("Admin token", !placeholder(value("ADMIN_API_TOKEN")), value("ADMIN_API_TOKEN") ? "configured" : "missing");
add("Supabase URL", /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(value("SUPABASE_URL")), value("SUPABASE_URL") ? "configured" : "missing");
add("Supabase secret key", !placeholder(value("SUPABASE_SERVICE_ROLE_KEY")), value("SUPABASE_SERVICE_ROLE_KEY") ? "configured" : "missing");
add("Cloudflare R2", ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"].every((key) => !placeholder(value(key))), isConfigured(["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]) ? "configured" : "missing");
// Validates the credentials for real. A non-empty string is not proof they work.
const paypalClientId = value("PAYPAL_CLIENT_ID");
const paypalClientSecret = value("PAYPAL_CLIENT_SECRET");
const paypalEnvironment = value("PAYPAL_ENVIRONMENT") || "sandbox";
const paypalBase = paypalEnvironment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const paypalFilled = isConfigured(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);

if (!paypalFilled) {
  add("PayPal", false, "missing");
} else if (paypalClientId === paypalClientSecret) {
  add("PayPal", false, "Client ID and Secret are identical, copy-paste error");
} else {
  try {
    const response = await fetch(`${paypalBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${paypalClientId}:${paypalClientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10000),
    });
    const body = response.ok ? "authenticated" : `HTTP ${response.status} ${(await response.json().catch(() => ({}))).error_description || "rejected"}`;
    add("PayPal", response.ok, `${paypalEnvironment}, ${body}`);
  } catch (error) {
    add("PayPal", false, `lookup failed: ${error.message}`);
  }
}
add("PayPal webhook", !placeholder(value("PAYPAL_WEBHOOK_ID")), value("PAYPAL_WEBHOOK_ID") ? "configured" : "missing");
add("Bank transfer", [value("BANK_NAME"), value("BANK_ACCOUNT_NAME"), value("BANK_ACCOUNT_NUMBER")].every((item) => item && !/^(chưa cập nhật|not configured|example|replace-with)/i.test(item)), [value("BANK_NAME"), value("BANK_ACCOUNT_NUMBER")].every((item) => item && !/^(chưa cập nhật|not configured|example|replace-with)/i.test(item)) ? "configured" : "missing");
add("Bank BIN (VietQR)", /^\d{6}$/.test(value("BANK_BIN")), value("BANK_BIN") || "missing");
add("MoMo wallet", !placeholder(value("MOMO_ACCOUNT_NUMBER")), value("MOMO_ACCOUNT_NUMBER") ? "configured" : "optional, missing");
add("ZaloPay wallet", !placeholder(value("ZALOPAY_ACCOUNT_NUMBER")), value("ZALOPAY_ACCOUNT_NUMBER") ? "configured" : "optional, missing");

// Order mail is what tells a buyer their order exists, when it expires and when
// the money arrived. Unconfigured, all three mails are silently written to
// data/outbox instead of being delivered, so a green run here still needs it.
const resendKey = value("RESEND_API_KEY");
if (!resendKey) {
  add("Order email", false, "RESEND_API_KEY missing, mail is only written to data/outbox");
} else {
  try {
    const response = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${resendKey}` }, signal: AbortSignal.timeout(10000) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      add("Order email", true, `resend, ${body.length || 0} domain(s)`);
    } else if (response.status === 401 && /only send/i.test(String(body.message || ""))) {
      // A key scoped to sending cannot list domains, and that is the setting we
      // want. Reporting this as a failure would push the owner towards handing
      // back full access to their whole Resend account.
      add("Order email", true, "resend, key giới hạn quyền gửi (đúng cấu hình). Xác minh thật: npm run email:check -- <email của bạn> created");
    } else {
      add("Order email", false, `HTTP ${response.status} ${body.message || "rejected"}`);
    }
  } catch (error) {
    add("Order email", false, `lookup failed: ${error.message}`);
  }
}
add("Email sender", /^[^<]+<[^>]+>$/.test(value("EMAIL_FROM") || "SonVuDev <no-reply@sonvudev.com>"), value("EMAIL_FROM") || "SonVuDev <no-reply@sonvudev.com>");
const windowHours = Number(value("ORDER_PAYMENT_WINDOW_HOURS") || "24");
add("Order payment window", Number.isFinite(windowHours) && windowHours >= 1, `${windowHours}h before an unpaid order is cancelled`);

function isConfigured(keys) { return keys.every((key) => !placeholder(value(key))); }
if (appUrl) {
  const host = new URL(appUrl).hostname;
  // dns.resolve4() queries DNS servers directly, so it fails whenever a local
  // resolver blocks direct queries (127.0.0.1, AdGuard, corporate DNS).
  // dns.lookup() goes through the OS resolver and matches what the browser sees.
  try {
    const addresses = await dns.lookup(host, { all: true });
    const public4 = [...new Set(addresses.filter((entry) => entry.family === 4).map((entry) => entry.address))];
    add("DNS A record", public4.length > 0, public4.join(", "));
  } catch (error) { add("DNS A record", false, `lookup failed: ${error.message}`); }
  try {
    const response = await fetch(`${appUrl}/api/health`, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const health = response.ok ? await response.json() : null;
    const summary = health ? JSON.stringify({ persistence: health.persistence, r2: health.r2, paypal: health.paypal, bank: health.bank }) : `HTTP ${response.status}`;
    add("HTTPS health", response.ok && health?.ok === true, summary);
    // A reachable server is not a store that can take money. Without R2 the
    // catalog hides every product, without bank/paypal checkout cannot complete,
    // and local-json means orders vanish on the next deploy.
    if (health) {
      add("Store is sellable", health.r2 === true, health.r2 ? "R2 connected, products are visible" : "r2=false, storefront hides every product");
      add("Payments live", health.paypal === true && health.bank === true, `paypal=${health.paypal}, bank=${health.bank}`);
      add("Database persistent", health.persistence === "supabase", health.persistence === "supabase" ? "supabase" : `${health.persistence}, orders are not durable`);
    }
  } catch (error) { add("HTTPS health", false, error.name === "TimeoutError" ? "timeout" : error.message); }
}

for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
const failed = checks.filter((check) => !check.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} production checks passed.`);
if (failed.length) process.exitCode = 1;
