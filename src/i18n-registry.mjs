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
 * Get locale config by code.
 */
export function getLocale(code) {
  return SUPPORTED_LOCALES.find((l) => l.code === code) || null;
}

/**
 * Get fallback chain for a language: [target, fallback, fallback-of-fallback, ...]
 */
export function getLocaleChain(code) {
  const chain = [];
  let current = code;
  while (current) {
    chain.push(current);
    const locale = getLocale(current);
    current = locale ? locale.fallback : null;
  }
  return chain;
}

/**
 * Check if a language code is supported (case-insensitive).
 */
export function isSupportedLocale(code) {
  const lower = String(code || "").toLowerCase();
  return LOCALE_CODES.some((c) => c.toLowerCase() === lower);
}

/**
 * Normalize a language tag to a supported locale (case-insensitive).
 * Falls back to FALLBACK_LOCALE ("en") for unknown tags; zh* maps to zh-CN.
 */
export function normalizeLocale(code) {
  if (!code) return FALLBACK_LOCALE;
  const lower = String(code).toLowerCase().split(";")[0].trim();
  const exact = LOCALE_CODES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split("-")[0];
  if (base === "zh") return "zh-CN";
  const byBase = LOCALE_CODES.find((c) => c.toLowerCase().split("-")[0] === base);
  return byBase || FALLBACK_LOCALE;
}
