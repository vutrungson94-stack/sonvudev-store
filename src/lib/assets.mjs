// One answer to "which version of this file should the browser fetch?".
//
// The problem this solves: the server answers /app.js and /styles.min.css with
// `Cache-Control: public, max-age=31536000`, but the pages that link them did
// not say which version they meant. A browser that visited the site before a
// deploy therefore kept using the old file for a year, and the deploy that
// fixed a bug was invisible to exactly the visitors the bug was hurting.
//
// The version is the content hash of the file, computed by the build and
// written to public/asset-manifest.json. Two properties matter:
//
//   - the same bytes always produce the same version, so the version changes
//     exactly when the file changes, and never otherwise;
//   - the build writes the manifest and the server reads it, so the page and
//     the file it points at can never disagree.
//
// Without a manifest — a development checkout, a test run — the URL is
// returned unchanged. That is deliberate: the query string only buys something
// when something is there to bust a cache, and an invented version in dev
// would make every local URL differ from the deployed one for no reason.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The public directory of the running artifact. src/lib -> src -> project root
// -> public. In a deployed artifact the same expression points at the packaged
// public/ directory, which is where the build wrote the manifest.
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

/** @type {Record<string, string> | null} */
let manifest = null;
try {
  const parsed = JSON.parse(readFileSync(path.join(publicDir, "asset-manifest.json"), "utf8"));
  if (parsed && typeof parsed === "object") manifest = parsed;
} catch {
  // No manifest: development checkout, or a test run. See the note above.
  manifest = null;
}

/**
 * The URL a page should use for a first-party asset.
 *
 * @param {string} name absolute path, e.g. "/styles.min.css"
 * @returns {string} the same path, with ?v=<content hash> when one is known
 */
export function assetUrl(name) {
  const key = name.startsWith("/") ? name : `/${name}`;
  const version = manifest?.[key];
  return version ? `${key}?v=${version}` : key;
}

/**
 * Whether a versioned asset is being served, i.e. whether the response may be
 * cached as immutable.
 *
 * @param {string|undefined} url the request URL
 * @returns {boolean}
 */
export function isVersionedRequest(url) {
  return /[?&]v=[0-9a-f]{6,}/i.test(String(url || ""));
}
