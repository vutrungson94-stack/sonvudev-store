// The categories, and the one rule that turns whatever the owner typed into one
// of them.
//
// The catalogue is typed by hand in the admin panel, so a category can arrive
// in a form the dictionaries do not know: the production catalogue had
// "Utility" (English, singular) next to "Tiện ích", and the Chinese homepage
// printed the filter row as "全部 | 工具 | 实用工具 | Utility" — one filter in
// English among three translated ones, on every locale, with nothing in the
// build to say so.
//
// The canonical list is here, and the mapping is derived from it rather than
// written as a second list of aliases: a raw value is matched to a canonical
// category by its Vietnamese key, by its English label, or by the same label
// with the plural folded ("Utility" ~ "Utilities").
//
// Anything that matches nothing is left exactly as the owner typed it. An
// unknown category shown verbatim is honest; one silently mapped to a
// neighbouring category would not be.
export const CATEGORY_EN = {
  "Công cụ": "Tools",
  "Tiện ích": "Utilities",
  "Phần mềm": "Software",
  "Khác": "Other",
};

// Folds the shapes a word takes in a category field: case, spaces, and the
// plural. "Utility" and "Utilities" are the same category; "Tiện ích" and
// "tiện ích" are the same word.
const fold = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/\s+/g, " ")
  .replace(/ies$/, "y")
  .replace(/es$/, "")
  .replace(/s$/, "");

/**
 * The canonical (Vietnamese) category key for a raw catalogue value.
 *
 * @param {string} raw the value as typed in the admin panel
 * @returns {string} the canonical key, or the raw value when it matches nothing
 */
export const normaliseCategory = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return value;
  if (CATEGORY_EN[value]) return value;
  const byEnglish = Object.entries(CATEGORY_EN).find(([, en]) => en === value);
  if (byEnglish) return byEnglish[0];
  const folded = fold(value);
  const loose = Object.entries(CATEGORY_EN).find(([vi, en]) => fold(en) === folded || fold(vi) === folded);
  return loose ? loose[0] : value;
};
