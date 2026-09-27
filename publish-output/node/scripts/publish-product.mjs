// Publish a built release to the storefront: upload the binary straight to R2
// (no browser step) and patch the matching product row in Supabase.
//
//   node scripts/publish-product.mjs <file.exe> [--id <productId>] [--dry-run]
//
// The R2 key is derived the same way src/r2.js does it, so the presigned download
// URL resolves back to the real file name instead of "download.bin".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { env, isConfigured } from "../src/config.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback = "") => {
  const i = args.indexOf(name);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};
const filePath = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
const dryRun = flag("--dry-run");

if (!filePath) {
  console.error("Dung: node scripts/publish-product.mjs <duong-dan-file.exe> [--id <productId>] [--dry-run]");
  process.exit(1);
}
if (!isConfigured.r2 || !isConfigured.supabase) {
  console.error("Thieu cau hinh R2 hoac Supabase trong .env");
  process.exit(1);
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.r2.accessKeyId, secretAccessKey: env.r2.secretAccessKey },
});

const safeName = (v) => String(v || "download.bin").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);

const supabase = async (pathname, options = {}) => {
  const headers = {
    apikey: env.supabase.serviceRoleKey,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...(options.headers || {}),
  };
  if (env.supabase.serviceRoleKey.startsWith("eyJ")) headers.Authorization = `Bearer ${env.supabase.serviceRoleKey}`;
  const res = await fetch(`${env.supabase.url}/rest/v1/${pathname}`, { ...options, headers });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
};

const bytes = (n) => `${(n / 1048576).toFixed(1)} MB`;

async function main() {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`${filePath} khong phai file`);
  const fileName = path.basename(filePath);

  const filter = value("--id", "") ? `id=eq.${encodeURIComponent(value("--id"))}` : "slug=eq.spark-capacity-tester";
  const rows = await supabase(`products?${filter}&select=*&limit=1`);
  const product = rows[0];
  if (!product) throw new Error(`Khong tim thay san pham (${filter}). Kiem tra --id hoac tao san pham truoc.`);
  console.log(`San pham: ${product.name} [${product.id}] slug=${product.slug}`);

  const version = product.version || "1.0.0";
  const key = `products/${safeName(product.slug)}/${safeName(version)}/${Date.now()}-${safeName(fileName)}`;
  console.log(`File    : ${fileName} (${bytes(stat.size)})`);
  console.log(`R2 key  : ${key}`);
  console.log(`Trang thai: ${dryRun ? "DRY-RUN, khong ghi gi" : "se upload that + bat ban"}`);

  if (dryRun) return;

  await r2.send(new PutObjectCommand({
    Bucket: env.r2.bucket,
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentLength: stat.size,
    ContentType: "application/vnd.microsoft.portable-executable",
  }));
  const head = await r2.send(new HeadObjectCommand({ Bucket: env.r2.bucket, Key: key }));
  console.log(`R2 OK   : ${key} (${bytes(head.ContentLength)})`);

  await supabase(`products?id=eq.${encodeURIComponent(product.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ file_key: key, status: "active", version }),
  });
  console.log("Da gan file_key va chuyen status sang active.");
}

main().catch((error) => {
  console.error(`LOI: ${error.message}`);
  process.exitCode = 1;
});
