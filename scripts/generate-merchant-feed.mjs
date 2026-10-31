import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const productsPath = path.join(projectRoot, "data", "products.json");
const outPath = path.join(projectRoot, "publish-output", "merchant-feed.tsv");

const appUrl = String(process.env.APP_URL || "").replace(/\/$/, "");
const appHost = appUrl ? new URL(appUrl).host : "";

if (!appHost) {
  console.error("[merchant-feed] APP_URL is not set; cannot build absolute links.");
  process.exit(1);
}

const products = JSON.parse(readFileSync(productsPath, "utf8"));
const sellable = (products || []).filter((p) => p.status === "active" && p.fileKey);

if (!sellable.length) {
  console.log("[merchant-feed] No sellable products; wrote empty header.");
  writeFileSync(outPath, "id\ttitle\tdescription\tlink\timage_link\tprice\tavailability\tcondition\tbrand\tmpn\tproduct_type\n");
  process.exit(0);
}

const escape = (value) => String(value ?? "").replace(/[\t\n\r]/g, " ").trim();

const rows = sellable.map((product) => {
  const title = escape(product.name + (product.version ? ` v${product.version}` : ""));
  const description = escape(
    (product.shortDescriptionEn || product.shortDescription || product.description || "")
      .replace(/\s+/g, " ")
      .trim()
  );
  const link = `${appHost}/product/${encodeURIComponent(product.slug)}`;
  const image = product.imageUrl
    ? product.imageUrl
    : `${appHost}/og/${product.slug}.png`;
  const price = `${Number(product.price) || 0} ${String(product.currency || "VND").toUpperCase()}`;
  const mpn = String(product.id || product.slug);

  return [
    escape(product.slug || mpn),
    title,
    description,
    link,
    image,
    price,
    "in stock",
    "new",
    escape("SonVuDev"),
    mpn,
    escape(product.category || "Software"),
  ].join("\t");
});

const header = [
  "id",
  "title",
  "description",
  "link",
  "image_link",
  "price",
  "availability",
  "condition",
  "brand",
  "mpn",
  "product_type",
].join("\t");

const tsv = [header, ...rows].join("\n") + "\n";
writeFileSync(outPath, tsv);
console.log(`[merchant-feed] Wrote ${sellable.length} products to ${outPath}`);
