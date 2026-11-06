// Single source of truth for i18n configuration.
//
// All language-related configuration must flow through this module.
// Adding a new language requires only adding an entry here - no code changes
// elsewhere.
//
// Structure:
//   code      - ISO 639-1 language code (used in URL paths: /fr/product/slug)
//   name      - Human-readable language name (displayed in language switcher)
//   fallback  - Fallback language code when translation is missing (always "en")
//   direction - Text direction: "ltr" or "rtl"

export const SUPPORTED_LOCALES = [
  { code: "vi", name: "Tiếng Việt", fallback: null, direction: "ltr" },
  { code: "en", name: "English", fallback: null, direction: "ltr" },
  { code: "de", name: "Deutsch", fallback: "en", direction: "ltr" },
  { code: "es", name: "Español", fallback: "en", direction: "ltr" },
  { code: "fr", name: "Français", fallback: "en", direction: "ltr" },
  { code: "ja", name: "日本語", fallback: "en", direction: "ltr" },
  { code: "zh-CN", name: "中文", fallback: "en", direction: "ltr" },
];

export const LOCALE_CODES = SUPPORTED_LOCALES.map((l) => l.code);
export const DEFAULT_LOCALE = "vi";
export const FALLBACK_LOCALE = "en";

/**
 * Recognizes a language tag (case-insensitive) or returns null when the shop
 * does not serve that language. Normalizing and recognizing are intentionally
 * different: an unknown browser language is not a request for English, but
 * app-layer call sites that truly need a fallback use normalizeLocale().
 */
function recognizedLocale(code) {
  if (!code) return null;
  const lower = String(code).toLowerCase().split(";")[0].trim();
  const exact = LOCALE_CODES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split("-")[0];
  if (base === "zh") return "zh-CN";
  return LOCALE_CODES.find((c) => c.toLowerCase().split("-")[0] === base) || null;
}

export function isSupportedLocale(code) {
  return Boolean(recognizedLocale(code));
}

/**
 * Normalize a language tag to a supported locale (case-insensitive).
 * Falls back to FALLBACK_LOCALE ("en") for unknown tags; zh* maps to zh-CN.
 */
export function normalizeLocale(code) {
  return recognizedLocale(code) || FALLBACK_LOCALE;
}
