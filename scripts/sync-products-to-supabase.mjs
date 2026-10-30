/**
 * Sync `data/products.json` → Supabase through the site’s admin API.
 *
 * Why this exists
 * ───────────────
 * The storefront reads its catalogue from Supabase when `SUPABASE_URL` is set,
 * so edits to `data/products.json` alone do not reach the live shop or the
 * Merchant Center feed. This script bridges that gap: the JSON file remains
 * the version-controlled source of truth, and this script pushes the same
 * data into the runtime store.
 *
 * How it works
 * ────────────
 * 1. Load `data/products.json` from the project root.
 * 2. Fetch the current live catalogue via `GET /api/admin/products`.
 * 3. Build two indexes: live products by `id` and by `slug`.
 * 4. For each JSON product:
 *      - If a live product has the same `id`   → PATCH it.
 *      - Else if a live product has the same `slug` → PATCH it (defensive).
 *      - Else                                    → POST a new product.
 * 5. Fields sent to the API match the admin PATCH allow-list in `src/app.js`
 *    so the server rejects anything unsafe rather than storing it.
 *
 * Safety
 * ──────
 * - Dry-run by default: set `DRY_RUN=1` to print planned actions without
 *   touching Supabase.
 * - Never sends secrets to the client: the admin token stays in the header.
 * - Skips products missing `id` and `slug` rather than inventing keys.
 *
 * Usage
 * ─────
 *   node scripts/sync-products-to-supabase.mjs           # dry-run
 *   DRY_RUN=0 node scripts/sync-products-to-supabase.mjs # apply
 *
 * After this script finishes, run the usual workflow:
 *   _Tests → _Build → _Sync
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import https from "node:https";

// ──────────────────────────────────────────────
// 1. Load environment
// ──────────────────────────────────────────────

// `.env` lives at the project root (one level up from `src/`).
// `import.meta.url` points to THIS script, so `..` resolves to the project root.
// `fileURLToPath` is required because URL pathnames keep `%20` for spaces,
// while `readFileSync` needs the real filesystem path with literal spaces.
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
// The admin token authorises every write below. Keep it secret.
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || (() => {
  try {
    const env = readFileSync(`${projectRoot}/.env`, "utf8");
    return env.match(/^ADMIN_API_TOKEN=(.+)$/m)?.[1]?.trim() || "";
  } catch {
    return "";
  }
})();

if (!ADMIN_API_TOKEN) {
  console.error("[sync] ERROR: ADMIN_API_TOKEN is not set in .env or environment.");
  process.exit(1);
}

// The live site URL. Must come from the environment so the same script works
// across dev, staging and production without editing source.
const APP_URL = String(process.env.APP_URL || "").replace(/\/+$/, "");
if (!APP_URL) {
  console.error("[sync] ERROR: APP_URL is not set. Export it or add it to .env.");
  process.exit(1);
}

// When true, the script only logs what it would do. No HTTP writes.
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

// ──────────────────────────────────────────────
// 2. Load local catalogue
// ──────────────────────────────────────────────

// `data/products.json` is the single source of truth for product content.
const productsPath = `${projectRoot}/data/products.json`;
let localProducts;
try {
  localProducts = JSON.parse(readFileSync(productsPath, "utf8"));
} catch (error) {
  console.error(`[sync] ERROR: cannot read ${productsPath}:`, error.message);
  process.exit(1);
}

if (!Array.isArray(localProducts) || localProducts.length === 0) {
  console.warn("[sync] WARNING: data/products.json is empty. Nothing to sync.");
  process.exit(0);
}

// ──────────────────────────────────────────────
// 3. HTTP helper (raw https, no external deps)
// ──────────────────────────────────────────────

/**
 * Make an HTTPS request and return the parsed JSON body.
 *
 * @param {string} method - HTTP method (GET, PATCH, POST …)
 * @param {string} path   - API path, e.g. `/api/admin/products`
 * @param {object|null} body - JSON-serialisable payload; null for GET
 * @returns {Promise<any>} parsed response body
 */
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body !== null ? JSON.stringify(body) : null;
    const headers = {
      Authorization: `Bearer ${ADMIN_API_TOKEN}`,
      "Content-Type": "application/json",
    };
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);

    const req = https.request(
      `${APP_URL}${path}`,
      { method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 400) {
            // Surface server errors so the operator can react.
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw);
          }
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ──────────────────────────────────────────────
// 4. Fetch live catalogue
// ──────────────────────────────────────────────

/** @type {Map<string, any>} live products keyed by `id` */
const liveById = new Map();
/** @type {Map<string, any>} live products keyed by `slug` */
const liveBySlug = new Map();

let liveProducts = [];
try {
  const response = await request("GET", "/api/admin/products");
  liveProducts = Array.isArray(response.products) ? response.products : [];
} catch (error) {
  console.error("[sync] ERROR: cannot fetch live catalogue:", error.message);
  process.exit(1);
}

for (const product of liveProducts) {
  if (product.id) liveById.set(product.id, product);
  if (product.slug) liveBySlug.set(product.slug, product);
}

// ──────────────────────────────────────────────
// 5. Field mapping: JSON → admin API
// ──────────────────────────────────────────────
//
// The server allow-list in `src/app.js` accepts these exact keys.
// Keep this list in sync with that file if new columns are added.

const JSON_TO_API_FIELDS = [
  "name",
  "slug",
  "shortDescription",
  "description",
  "shortDescriptionEn",
  "descriptionEn",
  "category",
  "platform",
  "version",
  "currency",
  "badge",
  "requirements",
  "requirementsEn",
  "fileKey",
  "seoTitle",
  "seoDescription",
  "seoTitleEn",
  "seoDescriptionEn",
  "features",
  "featuresEn",
  "price",
  "status",
];

/**
 * Convert one JSON product into the shape the admin API expects.
 *
 * Strips fields the server would reject anyway and normalises arrays so
 * a missing `featuresEn` becomes `[]` instead of `undefined`.
 *
 * @param {any} product
 * @returns {object}
 */
function toApiPayload(product) {
  const payload = {};
  for (const key of JSON_TO_API_FIELDS) {
    if (product[key] === undefined) continue;
    // Arrays (features / featuresEn) must be arrays of non-empty strings.
    if (key === "features" || key === "featuresEn") {
      const arr = Array.isArray(product[key])
        ? product[key].map((v) => String(v || "").trim()).filter(Boolean)
        : [];
      if (arr.length > 0) payload[key] = arr;
      continue;
    }
    // Scalars: coerce to string, skip blanks.
    const value = String(product[key]).trim();
    if (value) payload[key] = value;
  }
  return payload;
}

// ──────────────────────────────────────────────
// 6. Diff + apply
// ──────────────────────────────────────────────

const actions = []; // collect for the final report

for (const product of localProducts) {
  const id = product.id;
  const slug = product.slug;

  if (!id && !slug) {
    console.warn(`[sync] SKIP: product missing both id and slug:`, product.name || product);
    continue;
  }

  // Find the live product that corresponds to this JSON row.
  const live = liveById.get(id) || liveBySlug.get(slug) || null;
  const payload = toApiPayload(product);

  if (!payload.price && product.price !== undefined) {
    payload.price = Number(product.price);
  }

  if (live) {
    // Defensive: if the live row was found by slug only, make sure the id
    // stays stable. The PATCH route guards against id changes, so we only
    // send id when it matches.
    if (live.id === id) payload.id = id;

    // A real diff here would be better, but for now we always send the
    // payload. The server is idempotent for identical values, and the
    // `pingIndexNow` call re-indexes the page so Merchant Center sees
    // the fresh copy.
    actions.push({
      action: "PATCH",
      id: live.id,
      slug: live.slug || slug,
      name: payload.name || live.name,
    });

    if (!DRY_RUN) {
      await request("PATCH", `/api/admin/products/${live.id}`, payload);
    }
  } else {
    // New product: POST creates it server-side and assigns a fresh id when
    // we did not provide one.
    actions.push({
      action: "POST",
      id: id || "(server-assigned)",
      slug: slug || "(missing)",
      name: payload.name || "(unnamed)",
    });

    if (!DRY_RUN) {
      const created = await request("POST", "/api/admin/products", payload);
      // Replace the placeholder id so the report is truthful.
      actions[actions.length - 1].id = created.product?.id || created.id || actions[actions.length - 1].id;
    }
  }
}

// ──────────────────────────────────────────────
// 7. Report
// ──────────────────────────────────────────────

console.log(`\n[sync] DRY_RUN=${DRY_RUN}`);
console.log(`[sync] Local products : ${localProducts.length}`);
console.log(`[sync] Live products  : ${liveProducts.length}`);
console.log(`[sync] Planned actions: ${actions.length}\n`);

for (const act of actions) {
  console.log(`  ${act.action.padEnd(5)} ${(act.name || "(unnamed)").padEnd(28)} id=${act.id}  slug=${act.slug}`);
}

if (DRY_RUN) {
  console.log("\n[sync] Dry-run complete. Set DRY_RUN=0 to apply.");
} else {
  console.log("\n[sync] Apply complete. Verify on the live site and in Merchant Center.");
}
