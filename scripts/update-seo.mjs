import { readFile } from "node:fs/promises";
import { supabaseRequest } from "../src/supabase-http.js";

const raw = await readFile("data/products.json", "utf8");
const products = JSON.parse(raw);
const seoProducts = products.filter(p => p.seoTitle || p.seoDescription);

if (!seoProducts.length) {
  console.log("No products with SEO data found in data/products.json");
  process.exit(0);
}

console.log(`Updating SEO for ${seoProducts.length} products in Supabase...`);

for (const product of seoProducts) {
  const patch = {
    seo_title: product.seoTitle || "",
    seo_description: product.seoDescription || "",
    seo_title_en: product.seoTitleEn || "",
    seo_description_en: product.seoDescriptionEn || "",
  };

  try {
    const result = await supabaseRequest(`products?id=eq.${encodeURIComponent(product.id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    console.log(`✓ ${product.slug}: SEO updated`);
  } catch (error) {
    console.error(`✗ ${product.slug}: ${error.message}`);
  }
}

console.log("\nDone!");
