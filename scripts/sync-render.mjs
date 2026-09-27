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

// Render assigns PORT and injects its own RENDER_* vars. A blanket replace would
// wipe them, so each key is written individually via PUT /env-vars/{key}.
const SKIP = new Set(["PORT", "RENDER_API_KEY", "RENDER_SERVICE_ID"]);

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
  const name = env("RENDER_SERVICE") || "sonvudev";
  const data = await call("GET", `${api}/services?name=${encodeURIComponent(name)}&limit=20`);
  const services = Array.isArray(data) ? data : [];
  const match = services.find((item) => item.service?.name === name) || services[0];
  if (!match) throw new Error(`Khong tim thay service ten "${name}". Kiem tra RENDER_SERVICE trong .env.`);
  return match;
}

// The list endpoint paginates and wraps each entry as { envVar, cursor }.
async function readRemoteVars(serviceId) {
  const vars = new Map();
  let cursor = "";
  do {
    const page = await call("GET", `${api}/services/${serviceId}/env-vars?limit=100${cursor ? `&cursor=${cursor}` : ""}`);
    for (const entry of Array.isArray(page) ? page : []) {
      const item = entry.envVar || entry;
      if (item?.key) vars.set(item.key, item.value ?? "");
      cursor = entry.cursor || "";
    }
  } while (cursor);
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
  for (const [key, raw] of Object.entries(process.env)) {
    if (SKIP.has(key) || /^(RENDER_|npm_|NODE_)/i.test(key) || /^\s*#/i.test(raw)) continue;
    if (typeof raw !== "string" || !raw.trim()) continue;
    wanted.set(key, OVERRIDE[key] || raw.trim());
  }
  // Render requires HOST=0.0.0.0 to accept traffic; .env is tuned for localhost.
  if (wanted.has("HOST")) wanted.set("HOST", OVERRIDE.HOST);

  const changes = [];
  for (const [key, value] of wanted) {
    if (!remote.has(key)) changes.push({ key, action: "add" });
    else if (remote.get(key) !== value) changes.push({ key, action: "update" });
  }

  if (!changes.length) {
    console.log(`Khong co thay doi. ${wanted.size} bien da khop voi Render.`);
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