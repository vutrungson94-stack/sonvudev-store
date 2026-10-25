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
const USE_LINGVA = true;
const LINGVA_BASE = process.env.LINGVA_BASE || "https://lingva.ml";
const USE_MYMEMORY = true;
const MYMEMORY_BASE = process.env.MYMEMORY_BASE || "https://api.mymemory.translated.net/get";
const HF_API_KEY = process.env.HF_API_KEY || "";
// DeepL-style language codes (uppercase) for the DeepL API.
const LINGVA_LANG = { vi: "vi", en: "en", ja: "ja", "zh-CN": "zh", "zh-TW": "zh", ko: "ko" };

// i18n language code -> DeepL language code
const LANG_MAP = {
  vi: "VI", en: "EN", ja: "JA", "zh-CN": "ZH", "zh-TW": "ZH", ko: "KO",
};

// Tokens that must never be translated
const TOKEN_REGEX = /(\{\{[\w]+\}\}|\{[\w]+\}|<[^>]*>|&[a-z]+;)/gi;

const LOCALES_DIR = join(process.cwd(), "public", "locales");
mkdirSync(LOCALES_DIR, { recursive: true });

export function isConfigured() {
  // Lingva.ml needs no API key, so the service is always available.
  return true;
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
  return { text: protectedText, map };
}

function unprotect(text, map) {
  return text.replace(/__PH_\d+__/g, (match) => map.get(match) || match);
}

export async function translateText(text, target, source = "vi") {
  if (!text) return text;

  const srcCode = LINGVA_LANG[source] || String(source).toLowerCase();
  const tgtCode = LINGVA_LANG[target] || String(target).toLowerCase();
  if (!srcCode || !tgtCode || srcCode === tgtCode) return text;

  const p = protect(text);

  // 1. Lingva.ml (no API key required)
  if (USE_LINGVA) {
    try {
      const url = `${LINGVA_BASE}/api/v1/${srcCode}/${tgtCode}/${encodeURIComponent(p.text)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && data.translation) {
          return unprotect(data.translation, p.map);
        }
      }
    } catch (e) {
      console.warn("[translate] Lingva lỗi:", e.message);
    }
  }

  // 2. MyMemory (no API key required)
  if (USE_MYMEMORY) {
    try {
      const url = `${MYMEMORY_BASE}?q=${encodeURIComponent(p.text)}&langpair=${encodeURIComponent(srcCode)}|${encodeURIComponent(tgtCode)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const out = data?.responseData?.translatedText;
        if (out && !/^MYMEMORY WARNING/i.test(out)) {
          return unprotect(out, p.map);
        }
      }
    } catch (e) {
      console.warn("[translate] MyMemory lỗi:", e.message);
    }
  }

  // 3. DeepL (if configured)
  if (DEEPL_API_KEY) {
    try {
      const res = await fetch(DEEPL_URL, {
        method: "POST",
        headers: {
          Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: [p.text],
          target_lang: (LANG_MAP[target] || String(target).toUpperCase()),
          source_lang: (LANG_MAP[source] || String(source).toUpperCase()),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const out = data?.translations?.[0]?.text;
        if (out) return unprotect(out, p.map);
      }
    } catch (e) {
      console.warn("[translate] DeepL lỗi:", e.message);
    }
  }

  // Do not return the source text: that would write Vietnamese into a foreign
  // locale and show up as a "Vietnamese fallback" in that language.
  throw new Error("translation unavailable");
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
      const translated = await translateText(value, targetLang, "vi");
      cache[key] = translated;
      done += 1;
    } catch (err) {
      console.error(`Failed to translate ${key}:`, err.message);
      // Leave the key absent so the client keeps its English fallback instead
      // of storing an empty/Vietnamese value.
      delete cache[key];
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
