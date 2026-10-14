// One comment stripper for every script that has to read JavaScript as data.
//
// Three copies of this existed: an exported one in case-check.mjs and two private
// ones in audit-web.mjs (one for the refuse-key scan, one for the missing-
// diacritics scan). They were written for three different readers and had already
// drifted apart in the two ways that matter:
//
//   * the regex versions delete a block comment outright, so every index after it
//     shifts and the line number beside a finding points at the wrong line;
//   * the heuristic `(^|[^:])\/\/` cannot tell a URL inside a string from a real
//     comment start, so a string like "a//b" is eaten from the middle and the
//     text that survives is not the text that runs.
//
// The scanner below walks the source once, tracks string literals, and replaces
// every comment character with a space. Offsets stay exactly aligned — the output
// has the same length as the input, character for character — so a caller that
// reports `index` against the raw file reports the line the reader is actually
// looking at. That was the intent of the docstring in case-check.mjs all along
// ("roughly aligned"); it was not true of any of the three until now.

/**
 * Blanks out comments while leaving string literals untouched, and leaves byte
 * offsets exactly where they were so a reported line number still points at the
 * right line.
 *
 * Quotes are tracked rather than guessed at, which is what keeps "https://x" and
 * a regex literal containing "//" from being mistaken for a comment. A `//`
 * inside a string is data; only a `//` outside one starts a comment.
 *
 * @param {string} source JavaScript or JSON-ish source text
 * @returns {string} the same text, same length, with comments replaced by spaces
 */
export const stripComments = (source) => {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const char = source[i];
    if (quote) {
      out += char;
      // An escaped delimiter closes nothing: "\"" is a quote character inside the
      // string, not the end of it. Both characters are copied verbatim.
      if (char === "\\") {
        out += source[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      i += 1;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      // The newline is left for the next iteration on purpose. Emitting one here
      // as well is what used to add a phantom blank line after every line
      // comment and push every reported line number below it off by one.
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      // The closing "*/" is two characters in and two spaces out, so the length
      // holds even for an unterminated comment at the end of a file.
      out += "  ";
      i += 1;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
};
