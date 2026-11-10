// The stylesheet, inlined.
//
// Why it is inlined: Lighthouse reports `/styles.min.css` as a render-blocking
// request, and the saving it estimates (70-150 ms on a slow link) is the time
// the browser spends waiting for a file before it can paint anything.
//
// The obvious alternative — a small critical CSS plus the rest loaded in
// parallel — was implemented and measured, and rejected: the layout shift became
// unstable (0.02 in one run, 0.22 in the next) because the full stylesheet
// arrived after the first paint and moved things. The numbers are in
// docs/EXPERIMENT-ROLLOUT-PLAYBOOK.md.
//
// So the whole stylesheet goes in the head instead. There is then no
// render-blocking request at all, and nothing arrives late to shift the page:
// the first paint is the final layout.
//
// What it costs: the CSS is 16.3 KB gzipped, and it is part of the HTML, which
// the browser caches for five minutes (the pages carry prices, so the HTML
// cannot be cached for a year). A visitor who browses for ten minutes downloads
// it twice. What it saves: one round trip on every first paint, and the
// render-blocking finding itself.
//
// The file on disk is still the source of truth and is still built by
// scripts/minify-css.mjs. This module only reads the built file and puts it in
// the page.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

let css = "";
try {
  css = readFileSync(path.join(publicDir, "styles.min.css"), "utf8").trim();
} catch {
  // No built stylesheet (a checkout that has not run the build). The page then
  // keeps its stylesheet link, which is slower but correct.
  css = "";
}

/**
 * Replaces the stylesheet link with the stylesheet itself.
 *
 * @param {string} html the rendered page
 * @returns {string}
 */
export const inlineStyles = (html) => {
  if (!css) return html;
  return html.replace(
    /<link rel="stylesheet" href="\/styles\.min\.css[^"]*">/g,
    `<style id="site-styles">${css}</style>`,
  );
};
