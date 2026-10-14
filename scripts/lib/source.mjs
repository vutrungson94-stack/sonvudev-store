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
// Two more ways it used to stop stripping, both of them invisible for a long time
// because what survived was English prose rather than Vietnamese:
//
//   * a regex literal was not recognised, so a quote inside a character class —
//     `/[&<>"']/g`, the HTML escaper's own pattern — turned the quote tracker
//     inside out and every comment after that line was read as code;
//   * a template literal containing a nested one, which is ordinary in the page
//     renderer, was closed by the inner backtick, and the tracker was then out of
//     step for the rest of the file.
//
// The scanner below walks the source once with a stack of frames, so a template's
// `${...}` is entered and left on its own terms instead of by counting backticks.
// It replaces every comment character with a space and leaves every offset where
// it was, so a caller that reports `index` against the raw file reports the line
// the reader is actually looking at. That was the intent of the docstring in
// case-check.mjs all along ("roughly aligned"); it was not true of any of the
// five until now.

/**
 * Blanks out comments while leaving string, template and regex literals
 * untouched, and leaves byte offsets exactly where they were so a reported line
 * number still points at the right line.
 *
 * A `/` is division or the start of a regex depending on what came before it.
 * That one question cannot be answered without a parser, so the guess is made
 * reversible: a slash that does not close a literal before the end of its line
 * is rewound and treated as an ordinary character. A wrong guess then costs
 * nothing, which is the only safe property a heuristic in a shared helper can
 * have.
 *
 * @param {string} source JavaScript or JSON-ish source text
 * @returns {string} the same text, same length, with comments replaced by spaces
 */
export const stripComments = (source) => {
  const out = [];
  // One frame per thing we are currently inside. A base 'code' frame is always at
  // the bottom, so a file with unbalanced literals still terminates.
  const stack = [{ kind: "code" }];
  const top = () => stack[stack.length - 1];
  const push = (frame) => stack.push(frame);
  const pop = () => { if (stack.length > 1) stack.pop(); };
  const emit = (text) => { out.push(text); };

  // What a `/` means depends on the token before it, and only in code. Both are
  // tracked here rather than recomputed by walking the output, because the output
  // is an array of chunks and a backtrack over it would be a second scanner.
  let lastSignificant = "";
  let lastIdentifier = "";
  // Words that are followed by an expression. `return /re/` ends in a letter, so
  // the last character alone calls that slash division — and a quote inside the
  // regex then desyncs everything after it.
  const ENDS_EXPRESSION = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "case", "do", "else", "yield", "await", "throw",
  ]);

  let i = 0;
  while (i < source.length) {
    const frame = top();
    const char = source[i];

    if (frame.kind === "str") {
      emit(char);
      // An escaped delimiter closes nothing: "\"" is a quote character inside the
      // string, not the end of it. Both characters are copied verbatim.
      if (char === "\\") { emit(source[i + 1] ?? ""); i += 2; continue; }
      if (char === frame.quote) pop();
      i += 1;
      continue;
    }

    if (frame.kind === "tpl") {
      emit(char);
      if (char === "\\") { emit(source[i + 1] ?? ""); i += 2; continue; }
      if (char === "`") { pop(); i += 1; continue; }
      // An interpolation is real code again, and it can contain a nested
      // template of its own. That is the shape this whole frame stack exists
      // for: counting backticks closes a template on its own nested one.
      if (char === "$" && source[i + 1] === "{") {
        emit("{");
        i += 2;
        push({ kind: "tplExpr", brace: 0 });
        continue;
      }
      i += 1;
      continue;
    }

    if (frame.kind === "tplExpr") {
      if (char === "}") {
        emit(char);
        i += 1;
        // Only the brace that closes the interpolation hands control back to the
        // template. A brace belonging to an object literal inside it does not.
        if (frame.brace === 0) pop(); else frame.brace -= 1;
        continue;
      }
      if (char === "{") { frame.brace += 1; emit(char); i += 1; continue; }
      // Anything else inside an interpolation is ordinary code, handled below.
    }

    // --- ordinary code from here ---
    if (char === "'" || char === '"') { push({ kind: "str", quote: char }); emit(char); i += 1; continue; }
    if (char === "`") { push({ kind: "tpl" }); emit(char); i += 1; continue; }

    if (char === "/" && source[i + 1] === "/") {
      // The newline is left for the next iteration on purpose. Emitting one here
      // as well is what used to add a phantom blank line after every line comment
      // and push every reported line number below it off by one.
      while (i < source.length && source[i] !== "\n") { emit(" "); i += 1; }
      continue;
    }

    if (char === "/" && source[i + 1] === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        emit(source[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      // The closing "*/" is two characters in and two spaces out, so the length
      // holds even for an unterminated comment at the end of a file.
      emit("  ");
      i += 2;
      continue;
    }

    if (char === "/") {
      // `}` is deliberately absent from this set. `}` followed by `/**` is the
      // shape of a JSDoc block above an export, which is how most functions here
      // are written; calling that slash division leaves the `*` to open a block
      // comment that never ends.
      const afterValue = /[A-Za-z0-9_$)\]]/.test(lastSignificant) && !ENDS_EXPRESSION.has(lastIdentifier);
      if (afterValue) {
        emit(char);
        lastSignificant = char;
        lastIdentifier = "";
        i += 1;
        continue;
      }
      let scan = i + 1;
      let inClass = false;
      let closed = false;
      while (scan < source.length && source[scan] !== "\n") {
        const c = source[scan];
        if (c === "\\") { scan += 2; continue; }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) { closed = true; scan += 1; break; }
        scan += 1;
      }
      if (!closed) {
        emit(char);
        lastSignificant = char;
        lastIdentifier = "";
        i += 1;
        continue;
      }
      // Everything up to the closing slash is data, a quote inside a character
      // class included. Flags after it are data too.
      emit(source.slice(i, scan));
      i = scan;
      while (i < source.length && /[a-z]/.test(source[i])) { emit(source[i]); i += 1; }
      lastSignificant = "/";
      lastIdentifier = "";
      continue;
    }

    emit(char);
    if (!/\s/.test(char)) {
      lastSignificant = char;
      lastIdentifier = /[A-Za-z0-9_$]/.test(char) ? lastIdentifier + char : "";
    } else if (char === "\n") {
      // A newline ends an identifier, but not a value: `foo\n  /re/` is a regex
      // applied to foo, and treating the newline as a value boundary is what made
      // multi-line call sites misread.
      if (!/[A-Za-z0-9_$]/.test(lastSignificant)) lastIdentifier = "";
    }
    i += 1;
  }
  return out.join("");
};