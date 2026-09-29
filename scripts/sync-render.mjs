// Syncs environment variables from .env to a Render service.
// Usage: npm run render:sync          (dry run, prints the diff)
//        npm run render:sync -- --apply  (writes to Render)
//        npm run render:sync -- --apply --deploy  (writes, then redeploys)
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), override: true });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const redeploy = args.includes("--deploy");
const env = (key) => (process.env[key] || "").trim();
const token = env("RENDER_API_KEY");
const api = "https://api.render.com/v1";

// Render assigns PORT and injects its own RENDER_* vars, so neither the Render
// credentials nor PORT belong in this list. Each key is written individually
// via PUT /env-vars/{key} rather than the collection endpoint, which replaces
// every variable and would wipe those.
const ALLOWED = [
  "HOST", "APP_URL", "ADMIN_API_TOKEN", "NODE_ENV",
  "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME",
  "R2_UPLOAD_URL_TTL_SECONDS", "R2_DOWNLOAD_URL_TTL_SECONDS",
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "GEO_LOOKUP", "GEO_CACHE_HOURS",
  "PAYPAL_ENVIRONMENT", "PAYPAL_CURRENCY", "PAYPAL_VND_TO_USD_RATE", "PAYPAL_VND_TO_USD_FALLBACK",
  "PAYPAL_RATE_TTL_SECONDS", "PAYPAL_RATE_MARGIN_PERCENT",
  "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID", "PAYPAL_ACCOUNT_EMAIL",
  "BANK_NAME", "BANK_ACCOUNT_NAME", "BANK_ACCOUNT_NUMBER", "BANK_BIN", "BANK_TRANSFER_NOTE_PREFIX",
  "MOMO_ACCOUNT_NUMBER", "MOMO_QR_IMAGE", "MOMO_QR_AMOUNT_IMAGE", "MOMO_DEEP_LINK",
  "ZALOPAY_ACCOUNT_NUMBER", "ZALOPAY_QR_IMAGE",
  "ORDER_PAYMENT_WINDOW_HOURS", "ORDER_EXPIRY_WARN_HOURS", "ORDER_SWEEP_INTERVAL_MS",
  "RESEND_API_KEY", "EMAIL_FROM", "SUPPORT_EMAIL",
];

// .env carries local-development values that are wrong on Render.
const OVERRIDE = { HOST: "0.0.0.0" };

const auth = { Authorization: `Bearer ${token}`, Accept: "application/json" };

async function call(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { ...auth, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${method} ${url.replace(api, "")} -> HTTP ${response.status} ${detail.slice(0, 300)}`);
  }
  return response.status === 204 ? null : response.json();
}

async function findService() {
  const explicit = env("RENDER_SERVICE_ID");
  if (explicit) return { service: { id: explicit }, name: explicit };
  const wanted = env("RENDER_SERVICE") || "sonvudev";
  // The ?name= filter only matches the exact service name and returns nothing
  // when it differs, so list everything and match here where the naming can be
  // normalised and the failure can show the user what actually exists.
  const data = await call("GET", `${api}/services?limit=100`);
  const services = (Array.isArray(data) ? data : []).map((item) => item.service || item);
  const normalise = (item) => String(item || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = services.find((item) => item.name === wanted)
    || services.find((item) => normalise(item.name) === normalise(wanted))
    || services.find((item) => normalise(item.name).includes(normalise(wanted)));
  if (!match) {
    console.error(`Khong tim thay service nao khop voi "${wanted}".`);
    if (services.length) {
      console.error("Cac service dang co trong tai khoan Render:");
      for (const item of services) console.error(`  - ${item.name}  (${item.id})  ${item.type}`);
      console.error(`\nDat RENDER_SERVICE trong .env bang mot trong cac ten tren.`);
    } else {
      console.error("Tai khoan Render chua co service nao. Hay tao service truoc.");
    }
    throw new Error("Khong xac dinh duoc service.");
  }
  return { service: match, name: match.name };
}

// The list endpoint paginates and wraps each entry as { envVar, cursor }.
async function readRemoteVars(serviceId) {
  const vars = new Map();
  let cursor = "";
  do {
    const page = await call("GET", `${api}/services/${serviceId}/env-vars?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    const entries = Array.isArray(page) ? page : [];
    for (const entry of entries) {
      const item = entry.envVar || entry;
      if (item?.key) vars.set(item.key, item.value ?? "");
    }
    // Take the cursor from the page itself, not from the loop body. An empty
    // final page never runs the body, so reading it there would keep the old
    // cursor and paginate forever.
    const last = entries[entries.length - 1];
    cursor = last?.cursor || "";
  } while (cursor && vars.size <= 1000);
  return vars;
}

async function main() {
  if (!token) {
    console.error("Thieu RENDER_API_KEY trong .env.");
    console.error("Lay key tai https://dashboard.render.com/ > Account Settings > API Keys.");
    process.exitCode = 1;
    return;
  }

  const { service, name } = await findService();
  const serviceId = service.id;
  console.log(`Service: ${name} (${serviceId})`);

  const remote = await readRemoteVars(serviceId);
  const wanted = new Map();
  const missing = [];
  for (const key of ALLOWED) {
    const value = env(key);
    if (!value) { missing.push(key); continue; }
    wanted.set(key, OVERRIDE[key] || value);
  }
  console.log(`${wanted.size}/${ALLOWED.length} bien co gia tri trong .env`);
  if (missing.length) console.log(`Bo trong .env, giu nguyen tren Render: ${missing.join(", ")}`);

  const changes = [];
  for (const [key, value] of wanted) {
    if (!remote.has(key)) changes.push({ key, action: "add" });
    else if (remote.get(key) !== value) changes.push({ key, action: "update" });
  }

  if (!changes.length) {
    console.log(`Khong co thay doi. ${wanted.size} bien da khop voi Render.`);
    // A redeploy is worth doing even with nothing to write: env vars only reach
    // a running process on restart, which is the whole reason --deploy exists.
    // Returning here would make the script tell the user to run --apply --deploy
    // and then silently do nothing when they did.
    if (apply && redeploy) {
      const deploy = await call("POST", `${api}/services/${serviceId}/deploys`, { clearCache: "do_not_clear" });
      console.log(`Da trigger deploy: ${deploy?.deploy?.id || deploy?.id || "unknown"}`);
      console.log("Deploy mat vai phut. Kiem tra bang: npm run check:production");
    }
    return;
  }

  for (const change of changes) console.log(`  ${change.action.padEnd(6)} ${change.key}`);
  console.log(`\n${changes.length} thay doi tren ${wanted.size} bien.`);

  if (!apply) {
    console.log("Day chi la kiem tra. Chay lai voi --apply de ghi len Render.");
    return;
  }

  for (const change of changes) {
    await call("PUT", `${api}/services/${serviceId}/env-vars/${encodeURIComponent(change.key)}`, { key: change.key, value: wanted.get(change.key) });
    console.log(`Da ghi ${change.key}`);
  }
  console.log(`\nDa cap nhat ${changes.length} bien tren Render.`);

  if (!redeploy) {
    console.log("Chay lai voi --deploy de trigger deploy moi, hoac bam Manual Deploy tren Dashboard.");
    return;
  }
  const deploy = await call("POST", `${api}/services/${serviceId}/deploys`, { clearCache: "do_not_clear" });
  console.log(`Da trigger deploy: ${deploy?.deploy?.id || deploy?.id || "unknown"}`);
  console.log("Deploy mat vai phut. Kiem tra bang: npm run check:production");
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}