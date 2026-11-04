// Static parser for the DICT object inside public/i18n.js.
//
// i18n.js cannot be imported in Node (it touches window/document/localStorage),
// so completeness checks parse the source text instead of executing it.
// The scanner is a small state machine: it understands // and /* */ comments,
// single/double quoted strings with backslash escapes, and template literals
// including nested ${ ... } expressions. Braces inside any of those do not
// count towards depth, so Vietnamese prose containing braces cannot fool it.
//
// Usage:
//   import { parseDict } from "./lib/i18n-dict.mjs";
//   const dict = parseDict(source); // Map<lang, string[]>

function skipLineComment(src, i) {
  const nl = src.indexOf("\n", i + 2);
  return nl === -1 ? src.length : nl + 1;
}

function skipBlockComment(src, i) {
  const end = src.indexOf("*/", i + 2);
  if (end === -1) throw new Error("Unterminated block comment in DICT");
  return end + 2;
}

function skipQuoted(src, i, quote) {
  let k = i + 1;
  while (k < src.length) {
    const ch = src[k];
    if (ch === "\\") { k += 2; continue; }
    if (ch === quote) return k + 1;
    k++;
  }
  throw new Error("Unterminated string literal in DICT");
}

function skipTemplate(src, i) {
  let k = i + 1;
  while (k < src.length) {
    const ch = src[k];
    if (ch === "\\") { k += 2; continue; }
    if (ch === "`") return k + 1;
    if (ch === "$" && src[k + 1] === "{") {
      k = findMatchingBrace(src, k + 1) + 1;
      continue;
    }
    k++;
  }
  throw new Error("Unterminated template literal in DICT");
}

/**
 * Return the index just past the brace that closes the one at `openIdx`.
 */
export function findMatchingBrace(src, openIdx) {
  if (src[openIdx] !== "{") throw new Error("findMatchingBrace expects '{'");
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue; }
    if (ch === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue; }
    if (ch === "'" || ch === '"') { i = skipQuoted(src, i, ch); continue; }
    if (ch === "`") { i = skipTemplate(src, i); continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  throw new Error("Unbalanced braces in DICT");
}

function isIdentStart(ch) {
  return /[A-Za-z_$]/.test(ch);
}
function isIdentChar(ch) {
  return /[A-Za-z0-9_$-]/.test(ch);
}

function readIdentifier(src, i) {
  let k = i;
  while (k < src.length && isIdentChar(src[k])) k++;
  return { text: src.slice(i, k), end: k };
}

function skipWsAndComments(src, i) {
  let k = i;
  while (k < src.length) {
    const ch = src[k];
    if (/\s/.test(ch)) { k++; continue; }
    if (ch === "/" && src[k + 1] === "/") { k = skipLineComment(src, k); continue; }
    if (ch === "/" && src[k + 1] === "*") { k = skipBlockComment(src, k); continue; }
    break;
  }
  return k;
}

/**
 * Split the DICT object literal into its top-level language sections.
 * Returns an array of { lang, start, end } where start/end are the indices of
 * the section's braces inside `src`.
 */
function splitSections(src, dictOpen, dictClose) {
  const sections = [];
  let i = dictOpen + 1;
  while (i < dictClose) {
    const ch = src[i];
    if (/\s/.test(ch) || ch === ",") { i++; continue; }
    if (ch === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue; }
    if (ch === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue; }

    let lang = null;
    if (isIdentStart(ch)) {
      const { text, end } = readIdentifier(src, i);
      lang = text;
      i = end;
    } else if (ch === "'" || ch === '"') {
      const end = skipQuoted(src, i, ch);
      lang = src.slice(i + 1, end - 1);
      i = end;
    } else {
      // Unknown token at top level: skip one char and keep scanning.
      i++;
      continue;
    }

    i = skipWsAndComments(src, i);
    if (src[i] !== ":") continue;
    i = skipWsAndComments(src, i + 1);
    if (src[i] !== "{") {
      // Not a language block (e.g. a helper call). Skip to the next delimiter-ish spot.
      continue;
    }
    const end = findMatchingBrace(src, i);
    sections.push({ lang, start: i, end });
    i = end + 1;
  }
  return sections;
}

/**
 * Extract the keys declared at depth 1 inside a language section.
 */
function extractSectionKeys(src, section) {
  const keys = [];
  let i = section.start + 1;
  const end = section.end;
  while (i < end) {
    const ch = src[i];
    if (/\s/.test(ch) || ch === ",") { i++; continue; }
    if (ch === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue; }
    if (ch === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue; }
    if (ch === "'" || ch === '"') {
      const strEnd = skipQuoted(src, i, ch);
      const key = src.slice(i + 1, strEnd - 1);
      const colon = skipWsAndComments(src, strEnd);
      if (src[colon] === ":") keys.push(unescapeKey(key));
      i = strEnd;
      continue;
    }
    if (ch === "`") { i = skipTemplate(src, i); continue; }
    if (ch === "{") { i = findMatchingBrace(src, i) + 1; continue; }
    if (ch === "[") { // unexpected, but skip an array literal safely-ish
      let depth = 0;
      while (i < end && !(depth === 0 && src[i] === "]")) {
        if (src[i] === "[") depth++;
        if (src[i] === "]") depth--;
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return keys;
}

function unescapeKey(key) {
  return key.replace(/\\(.)/g, "$1");
}

/**
 * Parse public/i18n.js and return a Map<lang, string[]> of dictionary keys.
 * Values are not evaluated; only key names are collected.
 */
export function parseDict(source) {
  const anchor = source.indexOf("const DICT");
  if (anchor === -1) throw new Error("DICT declaration not found in i18n.js");
  const eq = source.indexOf("=", anchor);
  const open = source.indexOf("{", eq);
  if (eq === -1 || open === -1) throw new Error("DICT assignment not found in i18n.js");
  const close = findMatchingBrace(source, open);
  const sections = splitSections(source, open, close);
  const dict = new Map();
  for (const section of sections) {
    dict.set(section.lang, extractSectionKeys(source, section));
  }
  return dict;
}
