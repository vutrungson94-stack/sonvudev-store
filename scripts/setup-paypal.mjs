// Verifies the PayPal credentials in .env and makes sure a webhook exists.
// Usage: npm run paypal:setup
//        npm run paypal:detect   (find out which environment the
//        credentials belong to, instead of trusting the dashboard toggle)
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { resolvePaypalEnvironment } from "../src/paypal-environment.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), override: true });

const env = (key) => (process.env[key] || "").trim();
const detect = process.argv.slice(2).includes("--detect");
// Derived from the same resolver the server uses. This was a third copy of the
// endpoint list, and the script that verifies the credentials was therefore able
// to disagree with the module that spends them: a live/sandbox mapping changed in
// one file would verify against one endpoint and charge against another, which is
// the failure this script exists to prevent.
const BASES = Object.fromEntries(
  ["live", "sandbox"].map((name) => [name, resolvePaypalEnvironment(name).apiBase]),
);
const clientId = env("PAYPAL_CLIENT_ID");
const clientSecret = env("PAYPAL_CLIENT_SECRET");

async function authenticate(apiBase) {
  const response = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15000),
  });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
}

/**
 * The dashboard toggle is disabled while a business account is still being
 * verified, so which environment a set of credentials belongs to cannot be read
 * off the screen. Asking the API is the only honest answer.
 */
async function detectEnvironment() {
  console.log("Thu xac thuc credential voi ca hai moi truong PayPal...\n");
  for (const [name, base] of Object.entries(BASES)) {
    const result = await authenticate(base);
    console.log(`  ${name.padEnd(8)} ${result.ok ? "XAC THUC THANH CONG" : `that bai (HTTP ${result.status}: ${result.body.error_description || result.body.error || "unknown"})`}`);
    if (result.ok) {
      console.log(`\nCredential nay thuoc moi truong: ${name.toUpperCase()}`);
      console.log(`Dat PAYPAL_ENVIRONMENT=${name} trong .env roi chay lai: npm run paypal:setup`);
      return name;
    }
  }
  console.error("\nKhong xac thuc duoc o ca hai moi truong.");
  console.error("Kiem tra lai Client ID / Secret co dung app khong, va co copy thieu ky tu khong.");
  process.exitCode = 1;
  return null;
}

if (detect) {
  if (!clientId || !clientSecret) {
    console.error("Can PAYPAL_CLIENT_ID va PAYPAL_CLIENT_SECRET trong .env truoc khi do moi truong.");
    process.exit(1);
  }
  const found = await detectEnvironment();
  process.exit(found ? 0 : 1);
}

const resolved = resolvePaypalEnvironment(env("PAYPAL_ENVIRONMENT"));
const environment = resolved.isSet ? resolved.environment : "";
const apiBase = resolved.isSet ? resolved.apiBase : null;
const webhookUrl = `${env("APP_URL").replace(/\/$/, "")}/api/paypal/webhook`;
const eventTypes = ["PAYMENT.CAPTURE.COMPLETED"];

if (!resolved.isSet) {
  console.error(`${resolved.reason}. Khong tao webhook o moi truong nao.`);
  console.error("Chay `npm run paypal:detect` de PayPal tu tra loi credential thuoc moi truong nao,");
  console.error("roi dat PAYPAL_ENVIRONMENT vao .env truoc khi tao webhook.");
  process.exitCode = 1;
}

if (!clientId || !clientSecret) {
  console.error("Thiếu PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET trong .env.");
  process.exitCode = 1;
} else if (apiBase) {
  await main();
}

// Never call process.exit() while a fetch socket is still open, it aborts
// libuv on Windows.
async function main() {
  console.log(`Moi truong: ${environment} (${apiBase})`);

  if (clientId === clientSecret) {
    console.error("PAYPAL_CLIENT_ID va PAYPAL_CLIENT_SECRET dang giong nhau.");
    console.error("Bạn đã copy Client ID sang cả hai ô trong dashboard.");
    process.exitCode = 1;
    return;
  }

  // The same call authenticate() makes, one implementation rather than two. The
  // second copy that used to sit here had no timeout on it at all, so a PayPal
  // endpoint that accepted the connection and then stalled hung this script until
  // the operating system's TCP timeout, with nothing on screen.
  const tokenResult = await authenticate(apiBase);
  if (!tokenResult.ok) {
    console.error(`Xac thuc that bai (${tokenResult.status}): ${tokenResult.body.error_description || tokenResult.body.error || "unknown"}`);
    console.error("Kiem tra lai Client ID / Secret co dung app khong.");
    process.exitCode = 1;
    return;
  }
  const auth = { Authorization: `Bearer ${tokenResult.body.access_token}`, "Content-Type": "application/json" };
  console.log("Credential hợp lệ. Đã lấy access token.");

  // One read, one parse, one failure branch for each response that is not JSON —
  // a proxy's HTML error page used to reject out of main() as a raw stack trace,
  // which is not an answer to "are my credentials valid".
  const listResponse = await fetch(`${apiBase}/v1/notifications/webhooks`, { headers: auth, signal: AbortSignal.timeout(15000) });
  const listBody = await listResponse.json().catch(() => ({}));
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
      signal: AbortSignal.timeout(15000),
    });
    const createBody = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok) {
      const detail = (createBody.details || []).map((d) => `${d.field} ${d.issue}`).join("; ");
      console.error(`Tao webhook that bai (${createResponse.status}): ${createBody.message || "unknown"}`);
      if (detail) console.error(`Chi tiet: ${detail}`);
      if (createResponse.status === 400) {
        console.error("PayPal tu choi event_types cho app nay. Nguyen nhan thuong gap:");
        console.error("  - Tài khoản Personal chưa đăng ký webhook qua REST API.");
        console.error("  - Hay tao webhook thu cong trong Developer Dashboard > Apps & Credentials > Webhooks.");
        console.error("  - Sau khi có Webhook ID, điền vào .env rồi chạy lại check:production.");
      } else if (createResponse.status === 422 || createResponse.status === 404) {
        console.error("PayPal khong truy cap duoc URL nay. Kiem tra DNS + HTTPS cua APP_URL truoc khi tao lai.");
      }
      process.exitCode = 1;
      return;
    }
    console.log(`Da tao webhook. Subscribed: ${(createBody.event_types || []).join(", ")}`);
    console.log(`PAYPAL_WEBHOOK_ID=${createBody.id}`);
  }

  console.log("\nDien vao .env roi chay lai: npm run check:production");
}
