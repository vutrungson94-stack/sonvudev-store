import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Translation service backed by free translation providers.
 *
 * - First call for a missing key hits a free provider (Lingva/MyMemory).
 * - Result is cached in public/locales/<lang>.json so subsequent reads never call the API.
 * - Tokens ({{brandName}}, {sold}, ...) and HTML tags are protected before sending
 *   so they are never translated or corrupted.
 * - Long text is split into sentence-sized chunks and translated piece by piece,
 *   because free providers truncate or reject very long inputs.
 * - Transient failures (429/5xx/network) are retried with exponential backoff.
 */

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_URL = "https://api-free.deepl.com/v2/translate";
const USE_GOOGLE = true;
const GOOGLE_URL = "https://translate.googleapis.com/translate_a/single";
const USE_LINGVA = true;
const LINGVA_BASE = process.env.LINGVA_BASE || "https://lingva.ml";
const USE_MYMEMORY = true;
const MYMEMORY_BASE = process.env.MYMEMORY_BASE || "https://api.mymemory.translated.net/get";
const HF_API_KEY = process.env.HF_API_KEY || "";
// Provider language codes (lowercase) for Lingva/MyMemory.
const LINGVA_LANG = { vi: "vi", en: "en", de: "de", es: "es", fr: "fr", ja: "ja", "zh-CN": "zh", "zh-TW": "zh", ko: "ko" };

// i18n language code -> DeepL language code
const LANG_MAP = {
  vi: "VI", en: "EN", de: "DE", es: "ES", fr: "FR", ja: "JA", "zh-CN": "ZH", "zh-TW": "ZH", ko: "KO",
};

// Tokens that must never be translated
const TOKEN_REGEX = /(\{\{[\w]+\}\}|\{[\w]+\}|<[^>]*>|&[a-z]+;)/gi;

const LOCALES_DIR = join(process.cwd(), "public", "locales");
mkdirSync(LOCALES_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isConfigured() {
  // Free providers need no API key, so the service is always available.
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
 * Replace tokens/HTML with placeholders before sending to a provider.
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

function splitChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const parts = text.split(/(?<=[.!?。！？\n])\s+/);
  const chunks = [];
  let cur = "";
  for (const p of parts) {
    if (!p) continue;
    if (cur && cur.length + p.length + 1 > maxLen) {
      chunks.push(cur.trim());
      cur = p;
    } else {
      cur = cur ? cur + " " + p : p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  const final = [];
  for (const c of chunks) {
    if (c.length <= maxLen) final.push(c);
    else {
      for (let i = 0; i < c.length; i += maxLen) final.push(c.slice(i, i + maxLen));
    }
  }
  return final.filter(Boolean);
}

async function fetchWithRetry(url, init, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        await sleep(400 * Math.pow(2, i));
        continue;
      }
      return res;
    } catch (e) {
      await sleep(400 * Math.pow(2, i));
    }
  }
  return null;
}

/**
 * Translate a single (already short) chunk through the provider chain.
 */
async function translateChunk(text, target, source = "vi") {
  if (!text) return text;

  const srcCode = LINGVA_LANG[source] || String(source).toLowerCase();
  const tgtCode = LINGVA_LANG[target] || String(target).toLowerCase();
  if (!srcCode || !tgtCode || srcCode === tgtCode) return text;

  const p = protect(text);

  // 0. Google Translate free endpoint (no API key required) - most reliable.
  if (USE_GOOGLE) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const url = `${GOOGLE_URL}?client=gtx&sl=${encodeURIComponent(srcCode)}&tl=${encodeURIComponent(tgtCode)}&dt=t&q=${encodeURIComponent(p.text)}`;
        const res = await fetch(url);
        if (res.status === 429 || res.status >= 500) {
          await sleep(400 * Math.pow(2, attempt));
          continue;
        }
        if (res.ok) {
          const data = await res.json();
          const parts = Array.isArray(data?.[0]) ? data[0] : [];
          const out = parts.map((x) => (Array.isArray(x) ? x[0] : "")).join("");
          if (out && out.trim()) {
            return unprotect(out, p.map);
          }
        }
        break;
      } catch (e) {
        await sleep(400 * Math.pow(2, attempt));
      }
    }
  }

  // 1. Lingva (no API key required)
  if (USE_LINGVA) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const url = `${LINGVA_BASE}/api/v1/${srcCode}/${tgtCode}/${encodeURIComponent(p.text)}`;
        const res = await fetch(url);
        if (res.status === 429 || res.status >= 500) {
          await sleep(400 * Math.pow(2, attempt));
          continue;
        }
        if (res.ok) {
          const data = await res.json();
          if (data && data.translation) {
            return unprotect(data.translation, p.map);
          }
        }
        break;
      } catch (e) {
        await sleep(400 * Math.pow(2, attempt));
      }
    }
  }

  // 2. MyMemory (no API key required) - pick the best match, not just responseData.
  if (USE_MYMEMORY) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const url = `${MYMEMORY_BASE}?q=${encodeURIComponent(p.text)}&langpair=${encodeURIComponent(srcCode)}|${encodeURIComponent(tgtCode)}`;
        const res = await fetch(url);
        if (res.status === 429 || res.status >= 500) {
          await sleep(400 * Math.pow(2, attempt));
          continue;
        }
        if (res.ok) {
          const data = await res.json();
          const matches = Array.isArray(data?.matches) ? data.matches : [];
          let best = null;
          for (const m of matches) {
            const tr = m?.translation;
            if (!tr || /^MYMEMORY WARNING/i.test(tr)) continue;
            if (String(tr).trim().toLowerCase() === String(text).trim().toLowerCase()) continue;
            if (!best || (m.match || 0) + (m.quality || 0) > (best.match || 0) + (best.quality || 0)) {
              best = m;
            }
          }
          let out = best?.translation || data?.responseData?.translatedText;
          if (out && /^MYMEMORY WARNING/i.test(out)) out = null;
          if (out && String(out).trim().toLowerCase() === String(text).trim().toLowerCase()) {
            // No real translation: try any non-identical match as a last resort.
            const alt = matches.find((m) => m?.translation && !/^MYMEMORY WARNING/i.test(m.translation) && String(m.translation).trim().toLowerCase() !== String(text).trim().toLowerCase());
            if (alt) out = alt.translation;
          }
          if (out) return unprotect(out, p.map);
        }
        break;
      } catch (e) {
        await sleep(400 * Math.pow(2, attempt));
      }
    }
  }

  // 3. DeepL (if configured)
  if (DEEPL_API_KEY) {
    for (let attempt = 0; attempt < 3; attempt++) {
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
        if (res.status === 429 || res.status >= 500) {
          await sleep(400 * Math.pow(2, attempt));
          continue;
        }
        if (res.ok) {
          const data = await res.json();
          const out = data?.translations?.[0]?.text;
          if (out) return unprotect(out, p.map);
        }
        break;
      } catch (e) {
        await sleep(400 * Math.pow(2, attempt));
      }
    }
  }

  // Do not return the source text: that would write Vietnamese into a foreign
  // locale and show up as a "Vietnamese fallback" in that language.
  throw new Error("translation unavailable");
}

export async function translateText(text, target, source = "vi") {
  if (!text) return text;

  const srcCode = LINGVA_LANG[source] || String(source).toLowerCase();
  const tgtCode = LINGVA_LANG[target] || String(target).toLowerCase();
  if (!srcCode || !tgtCode || srcCode === tgtCode) return text;

  const chunks = splitChunks(String(text), 350);
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    const r = await translateChunk(chunks[i], target, source);
    results.push(r);
    if (i < chunks.length - 1) await sleep(250);
  }
  return results.join(" ");
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
      delete cache[key];
    }
    await sleep(250);
  }

  saveCache(targetLang, cache);
  return {
    translated: done,
    missing: missing.length,
    total: Object.keys(viDict).length,
    cached: Object.keys(cache).length,
  };
}