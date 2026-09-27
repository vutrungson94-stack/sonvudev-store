// Verifies the PayPal credentials in .env and makes sure a webhook exists.
// Usage: npm run paypal:setup
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), override: true });

const env = (key) => (process.env[key] || "").trim();
const environment = env("PAYPAL_ENVIRONMENT") || "sandbox";
const apiBase = environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const clientId = env("PAYPAL_CLIENT_ID");
const clientSecret = env("PAYPAL_CLIENT_SECRET");
const webhookUrl = `${env("APP_URL").replace(/\/$/, "")}/api/paypal/webhook`;
const eventTypes = ["PAYMENT.CAPTURE.COMPLETED"];

if (!clientId || !clientSecret) {
  console.error("Thiếu PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET trong .env.");
  process.exit(1);
}

console.log(`Moi truong: ${environment} (${apiBase})`);

const tokenResponse = await fetch(`${apiBase}/v1/oauth2/token`, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials",
});
const tokenBody = await tokenResponse.json();
if (!tokenResponse.ok) {
  console.error(`Xac thuc that bai (${tokenResponse.status}): ${tokenBody.error_description || tokenBody.error || "unknown"}`);
  console.error("Kiem tra lai Client ID / Secret co dung app khong.");
  process.exit(1);
}
console.log("Credential hop le. Da lay access token.");

const auth = { Authorization: `Bearer ${tokenBody.access_token}`, "Content-Type": "application/json" };
const listResponse = await fetch(`${apiBase}/v1/notifications/webhooks`, { headers: auth });
const listBody = await listResponse.json();
const existing = Array.isArray(listBody.webhooks) ? listBody.webhooks : [];
console.log(`Webhook hien co: ${existing.length}`);

const found = existing.find((hook) => hook.url === webhookUrl);
if (found) {
  console.log(`Webhook da ton tai cho ${webhookUrl}`);
  console.log(`PAYPAL_WEBHOOK_ID=${found.id}`);
} else {
  console.log(`Dang tao webhook ${webhookUrl} ...`);
  const createResponse = await fetch(`${apiBase}/v1/notifications/webhooks`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ url: webhookUrl, event_types: eventTypes }),
  });
  const createBody = await createResponse.json();
  if (!createResponse.ok) {
    console.error(`Tao webhook that bai (${createResponse.status}): ${createBody.message || "unknown"}`);
    if (createResponse.status === 422 || createResponse.status === 400) {
      console.error("PayPal can truy cap URL nay khong. Kiem tra DNS + HTTPS cua APP_URL truoc khi tao lai.");
    }
    process.exit(1);
  }
  console.log(`Da tao webhook. Subscribed: ${(createBody.event_types || []).join(", ")}`);
  console.log(`PAYPAL_WEBHOOK_ID=${createBody.id}`);
}

console.log("\nDien vao .env roi chay lai: npm run check:production");
