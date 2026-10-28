// Fills per-product copy for locales the catalogue has no columns for.
//
// The `products` table stores Vietnamese plus one English pair (name_en,
// description_en, ...). Japanese and Chinese readers therefore used to see
// English product text under a translated heading - the storefront's "for sale"
// section read as half-translated. This script writes the missing copy into the
// per-locale asset that the storefront and the product page already load:
//
//   public/locales/<lang>.json
//     "product.copy.<slug>.name"             -> translated product name
//     "product.copy.<slug>.shortDescription" -> one-line pitch
//     "product.copy.<slug>.description"      -> long description
//     "product.copy.<slug>.features"         -> array of bullet strings
//     "product.copy.<slug>.requirements"     -> system requirements
//
// It is idempotent: a key that already exists is never overwritten, so human
// edits in the asset survive a later run. Seed the file by hand for the fields
// that matter most (name, pitch, bullets) and let this script translate the long
// descriptions with the same service the UI dictionary uses.
//
// Usage:
//   node scripts/i18n-products.mjs                     # ja + zh-CN, all fields
//   node scripts/i18n-products.mjs --lang ja           # one language
//   node scripts/i18n-products.mjs --fields description,requirements
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCache, saveCache, translateText } from "../src/translate-service.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const LANGS = argValue("lang", "ja,zh-CN").split(",").map((s) => s.trim()).filter(Boolean);
const FIELDS = argValue("fields", "name,shortDescription,description,requirements,features")
  .split(",").map((s) => s.trim()).filter(Boolean);
const PAUSE_MS = 400;
const MAX_CHUNK = 700;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Last-resort translation endpoint, used ONLY while seeding this file.
//
// Lingva and MyMemory are free public services; after a few dozen calls they
// answer nothing, and the seed then silently misses the longest descriptions -
// which is exactly the copy a shopper opens the product page to read. Google's
// public gtx endpoint has no key and tolerates the volume, so it is the fallback
// here. It is deliberately NOT wired into src/translate-service.mjs: the runtime
// path keeps its documented providers, and the storefront never calls this.
async function translateViaGoogle(text, target, source) {
  const lang = (code) => ({ "zh-CN": "zh-CN", zh: "zh-CN", ja: "ja", en: "en", vi: "vi" }[code] || code);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(lang(source))}`
    + `&tl=${encodeURIComponent(lang(target))}&dt=t&q=${encodeURIComponent(text)}`;
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; sonvudev-seed)" } });
  if (!response.ok) throw new Error(`gtx HTTP ${response.status}`);
  const data = await response.json();
  const out = Array.isArray(data?.[0]) ? data[0].map((part) => part?.[0] || "").join("") : "";
  if (!String(out).trim()) throw new Error("gtx empty response");
  return out;
}

// One piece of text, with the shared service first and the fallback second.
async function translatePiece(text, target, source) {
  try {
    return await translateText(text, target, source);
  } catch (primaryError) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await translateViaGoogle(text, target, source);
      } catch (fallbackError) {
        if (attempt === 2) throw new Error(`${primaryError.message}; ${fallbackError.message}`);
        await sleep(1500 * attempt);
      }
    }
  }
  throw new Error("translation unavailable");
}

// The catalogue, from the same store the site uses. A local data/products.json is
// the fallback so the script also works on a checkout without Supabase env vars.
async function loadProducts() {
  try {
    const { listProducts } = await import("../src/store.js");
    const products = await listProducts({ includeDrafts: true });
    if (products && products.length) return products;
  } catch (error) {
    console.warn(`[i18n-products] store unavailable (${error.message}); falling back to data/products.json`);
  }
  const raw = await readFile(path.join(root, "data", "products.json"), "utf8");
  return JSON.parse(raw);
}

// English first: it is the language the long descriptions were rewritten in, and
// machine translation from English is markedly better than from Vietnamese.
const SOURCES = {
  name: ["nameEn", "name", "name"],
  shortDescription: ["shortDescriptionEn", "shortDescription", "shortDescription"],
  description: ["descriptionEn", "description", "description"],
  requirements: ["requirementsEn", "requirements", "requirements"],
  features: ["featuresEn", "features", "features"],
};
const sourceLang = (field, product) => {
  const [en, vi] = SOURCES[field];
  return String(product[en] || "").trim() ? "en" : "vi";
};
const sourceValue = (field, product) => {
  const [en, vi] = SOURCES[field];
  return String(product[en] || "").trim() ? product[en] : product[vi];
};

// Splits one paragraph into pieces the translation endpoints will accept. Returns
// an ARRAY OF PARAGRAPHS, each an array of parts, so the rebuild below can put a
// single space between parts of the same paragraph and a blank line between
// paragraphs. Flattening both kinds of boundary into "\n\n" turned every sentence
// of a long description into its own paragraph on the product page.
function chunk(text) {
  return String(text).split(/\n{2,}/).map((paragraph) => {
    if (paragraph.length <= MAX_CHUNK) return [paragraph];
    const sentences = paragraph.split(/(?<=[.!?。！？])\s+/);
    const parts = [];
    let current = "";
    for (const sentence of sentences) {
      if (`${current} ${sentence}`.trim().length > MAX_CHUNK && current) {
        parts.push(current.trim());
        current = sentence;
      } else {
        current = `${current} ${sentence}`.trim();
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  });
}

async function translateLong(text, target, source) {
  const paragraphs = [];
  for (const parts of chunk(text)) {
    const translated = [];
    for (const part of parts) {
      translated.push((await translatePiece(part, target, source)).trim());
      await sleep(PAUSE_MS);
    }
    paragraphs.push(translated.join(" "));
  }
  return paragraphs.join("\n\n").trim();
}

const cache = {};
const products = await loadProducts();
console.log(`[i18n-products] ${products.length} product(s); languages: ${LANGS.join(", ")}; fields: ${FIELDS.join(", ")}`);

let written = 0;
let skipped = 0;
let failed = 0;

for (const lang of LANGS) {
  cache[lang] = loadCache(lang) || {};
  for (const product of products) {
    const slug = String(product.slug || product.id || "").trim();
    if (!slug) continue;
    for (const field of FIELDS) {
      const key = `product.copy.${slug}.${field}`;
      if (cache[lang][key] !== undefined) { skipped += 1; continue; }

      const raw = sourceValue(field, product);
      if (Array.isArray(raw) ? raw.length === 0 : !String(raw || "").trim()) { skipped += 1; continue; }

      try {
        const source = sourceLang(field, product);
        if (field === "features") {
          const list = [];
          for (const item of raw) {
            list.push(String(item || "").trim() ? await translatePiece(String(item), lang, source) : item);
            await sleep(PAUSE_MS);
          }
          cache[lang][key] = list;
        } else {
          cache[lang][key] = await translateLong(String(raw), lang, source);
        }
        written += 1;
        console.log(`  + ${lang} ${key}`);
      } catch (error) {
        failed += 1;
        console.warn(`  ! ${lang} ${key}: ${error.message}`);
      }
    }
  }
  // Sort so the asset stays diffable: a re-run that adds one key moves one line.
  const sorted = Object.fromEntries(Object.entries(cache[lang]).sort(([a], [b]) => a.localeCompare(b)));
  saveCache(lang, sorted);
  console.log(`[i18n-products] wrote public/locales/${lang}.json (${Object.keys(sorted).length} keys)`);
}

console.log(`[i18n-products] done: ${written} translated, ${skipped} skipped (already present or empty), ${failed} failed`);
if (failed) process.exitCode = 1;
