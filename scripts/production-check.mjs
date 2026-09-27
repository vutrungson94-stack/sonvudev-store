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

function isConfigured(keys) { return keys.every((key) => !placeholder(value(key))); }
if (appUrl) {
  const host = new URL(appUrl).hostname;
  try { const addresses = await dns.resolve4(host); add("DNS A record", addresses.length > 0, addresses.join(", ")); }
  catch { add("DNS A record", false, "No public A record found"); }
  try {
    const response = await fetch(`${appUrl}/api/health`, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const health = response.ok ? await response.json() : null;
    add("HTTPS health", response.ok && health?.ok === true, response.ok ? JSON.stringify({ persistence: health.persistence, r2: health.r2, paypal: health.paypal, bank: health.bank }) : `HTTP ${response.status}`);
  } catch (error) { add("HTTPS health", false, error.name === "TimeoutError" ? "timeout" : error.message); }
}

for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
const failed = checks.filter((check) => !check.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} production checks passed.`);
if (failed.length) process.exitCode = 1;
