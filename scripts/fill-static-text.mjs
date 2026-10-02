// Writes the Vietnamese copy straight into index.html for every data-i18n
// element. The storefront fills these in with JavaScript, which means a search
// engine or a link-preview bot that never runs JavaScript sees an empty page.
//
// This is a one-off migration, not part of the app: the markup is edited in
// place, then the file keeps the text until someone changes i18n.js.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(path.join(root, "public", "index.html"), "utf8");
const source = await readFile(path.join(root, "public", "i18n.js"), "utf8");

const vi = source.slice(source.indexOf("vi: {"), source.indexOf("en: {"));
const dictionary = {};
for (const match of vi.matchAll(/'([\w.]+)':\s*'((?:[^'\\]|\\.)*)'/g)) {
  dictionary[match[1]] = match[2].replace(/\\'/g, "'").replace(/\\n/g, "\n");
}

const escapeText = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let filled = 0;
let missing = [];
// Only elements that are currently empty get text. An element that already
// carries copy was edited on purpose and is left alone.
const updated = html.replace(/(<(?:span|p|h1|h2|h3|a|button|summary|li|div)[^>]*\bdata-i18n="([\w.]+)"[^>]*>)(\s*)(<\/\1?[^>]*>)?/g,
  (match, open, key, gap, close) => {
    if (gap.trim()) return match;
    const text = dictionary[key];
    if (text === undefined) { missing.push(key); return match; }
    filled += 1;
    return `${open}${escapeText(text)}${close || ""}`;
  });

await writeFile(path.join(root, "public", "index.html"), updated, "utf8");
console.log(`Da dien ${filled} phan tu.`);
if (missing.length) console.log(`Không tìm thấy trong i18n.js: ${[...new Set(missing)].join(", ")}`);
console.log(`Con lai phan tu rong: ${(updated.match(/data-i18n="[\w.]+"[^>]*>\s*</g) || []).length}`);
