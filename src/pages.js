import { env } from "./config.js";
import { isSellable } from "./store.js";
import { esc, money } from "./format.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gitCommit = () => {
  try {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
    return r.status === 0 ? (r.stdout || '').trim() : '';
  } catch { return ''; }
};
const commitHash = gitCommit() || Date.now().toString(36);
const cssVersion = commitHash.slice(0, 8);

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
 * Fills the placeholders a product's copy is allowed to contain.
 *
 * `{{founder}}` is the owner's name, and it was typed by hand into the description
 * of a real product — as "Vũng Trọng Sơn" where the owner is "Vũ Trung Sơn". The
 * mistake lived in the database, appeared on the storefront in both languages, and
 * nothing could catch it: the name was correct in every other place on the site,
 * because everywhere else it came from BRAND_FOUNDER_NAME.
 *
 * So a product description no longer carries the name. It carries the placeholder,
 * and the one place that decides what it means is the same environment variable the
 * terms, the schema and the about page already read. Changing the name in one place
 * changes it everywhere, and a misspelling becomes impossible rather than
 * detectable.
 *
 * Called on the way out rather than on the way in, deliberately: the stored value
 * stays a placeholder, so the admin panel shows the author what is actually
 * happening instead of baking one spelling of the name into a text field where the
 * next person to save it would silently freeze a new one.
 *
 * The name is escaped for HTML because it lands inside page markup and inside
 * structured data, and it comes from configuration like anything else.
 */
export const fillCopy = (value) => {
  const text = String(value ?? "");
  if (!text.includes("{{")) return text;
  const founder = env.brand.founderName || env.brand.name;
  return text
    .replaceAll("{{founder}}", esc(founder))
    // An unknown placeholder is left alone and reported by the audit rather than
    // silently blanked, so a typo shows up as {{typo}} in the page instead of a
    // sentence with a hole in it.
    .replaceAll("{{brand}}", esc(env.brand.name));
};

/**
 * A short, honest summary for search results and link previews. The full
 * description can run to several thousand characters, and both Google and
 * Facebook truncate well before that, so a truncated wall of text buys nothing.
 */
export function productSummary(product, max = 155) {
  const source = fillCopy(product.short_description || product.shortDescription || product.description || "").replace(/\s+/g, " ").trim();
  if (source.length <= max) return source;
  const cut = source.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/**
 * The description a search engine and a link preview are shown.
 *
 * Distinct from productSummary on purpose. productSummary describes the product for a
 * reader who is already on the page, so falling back to the Vietnamese copy when the
 * English copy is missing is the better of two imperfect options. A meta description
 * is not read on the page — it is read by someone who searched in English and is
 * deciding whether to click. Serving them a Vietnamese sentence there puts the wrong
 * text in the result and reads as two pages competing for the same query, which is
 * what hreflang exists to prevent.
 *
 * So: the owner's own SEO copy when it exists, then English prose, then a
 * language-neutral line built from the product name and platform. A weak description
 * is recoverable; a description in the wrong language is worse than none.
 *
 * @param {object} product already passed through localisedProduct
 * @param {string} lang "en" or anything else for Vietnamese
 * @returns {string}
 */
export const metaDescriptionFor = (product, lang = "vi", max = 155) => {
  const own = fillCopy(String(product.seoDescription || "").trim());
  if (own) return own.length <= max ? own : `${own.slice(0, own.lastIndexOf(" ") || max)}…`;
  if (lang !== "en") return productSummary(product, max);

  // English requested, no English copy: describe it in words that are the same in
  // both languages rather than borrowing the Vietnamese sentence.
  const name = fillCopy(String(product.name || "").trim());
  const platform = fillCopy(String(product.platform || "Windows").trim());
  const summary = fillCopy(String(product.short_description || product.shortDescription || "").trim());
  if (summary && !/[À-ỹ]/.test(summary)) return productSummary(product, max);
  const derived = platform && platform.toLowerCase() !== "windows"
    ? `${name} for ${platform} — download from ${env.brand.name}`
    : `${name} for Windows — download from ${env.brand.name}`;
  return derived.length <= max ? derived : `${derived.slice(0, derived.lastIndexOf(" ") || max)}…`;
};

/**
 * The one logo URL the whole site publishes as the brand's logo.
 *
 * It was previously /favicon.svg, which is the right answer for a browser tab and
 * the wrong answer for structured data: Google asks for a logo of at least 112x112
 * and reads Organization.logo as an image to render in a knowledge panel. A 64x64
 * favicon is under that, so the field was technically present and practically
 * unusable. /logo-1024.png is the source mark at full size, generated by
 * scripts/make-logo-assets.mjs, and it is a real file rather than a path that was
 * only ever named in a comment.
 *
 * The tab icon is a different question with a different answer, and stays
 * /favicon.svg: 64px is all a tab can show, and SVG is sharper there.
 */
export const LOGO_PATH = "/logo-1024.png";

/**
 * The icon slots, declared once because every page has to link the same set.
 *
 * Each entry is one place a logo can be shown by something other than this site:
 * a browser tab, an iOS home screen, a Windows taskbar, an installed PWA, a Safari
 * pinned tab. They were all missing except the tab. A page that declares only
 * favicon.svg is not a page with a favicon — it is a page with a favicon and no
 * iOS icon, which is invisible until someone installs the shop and sees a blank
 * square with no way to tell what it is.
 *
 * `sizes` is what the browser uses to pick; it must be present and correct on each
 * entry, or Chrome logs a warning and guesses.
 */
export const ICON_LINKS = [
  { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
  { rel: 'icon', href: '/icon-16.png', type: 'image/png', sizes: '16x16' },
  { rel: 'icon', href: '/icon-32.png', type: 'image/png', sizes: '32x32' },
  { rel: 'icon', href: '/icon-192.png', type: 'image/png', sizes: '192x192' },
  { rel: 'icon', href: '/icon-512.png', type: 'image/png', sizes: '512x512' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
  { rel: 'mask-icon', href: '/mask-icon.png', color: '#0f2a22' },
  { rel: 'manifest', href: '/site.webmanifest' },
];

/** The <link> lines for every icon slot, one per line, ready to drop into a <head>. */
export const iconLinkMarkup = () => ICON_LINKS.map((link) => {
  const attrs = [`rel="${link.rel}"`, `href="${link.href}"`];
  if (link.type) attrs.push(`type="${link.type}"`);
  if (link.sizes) attrs.push(`sizes="${link.sizes}"`);
  if (link.color) attrs.push(`color="${link.color}"`);
  return `<link ${attrs.join(' ')}>`;
});

/**
 * The raster card for link previews.
 *
 * The per-product SVG at /og/:slug.svg is still generated, because some
 * crawlers render it. It is not what og:image points at, because Facebook, Zalo,
 * Telegram, Slack, LinkedIn and most AI answer engines refuse SVG outright and
 * show an empty box instead. This PNG is generated once by
 * scripts/make-og-image.mjs and committed, so neither the build nor the server
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
  description: env.brand.description,
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
  description: metaDescriptionFor(product, lang),
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
 * The brand, as a meta tag, so the browser knows it.
 *
 * It used to be a literal in the dictionary, and then it briefly became the part of
 * SUPPORT_EMAIL after the "@" — which printed the bare domain in the footer in lower
 * case, and would have printed "gmail.com" the moment the support address moved to a
 * webmail provider. Neither is the brand. The name belongs to the configuration, so
 * it is injected once here and every page reads it back, exactly the way the support
 * address already is.
 */
/**
 * The site's identity, in the form link previews read.
 *
 * Every page gets this, so the shop's name is stated once from configuration rather
 * than typed into each template's head. It used to be typed into index.html's
 * og:site_name, og:title, og:image:alt, twitter:title and twitter:description —
 * eleven literals of the same name across one file, while the product pages read
 * the same thing from env.brand.name. Change BRAND_NAME and the homepage kept
 * announcing the old shop on every share.
 *
 * Only the identity tags live here. The title and description are per page: the
 * homepage sells the shop and a product page sells one thing, and a shared tag
 * would have one of them wrong.
 */
export const brandMeta = () => [
  `<meta name="x-brand" content="${esc(env.brand.name)}">`,
  `<meta property="og:site_name" content="${esc(env.brand.name)}">`,
  `<meta property="og:brand" content="${esc(env.brand.name)}">`,
  `<meta name="twitter:site" content="${esc(env.brand.name)}">`,
].join("\n");

/**
 * The wordmark every header shows, built from BRAND_NAME.
 *
 * It is generated rather than templated because of the typographic split: the last
 * segment is styled separately, so "SonVuDev" renders as SonVu|Dev with Dev in the
 * accent colour. A single {{brandName}} cannot express that, which is the whole
 * reason the name ended up typed into fourteen places — seven HTML files, twice in
 * most of them, plus the product page the server builds in code.
 *
 * Fourteen copies is fourteen chances to answer a rename with the old shop. It was
 * already true once: the product page is the surface a crawler reads most, and its
 * header announced the old brand while the title, the canonical, the structured data
 * and every email had all moved to the new one. No audit could see it, because the
 * audit counts og:site_name inside public/*.html and this markup is generated by
 * src/pages.js and never exists on disk.
 *
 * The split is read out of the name rather than configured: the last capital letter
 * that starts a word, i.e. one preceded by a lowercase letter or a digit. "SonVuDev"
 * gives SonVu|Dev, "MyStore" gives My|Store, and a single-word name gives no split at
 * all — which is the right answer rather than a failure.
 */
export const brandWordmark = () => {
  const name = String(env.brand.name || "").trim();
  const mark = esc(name.slice(0, 1));
  let cut = -1;
  for (let i = name.length - 1; i > 0; i -= 1) {
    if (/[A-Z]/.test(name[i]) && /[a-z0-9]/.test(name[i - 1])) { cut = i; break; }
  }
  // The mark is the shop's own logo rather than the first letter of its name. The
  // letterform was a second, hand-drawn version of the same idea and it was the one
  // that survived: the header on all fourteen pages, the admin panel and every email
  // carried a plain S in a rounded square while the favicon, the share card and the
  // home screen icon carried the real mark. One logo, one file, everywhere.
  //
  // logo-mint is the light silhouette (--brand-mist) for use on dark surfaces like the
  // header brand mark. The ink version (--green) is for light backgrounds only.
  const logo = `<span class="brand-mark"><img src="/logo-mint-512.png" alt="" width="26" height="26" loading="eager" decoding="async"></span>`;
  if (cut < 1) return `${logo}<span>${esc(name)}</span>`;
  return `${logo}<span>${esc(name.slice(0, cut))}<span>${esc(name.slice(cut))}</span></span>`;
};

/**
 * Every {{token}} a static page template is allowed to carry, in one place.
 *
 * This list used to exist three times — as eleven replaceAll calls in
 * src/app.js, as a hand-written set in scripts/audit-web.mjs, and as another
 * one in test/support-address.test.js — and the three had already drifted:
 * {{brandWordmark}} was filled by the renderer but unknown to the audit, so the
 * build failed on thirteen correct pages while a real leak on /product/:slug
 * passed every gate. One list, exported from the module that also builds the
 * values, so adding a token in one place updates the renderer, the audit and
 * the tests together.
 */
export const PAGE_TOKENS = [
  "site", "brandName", "brandWordmark", "support", "paymentWindowHours",
  "reviewMinLength", "reviewMaxLength", "year", "legalEntityLine", "jsonLd", "iconLinks", "cssVersion",
];
/** Placeholders inside product copy, filled on the way out rather than in a page. */
export const COPY_TOKENS = ["founder", "brand"];
export const KNOWN_TEMPLATE_TOKENS = [...PAGE_TOKENS, ...COPY_TOKENS];

/**
 * The value of every page token for one render. reviewLimits travels as an
 * argument rather than an import so this module keeps its single dependency on
 * the store and never reaches into the review rules itself.
 */
export function pageTokenValues({ products = [], reviewLimits = null } = {}) {
  return {
    site: env.appUrl,
    brandName: esc(env.brand.name),
    brandWordmark: brandWordmark(),
    support: env.email.supportEmail,
    paymentWindowHours: String(env.orders.paymentWindowHours),
    reviewMinLength: String(reviewLimits?.minLength ?? 20),
    reviewMaxLength: String(reviewLimits?.maxLength ?? 1200),
    year: String(new Date().getFullYear()),
    legalEntity: env.brand.legalEntity,
    legalEntityLine: legalEntityLine(),
    jsonLd: jsonLdGraph(products),
    // Rendered, not written into nine <head>s. The icon block is nine lines in ten
    // places otherwise, and the page that misses one is the page with no iOS icon.
    iconLinks: iconLinkMarkup().join("\n"),
    cssVersion,
  };
}

/**
 * Fills the page tokens in a template. Tokens with no value are left alone
 * rather than blanked, so a typo shows up as {{typo}} for the audit and the
 * byte-level tests to catch instead of a sentence with a hole in it.
 */
export function fillPageTokens(html, values) {
  let out = String(html ?? "");
  for (const name of PAGE_TOKENS) {
    if (values[name] !== undefined) out = out.replaceAll(`{{${name}}}`, values[name]);
  }
  return out;
}

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

/**
 * The legal-entity line, or nothing at all.
 *
 * The three legal pages each carried `<p class="legal-entity">{{legalEntity}}</p>`
 * unconditionally, and BRAND_LEGAL_ENTITY is unset by default — so every one of them
 * shipped an empty paragraph. It is not invisible: `legal-entity` has its own margin
 * and colour, so what a buyer saw on /terms was a gap where the shop's name should
 * be, on the page whose entire job is saying who is responsible for the sale.
 *
 * The whole element is the token rather than just its text, because the alternative
 * is the same empty paragraph with a different failure: an empty <p> is a layout
 * artefact that only a person looking at the page would ever notice, whereas
 * omitting it is a decision the markup makes visible in review.
 */
export const legalEntityLine = (className = 'legal-entity') => {
  const name = String(env.brand.legalEntity || '').trim();
  return name ? `<p class="${className}">${esc(name)}</p>` : '';
};

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
    // Filled here as well as on the product page. The card and the detail page are
    // both places a buyer reads the feature list, and a placeholder resolved on one
    // and not the other puts the braces in front of them on whichever they load
    // first — the homepage, in fact, which is the one the product page test never
    // looked at.
    const features = (product.features || []).slice(0, 2)
      .map((item) => `<li>✓ ${esc(fillCopy(item))}</li>`).join("");
    const badge = esc(fillCopy(product.badge) || "Mới");
    const buyAria = `Mua ${esc(product.name)}`;
    return `<article class="product-card" data-id="${esc(product.id)}">
    <div class="product-art art-${art}">
      <span class="product-badge" data-i18n="products.new">${badge}</span>
      <div class="product-logo">${esc(initials(product.name))}</div>
      <div class="art-grid"></div>
      <span class="art-spark">✦</span>
    </div>
    <div class="product-info">
      <div class="product-meta"><span>${esc(product.platform || "Windows")} · v${esc(product.version || "1.0")}</span><span>${esc(product.category || "")}</span></div>
      <h3><a href="${esc(url)}">${esc(fillCopy(product.name))}</a></h3>
      <p>${esc(fillCopy(product.shortDescription || product.short_description || product.description || ""))}</p>
      <ul>${features}</ul>
      <div class="product-buy">
        <strong>${esc(money(product.price, product.currency))}</strong>
        <a class="round-arrow" href="${esc(url)}" data-i18n-attr="aria-label:products.buyAria" aria-label="${buyAria}">↗</a>
      </div>
    </div>
  </article>`;
  });
  // An empty catalogue still has to say so in words a crawler reads, rather than
  // leaving three grey placeholder rectangles in the markup.
  return cards.length
    ? cards.join("\n")
    : `<div class="empty-state"><b data-i18n="products.emptyTitle">Chưa có sản phẩm</b><p data-i18n="products.emptyText">Hãy thử bộ lọc khác.</p></div>`;
}

/** The "02 sản phẩm" counter above the grid, in the same shape the client writes. */
export const renderIndexCount = (products) => {
  const total = (products || []).filter(isSellable).length;
  return `${String(total).padStart(2, "0")} sản phẩm`;
};

/**
 * The homepage's category filter row, built from what is actually for sale.
 *
 * It used to be three literals in index.html — two categories and a platform —
 * sitting beside a grid that was loaded live. Nothing connected the two, so a
 * product published in a fourth category appeared in the grid with no button that
 * reached it, while the three buttons offered a subset nobody had chosen. One of
 * them was not filtering on the same thing as the other two.
 *
 * The buttons come from the same products the grid renders, so one exists exactly
 * when there is something behind it, and stops existing when there is not.
 *
 * "All" keeps its data-i18n key because it is a word in the interface. The
 * categories are not translated, because they are data — the same call the product
 * names make, and the reason a category can be in any language at all.
 */
export const renderIndexFilters = (products) => {
  const counts = new Map();
  for (const product of products || []) {
    const category = String(product.category || "").trim();
    if (!category) continue;
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  const buttons = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi"))
    .map(([category, count]) => `<button class="filter" data-filter="${esc(category)}" data-count="${count}">${esc(category)}</button>`)
    .join("");
  return `<button class="filter active" data-filter="all" data-i18n="products.all">Tất cả</button>${buttons}`;
};

/**
 * The three numbers under the hero, counted from the catalogue.
 *
 * These were 01+, 4.9/5 and 100% written into the template. None of the three was a
 * measurement of anything: there is no rating in this shop, and nothing behind the
 * third one. So the strip was making claims in numbers, on the page whose whole
 * argument is that the work is careful.
 *
 * What replaced them can be counted, which means it is true at every moment without
 * anyone remembering to update it. A shop with one product reads "1", which is a
 * smaller and less impressive number and also the correct one.
 *
 * Returns null when there is nothing to count, so the caller can drop the strip
 * rather than print zeros: a shop with an empty catalogue saying "0 products" is
 * still making a statement about itself.
 */
export const renderStats = (products) => {
  const sellable = (products || []).filter(isSellable);
  if (!sellable.length) return null;
  const platforms = new Set(sellable.map((product) => String(product.platform || "").trim()).filter(Boolean));
  return {
    products: sellable.length,
    platforms: platforms.size,
    // Counting versions rather than summing a field nobody maintains: a product
    // with a `version` has at least that one release, and the catalogue does not
    // record a release history.
    releases: sellable.reduce((total, product) => total + (product.version ? 1 : 0), 0),
  };
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
export const COPY_VI = {
  home: "Trang chủ",
  products: "Sản phẩm",
  why: "Vì sao",
  faqNav: "Câu hỏi",
  about: "Về chúng tôi",
  breadcrumbLabel: "Đường dẫn",
  software: "Phần mềm",
  // Category and badge are free-text columns, so a Vietnamese product carries
  // Vietnamese words there. Rendering them raw put "Công cụ · Windows · Phát hành 1.4.0"
  // at the top of the English page. These map the values the shop actually uses; an
  // unknown one still renders as written rather than disappearing.
  categories: { "Công cụ": "Công cụ", "Tiện ích": "Tiện ích", "Phần mềm": "Phần mềm", "Khác": "Khác" },
  badges: { "Mới": "Mới", "Bán chạy": "Bán chạy", "Cập nhật": "Cập nhật", "Phát hành": "Phát hành" },
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

export const COPY_EN = {
  home: "Home",
  products: "Products",
  why: "Why us",
  faqNav: "FAQ",
  about: "About",
  breadcrumbLabel: "Breadcrumb",
  software: "Software",
  // The Vietnamese values, translated. See the note on COPY_VI: the category and
  // badge are free-text columns written in one language and rendered in both.
  categories: { "Công cụ": "Tools", "Tiện ích": "Utilities", "Phần mềm": "Software", "Khác": "Other" },
  badges: { "Mới": "New", "Bán chạy": "Best seller", "Cập nhật": "Updated", "Phát hành": "Release" },
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
  if (!product) return product;
  const resolved = lang === "en" ? localizeToEnglish(product) : product;
  // Placeholders are filled after the language is chosen, so the same stored text
  // carries the owner's name in both. Filling them first would put the name into
  // whatever was picked as the fallback, and the English page would then show a
  // Vietnamese sentence with an English name in it.
  return { ...resolved, shortDescription: fillCopy(resolved.shortDescription), description: fillCopy(resolved.description), features: (resolved.features || []).map(fillCopy) };
}

/** Chooses the English text where it exists and the Vietnamese where it does not. */
function localizeToEnglish(product) {
  const pick = (en, vi) => (String(en || "").trim() ? en : vi);
  const featuresEn = Array.isArray(product.featuresEn) ? product.featuresEn.filter((item) => String(item || "").trim()) : [];
  return {
    ...product,
    shortDescription: pick(product.shortDescriptionEn, product.shortDescription),
    description: pick(product.descriptionEn, product.description),
    features: featuresEn.length ? featuresEn : product.features,
    // SEO copy is the one pair that does NOT fall back to Vietnamese.
    //
    // Everything else falls back because missing English is better than a hole.
    // Here the fallback is a page that serves Vietnamese words in its <title> and
    // meta description, on a URL declared as the English alternative of the
    // Vietnamese one — two hreflang pages with identical metadata, which reads as
    // duplicate content rather than as a translation, and puts a Vietnamese search
    // result in front of an English-language query. A derived title from the English
    // product name is worse copy and better markup, so that is what it falls back to.
    seoTitle: pick(product.seoTitleEn, ""),
    seoDescription: pick(product.seoDescriptionEn, ""),
  };
}

/**
 * Looks a free-text product field up in the dictionary for the current language.
 *
 * `category` and `badge` are free-text columns. They are written once, in whichever
 * language the owner was typing in, and the shop has two languages — so rendering
 * them raw put a Vietnamese eyebrow at the top of every English product page:
 * "Công cụ · Windows · Phát hành 1.4.0" on a URL declared as the English alternative
 * of the Vietnamese one. A dictionary entry cannot fix that on its own, because the
 * owner can type anything into those columns; the map below covers the values the
 * shop actually uses and this is what decides what happens to the rest.
 *
 * An unknown value is returned unchanged rather than dropped. A new category the owner
 * invented should appear on both pages, in one language, rather than leave a hole —
 * the reader can still see what it is, and the alternative is an empty eyebrow.
 *
 * @param {unknown} value the raw column value
 * @param {Record<string, string>|undefined} map dictionary for the current language
 * @param {string} [fallback] used when the column is empty
 * @returns {string}
 */
export const localised = (value, map, fallback = "") => {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return map?.[raw] ?? raw;
};

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
  //
  // One shape for both languages, and the language enters through productSummary
  // and the copy table below. The ternary that used to sit here had an identical
  // arm on each side — an editor had edited one and not the other, and a page that
  // looked localized was emitting the same title twice.
  const title = product.seoTitle || `${product.name} v${product.version} — ${product.platform || "Windows"} | ${brand()}`;
  const description = metaDescriptionFor(product, lang);
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
<link rel="stylesheet" href="/styles.css?v=${cssVersion}">
${brandMeta()}
${jsonLd([organization(), websiteSchema(), productSchema(product, lang), breadcrumbSchema(product, lang), faq])}
</head>
<body class="product-page">
<header class="site-header"><a class="brand" href="/">${brandWordmark()}</a><nav><a href="/#products">${copy.products}</a><a href="/#why">${copy.why}</a><a href="/#faq">${copy.faqNav}</a></nav><a class="header-cta" href="#mua">${copy.buyNow} <span>↗</span></a></header>
<main class="wrap">
<nav class="crumbs" aria-label="${copy.breadcrumbLabel}"><a href="/">${copy.home}</a> <span>/</span> <a href="/#products">${copy.products}</a> <span>/</span> <span aria-current="page">${esc(product.name)}</span></nav>
<article class="product-detail">
<header class="product-hero">
<div>
<p class="eyebrow">${esc(localised(product.category, copy.categories, copy.software))} · ${esc(product.platform || "Windows")}${product.badge ? ` · ${esc(localised(product.badge, copy.badges))}` : ""}</p>
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
<script src="/format.js"></script>
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

// `esc` is re-exported because app.js builds its own markup with it — one
// implementation, two consumers, rather than a second copy of the escape rules.
// The other three that used to sit here had no caller at all, which meant each had
// two homes and neither could be removed.
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
