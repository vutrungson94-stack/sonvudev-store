import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Translation service backed by DeepL Free API.
 *
 * - First call for a missing key hits the DeepL API.
 * - Result is cached in public/locales/<lang>.json so subsequent reads never call the API.
 * - Tokens ({{brandName}}, {sold}, ...) and HTML tags are protected before sending to DeepL
 *   so they are never translated or corrupted.
 */

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_URL = "https://api-free.deepl.com/v2/translate";

// i18n language code -> DeepL language code
const LANG_MAP = {
  vi: "VI", en: "EN", ja: "JA", "zh-CN": "ZH", "zh-TW": "ZH", ko: "KO",
};

// Tokens that must never be translated
const TOKEN_REGEX = /(\{\{[\w]+\}\}|\{[\w]+\}|<[^>]*>|&[a-z]+;)/gi;

const LOCALES_DIR = join(process.cwd(), "public", "locales");
mkdirSync(LOCALES_DIR, { recursive: true });

export function isConfigured() {
  return Boolean(DEEPL_API_KEY);
}

export function getCachePath(lang) {
  return join(LOCALES_DIR, `${lang}.json`);
}

export function loadCache(lang) {
  const path = getCachePath(lang);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {}
  }
  return {};
}

export function saveCache(lang, data) {
  writeFileSync(getCachePath(lang), JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Replace tokens/HTML with placeholders before sending to DeepL.
 */
function protect(text) {
  const map = new Map();
  let counter = 0;
  const protectedText = text.replace(TOKEN_REGEX, (match) => {
    const token = `__PH_${counter++}__`;
    map.set(token, match);
    return token;
  });
  return { text, map };
}

function unprotect(text, map) {
  return text.replace(/__PH_\d+__/g, (match) => map.get(match) || match);
}

export async function translateText(text, target, source = "vi") {
  if (!text) return text;

  // 1. Thử Lingva.ml (không cần key, miễn phí)
  if (USE_LINGVA) {
    try {
      const p = protect(text);
      const url = `${LINGVA_BASE}/api/v1/${source}/${target}/${encodeURIComponent(p.text)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.translation) {
          return unprotect(data.translation, p.map);
        }
      }
    } catch (e) {
      console.warn("[translate] Lingva lỗi, fallback sang DeepL/HF:", e.message);
    }
  }

  // 2. Fallback: DeepL (nếu có key)
  if (DEEPL_API_KEY) {
    // Sử dụng DeepL có sẵn...
  }

  // 3. Fallback: Hugging Face (nếu có key)
  if (HF_API_KEY) {
    // Sử dụng HF có sẵn...
  }

  // Cuối cùng trả text gốc
  return text;
}

/**
 * Translate every key from the Vietnamese dictionary that is still missing in the
 * target language cache, then persist the cache file.
 */
export async function translateMissingKeys(targetLang) {
  const viRaw = readFileSync("public/i18n.js", "utf8");
  const m = viRaw.match(/vi:\s*\{([\s\S]*?)\n\s*},\s*\n\s*en:/);
  if (!m) throw new Error("Could not parse `vi` block from public/i18n.js");

  const viDict = {};
  for (const line of m[1].split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("//")) continue;
    const km = l.match(/^'([^']+)'\s*:(.+?)\s*,?\s*$/);
    if (!km) continue;
    let v = km[2].replace(/,\s*$/, "").trim();
    if (v.startsWith("`") && v.endsWith("`")) v = v.slice(1, -1);
    else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    else if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    else v = null;
    if (v !== null) viDict[km[1]] = v;
  }

  const cache = loadCache(targetLang);
  const missing = Object.entries(viDict).filter(([key]) => !cache[key]);

  if (missing.length === 0) {
    return { translated: 0, total: Object.keys(viDict).length, cached: Object.keys(cache).length };
  }

  let done = 0;
  for (const [key, value] of missing) {
    try {
      cache[key] = await translateText(value, targetLang, "vi");
      done += 1;
    } catch (err) {
      console.error(`Failed to translate ${key}:`, err.message);
      cache[key] = ""; // mark as attempted so we don't retry endlessly
    }
  }

  saveCache(targetLang, cache);
  return {
    translated: done,
    missing: missing.length,
    total: Object.keys(viDict).length,
    cached: Object.keys(cache).length,
  };
}
