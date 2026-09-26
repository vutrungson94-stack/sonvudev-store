import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, isConfigured } from "./config.js";

let client;
function getClient() {
  if (!isConfigured.r2) throw new Error("R2 chưa được cấu hình");
  client ||= new S3Client({
    region: "auto",
    endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.r2.accessKeyId, secretAccessKey: env.r2.secretAccessKey },
  });
  return client;
}

const safeName = (name) => String(name || "download.bin").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
const keyFor = (productId, version, fileName) => `products/${safeName(productId)}/${safeName(version)}/${Date.now()}-${safeName(fileName)}`;
const releaseNameFromKey = (key, fallback) => {
  const objectName = String(key || "").split("/").pop() || "";
  return safeName(objectName.replace(/^\d+-/, "") || fallback || "download.bin");
};

export async function createUploadUrl({ productId, version, fileName, contentType }) {
  const key = keyFor(productId, version, fileName);
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
