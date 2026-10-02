// Publish a built release to the storefront: upload the binary straight to R2
// (no browser step) and patch the matching product row in Supabase.
//
//   node scripts/publish-product.mjs <duong-dan-file.exe> [--dry-run]
//   node scripts/publish-product.mjs <file.exe> [--slug <slug> | --id <id>]
//                                   [--version <x.y.z>] [--prune]
//
// One command is enough. Without --slug/--id the product is resolved
// automatically: the single product that already has a release file, or the
// only product in the table. The R2 key comes from releaseKey() in src/r2.js,
// the same helper the admin upload endpoint uses, so the presigned download URL
// resolves back to the real file name instead of "download.bin".
import fs from "node:fs";
import path from "node:path";
import { PutObjectCommand, S3Client, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { env, isConfigured } from "../src/config.js";
import { supabaseRequest, requireSupabase } from "../src/supabase-http.js";
import { releaseKey, releaseClient } from "../src/r2.js";

const args = process.argv.slice(2);
const usage = [
  "Dung: node scripts/publish-product.mjs <duong-dan-file.exe> [--slug <slug> | --id <id>]",
  "                                     [--version <x.y.z>] [--prune] [--dry-run]",
  "",
  "  --dry-run          chi in ke hoach, khong ghi gi len R2 hay Supabase",
  "  --slug <slug>      san pham theo slug (mac dinh tu nhan dien)",
  "  --id <id>          san pham theo id",
  "  --version <x.y.z>  bản phát hành mới (mặc định giữ version hiện tại)",
  "  --prune            xoa ban cu tren R2 sau khi gan ban moi",
].join("\n");

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

const flagValue = (name) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : "";
};
// Positional = the first argument that is not a flag and not a flag's value.
const valueFlags = new Set(["--slug", "--id", "--version"]);
const filePath = args.find((a, i) => !a.startsWith("-") && !valueFlags.has(args[i - 1]));
const dryRun = args.includes("--dry-run");
const prune = args.includes("--prune");

if (!filePath) {
  console.error(usage);
  process.exit(1);
}
requireSupabase();
if (!isConfigured.r2) {
  console.error("Thiếu cấu hình R2 trong .env");
  process.exit(1);
}
if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
  console.error(`Không tìm thấy file: ${filePath}`);
  process.exit(1);
}

// The R2 client and the PostgREST call come from src/. This script used to build
// both itself, in a second copy of each. They agreed, which is why nothing broke
// until the moment one of them was changed and the other was not — a release
// published by hand would have written to a bucket under a key the server did not
// expect, with no error to say so.
const r2 = releaseClient();
const supabase = (pathname, options) => supabaseRequest(pathname, options);

const bytes = (n) => `${(n / 1048576).toFixed(1)} MB`;
const contentTypeFor = (name) => (/\.zip$/i.test(name) ? "application/zip"
  : /\.msi$/i.test(name) ? "application/x-msi"
    : /\.7z$/i.test(name) ? "application/x-7z-compressed"
      : "application/vnd.microsoft.portable-executable");

async function resolveProduct() {
  const slug = flagValue("--slug");
  const id = flagValue("--id");
  if (slug || id) {
    const column = slug ? "slug" : "id";
    const rows = await supabase(`products?${column}=eq.${encodeURIComponent(slug || id)}&select=*&limit=1`);
    if (!rows[0]) throw new Error(`Không tìm thấy sản phẩm với ${column}=${slug || id}.`);
    return rows[0];
  }
  const all = await supabase("products?select=id,slug,name,version,status,file_key&order=created_at.desc");
  if (all.length === 1) return all[0];
  // Prefer the product that already ships a release: that is the one being updated.
  const published = all.filter((p) => p.file_key);
  if (published.length === 1) return published[0];
  throw new Error(
    `Không đoán được sản phẩm nào (${all.length} sản phẩm trong bảng). Chọn bằng --slug hoặc --id:\n`
    + all.map((p) => `  ${p.slug}  [${p.id}]  v${p.version}  ${p.file_key ? "đã có file" : "chưa có file"}`).join("\n"),
  );
}

async function main() {
  const stat = fs.statSync(filePath);
  const fileName = path.basename(filePath);

  const product = await resolveProduct();
  console.log(`San pham: ${product.name} [${product.id}] slug=${product.slug}`);

  const version = flagValue("--version") || product.version || "1.0.0";
  const previousKey = product.file_key || "";
  const key = releaseKey(product.slug, version, fileName);
  console.log(`File    : ${filePath}`);
  console.log(`Dung luong: ${bytes(stat.size)}`);
  console.log(`Version : ${version}${product.version && product.version !== version ? ` (truoc: ${product.version})` : ""}`);
  console.log(`R2 key  : ${key}`);
  if (previousKey) console.log(`Ban cu  : ${previousKey}${prune ? " (sẽ xoá)" : " (giữ lại, thêm --prune để xoá)"}`);
  console.log(`Trang thai: ${dryRun ? "DRY-RUN, không ghi gì" : "se upload that + gan file_key + status=active"}`);

  if (dryRun) {
    console.log("\nDRY-RUN xong. Bo --dry-run de phat hanh that.");
    return;
  }

  await r2.send(new PutObjectCommand({
    Bucket: env.r2.bucket,
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentLength: stat.size,
    ContentType: contentTypeFor(fileName),
  }));
  const head = await r2.send(new HeadObjectCommand({ Bucket: env.r2.bucket, Key: key }));
  if (Number(head.ContentLength) !== stat.size) {
    throw new Error(`Kich thuoc tren R2 khong khop: ${head.ContentLength} != ${stat.size}`);
  }
  console.log(`R2 OK   : ${key} (${bytes(head.ContentLength)})`);

  const patch = { file_key: key, status: "active", version, updated_at: new Date().toISOString() };
  const [updated] = await supabase(`products?id=eq.${encodeURIComponent(product.id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (updated?.file_key !== key) throw new Error("Supabase không xác nhận lại file_key. Kiểm tra lại.");
  console.log(`Supabase OK: file_key -> ${updated.file_key}, status=${updated.status}, version=${updated.version}`);

  if (prune && previousKey && previousKey !== key) {
    await r2.send(new DeleteObjectCommand({ Bucket: env.r2.bucket, Key: previousKey }));
    console.log(`Da xoa ban cu tren R2: ${previousKey}`);
  }
  // The address to check comes from APP_URL, which is the value the storefront
  // itself was built from. A literal domain here meant that publishing to a
  // different host still told the operator to go and look at the old one.
  console.log(`\nPhat hanh xong. Kiem tra tai ${env.appUrl}.`);
}

main().catch((error) => {
  console.error(`LOI: ${error.message}`);
  process.exitCode = 1;
});
