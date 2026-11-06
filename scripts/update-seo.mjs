/**
 * SEO-only catalogue sync.
 *
 * `scripts/sync-products-to-supabase.mjs` normally owns the whole catalogue via
 * the admin API (including SEO fields). This script is the DB-direct fallback
 * for an operator who can reach Supabase but not the live admin API, or who
 * only wants to re-assert SEO columns. It is deliberately narrow on purpose:
 * it writes just seo_title / seo_description (and their English twins) and
 * never touches price, fileKey or status.
 *
 * Usage:
 *   npm run ops:seo                    # dry-run, prints planned patches
 *   npm run ops:seo:apply   # apply
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, isConfigured } from "../src/config.js";
import { supabaseRequest } from "../src/supabase-http.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply") || process.env.DRY_RUN === "0" || process.env.DRY_RUN === "false";
const raw = await readFile(path.join(root, "data", "products.json"), "utf8");
const products = JSON.parse(raw);

if (!isConfigured.supabase) {
  console.error("[seo] ERROR: Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}

const seoProducts = products.filter((p) => p.seoTitle || p.seoDescription || p.seoTitleEn || p.seoDescriptionEn || p.seo_title || p.seo_description);

if (!seoProducts.length) {
  console.log("No products with SEO data found in data/products.json");
  process.exit(0);
}

console.log(`${apply ? "Updating" : "Dry-run"} SEO for ${seoProducts.length} products in Supabase...`);

for (const product of seoProducts) {
  const patch = {
    seo_title: product.seoTitle || product.seo_title || "",
    seo_description: product.seoDescription || product.seo_description || "",
    seo_title_en: product.seoTitleEn || product.seo_title_en || "",
    seo_description_en: product.seoDescriptionEn || product.seo_description_en || "",
  };

  if (!apply) {
    console.log(`[dry-run] ${product.slug}: PATCH products?id=eq.${product.id}`);
    continue;
  }

  try {
    await supabaseRequest(`products?id=eq.${encodeURIComponent(product.id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    console.log(`✓ ${product.slug}: SEO updated`);
  } catch (error) {
    console.error(`✗ ${product.slug}: ${error.message}`);
  }
}

console.log(apply ? "\nDone!" : "\nDry-run complete. Pass --apply to write.");
