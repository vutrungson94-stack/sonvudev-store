import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { translateText } from "../src/translate-service.mjs";

const BLOG_DIR = join(process.cwd(), "data", "blog");
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

async function translateField(text, targetLang, fieldName) {
  if (!text || !text.trim()) return text;
  try {
    const result = await translateText(text, targetLang, SOURCE_LANG);
    return result;
  } catch (err) {
    console.error(`  Failed to translate ${fieldName}:`, err.message);
    return null;
  }
}

async function translatePost(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const post = JSON.parse(raw);
  let changed = false;

  for (const lang of TARGET_LANGS) {
    const fields = FIELD_MAP[lang];
    console.log(`\nTranslating ${basename(filePath)} -> ${lang}`);

    // Title
    if (!post[fields.title] && post.titleVi) {
      console.log(`  Translating title...`);
      post[fields.title] = await translateField(post.titleVi, lang, "title");
      if (post[fields.title]) changed = true;
      await sleep(300);
    }

    // Description
    if (!post[fields.description] && post.descriptionVi) {
      console.log(`  Translating description...`);
      post[fields.description] = await translateField(post.descriptionVi, lang, "description");
      if (post[fields.description]) changed = true;
      await sleep(300);
    }

    // Section
    if (!post[fields.section] && post.section) {
      console.log(`  Translating section...`);
      post[fields.section] = await translateField(post.section, lang, "section");
      if (post[fields.section]) changed = true;
      await sleep(300);
    }

    // Content (HTML)
    if (!post[fields.content] && post.contentVi) {
      console.log(`  Translating content (${post.contentVi.length} chars)...`);
      post[fields.content] = await translateField(post.contentVi, lang, "content");
      if (post[fields.content]) changed = true;
      await sleep(500);
    }
  }

  if (changed) {
    writeFileSync(filePath, JSON.stringify(post, null, 2) + "\n", "utf8");
    console.log(`\nUpdated: ${filePath}`);
  } else {
    console.log(`\nNo changes: ${filePath}`);
  }
}

async function main() {
  const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Found ${files.length} blog posts`);

  for (const file of files) {
    const filePath = join(BLOG_DIR, file);
    await translatePost(filePath);
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
