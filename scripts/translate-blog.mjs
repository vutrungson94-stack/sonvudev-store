/**
 * Fill missing blog translations (title/description/section/content) for the
 * on-demand locales. Only missing fields are translated - existing human
 * translations are never overwritten, and a failed field never becomes a
 * broken null bolted into the JSON.
 *
 * Usage:
 *   npm run blog:translate                 # dry-run report
 *   npm run blog:translate:apply
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { translateText } from "../src/translate-service.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Blog content ships in src/blog-posts, not data/blog: data/ is runtime state
// (orders.json) and is excluded from the deploy artifact, so anything read from
// there is missing in production. Resolved from this script's own path so it works
// both in a checkout and in publish-output/node/scripts.
const BLOG_DIR = join(root, "src", "blog-posts");
const DRY_RUN = !process.argv.includes("--apply");
const TARGET_LANGS = ["de", "es", "fr", "ja", "zh-CN"];
const SOURCE_LANG = "vi";

const FIELD_MAP = {
  de: { title: "titleDe", description: "descriptionDe", content: "contentDe", section: "sectionDe" },
  es: { title: "titleEs", description: "descriptionEs", content: "contentEs", section: "sectionEs" },
  fr: { title: "titleFr", description: "descriptionFr", content: "contentFr", section: "sectionFr" },
  ja: { title: "titleJa", description: "descriptionJa", content: "contentJa", section: "sectionJa" },
  "zh-CN": { title: "titleZhCN", description: "descriptionZhCN", content: "contentZhCN", section: "sectionZhCN" },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateField(text, targetLang) {
  if (!text || !String(text).trim()) return null;
  try {
    return await translateText(String(text), targetLang, SOURCE_LANG);
  } catch (error) {
    console.error(`  failed: ${error.message}`);
    return null;
  }
}

async function translatePost(filePath) {
  const post = JSON.parse(readFileSync(filePath, "utf8"));
  let changed = false;

  for (const lang of TARGET_LANGS) {
    const fields = FIELD_MAP[lang];
    const jobs = [
      ["title", fields.title, post.titleVi],
      ["description", fields.description, post.descriptionVi],
      ["section", fields.section, post.section],
      ["content", fields.content, post.contentVi],
    ];
    for (const [fieldName, key, source] of jobs) {
      if (post[key] || !source) continue;
      console.log(`  ${basename(filePath)} -> ${lang}.${fieldName}${DRY_RUN ? " (dry-run)" : ""}`);
      if (DRY_RUN) continue;
      const translated = await translateField(source, lang);
      if (translated) {
        post[key] = translated;
        changed = true;
      }
      await sleep(250);
    }
  }

  if (changed && !DRY_RUN) {
    writeFileSync(filePath, JSON.stringify(post, null, 2) + "\n", "utf8");
    console.log(`Updated: ${filePath}`);
  } else if (!changed) {
    console.log(`No changes: ${filePath}`);
  }
}

const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith(".json"));
console.log(`Found ${files.length} blog posts${DRY_RUN ? " (dry-run)" : ""}`);
for (const file of files) await translatePost(join(BLOG_DIR, file));
console.log("\nDone!");
