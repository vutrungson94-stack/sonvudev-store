import { readFileSync, writeFileSync } from "node:fs";

const viRaw = readFileSync("public/i18n.js", "utf8");
const m = viRaw.match(/vi:\s*\{([\s\S]*?)\n\s*},\s*\n\s*en:/);
const body = m[1];
const viDict = {};
let matched = 0;
for (const line of body.split("\n")) {
  const l = line.trim();
  if (!l || l.startsWith("//")) continue;
  const km = l.match(/^'([^']+)'\s*:(.+?)\s*,?\s*$/);
  if (!km) continue;
  matched += 1;
  let v = km[2].replace(/,\s*$/, "").trim();
  if (v.startsWith("`") && v.endsWith("`")) v = v.slice(1, -1);
  else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  else if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  else v = null;
  if (v !== null) viDict[km[1]] = v;
}
writeFileSync("scripts/vi_dict.json", JSON.stringify(viDict, null, 2));
console.log("Lines matched:", matched, "String values:", Object.keys(viDict).length);

