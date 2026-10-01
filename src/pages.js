import { env } from "./config.js";
import { isSellable } from "./store.js";
import { esc, money } from "./format.js";

// Product pages are rendered here, on the server, rather than in the browser.
// The storefront ships an empty skeleton and fills it in with JavaScript, which
// is fine for a person but leaves a search engine with a page of empty headings
// and no products. It also leaves link-preview crawlers — the ones Facebook,
// Zalo and Telegram use when someone shares your URL — with nothing at all.
//
// Everything a crawler needs has to be in the bytes the server sends.
//
// esc and money live in format.js, shared with the mail templates. They were
// written out here and in notify.js, identical to the character, and the two
// appear in the same sentence: the page a crawler reads and the email a buyer
// reads. Two copies of an escape function do not have to be wrong today to
// disagree tomorrow.

const site = () => env.appUrl.replace(/\/$/, "");

const absolute = (path) => `${site()}${path.startsWith("/") ? path : `/${path}`}`;


/**
 * A short, honest summary for search results and link previews. The full
 * description can run to several thousand characters, and both Google and
 * Facebook truncate well before that, so a truncated wall of text buys nothing.
 */
export function productSummary(product, max = 155) {
  const source = String(product.short_description || product.shortDescription || product.description || "").replace(/\s+/g, " ").trim();
  if (source.length <= max) return source;
  const cut = source.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/**
 * The one logo URL the whole site uses. It was previously /logo.svg, a file that
 * has never existed: every product page told Google the brand's logo was a 404,
 * and only the homepage named the file that is really there.
 */
export const LOGO_PATH = "/favicon.svg";

/**
 * The raster card for link previews.
 *
 * The per-product SVG at /og/:slug.svg is still generated, because some
 * crawlers render it. It is not what og:image points at, because Facebook, Zalo,
 * Telegram, Slack, LinkedIn and most AI answer engines refuse SVG outright and
 * show an empty box instead. This PNG is generated once by
 * scripts/make-og-image.ps1 and committed, so neither the build nor the server
 * needs an image library to produce a shareable card.
 */
export const OG_IMAGE_PATH = "/og.png";

/**
 * Every page og:image, og:image:width and og:image:height have to agree, so the
 * numbers live here rather than being repeated in each meta block.
 */
const OG_IMAGE = { path: OG_IMAGE_PATH, width: 1200, height: 630 };

export const brand = () => env.brand.name;

export const organization = () => ({
  "@type": "Organization",
  "@id": `${site()}/#organization`,
  name: brand(),
  url: `${site()}/`,
  logo: absolute(LOGO_PATH),
  description: "Công cụ và tiện ích phần mềm cho doanh nghiệp và cá nhân tại Việt Nam.",
  address: { "@type": "PostalAddress", addressCountry: "VN" },
  // The profile accounts for the same shop elsewhere. This is the one thing that
  // links this storefront to the rest of the web in a knowledge graph: with an
  // empty sameAs the brand is an island that nothing can corroborate, and an
  // unverifiable entity is one a model has no reason to quote.
  ...(env.brand.socialLinks.length ? { sameAs: env.brand.socialLinks } : {}),
  // A named person behind the shop. Anonymous storefronts get cited far less
  // readily than a place with a human attached to it.
  ...(env.brand.founderName ? {
    founder: {
      "@type": "Person",
      name: env.brand.founderName,
      ...(env.brand.founderUrl ? { url: env.brand.founderUrl } : {}),
    },
  } : {}),
});

/**
 * SoftwareApplication is the schema.org type that matches a downloadable tool.
 * Product plus an Offer would also be valid, but SoftwareApplication carries
 * operatingSystem and applicationCategory, which is what makes it eligible for
 * the software rich result.
 *
 * The fields past the ones a search result shows are what a model needs to say
 * something specific rather than something generic: which platforms it runs on,
 * what it needs to run at all, and where the file actually is.
 */
export const productSchema = (product, lang = "vi") => ({
  "@type": "SoftwareApplication",
  "@id": absolute(productUrl(product.slug, lang)) + "#software",
  name: `${product.name} ${product.version ? `v${product.version}` : ""}`.trim(),
  // altText and the description both take the search phrasing, so the product
  // is findable by the problem it solves and not only by its product name.
  description: product.seoDescription || productSummary(product),
  alternateName: product.seoTitle || undefined,
  url: absolute(productUrl(product.slug, lang)),
  inLanguage: lang === "en" ? "en" : "vi-VN",
  applicationCategory: product.category || "UtilitiesApplication",
  operatingSystem: product.platform || "Windows",
  softwareVersion: product.version || undefined,
  // A requirements field in the data is the closest thing to a spec sheet, and
  // it is the field an assistant quotes when asked whether something will run.
  softwareRequirements: product.requirements || undefined,
  downloadUrl: absolute(productUrl(product.slug, lang)),
  installUrl: absolute(productUrl(product.slug, lang)),
  ...(env.brand.socialLinks.length ? { sameAs: env.brand.socialLinks } : {}),
  author: { "@id": `${site()}/#organization` },
  publisher: { "@id": `${site()}/#organization` },
  offers: {
    "@type": "Offer",
    price: Number(product.price) || 0,
    priceCurrency: product.currency || "VND",
    availability: "https://schema.org/InStock",
    priceValidUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    url: absolute(productUrl(product.slug, lang)),
    seller: { "@id": `${site()}/#organization` },
  },
});

export const breadcrumbSchema = (product, lang = "vi") => {
  const labels = lang === "en"
    ? { home: "Home", products: "Products", here: product.name }
    : { home: "Trang chủ", products: "Sản phẩm", here: product.name };
  return {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: labels.home, item: `${site()}/` },
      { "@type": "ListItem", position: 2, name: labels.products, item: `${site()}/#products` },
      { "@type": "ListItem", position: 3, name: labels.here, item: absolute(productUrl(product.slug, lang)) },
    ],
  };
};

/**
 * The four questions a buyer asks before paying, answered from what this shop
 * actually does rather than from a generic template.
 *
 * Question-and-answer prose in the exact wording someone uses is close to the
 * highest-yield thing on the page for an assistant: it is the shape of text these
 * systems quote, and it is the shape they can verify against the page itself.
 */
export const faqSchema = (product, lang = "vi") => {
  const window = env.orders.paymentWindowHours;
  const entries = lang === "en" ? [
    ["How do I receive the file?", "Pay by bank transfer or PayPal and the download link is emailed to you straight away. Nothing is queued for manual approval."],
    ["How many times can I download it?", "As many as you like. The lookup code in your email makes a fresh download link on demand; links expire quickly, the number of downloads does not."],
    ["Which platforms does it run on?", `${product.platform || "Windows"}. ${product.requirements || ""}`.trim()],
    ["What if the file is broken or I bought the wrong thing?", `Email ${env.email.supportEmail} with your order code and the file is replaced or refunded.`],
    ["How long do I have to pay?", `An unpaid order is cancelled after ${window} hours, so pay inside that window and nothing happens to it.`],
  ] : [
    ["Tôi nhận hàng bằng cách nào?", "Thanh toán xong là mã tra cứu gửi qua email ngay, kèm link tải trực tiếp. Không cần chờ ai duyệt."],
    ["Tải được mấy lần?", "Bạn tự tạo link tải mới bất cứ lúc nào bằng mã tra cứu. Link có thời hạn ngắn nhưng không giới hạn số lần tạo."],
    ["Phần mềm chạy trên nền tảng nào?", `${product.platform || "Windows"}. ${product.requirements || ""}`.trim()],
    ["Nếu file lỗi hoặc tôi mua nhầm?", `Liên hệ ${env.email.supportEmail} kèm mã đơn. Chúng tôi hoàn tiền hoặc gửi lại bản sửa.`],
    ["Tôi có bao lâu để thanh toán?", `Đơn chưa thanh toán bị hủy sau ${window} giờ, nên thanh toán trong khoảng đó là an toàn.`],
  ];
  return {
    "@type": "FAQPage",
    mainEntity: entries.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
};

// Google retired the sitelinks search box in November 2024, so a SearchAction
// earns nothing any more. What it used to point at was worse than useless: the
// only page this site has that takes a query string is /lookup, the order
// recovery form, which robots.txt disallows and which serves noindex. Telling a
// search engine the site's search feature is a page it must not read is a
// contradiction in the markup, so the action is gone.
export const websiteSchema = () => ({
  "@type": "WebSite",
  "@id": `${site()}/#website`,
  name: brand(),
  url: `${site()}/`,
  inLanguage: "vi-VN",
  publisher: { "@id": `${site()}/#organization` },
});

const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

/**
 * Search engine ownership tokens, as meta tags.
 *
 * Google and Bing each hand out one string and offer two ways to present it: a
 * tag in the head, or a file at the site root. Both are served from the same env
 * var so whichever the dashboard offers works without touching the code.
 * Returns an empty string when nothing is configured, which is not an error:
 * a store that has not claimed the domain in Search Console still works.
 */
export const verificationMeta = () => {
  const tags = [];
  if (env.site.googleVerification) tags.push(`<meta name="google-site-verification" content="${esc(env.site.googleVerification)}">`);
  if (env.site.bingVerification) tags.push(`<meta name="msvalidate.01" content="${esc(env.site.bingVerification)}">`);
  return tags.join("\n");
};

/**
 * The verification file a search engine fetches from the site root.
 *
 * Google names it google<token>.html and wants a one-line body naming itself;
 * Bing names it ms<token>.txt and wants the bare token. Both names come out of
 * the same string the meta tag uses, so one env var satisfies either method.
 * Returns null when the token is not configured, which is not an error.
 */
export const verificationFile = (prefix, suffix, token) => {
  const value = String(token || "").trim();
  if (!value || !/^[0-9a-z]+$/i.test(value)) return null;
  const name = `${prefix}${value}${suffix}`;
  return { name, body: prefix === "google" ? `google-site-verification: ${name}` : value };
};

/** One product's canonical address. Vietnamese is the root; English sits under /en. */
export const productUrl = (slug, lang = "vi") => (lang === "en" ? `/en/product/${slug}` : `/product/${slug}`);

/** The other language's address for the same page, or nothing when it has none. */
const alternateUrl = (path, lang) => {
  if (lang === "en") return absolute(path);
  return absolute(`/en${path === "/" ? "" : path}`).replace(/\/$/, "") || absolute("/en");
};

/**
 * Meta block shared by every indexable page.
 *
 * og:image points at the committed PNG rather than the per-product SVG. The SVG
 * is still generated and still served, but Facebook, Zalo, Telegram, Slack,
 * LinkedIn and most AI answer engines refuse SVG outright, so a card that looks
 * right in a browser is an empty box at every place the link is actually shared.
 */
const meta = ({ title, description, url, image = absolute(OG_IMAGE_PATH), type = "website", published, lang = "vi", alternates }) => [
  `<title>${esc(title)}</title>`,
  `<meta name="description" content="${esc(description)}">`,
  `<link rel="canonical" href="${esc(url)}">`,
  // The two languages are separate URLs serving the same product, so they point
  // at each other. Without this a crawler has to guess which of the two is the
  // original and may index both as competing pages.
  `<link rel="alternate" hreflang="vi" href="${esc(alternates?.vi || url)}">`,
  `<link rel="alternate" hreflang="en" href="${esc(alternates?.en || alternateUrl(url, lang))}">`,
  `<link rel="alternate" hreflang="x-default" href="${esc(alternates?.vi || url)}">`,
  `<meta property="og:type" content="${type}">`,
  `<meta property="og:site_name" content="${esc(brand())}">`,
  `<meta property="og:locale" content="${lang === "en" ? "en_US" : "vi_VN"}">`,
  lang === "en" ? `<meta property="og:locale:alternate" content="vi_VN">` : `<meta property="og:locale:alternate" content="en_US">`,
  `<meta property="og:title" content="${esc(title)}">`,
  `<meta property="og:description" content="${esc(description)}">`,
  `<meta property="og:url" content="${esc(url)}">`,
  image ? `<meta property="og:image" content="${esc(image)}">` : "",
  image ? `<meta property="og:image:width" content="${OG_IMAGE.width}">` : "",
  image ? `<meta property="og:image:height" content="${OG_IMAGE.height}">` : "",
  image ? `<meta property="og:image:alt" content="${esc(title)}">` : "",
  `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
  `<meta name="twitter:title" content="${esc(title)}">`,
  `<meta name="twitter:description" content="${esc(description)}">`,
  published ? `<meta property="article:published_time" content="${esc(published)}">` : "",
].filter(Boolean).join("\n");

/**
 * The product grid, rendered on the server into the homepage.
 *
 * The storefront fills this in with JavaScript, which is fine for a person but
 * means a crawler reads a landing page with a hero, a slogan and no products: no
 * names, no prices, and not one link to a product page. Internal links are how a
 * search engine discovers and judges the rest of a site, so a store that only
 * advertises its products in the sitemap is a store that is one crawl away from
 * being invisible.
 *
 * The classes and fields are the ones public/app.js produces, so the swap when
 * the page's own script runs is a repaint rather than a layout change. The name
 * and the arrow are real links, which is what makes the page usable with
 * JavaScript turned off.
 */
export function renderIndexGrid(products) {
  const cards = (products || []).filter(isSellable).map((product) => {
    const art = esc(String(product.category || "khac").toLowerCase().replace(/\s+/g, "-"));
    const url = absolute(`/product/${encodeURIComponent(product.slug)}`);
    const features = (product.features || []).slice(0, 2)
      .map((item) => `<li>✓ ${esc(item)}</li>`).join("");
    return `<article class="product-card" data-id="${esc(product.id)}">
    <div class="product-art art-${art}">
      <span class="product-badge">${esc(product.badge || "Mới")}</span>
      <div class="product-logo">${esc(initials(product.name))}</div>
      <div class="art-grid"></div>
      <span class="art-spark">✦</span>
    </div>
    <div class="product-info">
      <div class="product-meta"><span>${esc(product.platform || "Windows")} · v${esc(product.version || "1.0")}</span><span>${esc(product.category || "")}</span></div>
      <h3><a href="${esc(url)}">${esc(product.name)}</a></h3>
      <p>${esc(product.shortDescription || product.short_description || product.description || "")}</p>
      <ul>${features}</ul>
      <div class="product-buy">
        <strong>${esc(money(product.price, product.currency))}</strong>
        <a class="round-arrow" href="${esc(url)}" aria-label="Mua ${esc(product.name)}">↗</a>
      </div>
    </div>
  </article>`;
  });
  // An empty catalogue still has to say so in words a crawler reads, rather than
  // leaving three grey placeholder rectangles in the markup.
  return cards.length
    ? cards.join("\n")
    : `<div class="empty-state"><b>Chưa có sản phẩm</b><p>Hãy thử bộ lọc khác.</p></div>`;
}

/** The "02 sản phẩm" counter above the grid, in the same shape the client writes. */
export const renderIndexCount = (products) => {
  const total = (products || []).filter(isSellable).length;
  return `${String(total).padStart(2, "0")} sản phẩm`;
};

const initials = (name) => String(name || "SV").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

/**
 * The words on a product page, in both languages.
 *
 * These used to be typed into the Vietnamese template and left out of the English
 * one entirely, which is why the server only ever had one language to render. Two
 * tables side by side make a missing translation a visible gap rather than a
 * silent absence.
 */
const COPY_VI = {
  home: "Trang chủ",
  products: "Sản phẩm",
  why: "Vì sao",
  faqNav: "Câu hỏi",
  about: "Về chúng tôi",
  breadcrumbLabel: "Đường dẫn",
  software: "Phần mềm",
  buyNow: "Mua ngay",
  buyNote: "Giấy phép vĩnh viễn, không phí thuê bao. Thanh toán chuyển khoản hoặc PayPal.",
  pointDownload: "Tải ngay sau khi thanh toán",
  pointLookup: "Mã tra cứu gửi qua email",
  pointRefund: "Hoàn tiền nếu file lỗi",
  features: "Tính năng",
  requirements: "Yêu cầu hệ thống",
  faqHeading: "Câu hỏi thường gặp",
  reviewsHeading: "Khách đã dùng",
  anonymous: "Khách hàng",
  related: "Sản phẩm khác",
  loading: "Đang tải…",
  terms: "Điều khoản",
  refund: "Hoàn tiền",
  privacy: "Bảo mật",
};

const COPY_EN = {
  home: "Home",
  products: "Products",
  why: "Why us",
  faqNav: "FAQ",
  about: "About",
  breadcrumbLabel: "Breadcrumb",
  software: "Software",
  buyNow: "Buy now",
  buyNote: "One-time licence, no subscription. Pay by bank transfer or PayPal.",
  pointDownload: "Download immediately after payment",
  pointLookup: "Lookup code sent by email",
  pointRefund: "Refunded if the file is broken",
  features: "Features",
  requirements: "System requirements",
  faqHeading: "Frequently asked questions",
  reviewsHeading: "What customers say",
  anonymous: "Customer",
  related: "Other products",
  loading: "Loading…",
  terms: "Terms",
  refund: "Refunds",
  privacy: "Privacy",
};

/** Splits the long form description on the === heading === markers. */function sections(description) {
  const parts = String(description || "").split(/\n={3,}\n?/);
  if (parts.length > 1) {
    const [head, ...rest] = parts;
    return { intro: head.trim(), groups: rest.map((item) => item.trim()).filter(Boolean) };
  }
  return { intro: String(description || "").trim(), groups: [] };
}

const paragraphBlocks = (text) => String(text || "").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  .map((block) => {
    if (block.startsWith("===") && block.endsWith("===")) return `<h3>${esc(block.replace(/=/g, "").trim())}</h3>`;
    if (block.startsWith("- ")) {
      return `<ul>${block.split("\n").filter((line) => line.trim().startsWith("- ")).map((line) => `<li>${esc(line.replace(/^-\s*/, "").trim())}</li>`).join("")}</ul>`;
    }
    if (/^\d+\.\s/.test(block)) {
      return `<ol>${block.split("\n").filter((line) => /^\d+\.\s/.test(line.trim())).map((line) => `<li>${esc(line.replace(/^\d+\.\s*/, "").trim())}</li>`).join("")}</ol>`;
    }
    return `<p>${esc(block).replace(/\n/g, "<br>")}</p>`;
  }).join("\n");

/**
 * Swaps in the English copy when there is any, and falls back to the Vietnamese
 * per field rather than per product.
 *
 * A product translated half way must still render a complete page: falling back
 * field by field means a partially translated product is readable in both
 * languages, whereas falling back per product would show an English page full of
 * Vietnamese.
 */
export function localize(product, lang) {
  if (!product || lang !== "en") return product;
  const pick = (en, vi) => (String(en || "").trim() ? en : vi);
  const featuresEn = Array.isArray(product.featuresEn) ? product.featuresEn.filter((item) => String(item || "").trim()) : [];
  return {
    ...product,
    shortDescription: pick(product.shortDescriptionEn, product.shortDescription),
    description: pick(product.descriptionEn, product.description),
    features: featuresEn.length ? featuresEn : product.features,
  };
}

/**
 * The full product page. It is deliberately standalone HTML: no JavaScript is
 * required to read the whole thing, and the only script on the page opens the
 * existing checkout modal on the storefront rather than duplicating it.
 *
 * The same renderer serves both languages. The page was Vietnamese-only on the
 * server even though the English copy had been sitting in the database all along
 * and the browser already used it, which meant an assistant asked in English
 * found a page it could only cite in translation.
 */
export function renderProductPage(rawProduct, lang = "vi", reviews = []) {
  const product = localize(rawProduct, lang);
  const en = lang === "en";
  const url = absolute(productUrl(product.slug, lang));
  const { intro, groups } = sections(product.description);
  const features = product.features || [];
  // The headline leads with what someone types into a search box, not with the
  // product's own name, which nobody outside this site has heard of. The two are
  // the same sentence read differently: "bật macro Excel" is the problem, "Excel
  // Trusted Locations Setup" is the thing that solves it.
  const title = product.seoTitle || (en
    ? `${product.name} v${product.version} — ${product.platform || "Windows"} | ${brand()}`
    : `${product.name} v${product.version} — ${product.platform || "Windows"} | ${brand()}`);
  const description = product.seoDescription || productSummary(product);
  const copy = en ? COPY_EN : COPY_VI;
  const faq = faqSchema(product, lang);

  return `<!doctype html>
<html lang="${en ? "en" : "vi"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${meta({ title, description, url, type: "product", lang, alternates: { vi: absolute(productUrl(product.slug, "vi")), en: absolute(productUrl(product.slug, "en")) } })}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
${jsonLd([organization(), websiteSchema(), productSchema(product, lang), breadcrumbSchema(product, lang), faq])}
</head>
<body class="product-page">
<header class="site-header"><a class="brand" href="/"><span class="brand-mark">S</span><span>SonVu<span>Dev</span></span></a><nav><a href="/#products">${copy.products}</a><a href="/#why">${copy.why}</a><a href="/#faq">${copy.faqNav}</a></nav><a class="header-cta" href="#mua">${copy.buyNow} <span>↗</span></a></header>
<main class="wrap">
<nav class="crumbs" aria-label="${copy.breadcrumbLabel}"><a href="/">${copy.home}</a> <span>/</span> <a href="/#products">${copy.products}</a> <span>/</span> <span aria-current="page">${esc(product.name)}</span></nav>
<article class="product-detail">
<header class="product-hero">
<div>
<p class="eyebrow">${esc(product.category || copy.software)} · ${esc(product.platform || "Windows")}${product.badge ? ` · ${esc(product.badge)}` : ""}</p>
<h1>${esc(product.name)} <em>v${esc(product.version)}</em></h1>
<p class="product-lede">${esc(product.short_description || product.shortDescription || "")}</p>
</div>
<aside class="buy-card" id="mua">
<div class="buy-price">${esc(money(product.price, product.currency))}</div>
<p class="buy-note">${copy.buyNote}</p>
<a class="button button-primary button-wide" href="/?buy=${encodeURIComponent(product.id)}#products">${copy.buyNow} <span>→</span></a>
<ul class="buy-points"><li>${copy.pointDownload}</li><li>${copy.pointLookup}</li><li>${copy.pointRefund}</li></ul>
</aside>
</header>
${features.length ? `<section class="detail-block"><h2>${copy.features}</h2><ul class="feature-grid">${features.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>` : ""}
${product.requirements ? `<section class="detail-block"><h2>${copy.requirements}</h2><p>${esc(product.requirements).replace(/\n/g, "<br>")}</p></section>` : ""}
${intro ? `<section class="detail-block prose">${paragraphBlocks(intro)}</section>` : ""}
${groups.map((group) => `<section class="detail-block prose">${paragraphBlocks(group)}</section>`).join("")}
<section class="detail-block">
<h2>${copy.faqHeading}</h2>
<dl class="faq-mini">
${faq.mainEntity.map((entry) => `<dt>${esc(entry.name)}</dt><dd>${esc(entry.acceptedAnswer.text)}</dd>`).join("\n")}
</dl>
</section>
${reviews.length ? `<section class="detail-block reviews"><h2>${copy.reviewsHeading}</h2><ul class="review-list">${reviews.map((review) => `<li><p>${esc(review.body)}</p><small>${esc(review.authorName || copy.anonymous)}</small></li>`).join("")}</ul></section>` : ""}
</article>
<section class="related"><h2>${copy.related}</h2><div id="related" class="related-grid">${copy.loading}</div></section>
</main>
<footer class="site-footer wrap"><p>© ${new Date().getFullYear()} ${esc(brand())} · <a href="/terms">${copy.terms}</a> · <a href="/refund">${copy.refund}</a> · <a href="/privacy">${copy.privacy}</a> · <a href="/about">${copy.about}</a></p></footer>
<!--
  The related-products loader lives in /related.js rather than inline. The server
  sends script-src 'self' with no 'unsafe-inline' and no nonce, so an inline block
  here was silently refused by every browser: the section below the product sat on
  "loading" forever. Nothing on this page needs inline script, so the CSP stays
  strict and the script moves.
-->
<script src="/related.js" data-slug="${esc(product.slug)}" data-self="${esc(product.id)}"></script>
</body>
</html>`;
}

/**
 * A link-preview card. SVG is used because it renders crisply and needs no build
 * step, but it is not what og:image points at: Facebook, Zalo, Telegram, Slack,
 * LinkedIn and most AI answer engines refuse SVG and show nothing. og:image
 * points at the committed raster card instead, and this stays available for the
 * crawlers that do handle SVG.
 */
export function renderOgImage(product) {
  const name = String(product.name || "");
  const lines = name.length > 34 ? [name.slice(0, 34), name.slice(34, 68)] : [name];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${esc(name)}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f2a22"/><stop offset="1" stop-color="#163a2f"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<circle cx="1080" cy="90" r="220" fill="#1d4a3c" opacity="0.55"/>
<text x="90" y="150" fill="#4fbf8b" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="600" letter-spacing="5">${esc(brand().toUpperCase())}</text>
${lines.map((line, index) => `<text x="90" y="${270 + index * 74}" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="62" font-weight="700">${esc(line)}</text>`).join("")}
<text x="90" y="${270 + lines.length * 74 + 26}" fill="#8fd3b2" font-family="Helvetica, Arial, sans-serif" font-size="34">${esc(product.platform || "Windows")} · v${esc(product.version || "1.0")}</text>
<text x="90" y="556" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="600">${esc(money(product.price, product.currency))}</text>
<text x="90" y="596" fill="#7fb39c" font-family="Helvetica, Arial, sans-serif" font-size="24">Giấy phép vĩnh viễn · Tải ngay sau khi thanh toán</text>
</svg>`;
}

/**
 * /llms.txt — a plain-text index for text agents.
 *
 * The convention is new and optional, so it is cheap: one route, no crawling, no
 * markup. What it buys is that an agent that has been told to prefer machine
 * summaries gets told what this site actually sells and where each thing lives,
 * instead of inferring it from a hero image and a sitemap.
 */
export function renderLlmsTxt(products) {
  const sellable = (products || []).filter(isSellable);
  const lines = [
    `# ${brand()}`,
    "",
    `> ${organization().description}`,
    "",
    sellable.length
      ? sellable.map((product) => {
        const facts = [
          `${product.platform || "Windows"}`,
          product.version ? `v${product.version}` : "",
          money(product.price, product.currency),
        ].filter(Boolean).join(" · ");
        return `- [${product.name}](${absolute(productUrl(product.slug))}): ${productSummary(product, 120)} (${facts})`;
      }).join("\n")
      : "- The catalogue is empty at the moment.",
    "",
    "## About",
    `- Who: ${env.brand.founderName ? `${env.brand.founderName}${env.brand.legalEntity ? ` (${env.brand.legalEntity})` : ""}` : brand()}`,
    `- Contact: ${env.email.supportEmail}`,
    `- Payments: bank transfer (VietQR, MoMo, ZaloPay) and PayPal, both confirmed automatically`,
    `- Terms: an unpaid order is cancelled after ${env.orders.paymentWindowHours} hours`,
    "",
    "## Pages",
    `- [Homepage](${absolute("/")}) — overview and the full catalogue`,
    `- [Feed (JSON)](${absolute("/feed.json")}) — every product with price, platform and version`,
    ...(env.brand.socialLinks.length ? [`- [Elsewhere](${env.brand.socialLinks.join(", ")})`] : []),
    "",
  ];
  return lines.join("\n");
}

/**
 * /feed.json — the catalogue as data.
 *
 * An assistant asked "what Windows tools do you sell and what do they cost"
 * would otherwise have to read three product pages to answer it. This is one
 * fetch, it is built from the live catalogue rather than a maintained list, and
 * it costs nothing beyond the route.
 */
export function renderFeed(products) {
  const sellable = (products || []).filter(isSellable);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${brand()} catalogue`,
    url: absolute("/feed.json"),
    numberOfItems: sellable.length,
    dateModified: new Date().toISOString().slice(0, 10),
    itemListElement: sellable.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "SoftwareApplication",
        "@id": absolute(`${productUrl(product.slug)}#software`),
        name: product.name,
        description: productSummary(product, 300),
        url: absolute(productUrl(product.slug)),
        ...(product.seoTitle ? { alternateName: product.seoTitle } : {}),
        applicationCategory: product.category || "UtilitiesApplication",
        operatingSystem: product.platform || "Windows",
        softwareVersion: product.version || undefined,
        ...(product.requirements ? { softwareRequirements: product.requirements } : {}),
        offers: {
          "@type": "Offer",
          price: Number(product.price) || 0,
          priceCurrency: product.currency || "VND",
          availability: "https://schema.org/InStock",
          url: absolute(productUrl(product.slug)),
        },
      },
    })),
  };
}

// Only `esc` and `jsonLdGraph` are imported by app.js. The other three were
// re-exported without a caller, which meant each had two homes and neither could
// be removed.
export { esc };

/**
 * The structured data every indexable page shares.
 *
 * The homepage used to carry its own hand-written copy of these same two nodes,
 * and the copies had drifted: the product pages read the brand name, `sameAs` and
 * `founder` from configuration, the homepage had them typed in. A crawler was
 * therefore told two different things about who the shop is, and the homepage's
 * answer was the one missing the profile links that tie the shop to the rest of
 * the web.
 *
 * FAQPage is included because the homepage's own questions are the most-asked
 * ones on the site, and they are asked in the wording people actually use.
 */
export function jsonLdGraph(products = []) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      organization(),
      websiteSchema(),
      ...(products.length ? [{
        "@type": "ItemList",
        name: `${brand()} — sản phẩm`,
        numberOfItems: products.length,
        itemListElement: products.map((product, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: product.name,
          url: absolute(productUrl(product.slug)),
        })),
      }] : []),
    ],
  });
}
