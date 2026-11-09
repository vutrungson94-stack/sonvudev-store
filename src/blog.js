// Dynamic blog module for SonVuDev.
// Stores and renders multilingual blog posts from JSON files under data/blog/.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config.js";
import { dataDir } from "./store.js";
import { esc } from "./format.js";
import { SUPPORTED_LOCALES } from "./i18n-registry.mjs";

// Directory where blog post JSON files live.
const BLOG_DIR = path.join(dataDir, "blog");

// Build absolute URLs for SEO (canonical, og, alternate).
const site = () => env.appUrl.replace(/\/$/, "");
const absolute = (p) => `${site()}${p.startsWith("/") ? p : `/${p}`}`;

// Resolve absolute path to a single blog post JSON file.
function blogPath(slug) {
  return path.join(BLOG_DIR, `${slug}.json`);
}

// Resolve a product slug to its stable id so an explicit "buy" CTA in blog
// content can deep-link into checkout (/?buy=<id>). Uses the tracked products
// file synchronously; when the catalogue only lives in Supabase (no local
// file) or the slug is unknown, the CTA falls back to the locale product page
// (discovery) rather than inventing a broken buy link.
const productsJsonPath = path.join(dataDir, "products.json");
let slugToId = null;
const productIdForSlug = (slug) => {
  if (!slug) return null;
  if (slugToId) return slugToId.get(slug) || null;
  try {
    const items = JSON.parse(readFileSync(productsJsonPath, "utf8"));
    slugToId = new Map((Array.isArray(items) ? items : []).map((p) => [String(p.slug || ""), p.id]));
    return slugToId.get(slug) || null;
  } catch {
    slugToId = new Map();
    return null;
  }
};
const productPageHref = (slug, lang = "vi") => {
  const prefix = lang && lang !== "vi" ? `/${lang}` : "";
  return absolute(`${prefix}/product/${encodeURIComponent(String(slug || ""))}`);
};
const buyHref = (slug, lang = "vi") => {
  const id = productIdForSlug(slug);
  return id ? absolute(`/?buy=${encodeURIComponent(id)}#products`) : productPageHref(slug, lang);
};

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
// The locale list itself comes from the i18n registry — adding a language
// means adding one entry to src/i18n-registry.mjs, not editing this file.
const languageFlagClass = (code) => `flag-${String(code).toLowerCase().replace(/_/g, "-")}`;
const BLOG_LANGS = SUPPORTED_LOCALES.map(({ code, name }) => ({ code, label: name }));
const BLOG_LOCALES = Object.freeze(BLOG_LANGS.map(({ code }) => code));
export const EXTRA_BLOG_LOCALES = Object.freeze(BLOG_LOCALES.filter((code) => code !== "vi" && code !== "en"));

const blogUrl = (slug, lang = "vi") => {
  if (!slug) return lang === "vi" ? "/blog" : `/${lang}/blog`;
  return lang === "vi" ? `/blog/${slug}` : `/${lang}/blog/${slug}`;
};
const blogLangHref = (code, slug) => absolute(blogUrl(slug, code));
const blogLangLinks = (slug, currentLang) =>
  BLOG_LANGS.map(({ code, label }) => {
    const active = code === currentLang ? ' active' : '';
    const flagSpan = `<span class="lang-flag ${languageFlagClass(code)}" aria-hidden="true"></span>`;
    return `<a href="${esc(blogLangHref(code, slug))}" class="${active}" data-blog-lang="${code}">${flagSpan} ${label}</a>`;
  }).join("");
const blogField = (post, lang, base) => {
  const suffix = lang === 'vi' ? 'Vi'
    : lang === 'en' ? 'En'
    : lang === 'de' ? 'De'
    : lang === 'es' ? 'Es'
    : lang === 'fr' ? 'Fr'
    : lang === 'ja' ? 'Ja'
    : lang === 'zh-CN' ? 'ZhCN'
    : 'En';
  const key = base + suffix;
  if (post[key]) return post[key];
  // Fallback chain: En -> Vi
  if (post[base + 'En']) return post[base + 'En'];
  if (post[base + 'Vi']) return post[base + 'Vi'];
  return '';
};

// UI labels for every supported blog language.
const BLOG_UI = {
  'vi': {
    home: 'Trang chủ',
    language: 'Ngôn ngữ:',
    pageTitle: 'Blog',
    pageSubtitle: (brand) => `Hướng dẫn và mẹo từ ${brand}.`,
    related: 'Sản phẩm liên quan',
    empty: 'Chưa có bài viết.',
    dateLocale: 'vi-VN',
    htmlLang: 'vi',
    ogLocale: 'vi_VN',
    ogLocaleAlt: 'en_US',
    translationNotice: '',
  },
  'en': {
    home: 'Home',
    language: 'Language:',
    pageTitle: 'Blog',
    pageSubtitle: (brand) => `Guides and tips from ${brand}.`,
    related: 'Related Product',
    empty: 'No posts yet.',
    dateLocale: 'en-US',
    htmlLang: 'en',
    ogLocale: 'en_US',
    ogLocaleAlt: 'vi_VN',
    translationNotice: '',
  },
  'de': {
    home: 'Startseite',
    language: 'Sprache:',
    pageTitle: 'Blog',
    pageSubtitle: (brand) => `Anleitungen und Tipps von ${brand}.`,
    related: 'Zugehöriges Produkt',
    empty: 'Noch keine Beiträge.',
    dateLocale: 'de-DE',
    htmlLang: 'de',
    ogLocale: 'de_DE',
    ogLocaleAlt: 'en_US',
    translationNotice: '<p class="blog-translation-notice">Dieser Beitrag ist derzeit nur auf Vietnamesisch und Englisch verfügbar. Englische Version wird angezeigt.</p>',
  },
  'es': {
    home: 'Página de inicio',
    language: 'Idioma:',
    pageTitle: 'Blog',
    pageSubtitle: (brand) => `Guías y consejos de ${brand}.`,
    related: 'Producto relacionado',
    empty: 'Aún no hay publicaciones.',
    dateLocale: 'es-ES',
    htmlLang: 'es',
    ogLocale: 'es_ES',
    ogLocaleAlt: 'en_US',
    translationNotice: '<p class="blog-translation-notice">Esta publicación solo está disponible en vietnamita e inglés por ahora. Se muestra la versión en inglés.</p>',
  },
  'fr': {
    home: 'Accueil',
    language: 'Langue :',
    pageTitle: 'Blog',
    pageSubtitle: (brand) => `Guides et conseils de ${brand}.`,
    related: 'Produit associé',
    empty: 'Aucun article pour le moment.',
    dateLocale: 'fr-FR',
    htmlLang: 'fr',
    ogLocale: 'fr_FR',
    ogLocaleAlt: 'en_US',
    translationNotice: '<p class="blog-translation-notice">Cet article est actuellement disponible uniquement en vietnamien et en anglais. Version anglaise affichée.</p>',
  },
  'ja': {
    home: 'ホーム',
    language: '言語：',
    pageTitle: 'ブログ',
    pageSubtitle: (brand) => `${brand}からのガイドとヒント。`,
    related: '関連製品',
    empty: '記事がまだありません。',
    dateLocale: 'ja-JP',
    htmlLang: 'ja',
    ogLocale: 'ja_JP',
    ogLocaleAlt: 'en_US',
    translationNotice: '<p class="blog-translation-notice">この記事は現在、ベトナム語と英語でのみ利用可能です。英語版を表示しています。</p>',
  },
  'zh-CN': {
    home: '首页',
    language: '语言：',
    pageTitle: '博客',
    pageSubtitle: (brand) => `${brand}的指南和技巧。`,
    related: '相关产品',
    empty: '暂无文章。',
    dateLocale: 'zh-CN',
    htmlLang: 'zh-CN',
    ogLocale: 'zh_CN',
    ogLocaleAlt: 'en_US',
    translationNotice: '<p class="blog-translation-notice">此文章目前仅提供越南语和英语版本。正在显示英语版本。</p>',
  },
};
const blogUi = (lang) => BLOG_UI[lang] || BLOG_UI['en'];

// Render a single blog post as a full HTML document.
export function renderBlogPost(post, lang = "vi") {
  const ui = blogUi(lang);
  const isVi = lang === "vi";
  const isEn = lang === "en";
  // Blog posts are authored in Vietnamese and English only.
  // Non-Vi/En languages fall back to the English version as the best-available
  // translation until full translations are provided.
  const title = blogField(post, lang, "title");
  const description = blogField(post, lang, "description");
  const bodyContent = blogField(post, lang, "content");
  // Rewrite /product/<slug> links in authored blog HTML with explicit intent:
  // - explicit buy CTAs (mua/buy/checkout/purchase/order/cart signals, or
  //   data-buy/data-purchase) open checkout via /?buy=<id>;
  // - discovery/reference links go to the localized product page.
  // This avoids sending readers who click "view details" into checkout.
  const contentHtml = String(bodyContent || "").replace(
    /<a\b([^>]*\bhref="\/product\/([^"?#\s]+)"[^>]*)>([\s\S]*?)<\/a>/gi,
    (m, _attrs, slug, inner) => {
      const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      const hay = `${m} ${text}`.toLowerCase();
      const isBuy = /\bdata-buy\b|\bdata-purchase\b|class="[^"]*\b(?:buy|purchase|checkout|btn-buy|btn-purchase|order-now|add-to-cart|cart)\b[^"]*"|\b(?:mua ngay|đặt mua|mua hàng|thanh toán ngay|buy now|purchase now|order now|checkout|add to cart)\b/i.test(hay);
      const href = isBuy ? buyHref(slug, lang) : productPageHref(slug, lang);
      return m.replace(/href="\/product\/[^"?#\s]+"/i, `href="${href}"`);
    }
  );
  const section = blogField(post, lang, "section");
  const dateDisplay = new Date(post.published || post.modified || Date.now())
    .toLocaleDateString(ui.dateLocale, {
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

  // "Related product" is a discovery/navigation affordance: link to the product
  // page. Explicit "Mua hàng/Buy" CTAs use /?buy=<id> (see PURCHASE-LINK-RULES.md).
  const relatedHtml = post.relatedProductSlug
    ? `<a class="blog-related-link" href="${esc(productPageHref(post.relatedProductSlug, lang))}">${ui.related} →</a>`
    : "";

  const noticeHtml = !isVi && !isEn && ui.translationNotice
    ? ui.translationNotice
    : "";

  return `<!DOCTYPE html>
<html lang="${ui.htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} — ${esc(section)} | ${esc(env.brand.name)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${esc(env.brand.name)}">
  <meta property="og:locale" content="${ui.ogLocale}">
  <meta property="og:locale:alternate" content="${ui.ogLocaleAlt}">
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
    <a href="${absolute("/")}" class="blog-home">← ${ui.home}</a>
    <span class="blog-language-label">${ui.language}</span>
    ${blogLangLinks(post.slug, lang)}
  </nav>
  <script src="/blog-lang.js"></script>
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
      ${noticeHtml}${contentHtml}
    </div>
    <footer class="blog-footer">
      <div class="blog-related">
        <h2>${ui.related}</h2>
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
  const ui = blogUi(lang);
  const isVi = lang === "vi";
  const isEn = lang === "en";
  const title = `${ui.pageTitle} — ${env.brand.name}`;
  const description = ui.pageSubtitle(env.brand.name);
  const url = absolute(blogUrl("", lang));
  const viUrl = absolute("/blog");
  const enUrl = absolute("/en/blog");

  const cards = (posts || [])
    .map((post) => {
      const pTitle = blogField(post, lang, "title");
      const pDesc = blogField(post, lang, "description");
      const pUrl = absolute(blogUrl(post.slug, lang));
      const pDate = new Date(
        post.published || post.modified || Date.now()
      ).toLocaleDateString(ui.dateLocale, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      return `<a class="blog-card" href="${esc(pUrl)}">
        <div class="blog-card-meta">
          <span class="blog-date">${esc(pDate)}</span>
          <span class="blog-section">${esc(blogField(post, lang, "section"))}</span>
        </div>
        <h3>${esc(pTitle)}</h3>
        <p>${esc(pDesc)}</p>
      </a>`;
    })
    .join("");

  const noticeHtml = !isVi && !isEn && ui.translationNotice
    ? `<div class="blog-translation-wrap">${ui.translationNotice}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="${ui.htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(env.brand.name)}">
  <meta property="og:locale" content="${ui.ogLocale}">
  <meta property="og:locale:alternate" content="${ui.ogLocaleAlt}">
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
    <a href="${absolute("/")}" class="blog-home">← ${ui.home}</a>
    <span class="blog-language-label">${ui.language}</span>
    ${blogLangLinks("", lang)}
  </nav>
  <script src="/blog-lang.js"></script>
  <main class="wrap">
    <header class="blog-index-header">
      <h1>${esc(ui.pageTitle)}</h1>
      <p>${esc(ui.pageSubtitle(env.brand.name))}</p>
    </header>
    <div class="blog-index">
      ${noticeHtml}${cards || `<p>${esc(ui.empty)}</p>`}
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
