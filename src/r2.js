import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, isConfigured } from "./config.js";

/**
 * The R2 client, built from config.
 *
 * Exported so that everything which writes to the bucket speaks to R2 the same way:
 * the admin upload endpoint and scripts/publish-product.mjs. The script used to
 * construct its own, and the two agreed only until one of them was changed — a
 * release published by hand would then have landed under a key shape the download
 * endpoint did not look for, with no error anywhere.
 *
 * S3-compatible, region "auto": Cloudflare's convention rather than an AWS one.
 */
export const releaseClient = () => new S3Client({
  region: "auto",
  endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.r2.accessKeyId, secretAccessKey: env.r2.secretAccessKey },
});

let client;
function getClient() {
  if (!isConfigured.r2) throw new Error("R2 chưa được cấu hình");
  client ||= releaseClient();
  return client;
}

const safeName = (name) => String(name || "download.bin").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);

// Single source of truth for the R2 object key so the admin presign endpoint and
// scripts/publish-product.mjs always produce the exact same layout.
export const releaseKey = (productRef, version, fileName) =>
  `products/${safeName(productRef)}/${safeName(version)}/${Date.now()}-${safeName(fileName)}`;
const releaseNameFromKey = (key, fallback) => {
  const objectName = String(key || "").split("/").pop() || "";
  return safeName(objectName.replace(/^\d+-/, "") || fallback || "download.bin");
};

export async function createUploadUrl({ productRef, version, fileName, contentType }) {
  const key = releaseKey(productRef, version, fileName);
  const command = new PutObjectCommand({ Bucket: env.r2.bucket, Key: key, ContentType: contentType || "application/octet-stream" });
  return { key, url: await getSignedUrl(getClient(), command, { expiresIn: env.r2.uploadTtl }) };
}

export async function createDownloadUrl(key, fileName = "download.bin") {
  const downloadName = releaseNameFromKey(key, fileName);
  const command = new GetObjectCommand({
    Bucket: env.r2.bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${downloadName}"`,
  });
  return getSignedUrl(getClient(), command, { expiresIn: env.r2.downloadTtl });
}
