// Keeps cloudflare/r2-cors.json equal to what APP_URL implies, and prints the
// Cloudflare command that applies it.
//
//   npm run r2:cors            check, and print the command (default)
//   npm run r2:cors:write      rewrite the file from APP_URL
//   npm run r2:cors:command    print only the wrangler command
//
// Why this is a script and not a paragraph in the README: the file is applied to a
// bucket by hand, so nothing else in the repository runs when it goes stale. The
// upload path is a cross-origin PUT from the admin panel (public/admin.js), which is
// the only release-publishing action in the shop and the only one a browser refuses
// on CORS grounds without anything on the page saying so.
//
// The command is printed rather than run on purpose. Wrriting to a live bucket is
// not something a check should do to itself, and a value for R2_BUCKET_NAME that is
// wrong in one place would take a working upload path down.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { requiredOrigins, corsDiff, hostOf } from "./lib/cors.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const file = path.join(root, "cloudflare", "r2-cors.json");
const args = process.argv.slice(2);
const write = args.includes("--write");
const commandOnly = args.includes("--command");
const bucket = (process.env.R2_BUCKET_NAME || "").trim();

const appUrl = (process.env.APP_URL || "").trim();
if (!hostOf(appUrl)) {
  console.error("Thieu APP_URL trong .env. Chay: npm run r2:cors -- https://ten-mien-cua-ban");
  process.exit(1);
}

const build = (origins) => [
  {
    AllowedOrigins: origins,
    AllowedMethods: ["GET", "PUT", "HEAD"],
    AllowedHeaders: ["Content-Type"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 900,
  },
];

let rules = [];
try {
  rules = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  console.error(`Khong doc duoc cloudflare/r2-cors.json: ${error.message}`);
  process.exit(1);
}

const diff = corsDiff(rules, appUrl);
const command = bucket
  ? `npx wrangler r2 bucket cors set ${bucket} --file cloudflare/r2-cors.json`
  : "npx wrangler r2 bucket cors set <R2_BUCKET_NAME> --file cloudflare/r2-cors.json";

if (write) {
  await writeFile(file, `${JSON.stringify(build(requiredOrigins(appUrl)), null, 2)}\n`);
  console.log(`[r2:cors] da ghi cloudflare/r2-cors.json cho ${hostOf(appUrl)}`);
} else if (diff.missing.length) {
  console.error(`[r2:cors] FAIL — thieu ${diff.missing.length} origin trong cloudflare/r2-cors.json:`);
  for (const origin of diff.missing) console.error(`  + ${origin}`);
  if (diff.extra.length) {
    console.error(`  va thua ${diff.extra.length} origin (van an toan, nen doc lai):`);
    for (const origin of diff.extra) console.error(`  - ${origin}`);
  }
  if (!commandOnly) {
    console.error("\nSua no:");
    console.error("  npm run r2:cors:write");
    console.error("\nRoi ap len bucket:");
    console.error(`  ${command}`);
  }
  process.exit(1);
} else if (commandOnly) {
  console.log(command);
} else {
  console.log(`[r2:cors] PASS: cloudflare/r2-cors.json khop voi ${hostOf(appUrl)} (${requiredOrigins(appUrl).length} origin).`);
  if (diff.extra.length) {
    console.log(`[r2:cors] GHI CHU: ${diff.extra.length} origin khong do APP_URL sinh ra — doc lai truoc khi ap:`);
    for (const origin of diff.extra) console.log(`  - ${origin}`);
  }
  console.log(`[r2:cors] Ap len bucket: ${command}`);
}
