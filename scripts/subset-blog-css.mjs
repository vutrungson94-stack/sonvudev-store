// Blog pages carried the whole storefront stylesheet inlined: ~70 KB minified,
// of which a blog page matched about a fifth. The rest — the product grid, the
// checkout, the admin panel, the 404 page — is dead weight on a content page and
// Lighthouse charges it as "unused CSS" (12–14 KiB gzipped on a phone).
//
// This writes public/blog.min.css: the same declarations, filtered to the
// selectors the blog actually renders. There is no hand-written copy of any
// rule — the class list comes from rendering the real pages, so a class added to
// a template is included on the next build, and test/blog.test.js fails if one
// arrives without its rule. The single source of truth is still public/styles.css.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBlogPosts, renderBlogIndex, renderBlogPost } from "../src/blog.js";
import { EXTRA_BLOG_LOCALES } from "../src/blog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "public", "styles.css");
const targetPath = path.join(root, "public", "blog.min.css");

// vi and en carry their own blog UI dictionaries; the rest read the same
// templates through EXTRA_BLOG_LOCALES.
const LOCALES = ["vi", "en", ...EXTRA_BLOG_LOCALES];

const css = await readFile(sourcePath, "utf8");

// Render every blog surface in every supported language, then read the class
// names back out of the HTML. Rendering is the only list that cannot drift.
const posts = loadBlogPosts();
const pages = [];
for (const code of LOCALES) {
  pages.push(renderBlogIndex(posts, code));
  for (const post of posts) pages.push(renderBlogPost(post, code));
}
const used = new Set();
for (const page of pages) {
  const re = /class="([^"]+)"/g;
  let match;
  while ((match = re.exec(page))) {
    for (const name of match[1].split(/\s+/)) {
      if (name && !name.includes("${")) used.add(name);
    }
  }
}

// Selectors that do not name a class still matter: the blog inherits the base
// typography, the brand tokens, the footer and the language control.
const BASE = /^(html|body|\*|:root|a\b|button\b|input\b|select\b|textarea\b|table\b|thead\b|tbody\b|tr\b|th\b|td\b|h1\b|h2\b|h3\b|h4\b|h5\b|h6\b|p\b|ul\b|ol\b|li\b|code\b|pre\b|blockquote\b|img\b|figure\b|header\b|footer\b|nav\b|main\b|article\b|section\b|small\b|strong\b|em\b|label\b|form\b|::selection|::placeholder|:focus|\[hidden\]|\[disabled\]|\[aria-current)/;
const usesUsedClass = (selector) => [...used].some((name) => selector.includes(`.${name}`));
const matches = (selector) => BASE.test(selector.trim()) || usesUsedClass(selector);

// Split the stylesheet into top-level blocks. @media/@supports keep only the
// inner rules that match; @font-face and @keyframes are kept whole — a keyframe
// name is referenced from a rule, not matched by a selector.
const blocks = [];
let depth = 0;
let start = 0;
for (let i = 0; i < css.length; i += 1) {
  if (css[i] === "{") depth += 1;
  else if (css[i] === "}") {
    depth -= 1;
    if (depth === 0) {
      blocks.push(css.slice(start, i + 1));
      start = i + 1;
    }
  }
}
const selectorOf = (block) => block
  .slice(0, block.indexOf("{"))
  // A rule preceded by its documentation comment would otherwise be tested with
  // the comment as part of the selector, and a font-face attached to the file
  // header was dropped exactly that way.
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .trim();

const kept = [];
for (const block of blocks) {
  const selector = selectorOf(block);
  if (selector.startsWith("@font-face") || selector.startsWith("@keyframes")) {
    kept.push(block);
    continue;
  }
  if (selector.startsWith("@media") || selector.startsWith("@supports")) {
    const inner = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
    const innerBlocks = [];
    let innerDepth = 0;
    let innerStart = 0;
    for (let i = 0; i < inner.length; i += 1) {
      if (inner[i] === "{") innerDepth += 1;
      else if (inner[i] === "}") {
        innerDepth -= 1;
        if (innerDepth === 0) {
          innerBlocks.push(inner.slice(innerStart, i + 1));
          innerStart = i + 1;
        }
      }
    }
    const keptInner = innerBlocks.filter((rule) => matches(selectorOf(rule)));
    if (keptInner.length) kept.push(`${selector}{${keptInner.join("")}}`);
    continue;
  }
  if (matches(selector)) kept.push(block);
}

// Same textual minifier as scripts/minify-css.mjs, applied to the subset.
let out = "";
let inString = null;
const text = kept.join("");
for (let i = 0; i < text.length; i += 1) {
  const char = text[i];
  const next = text[i + 1];
  if (inString) {
    out += char;
    if (char === "\\") { out += text[++i]; continue; }
    if (char === inString) inString = null;
    continue;
  }
  if (char === "/" && next === "*") {
    const end = text.indexOf("*/", i + 2);
    if (end === -1) break;
    i = end + 1;
    out += " ";
    continue;
  }
  if (char === '"' || char === "'") {
    inString = char;
    out += char;
    continue;
  }
  out += char;
}
out = out.replace(/\s+/g, " ");
out = out.replace(/;\s*}/g, "}");
out = out.replace(/\s*([{}:,;>+~])\s*/g, "$1");
out = out.replace(/}(?=[@.a-z])/g, "}\n");
out = `${out.trim()}\n`;

await writeFile(targetPath, out, "utf8");
console.log(`[css:blog] ${targetPath} (${out.length} bytes, ${used.size} class(es) used)`);
