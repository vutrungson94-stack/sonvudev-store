// Dynamic blog module for SonVuDev.
// Stores and renders multilingual blog posts from JSON files under data/blog/.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config.js";
import { dataDir } from "./store.js";
import { esc } from "./format.js";

// Directory where blog post JSON files live.
const BLOG_DIR = path.join(dataDir, "blog");

// Build absolute URLs for SEO (canonical, og, alternate).
const site = () => env.appUrl.replace(/\/$/, "");
const absolute = (p) => `${site()}${p.startsWith("/") ? p : `/${p}`}`;

// Resolve absolute path to a single blog post JSON file.
function blogPath(slug) {
  return path.join(BLOG_DIR, `${slug}.json`);
}

// Load all blog posts from disk and sort by date (newest first).
export function loadBlogPosts() {
  let files;
  try {
    files = readdirSync(BLOG_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const posts = [];
  for (const file of files) {
    try {
      const raw = readFileSync(path.join(BLOG_DIR, file), "utf8");
      const post = JSON.parse(raw);
      if (post && post.slug) posts.push(post);
    } catch {
      // skip unreadable posts
    }
  }
  return posts.sort((a, b) => {
    const da = new Date(a.published || a.modified || 0);
    const db = new Date(b.published || b.modified || 0);
    return db - da;
  });
}

// Find a single blog post by slug, or null if missing.
export function getBlogPostBySlug(slug) {
  try {
    const raw = readFileSync(blogPath(slug), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Build blog route path from slug and language.
const blogUrl = (slug, lang = "vi") =>
  lang === "vi" ? `/blog/${slug}` : `/en/blog/${slug}`;

// Render a single blog post as a full HTML document.
export function renderBlogPost(post, lang = "vi") {
  const isVi = lang === "vi";
  const title = isVi ? post.titleVi : post.titleEn || post.titleVi;
  const description = isVi
    ? post.descriptionVi
    : post.descriptionEn || post.descriptionVi;
  const content = isVi ? post.contentVi : post.contentEn || post.contentVi;
  const section = isVi ? post.section : post.sectionEn || post.section;
  const dateDisplay = new Date(post.published || post.modified || Date.now())
    .toLocaleDateString(isVi ? "vi-VN" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  const url = absolute(blogUrl(post.slug, lang));
  const viUrl = absolute(blogUrl(post.slug, "vi"));
  const enUrl = absolute(blogUrl(post.slug, "en"));
  const tags = Array.isArray(post.tags) ? post.tags : [];
  const published = new Date(post.published || post.modified || Date.now())
    .toISOString();
  const modified = new Date(post.modified || post.published || Date.now())
    .toISOString();

  const relatedHtml = post.relatedProductSlug
    ? `<a class="blog-related-link" href="${absolute(
        `/product/${post.relatedProductSlug}`
      )}">${isVi ? 'Sản phẩm liên quan' : 'Related Product'} →</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="${isVi ? "vi" : "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} — ${esc(section)} | ${esc(env.brand.name)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${esc(env.brand.name)}">
  <meta property="og:locale" content="${isVi ? "vi_VN" : "en_US"}">
  <meta property="og:locale:alternate" content="${isVi ? "en_US" : "vi_VN"}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${absolute("/og.png")}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(title)}">
  <meta property="article:published_time" content="${esc(published)}">
  <meta property="article:modified_time" content="${esc(modified)}">
  <meta property="article:author" content="${esc(env.brand.name)}">
  <meta property="article:section" content="${esc(section)}">
  ${tags.map((t) => `<meta property="article:tag" content="${esc(t)}">`).join("\n")}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <link rel="alternate" hreflang="vi" href="${esc(viUrl)}">
  <link rel="alternate" hreflang="en" href="${esc(enUrl)}">
  <link rel="alternate" hreflang="x-default" href="${esc(viUrl)}">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <nav class="blog-lang">
    <a href="${absolute("/")}" class="blog-home">← ${isVi ? 'Trang chủ' : 'Home'}</a>
    <span>${isVi ? 'Ngôn ngữ:' : 'Language:'}</span>
    <a href="${esc(viUrl)}" class="${!isVi ? 'active' : ''}">Tiếng Việt</a>
    <a href="${esc(enUrl)}" class="${isVi ? 'active' : ''}">English</a>
  </nav>
  <article class="blog-post">
    <header class="blog-header">
      <div class="blog-meta">
        <span class="blog-date">${esc(dateDisplay)}</span>
        <span class="blog-section">${esc(section)}</span>
      </div>
      <h1>${esc(title)}</h1>
      <p class="blog-lead">${esc(description)}</p>
    </header>
    <div class="blog-content">
      ${content}
    </div>
    <footer class="blog-footer">
      <div class="blog-related">
        <h2>${isVi ? "Sản phẩm liên quan" : "Related Product"}</h2>
        <div id="related-products">${relatedHtml || (isVi ? "Không có sản phẩm liên quan." : "No related product.")}</div>
      </div>
    </footer>
  </article>
  <script src="/lang-detect.js"></script>
</body>
</html>`;
}

// Render blog index page listing all posts.
export function renderBlogIndex(posts, lang = "vi") {
  const isVi = lang === "vi";
  const title = isVi ? `Blog — ${env.brand.name}` : `Blog — ${env.brand.name}`;
  const description = isVi
    ? `Hướng dẫn, mẹo và công cụ từ ${env.brand.name} giúp bạn làm việc nhanh hơn và an toàn hơn trên Windows.`
    : `Guides, tips and tools from ${env.brand.name} to help you work faster and safer on Windows.`;
  const url = absolute(lang === "vi" ? "/blog" : "/en/blog");
  const viUrl = absolute("/blog");
  const enUrl = absolute("/en/blog");

  const cards = (posts || [])
    .map((post) => {
      const pTitle = isVi ? post.titleVi : post.titleEn || post.titleVi;
      const pDesc = isVi
        ? post.descriptionVi
        : post.descriptionEn || post.descriptionVi;
      const pUrl = absolute(blogUrl(post.slug, lang));
      const pDate = new Date(
        post.published || post.modified || Date.now()
      ).toLocaleDateString(isVi ? "vi-VN" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      return `<a class="blog-card" href="${esc(pUrl)}">
        <div class="blog-card-meta">
          <span class="blog-date">${esc(pDate)}</span>
          <span class="blog-section">${esc(isVi ? post.section : post.sectionEn || post.section)}</span>
        </div>
        <h3>${esc(pTitle)}</h3>
        <p>${esc(pDesc)}</p>
      </a>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="${isVi ? "vi" : "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(env.brand.name)}">
  <meta property="og:locale" content="${isVi ? "vi_VN" : "en_US"}">
  <meta property="og:locale:alternate" content="${isVi ? "en_US" : "vi_VN"}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${absolute("/og.png")}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(title)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <link rel="alternate" hreflang="vi" href="${esc(viUrl)}">
  <link rel="alternate" hreflang="en" href="${esc(enUrl)}">
  <link rel="alternate" hreflang="x-default" href="${esc(viUrl)}">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <nav class="blog-lang">
    <a href="${absolute("/")}" class="blog-home">← ${isVi ? 'Trang chủ' : 'Home'}</a>
    <span>${isVi ? 'Ngôn ngữ:' : 'Language:'}</span>
    <a href="${esc(viUrl)}" class="${!isVi ? 'active' : ''}">Tiếng Việt</a>
    <a href="${esc(enUrl)}" class="${isVi ? 'active' : ''}">English</a>
  </nav>
  <main class="wrap">
    <header class="blog-index-header">
      <h1>${isVi ? "Blog" : "Blog"}</h1>
      <p>${isVi ? `Hướng dẫn và mẹo từ ${env.brand.name}.` : `Guides and tips from ${env.brand.name}.`}</p>
    </header>
    <div class="blog-index">
      ${cards || `<p>${isVi ? "Chưa có bài viết." : "No posts yet."}</p>`}
    </div>
  </main>
  <script src="/lang-detect.js"></script>
</body>
</html>`;
}

// Render JSON feed of blog posts for readers / SEO tools.
export function renderBlogFeed(posts) {
  const base = absolute("/");
  const items = (posts || []).map((post, i) => {
    const viUrl = `${base}blog/${encodeURIComponent(post.slug)}`;
    const enUrl = `${base}en/blog/${encodeURIComponent(post.slug)}`;
    const title = post.titleVi || post.titleEn || "Untitled";
    const desc = post.descriptionVi || post.descriptionEn || "";
    const date = new Date(post.published || post.modified || Date.now())
      .toISOString()
      .slice(0, 10);
    return {
      position: i + 1,
      url: viUrl,
      title,
      description: desc,
      date,
      alternate: enUrl,
    };
  });
  return {
    title: `${env.brand.name} Blog`,
    description: `Guides, tips and tools from ${env.brand.name}.`,
    url: `${base}blog`,
    items,
  };
}
