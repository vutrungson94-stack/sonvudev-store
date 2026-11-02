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
  lang === "en" ? `/en/blog/${slug}` : `/blog/${slug}`;

// Render a single blog post as a full HTML document.
export function renderBlogPost(post, lang = "vi") {
  const isEn = lang === "en";
  const title = isEn ? post.titleEn || post.titleVi : post.titleVi;
  const description = isEn
    ? post.descriptionEn || post.descriptionVi
    : post.descriptionVi;
  const content = isEn ? post.contentEn || post.contentVi : post.contentVi;
  const section = isEn ? post.sectionEn || post.section : post.section;
  const dateDisplay = new Date(post.published || post.modified || Date.now())
    .toLocaleDateString(isEn ? "en-US" : "vi-VN", {
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
      )}">${isEn ? 'View product' : 'Xem sản phẩm'} →</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="${isEn ? "en" : "vi"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} — ${esc(section)} | SonVuDev</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="SonVuDev">
  <meta property="og:locale" content="${isEn ? "en_US" : "vi_VN"}">
  <meta property="og:locale:alternate" content="${isEn ? "vi_VN" : "en_US"}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${absolute("/og.png")}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(title)}">
  <meta property="article:published_time" content="${esc(published)}">
  <meta property="article:modified_time" content="${esc(modified)}">
  <meta property="article:author" content="SonVuDev">
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
    <span>${isEn ? 'Language:' : 'Ngôn ngữ:'}</span>
    <a href="${esc(viUrl)}" class="${!isEn ? 'active' : ''}">Tiếng Việt</a>
    <a href="${esc(enUrl)}" class="${isEn ? 'active' : ''}">English</a>
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
        <h2>${isEn ? "Related Product" : "Sản phẩm liên quan"}</h2>
        <div id="related-products">${relatedHtml || (isEn ? "No related product." : "Không có sản phẩm liên quan.")}</div>
      </div>
    </footer>
  </article>
</body>
</html>`;
}

// Render blog index page listing all posts.
export function renderBlogIndex(posts, lang = "vi") {
  const isEn = lang === "en";
  const title = isEn ? "Blog — SonVuDev" : "Blog — SonVuDev";
  const description = isEn
    ? "Guides, tips and tools from SonVuDev to help you work faster and safer on Windows."
    : "Hướng dẫn, mẹo và công cụ từ SonVuDev giúp bạn làm việc nhanh hơn và an toàn hơn trên Windows.";
  const url = absolute(lang === "en" ? "/en/blog" : "/blog");
  const viUrl = absolute("/blog");
  const enUrl = absolute("/en/blog");

  const cards = (posts || [])
    .map((post) => {
      const pTitle = isEn ? post.titleEn || post.titleVi : post.titleVi;
      const pDesc = isEn
        ? post.descriptionEn || post.descriptionVi
        : post.descriptionVi;
      const pUrl = absolute(blogUrl(post.slug, lang));
      const pDate = new Date(
        post.published || post.modified || Date.now()
      ).toLocaleDateString(isEn ? "en-US" : "vi-VN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      return `<a class="blog-card" href="${esc(pUrl)}">
        <div class="blog-card-meta">
          <span class="blog-date">${esc(pDate)}</span>
          <span class="blog-section">${esc(isEn ? post.sectionEn || post.section : post.section)}</span>
        </div>
        <h3>${esc(pTitle)}</h3>
        <p>${esc(pDesc)}</p>
      </a>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="${isEn ? "en" : "vi"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="SonVuDev">
  <meta property="og:locale" content="${isEn ? "en_US" : "vi_VN"}">
  <meta property="og:locale:alternate" content="${isEn ? "vi_VN" : "en_US"}">
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
    <span>${isEn ? 'Language:' : 'Ngôn ngữ:'}</span>
    <a href="${esc(viUrl)}" class="${!isEn ? 'active' : ''}">Tiếng Việt</a>
    <a href="${esc(enUrl)}" class="${isEn ? 'active' : ''}">English</a>
  </nav>
  <main class="wrap">
    <header class="blog-index-header">
      <h1>${isEn ? "Blog" : "Blog"}</h1>
      <p>${isEn ? "Guides and tips from SonVuDev." : "Hướng dẫn và mẹo từ SonVuDev."}</p>
    </header>
    <div class="blog-index">
      ${cards || `<p>${isEn ? "No posts yet." : "Chưa có bài viết."}</p>`}
    </div>
  </main>
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
    title: "SonVuDev Blog",
    description: "Guides, tips and tools from SonVuDev.",
    url: `${base}blog`,
    items,
  };
}
