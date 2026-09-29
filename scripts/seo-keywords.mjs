// Rewrites product copy so each page leads with the phrase someone actually
// types into a search box. Run once; the values are stored in the database and
// stay editable afterwards from the admin panel.
//
// PostgREST addresses columns by their real snake_case names, not the camelCase
// the app uses internally, so the keys here are deliberately snake_case.
import dotenv from "dotenv";

dotenv.config({ path: "D:/SonVuDev-Upload/.env", override: true });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };

const UPDATES = {
  "excel-trusted-locations-setup": {
    seo_title: "Bật macro Excel — thêm thư mục tin cậy, không cần chỉnh tay | SonVuDev",
    seo_description: "Excel bị chặn macro khi mở file .xlsm? Script tự thêm thư mục bạn chọn vào Trusted Locations, dọn thư mục rác, có sẵn script hoàn tác. Không xóa gì, không đụng cài đặt của bạn.",
    short_description: "Excel bị chặn macro khi mở file .xlsm? Script tự thêm thư mục bạn chọn vào Trusted Locations, dọn thư mục rác tự phát hiện máy chủ, có sẵn script hoàn tác. Không xóa file, không đụng setting của bạn.",
  },
  "spark-capacity-tester-pro": {
    seo_title: "Kiểm tra dung lượng thật USB, thẻ nhớ — phát hiện hàng giả | SonVuDev",
    seo_description: "Ổ USB báo 128GB nhưng thực ra chỉ còn 8GB? Đo tốc độ và kiểm tra dung lượng thật, tự phát hiện vùng lỗi, báo PASS/FAIL rõ ràng. Portable, chạy ngay, không cần cài.",
    short_description: "Ổ USB báo 128GB nhưng thực ra chỉ còn 8GB? Đo tốc độ và kiểm tra dung lượng thật, tự phát hiện vùng lỗi, báo PASS/FAIL rõ ràng. Portable, chạy ngay, không cần cài đặt.",
  },
};

// One column at a time: PostgREST rejects the whole request when any single
// column is unknown, so a schema that is one migration behind should still get
// the copy it can accept rather than nothing at all.
async function applyColumns(slug, patch) {
  const applied = [];
  const missing = [];
  for (const [column, value] of Object.entries(patch)) {
    const response = await fetch(`${url}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}`, { method: "PATCH", headers, body: JSON.stringify({ [column]: value }) });
    if (response.ok) applied.push(column);
    else missing.push(`${column} (${response.status})`);
  }
  return { applied, missing };
}

let incomplete = false;
for (const [slug, patch] of Object.entries(UPDATES)) {
  const { applied, missing } = await applyColumns(slug, patch);
  console.log(`OK  ${slug}  ->  ${applied.join(", ") || "(khong co gi)"}`);
  if (missing.length) { incomplete = true; console.log(`    CHUA CO COT: ${missing.join(", ")}`); }
  const selected = ["short_description", ...(missing.length ? [] : ["seo_title"])];
  const rows = await (await fetch(`${url}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}&select=${selected.join(",")}`, { headers })).json();
  const [row] = Array.isArray(rows) ? rows : [{}];
  console.log(`    mô tả: ${String(row.short_description || "").slice(0, 88)}...`);
  if (row.seo_title) console.log(`    tiêu đề: ${row.seo_title}`);
}
if (incomplete) {
  console.log("\nChạy supabase/schema.sql trong Supabase SQL editor, rồi chạy lại script này.");
  console.log("Cần có trước:");
  console.log("  alter table public.products add column if not exists seo_title text not null default '';");
  console.log("  alter table public.products add column if not exists seo_description text not null default '';");
}
