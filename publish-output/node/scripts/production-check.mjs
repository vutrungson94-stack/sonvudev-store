import dns from "node:dns/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });
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
add("PayPal", ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"].every((key) => !placeholder(value(key))), isConfigured(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]) ? value("PAYPAL_ENVIRONMENT") || "sandbox" : "missing");
add("PayPal webhook", !placeholder(value("PAYPAL_WEBHOOK_ID")), value("PAYPAL_WEBHOOK_ID") ? "configured" : "missing");
add("Bank transfer", [value("BANK_NAME"), value("BANK_ACCOUNT_NAME"), value("BANK_ACCOUNT_NUMBER")].every((item) => item && !/^(chưa cập nhật|not configured|example|replace-with)/i.test(item)), [value("BANK_NAME"), value("BANK_ACCOUNT_NUMBER")].every((item) => item && !/^(chưa cập nhật|not configured|example|replace-with)/i.test(item)) ? "configured" : "missing");

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
