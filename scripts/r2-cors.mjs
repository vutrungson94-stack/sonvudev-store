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
import { requiredOrigins, corsDiff, hostOf } from "./lib/cors.mjs";
import { env } from "../src/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const file = path.join(root, "cloudflare", "r2-cors.json");
const args = process.argv.slice(2);
const write = args.includes("--write");
const commandOnly = args.includes("--command");
const bucket = env.r2.bucket.trim();
const appUrl = env.appUrl.trim();
if (!hostOf(appUrl)) {
  // No trailing argument to type. This script has never read one — the flags below
  // are the only arguments it looks at, and the origin comes from APP_URL — so the
  // instruction it printed could not be followed. It names the variable instead.
  console.error("Thieu APP_URL trong .env. Dat APP_URL=https://ten-mien-cua-ban roi chay lai.");
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
  console.error(`Không đọc được cloudflare/r2-cors.json: ${error.message}`);
  process.exit(1);
}

const diff = corsDiff(rules, appUrl);
const command = bucket
  ? `npx wrangler r2 bucket cors set ${bucket} --file cloudflare/r2-cors.json`
  : "npx wrangler r2 bucket cors set <R2_BUCKET_NAME> --file cloudflare/r2-cors.json";

// `--command` prints the wrangler line and nothing else, which is the one mode
// meant to be pasted into a terminal. It used to be handled last, after the branch
// that reports a mismatch — so `npm run r2:cors:command` against a file that needed
// updating exited 1 having printed no command at all: the mode whose only job is to
// print the command could not print it.
if (write) {
  if (commandOnly) {
    console.error("[r2:cors] không thể vừa ghi file vừa in ra lệnh. Chạy tách hai lệnh:");
    console.error("  npm run r2:cors:write");
    console.error("  npm run r2:cors:command");
    process.exit(1);
  }
  await writeFile(file, `${JSON.stringify(build(requiredOrigins(appUrl)), null, 2)}\n`);
  console.log(`[r2:cors] đã ghi cloudflare/r2-cors.json cho ${hostOf(appUrl)}`);
  console.log(`[r2:cors] Ap len bucket: ${command}`);
} else if (commandOnly) {
  console.log(command);
} else if (diff.missing.length) {
  console.error(`[r2:cors] FAIL — thiếu ${diff.missing.length} origin trong cloudflare/r2-cors.json:`);
  for (const origin of diff.missing) console.error(`  + ${origin}`);
  if (diff.extra.length) {
    console.error(`  và thừa ${diff.extra.length} origin (vẫn an toàn, nên đọc lại):`);
    for (const origin of diff.extra) console.error(`  - ${origin}`);
  }
  console.error("\nSửa nó:");
  console.error("  npm run r2:cors:write");
  console.error("\nRồi áp lên bucket:");
  console.error(`  ${command}`);
  process.exit(1);
} else {
  console.log(`[r2:cors] PASS: cloudflare/r2-cors.json khớp với ${hostOf(appUrl)} (${requiredOrigins(appUrl).length} origin).`);
  if (diff.extra.length) {
    console.log(`[r2:cors] GHI CHÚ: ${diff.extra.length} origin không do APP_URL sinh ra — đọc lại trước khi áp:`);
    for (const origin of diff.extra) console.log(`  - ${origin}`);
  }
  console.log(`[r2:cors] Ap len bucket: ${command}`);
}
