/**
 * Operations orchestrator - the single entry point for the automation scripts
 * that used to stand alone with no npm script and no schedule.
 *
 * Order matters:
 *   1. translate missing blog fields (local files, easy to review)
 *   2. sync the catalogue through the admin API (SEO fields included)
 *   3. SEO-only fallback when the admin API is not available
 *   4. announce the change (IndexNow + Bing)
 *
 * Dry-run by default. `--apply` is the only way anything external is written;
 * translation still only fills missing fields, so a re-run is idempotent.
 *
 * Usage:
 *   npm run ops:run                       # dry-run report (local, safe)
 *   OPS_ALLOW_EXTERNAL=1 npm run ops:run:apply
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply");
const wanted = new Set(process.argv.filter((a) => a.startsWith("--") && a !== "--apply"));
const runAll = wanted.size === 0;
const has = (name) => runAll || wanted.has(name);
const externalAllowed = process.env.OPS_ALLOW_EXTERNAL === "1";

const steps = [
  { name: "translate-blog", script: "translate-blog.mjs", args: apply ? ["--apply"] : [], run: has("--translate-blog") || has("translate-blog") },
  { name: "sync-catalog", script: "sync-products-to-supabase.mjs", args: apply ? ["--apply"] : [], run: has("--catalog") || has("catalog") },
  { name: "update-seo", script: "update-seo.mjs", args: apply ? ["--apply"] : [], run: has("--seo") || has("seo") },
  { name: "ping-indexnow", script: "ping-indexnow.mjs", args: [], external: true, run: has("--indexnow") || has("indexnow") },
  { name: "submit-bing", script: "submit-bing-sitemap.mjs", args: [], external: true, run: has("--bing") || has("bing") },
];

let failures = 0;
for (const step of steps) {
  if (!step.run) continue;
  if (step.external && !(apply && externalAllowed)) {
    console.log(`[ops] skip ${step.name}: external side effect requires --apply and OPS_ALLOW_EXTERNAL=1`);
    continue;
  }
  console.log(`\n[ops] === ${step.name}${apply ? "" : " (dry-run)"} ===`);
  const result = spawnSync(process.execPath, [path.join(root, "scripts", step.script), ...step.args], {
    cwd: root,
    stdio: "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failures += 1;
    console.log(`[ops] ${step.name} exited ${result.status}`);
  }
}

if (failures) {
  console.log(`\n[ops] ${failures} step(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\n[ops] done");
}
