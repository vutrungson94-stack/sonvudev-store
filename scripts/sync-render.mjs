// Syncs environment variables from .env to a Render service.
// Usage: npm run render:sync          (dry run, prints the diff)
//        npm run render:sync:apply  (writes to Render)
//        npm run render:sync:deploy  (writes, then redeploys)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { env } from "../src/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// dotenv.config({ path: path.join(root, ".env"), override: true });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const redeploy = args.includes("--deploy");
const token = (process.env.RENDER_API_KEY || "").trim();
const api = "https://api.render.com/v1";

// Render assigns PORT and injects its own RENDER_* vars, so neither the Render
// credentials nor PORT belong in this list. Each key is written individually
// via PUT /env-vars/{key} rather than the collection endpoint, which replaces
// every variable and would wipe those.
// Every variable src/config.js reads, and nothing else.
//
// The list is the problem, not the copy. The script pushes each of these to Render
// before every deploy, and it omitted the five BRAND_ ones: the shop name, the
// legal entity, the founder and the social links. So on the Render host those kept
// falling back to the defaults baked into config.js while .env held the real
// values, and a deploy did nothing about it — the name on a buyer's bank
// statement, the entity named in the terms they agree to, and the profile links
// that tell a crawler the homepage and the product pages describe one shop all
// disagreed with each other, and only on that host.
//
// PORT is the one deliberate omission: Render assigns it, and pushing a local one
// would make the service bind somewhere it was not given.
//
// Kept next to a test that holds it against config.js, because this is the third
// place these names are written down and the only one with no caller to complain
// when it falls behind.
const ALLOWED = [
  "HOST", "APP_URL", "ADMIN_API_TOKEN", "ADMIN_API_TOKENS", "NODE_ENV", "TRUST_PROXY",
  "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME",
  "R2_UPLOAD_URL_TTL_SECONDS", "R2_DOWNLOAD_URL_TTL_SECONDS",
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "GEO_LOOKUP", "GEO_CACHE_HOURS", "GEO_PROVIDER_1_URL", "GEO_PROVIDER_2_URL",
  "GOOGLE_SITE_VERIFICATION", "BING_SITE_VERIFICATION", "INDEXNOW_KEY", "INDEXNOW_ENDPOINT",
  "CF_WEB_ANALYTICS_TOKEN",
  "PAYPAL_ENVIRONMENT", "PAYPAL_CURRENCY", "PAYPAL_VND_TO_USD_RATE", "PAYPAL_VND_TO_USD_FALLBACK",
  "PAYPAL_RATE_TTL_SECONDS", "PAYPAL_RATE_MARGIN_PERCENT",
  "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID", "PAYPAL_ACCOUNT_EMAIL",
  "BANK_NAME", "BANK_ACCOUNT_NAME", "BANK_ACCOUNT_NUMBER", "BANK_BIN", "BANK_TRANSFER_NOTE_PREFIX",
  "MOMO_ACCOUNT_NUMBER", "MOMO_QR_IMAGE", "MOMO_QR_AMOUNT_IMAGE", "MOMO_DEEP_LINK",
  "ZALOPAY_ACCOUNT_NUMBER", "ZALOPAY_QR_IMAGE",
  "ORDER_PAYMENT_WINDOW_HOURS", "ORDER_EXPIRY_WARN_HOURS", "ORDER_SWEEP_INTERVAL_MS",
  "RESEND_API_KEY", "RESEND_API_URL", "EMAIL_FROM", "SUPPORT_EMAIL",
  "BRAND_NAME", "BRAND_DESCRIPTION", "BRAND_LEGAL_ENTITY", "BRAND_FOUNDER_NAME", "BRAND_FOUNDER_URL", "BRAND_SOCIAL_LINKS",
  "RATES_SOURCE_URLS",
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
  // Render answers a deploy request with 200 and no body at all. Calling
  // response.json() on that throws "Unexpected end of JSON input" *after* the
  // deploy has been created, which reads like the deploy failed and invites
  // triggering a second one. An empty body is a success with nothing to report.
  const text = await response.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function findService() {
   const explicit = (process.env.RENDER_SERVICE_ID || "").trim();
  if (explicit) return { service: { id: explicit }, name: explicit };
  // The name used to fall back to a literal typed into this file. A service
  // name belongs to the Render account, not to the script: renaming the service
  // on the dashboard would fail with a message pointing at a name that no
  // longer exists, instead of naming the variable that decides it. So the
  // variable is required and its absence says what to set.
   const wanted = (process.env.RENDER_SERVICE || "").trim();
  if (!wanted) {
    console.error("Thieu RENDER_SERVICE hoac RENDER_SERVICE_ID trong .env.");
    console.error("Dat mot trong hai: RENDER_SERVICE_ID (id cua service) hoac RENDER_SERVICE (ten service).");
    throw new Error("Khong xac dinh duoc service Render.");
  }
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
    console.error(`Không tìm thấy service nào khớp với "${wanted}".`);
    if (services.length) {
      console.error("Các service đang có trong tài khoản Render:");
      for (const item of services) console.error(`  - ${item.name}  (${item.id})  ${item.type}`);
      console.error(`\nDat RENDER_SERVICE trong .env bang mot trong cac ten tren.`);
    } else {
      console.error("Tài khoản Render chưa có service nào. Hãy tạo service trước.");
    }
    throw new Error("Không xác định được service.");
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

  // Writing env vars to Render restarts the service on the current code, with or
  // without --deploy, so every mutating run is a deploy and is gated like one:
  // the build (syntax check, audit, metrics) and the test suite run first, and a
  // red gate aborts before anything is written. A dry run stays read-only and is
  // never gated, because it changes nothing.
  //
  // The test files are listed explicitly rather than passed as a directory: the
  // runner only discovers what it is pointed at, and a directory argument
  // silently ran nothing while reporting success on some platforms.
  if (apply || redeploy) {
    console.log("Kiểm tra build trước khi ghi lên Render...");
    const build = spawnSync(process.execPath, [path.join(root, "scripts", "build-web.mjs")], { stdio: "inherit" });
    if (build.status !== 0) {
      throw new Error("Build thất bại — đã dừng, chưa ghi gì lên Render. Sửa cho xanh rồi chạy lại.");
    }
    console.log("Chạy test trước khi ghi lên Render...");
    const { readdir } = await import("node:fs/promises");
    const testFiles = (await readdir(path.join(root, "test")))
      .filter((name) => name.endsWith(".test.js"))
      .map((name) => path.join(root, "test", name));
    const tests = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
    if (tests.status !== 0) {
      throw new Error("Test thất bại — đã dừng, chưa ghi gì lên Render. Sửa cho xanh rồi chạy lại.");
    }
  }

  const { service, name } = await findService();
  const serviceId = service.id;
  console.log(`Service: ${name} (${serviceId})`);

  const remote = await readRemoteVars(serviceId);
  const wanted = new Map();
  const missing = [];
  for (const key of ALLOWED) {
     const value = (env[key] ?? "").trim();
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
    console.log(`Không có thay đổi. ${wanted.size} bien da khop voi Render.`);
    // A redeploy is worth doing even with nothing to write, and it is asked for
    // separately from writing: --apply means "put the environment on Render",
    // --deploy means "restart the thing".
    //
    // Gating this on `apply` meant `npm run render:deploy` did nothing whenever the
    // environment already matched — which is every code-only change, the most common
    // reason to redeploy at all. The script printed "Khong co thay doi" and exited
    // successfully, so the redeploy it was named after never happened and nothing
    // said so. It is still gated on `redeploy`, so a plain `render:sync` stays a
    // read-only check.
    if (redeploy) {
      const deploy = await call("POST", `${api}/services/${serviceId}/deploys`, { clearCache: "do_not_clear" });
      console.log(`Da trigger deploy: ${deploy?.deploy?.id || deploy?.id || "unknown"}`);
      console.log("Deploy mất vài phút. Kiểm tra bằng: npm run check:production");
    }
    return;
  }

  for (const change of changes) console.log(`  ${change.action.padEnd(6)} ${change.key}`);
  console.log(`\n${changes.length} thay doi tren ${wanted.size} bien.`);

  if (!apply) {
    console.log("Chưa ghi gì lên Render. Đây mới là phần kiểm tra.");
    console.log("Để ghi thật:  npm run render:sync:apply");
    // A dry run that reports "4 changes" reads like four changes happened. It
    // matters most for PayPal, where PAYPAL_ENVIRONMENT and the credential pair
    // have to move together: a live deployment left holding sandbox credentials
    // shows PayPal in the checkout and fails it at the last step, for real
    // customers, with no error on the machine that made the change.
    const money = changes.filter((change) => /^(PAYPAL_|SUPABASE_|R2_|BANK_|RESEND_|ADMIN_|APP_URL)/.test(change.key));
    if (money.length) {
      console.log(`\n${money.length} trong các thay đổi này là thông tin thanh toán và kết nối dữ liệu:`);
      console.log(`  ${money.map((change) => change.key).join(", ")}`);
      console.log("  Chưa thay thì site đang chạy trên cấu hình CŨ, không phải cấu hình mới.");
    }
    return;
  }

  for (const change of changes) {
    await call("PUT", `${api}/services/${serviceId}/env-vars/${encodeURIComponent(change.key)}`, { key: change.key, value: wanted.get(change.key) });
    console.log(`Da ghi ${change.key}`);
  }
  console.log(`\nĐã cập nhật ${changes.length} biến trên Render.`);

  if (!redeploy) {
    console.log("Chạy lại với --deploy để trigger deploy mới, hoặc bấm Manual Deploy trên Dashboard.");
    return;
  }
  const deploy = await call("POST", `${api}/services/${serviceId}/deploys`, { clearCache: "do_not_clear" });
  console.log(`Da trigger deploy: ${deploy?.deploy?.id || deploy?.id || "unknown"}`);
  console.log("Deploy mất vài phút. Kiểm tra bằng: npm run check:production");
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}