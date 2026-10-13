import dotenv from "dotenv";
dotenv.config({ path: ".env", override: true });
import { updateProduct, getProductBySlug } from "../src/store.js";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, value] = item.replace(/^--/, "").split("=");
  return [key, value];
}));

const slug = args.get("slug");
const id = args.get("id");
const url = args.get("url");
if (!url || (!slug && !id)) {
  console.error("Usage: node scripts/set-virus-scan.mjs --slug=<slug> --url=<virustotal-url>");
  console.error("   or: node scripts/set-virus-scan.mjs --id=<product-id> --url=<virustotal-url>");
  process.exit(1);
}

const product = slug ? await getProductBySlug(slug) : null;
const productId = id || product?.id;
if (!productId) {
  console.error("Không tìm thấy sản phẩm.");
  process.exit(1);
}
const updated = await updateProduct(productId, { virusScanUrl: url, updatedAt: new Date().toISOString() });
console.log("OK", updated?.name || productId, url);
