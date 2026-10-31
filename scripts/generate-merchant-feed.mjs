import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMerchantFeed } from "../src/pages.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const productsPath = path.join(projectRoot, "data", "products.json");
const outPath = path.join(projectRoot, "publish-output", "merchant-feed.tsv");

mkdirSync(path.dirname(outPath), { recursive: true });

const products = JSON.parse(readFileSync(productsPath, "utf8"));
const tsv = renderMerchantFeed(products);

writeFileSync(outPath, tsv);
console.log(`[merchant-feed] Wrote feed to ${outPath}`);
