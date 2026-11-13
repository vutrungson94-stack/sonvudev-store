// Minifies the browser scripts that the storefront actually downloads.
//
// The CSS has had a minified copy for a long time (scripts/minify-css.mjs). The
// JavaScript did not, and Lighthouse charged the site for it: /app.js was
// 45.9 KB raw and public/i18n.js was 127.2 KB raw — the two largest scripts on
// the busiest page.
//
// Why the artifact and not public/: the source of every script in public/ is
// read by the audit, the metrics and the tests — the dictionary in
// public/i18n.js is parsed as text, and public/app.js is executed in a stubbed
// DOM. A minified copy in public/ would make all of those read a different
// file than the one that ships, and the drift check would report it. So the
// source stays readable and the build writes the minified bytes into the
// artifact it is about to deploy.
//
// Identifiers are not renamed. public/app.js and public/i18n.js publish
// globals (window.I18N, window.SVDFormat, window.SVDApp) and the tests and the
// audit look those up by name; renaming a local is safe, renaming a published
// name is not. Whitespace and syntax are, which is where most of the bytes
// are.
import { transform } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARTIFACT_PATH } from "./lib/artifact.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The directory to minify. The build points this at the artifact; the default
// is the same directory, so running this by hand reproduces what a deploy
// ships.
const dirFlag = process.argv.indexOf("--dir");
const targetDir = dirFlag !== -1
  ? path.resolve(process.argv[dirFlag + 1])
  : path.join(root, ARTIFACT_PATH, "public");

// The two files Lighthouse named, plus admin.js: the panel is its own page, and
// Lighthouse charges it ~4 KiB of whitespace and comments ("Minify JavaScript").
// related.js, format.js and the rest are smaller and are not on the critical path
// of a storefront visit.
const TARGETS = ["app.js", "i18n.js", "admin.js"];

let saved = 0;
for (const name of TARGETS) {
  const file = path.join(targetDir, name);
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    console.error(`[js:minify] ${name}: ${error.message}`);
    process.exit(1);
  }
  const result = await transform(source, {
    loader: "js",
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,
    legalComments: "none",
    sourcefile: name,
  });
  await writeFile(file, result.code, "utf8");
  saved += source.length - result.code.length;
  console.log(`[js:minify] ${name}: ${source.length} -> ${result.code.length} bytes`);
}

console.log(`[js:minify] ${TARGETS.length} file(s) minified, ${saved} bytes smaller.`);
