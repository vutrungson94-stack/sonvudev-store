#!/usr/bin/env node
/**
 * i18n-add-lang.mjs
 *
 * Sinh ra một file template ngôn ngữ mới từ block `vi` trong public/i18n.js,
 * để bạn dịch sang ngôn ngữ khác (zh, ko, ja, ...) đầy đủ mọi key giống như
 * vi và en đã có.
 *
 *   node scripts/i18n-add-lang.mjs zh
 *   # ra scripts/i18n.lang.zh.template.json
 *
 * Sau đó:
 * 1. Mở file template, điền bản dịch vào mỗi value.
 * 2. Thêm khóa mới vào DICT trong public/i18n.js (ví dụ `zh: { ... }`).
 * 3. Thêm nút chọn ngôn ngữ vào <div data-lang-switch> trong các file public/*.html.
 *
 * Các giá trị chứa hàm (supportAddress(), host()) hoặc template literal
 * {{brandName}}, {{support}}, {{year}}, {{paymentWindowHours}} giữ nguyên
 * như trong vi — chúng là thông số cấu hình, không phải bản dịch.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const i18nPath = join(root, "public", "i18n.js");

const lang = process.argv[2];
if (!lang || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(lang)) {
  console.error("Usage: node scripts/i18n-add-lang.mjs <lang>");
  console.error('Example: node scripts/i18n-add-lang.mjs zh');
  process.exit(1);
}

if (!existsSync(i18nPath)) {
  console.error(`Not found: ${i18nPath}`);
  process.exit(1);
}

const src = readFileSync(i18nPath, "utf8");

// Tìm block `vi: { ... }` đầu tiên và tách nội dung nguyên bản của nó.
// Đoạn này thô nhưng đủ chính xác cho file i18n.js hiện có: các entry nằm trên
// một dòng và kết thúc bằng dấu phẩy, value là chuỗi đơn nháy hoặc template
// literal (backtick). Các dòng bình luận và key không có value bị bỏ qua.
const viBlock = src.match(/vi:\s*\{([\s\S]*?)\n\s*},\s*\n\s*en:/);
if (!viBlock) {
  console.error("Could not locate the `vi` dictionary block in i18n.js");
  process.exit(1);
}

const body = viBlock[1];

const entries = [];
const keyRe = /^\s*'([^']+)'\s*:\s*(.+?)\s*,?\s*$/;

for (const rawLine of body.split("\n")) {
  const line = rawLine.trim();
  if (!line || line.startsWith("//")) continue;
  const m = line.match(keyRe);
  if (!m) continue;
  const key = m[1];
  let value = m[2];

  // Chuẩn hóa value thành chuỗi đơn nháy (bỏ dấu phẩy cuối nếu có).
  value = value.replace(/,\s*$/, "");
  // Nếu là template literal backtick, giữ nguyên nội dung.
  if (value.startsWith("`") && value.endsWith("`")) {
    value = value.slice(1, -1);
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  } else if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  } else {
    // Có thể là hàm gọi (supportAddress()) — giữ nguyên làm placeholder.
    value = `<<FUNCTION:${value}>>`;
  }

  entries.push({ key, value });
}

// Loại trùng: giữ lần cuối cùng (giống như JS object literal).
const dedup = new Map();
for (const e of entries) dedup.set(e.key, e.value);

const out = {
  lang,
  source: "vi",
  note: "Dịch từng dòng. Giữ nguyên các token {{brandName}}, {{support}}, {{year}}, {{paymentWindowHours}} và các hàm <<FUNCTION:...>>.",
  entries: [...dedup.entries()].map(([key, value]) => ({ key, value })),
};

const outPath = join(root, `scripts/i18n.lang.${lang}.template.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

console.log(`Đã viết ${outPath}`);
console.log(`Tổng số key cần dịch: ${out.entries.length}`);
console.log("");
console.log("Bước tiếp theo:");
console.log(`  1. Mở ${outPath} và điền bản dịch vào mỗi "value".`);
console.log(`  2. Thêm khóa '${lang}' vào DICT trong public/i18n.js (nhập lại giá trị đã dịch).`);
console.log(`  3. Thêm nút chọn ngôn ngữ vào <div data-lang-switch> trong public/*.html.`);
