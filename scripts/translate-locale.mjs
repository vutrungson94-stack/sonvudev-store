// Translation pipeline CLI - fills in missing keys of public/locales/<lang>.json
// by translating the Vietnamese source dictionary through the shared
// translation service (src/translate-service.mjs), which already backs the
// admin "translate now" endpoint. This script is a thin wrapper so operators
// can run the same pipeline from the command line; it keeps one code path for
// token protection, chunking and retry instead of duplicating it here.
//
// Usage:
//   npm run translate-locale ja
//   npm run translate-locale fr
//   node scripts/translate-locale.mjs ja
//
// Only keys missing from public/locales/<lang>.json are translated.
// Existing translations are never overwritten. Dynamic (non-literal) dictionary
// values are reported and skipped for manual translation.

import { translateMissingKeys, isConfigured } from "../src/translate-service.mjs";

const positional = process.argv.slice(2).find((a) => !a.startsWith("--"));
const flagged = process.argv.find((a) => a.startsWith("--lang="))?.split("=")[1];
const TARGET_LANG = positional || flagged;

if (!TARGET_LANG) {
  console.error("Usage: npm run translate-locale <target-language>   (e.g. ja, fr, de)");
  process.exit(1);
}

if (!isConfigured()) {
  console.error("[translate-locale] Translation service is not configured");
  process.exit(1);
}

const result = await translateMissingKeys(TARGET_LANG);
console.log(
  `[translate-locale] ${TARGET_LANG}: translated=${result.translated}` +
  (result.missing != null ? ` missing=${result.missing}` : "") +
  ` total=${result.total} cached=${result.cached}`
);
process.exit(0);
