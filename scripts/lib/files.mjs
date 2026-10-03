// One answer to "which files are part of this project", for every tool that needs
// to walk it.
//
// This existed three times and the three copies disagreed, which made a gate's
// verdict depend on which machine ran it:
//
//   lint-web.mjs    skipped build-reports and logs but NOT .tmp-* and NOT
//                   publish-output
//   build-web.mjs   skipped .tmp-* and node_modules but NOT publish-output — so
//                   the build syntax-checked the 41 JavaScript files it had just
//                   written, and build-reports/web-build.json recorded 122
//                   instead of 81
//   metrics.mjs     skipped everything dot-prefixed plus publish-output
//
// The visible symptom was `npm run lint` reporting 129 files on a developer's
// machine and a different number in CI, for identical source. A gate that answers
// differently depending on who ran it is not a gate, it is an observation — and
// the one thing this repository's process is built on is that a check means the
// same thing everywhere.
//
// So the list below is the only one. The rules, and why each exists:
//
//   node_modules         dependencies, not source
//   publish-output       the build's own output; walking it means the build
//                        checks its previous run and the artifact grows a
//                        publish-output inside itself on every build
//   build-reports, logs  generated output, committed to neither
//   data                 local runtime state (orders.json, outbox/)
//   .tmp-*               scratch files, by naming convention
//   dot-directories      .git, .gbuildcache, and any editor or tool cache
//
// Everything else is source, including deploy/, supabase/, cloudflare/ and the
// root dotfiles, which is what makes `npm run lint` on a fresh clone and on a
// working machine return the same number.
import { readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Whether a directory should be left out of a project walk.
 *
 * Split by directory and file on purpose. An earlier version applied one rule to
 * both, and because it tested `name.startsWith('.')` on every entry it silently
 * skipped dot *files* as well — .env.example, .gitignore, .gitattributes — which
 * is how a build can report 68 packaged files while 69 are on disk. A file named
 * .env.example is documentation the deploy needs; a directory named .git is not
 * something a gate should be reading.
 *
 * @param {string} name a single directory name
 * @returns {boolean} true when the directory is not part of the project
 */
export const isExcludedDir = (name) => (
  name === 'node_modules'
  || name.startsWith('node_modules_stale_')
  || name === 'publish-output'
  || name === 'build-reports'
  || name === 'logs'
  || name === 'data'
  // Every dot-directory. .git and .gbuildcache are the ones that matter, but
  // listing one tool's cache here is a losing game; the rule is the prefix.
  || name.startsWith('.')
);

/**
 * Whether a file should be left out of a project walk, regardless of name.
 *
 * Only stale dependency directories, which the rule above already covers as
 * directories. Kept as a separate function so a caller that walks a single
 * directory can ask the same question the walker asks.
 *
 * @param {string} name a single file name
 * @returns {boolean} true when the file should be skipped
 */
export const isExcludedFile = (name) => name.startsWith('.tmp-');

/**
 * Recursively collects files under a directory, skipping generated directories.
 *
 * @param {string} dir absolute path to start from
 * @param {{ extensions?: string[] }} [options]
 *   extensions when given, only files ending in one of those suffixes are kept
 * @returns {Promise<string[]>} absolute paths, in readdir order
 */
export const walkProjectFiles = async (dir, options = {}) => {
  const { extensions } = options;
  const out = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!isExcludedDir(entry.name)) await visit(path.join(current, entry.name));
      } else {
        if (isExcludedFile(entry.name)) continue;
        if (!extensions || extensions.some((ext) => entry.name.endsWith(ext))) out.push(path.join(current, entry.name));
      }
    }
  };
  await visit(dir);
  return out;
};

/** The extensions every syntax-checking gate cares about. */
export const JS_EXTENSIONS = ['.js', '.mjs', '.cjs'];
