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
import { releaseKey } from "../src/r2.js";

const args = process.argv.slice(2);
const usage = [
  "Dung: node scripts/publish-product.mjs <duong-dan-file.exe> [--slug <slug> | --id <id>]",
  "                                     [--version <x.y.z>] [--prune] [--dry-run]",
  "",
  "  --dry-run          chi in ke hoach, khong ghi gi len R2 hay Supabase",
  "  --slug <slug>      san pham theo slug (mac dinh tu nhan dien)",
  "  --id <id>          san pham theo id",
  "  --version <x.y.z>  ban phat hanh moi (mac dinh giu version hien tai)",
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
if (!isConfigured.r2 || !isConfigured.supabase) {
  console.error("Thieu cau hinh R2 hoac Supabase trong .env");
  process.exit(1);
}
if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
  console.error(`Khong tim thay file: ${filePath}`);
  process.exit(1);
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.r2.accessKeyId, secretAccessKey: env.r2.secretAccessKey },
});

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
    if (!rows[0]) throw new Error(`Khong tim thay san pham voi ${column}=${slug || id}.`);
    return rows[0];
  }
  const all = await supabase("products?select=id,slug,name,version,status,file_key&order=created_at.desc");
  if (all.length === 1) return all[0];
  // Prefer the product that already ships a release: that is the one being updated.
  const published = all.filter((p) => p.file_key);
  if (published.length === 1) return published[0];
  throw new Error(
    `Khong doan duoc san pham nao (${all.length} san pham trong bang). Chon bang --slug hoac --id:\n`
    + all.map((p) => `  ${p.slug}  [${p.id}]  v${p.version}  ${p.file_key ? "da co file" : "chua co file"}`).join("\n"),
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
  if (previousKey) console.log(`Ban cu  : ${previousKey}${prune ? " (se xoa)" : " (giu lai, them --prune de xoa)"}`);
  console.log(`Trang thai: ${dryRun ? "DRY-RUN, khong ghi gi" : "se upload that + gan file_key + status=active"}`);

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
  if (updated?.file_key !== key) throw new Error("Supabase khong xac nhan lai file_key. Kiem tra lai.");
  console.log(`Supabase OK: file_key -> ${updated.file_key}, status=${updated.status}, version=${updated.version}`);

  if (prune && previousKey && previousKey !== key) {
    await r2.send(new DeleteObjectCommand({ Bucket: env.r2.bucket, Key: previousKey }));
    console.log(`Da xoa ban cu tren R2: ${previousKey}`);
  }
  console.log("\nPhat hanh xong. Kiem tra tai sonvudev.com.");
}

main().catch((error) => {
  console.error(`LOI: ${error.message}`);
  process.exitCode = 1;
});
