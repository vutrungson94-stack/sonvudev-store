// Finds references whose capitalisation does not match the file on disk.
//
// Windows cannot see this class of bug at all. NTFS is case-insensitive, so
// `import ... from "./Config.js"` resolves to `config.js`, the import works, and
// it has worked on every machine that has ever run this repository. It then fails
// on the first Linux runner — which is where the code is deployed, and where the
// test suite has never run.
//
// Nothing else in this repository's gate can catch it, and that is the point:
// `node --check` does not resolve imports, the audit reads text rather than the
// filesystem, and `npm ci` never looks at a single line of application code. The
// test suite would catch it, but only once CI is green enough to run the tests —
// and CI is red for some other reason, so the tests never run. A failure here
// hides behind the failure it would have explained.
//
// Three details matter, and each of them is a way the obvious version of this
// script reports forty problems that are not problems:
//
//   Comments are stripped first. A path written in prose is documentation, and
//   an example in a doc comment is not an import. This file's own header names
//   "./Config.js" — the exact bug being hunted — and a checker that read it as
//   code would open by reporting itself.
//
//   HTML references are resolved the way a server resolves them. A leading slash
//   means the public root, not the file's own directory, so "/favicon.svg" is
//   public/favicon.svg. Resolving it against public/404.html looks for
//   public/404.html/favicon.svg and reports a missing file that exists.
//
// Only references with a file extension are checked. "/terms" is a route, not
//   a file, and a shop has routes. "{{site}}/about" is a template token the
//   renderer fills in. Neither is a case problem, and treating them as one
//   buries the real finding under noise nobody will read past.
//
// And in JavaScript only a case *mismatch* is reported, never a missing file.
// A regex cannot tell an import from a string that looks like one — this
// repository has `source.includes('from "./refuse.js"')` in it, a deliberate
// string used to detect whether a module imports refuse.js, and the obvious
// version of this script reported it as a broken import and failed. A missing
// import in JavaScript is loud anyway: the test suite cannot import the file.
// What only shows up on Linux is a file that *exists* under a different case,
// and that is the whole subject here.
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { walkProjectFiles } from './lib/files.mjs';

// Như audit-web.mjs: mặc định quét chính repo này, `--root <dir>` để quét
// một bản sao fixture trong test mà không cần copy cả script sang.
const rootFlag = process.argv.indexOf("--root");
const root = rootFlag > -1 && process.argv[rootFlag + 1]
  ? path.resolve(process.argv[rootFlag + 1])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Removes comments while keeping string literals, and keeping byte offsets
 * roughly aligned so a reported line number still points at the right place.
 *
 * A block comment becomes newlines of the same length rather than nothing, which
 * is what keeps the line arithmetic in the caller honest.
 *
 * @param {string} source JavaScript source
 * @returns {string} the same text with comments blanked out
 */
export const withoutComments = (source) => {
  let out = '';
  let quote = '';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      out += char;
      if (char === "\\") { out += source[i + 1] ?? ''; i += 1; continue; }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; out += char; continue; }
    if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") { out += " "; i += 1; }
      out += "\n";
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      out += "  ";
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
};

/** A reference that names a file, as opposed to a route or a template value. */
const NAMED_FILE = /\.[a-z0-9]{2,5}$/i;

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

/**
 * Checks every import and asset reference against the real directory listing.
 *
 * @param {string} [scanRoot] thư mục cần quét, mặc định là root của repo
 * @returns {Promise<{problems: Array<object>, checked: number, fileCount: number}>}
 */
export async function findCaseProblems(scanRoot = root) {
  const files = await walkProjectFiles(scanRoot, { extensions: [".js", ".mjs", ".cjs", ".html"] });

  // The real names, grouped by lower-cased directory so a lookup can find the
  // exact spelling without walking the tree again per reference.
  const realNames = new Map();
  for (const dir of ["public", "src", "scripts", "test"]) {
    const stack = [path.join(scanRoot, dir)];
    while (stack.length) {
      const current = stack.pop();
      let entries;
      try { entries = await readdir(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (entry.isDirectory()) { stack.push(path.join(current, entry.name)); continue; }
        const key = current.toLowerCase();
        if (!realNames.has(key)) realNames.set(key, new Map());
        realNames.get(key).set(entry.name.toLowerCase(), entry.name);
      }
    }
  }

  /** Resolves a path the way the server would, and reports a case mismatch. */
  const resolve = (fromFile, reference) => {
    const base = reference.startsWith("/")
      ? path.join(scanRoot, "public")
      : path.dirname(fromFile);
    const target = path.resolve(base, reference.replace(/^\//, ""));
    const table = realNames.get(path.dirname(target).toLowerCase());
    if (!table) return null;
    const real = table.get(path.basename(target).toLowerCase());
    if (!real) return "missing";
    return real === path.basename(target) ? null : real;
  };

  const problems = [];
  let checked = 0;

  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const source = file.endsWith(".html") ? raw : withoutComments(raw);

    const references = [];
    if (file.endsWith(".html")) {
      // Assets only. A path with no extension is a route, and every route on this
      // site is extensionless by design.
      for (const match of source.matchAll(/(?:href|src)="([^"#?]+)"/g)) {
        if (NAMED_FILE.test(match[1])) references.push({ reference: match[1], at: match.index });
      }
    } else {
      for (const match of source.matchAll(/(?:from|import)\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
        references.push({ reference: match[1], at: match.index });
      }
    }

    for (const { reference, at } of references) {
      if (reference.includes("<") || reference.includes("{{")) continue;
      checked += 1;
      const verdict = resolve(file, reference);
      if (verdict === null || verdict === "missing") continue;
      problems.push({
        file: path.relative(scanRoot, file),
        line: lineOf(raw, at),
        reference,
        verdict,
        absolute: path.relative(scanRoot, path.resolve(
          file.endsWith(".html") && reference.startsWith("/") ? path.join(scanRoot, "public") : path.dirname(file),
          reference.replace(/^\//, ""),
        )),
      });
    }
  }

  return { problems, checked, fileCount: files.length };
}

const { problems, checked, fileCount } = await findCaseProblems();
if (problems.length) {
  console.error(`[case] FAIL: ${problems.length} tham chiếu sai hoa/thường, trong ${checked} tham chiếu:`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}  ${p.reference}  — trên đĩa là "${p.verdict}"  (${p.absolute})`);
  }
  console.error("");
  console.error("Những cái này chạy được trên Windows vì ổ đĩa không phân biệt hoa/thường, và chết trên Linux.");
  process.exit(1);
}
console.log(`[case] PASS: ${checked} tham chiếu trong ${fileCount} file, tất cả khớp hoa/thường trên filesystem phân biệt case.`);
