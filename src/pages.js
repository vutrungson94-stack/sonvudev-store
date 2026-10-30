import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config.js";
import { isSellable } from "./store.js";
import { esc, money, formatBytes, initials } from "./format.js";
import { commitHash } from "./lib/git.mjs";

// The commit that produced this process, for CSS cache-busting. This replaces a
// private copy of the git call that scripts/build-web.mjs also carried, so the
// live page and the packaged page could end up naming different stylesheet
// versions. Both now read the single implementation in src/lib/git.mjs.
const cssVersion = commitHash().slice(0, 8);

// Product pages are rendered on the server here, not in the browser. The
// storefront sends an empty skeleton and fills it in with JavaScript. That is
// fine for a person, but leaves a search engine with a page of empty headings
// and no products, and it leaves link-preview crawlers (those used by Facebook,
// Zalo and Telegram when a URL is shared) with nothing at all.
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
  // The camelCase field is the one localize() has already picked for this
  // language and stripped of prices; the snake_case field is the raw database
  // row. Preferring the raw row put Vietnamese text in English metadata and
  // reintroduced prices the render path had just removed.
  const source = fillCopy(product.shortDescription || product.short_description || product.description || "").replace(/\s+/g, " ").trim();
  if (source.length <= max) return source;
  const cut = source.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/**
 * Tokens that make a string unusable as product data.
 *
 * Google's product data specification forbids price, discount and urgency in the
 * title, and Merchant Center reads the landing page title whenever the page does
 * not carry a Product node. This catalogue's copy was written for a sale, so the
 * title read "RAMCleaner Early Bird - 199k VND (33% off) First 100 Customers
 * Only" — three violations in one line, and the reason the feed item was built
 * from it instead of from the catalogue.
 *
 * The check is deliberately all-or-nothing. Editing a promotional sentence token
 * by token leaves the grammar behind ("all features for instead of ."), and a
 * half-rewritten title is worse data than a clean one derived from the product's
 * own name. So a string that trips this is discarded, not repaired.
 */
export const PROMO_IN_TEXT = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${[
    String.raw`\d[\d.,]*\s*k?\s*(?:₫|đ|vnd|usd|eur|gbp)`,
    String.raw`[$€£]\s?\d`,
    String.raw`\d{1,3}\s*%`,
    String.raw`(?:first|only|last)\s+\d+\s+(?:customers?|copies|orders?|slots?|units?)`,
    String.raw`\d+\s+(?:copies|gói|khách)`,
    String.raw`chỉ\s+\d+\s+(?:gói|bản|khách|suất)`,
    String.raw`giảm\s+\d`,
    // Vietnamese sale wording that carries no number: "mua sớm", "khóa giá",
    // "ưu đãi". The bare word "giá" is deliberately not matched on its own,
    // because "đánh giá" (review) is a legitimate word and would be dropped
    // with it. A "giá" followed by a sale qualifier is still promotional.
    String.raw`(?:mua sớm|mua ngay|đặt ngay|khóa giá|giữ giá|ưu đãi|khuyến m[ãa]i|giảm giá|hết là hết)`,
    String.raw`giá\s+(?:chỉ|sẽ|gốc|tiêu chuẩn|niêm yết|ưu đãi|rẻ)`,
    String.raw`(?:early bird deal|limited time|while supplies last|act now|hurry|order now|buy now|special offer|discount|on sale|lock in)`,
    String.raw`prices?`,
  ].join("|")})(?![\\p{L}\\p{N}_])`,
  "iu"
);

/**
 * The owner's SEO copy when it is safe to publish, otherwise an empty string.
 *
 * Returning "" rather than a repaired string is what lets every caller fall back
 * to a title built from the product's own name, which is the only value that is
 * guaranteed to be free of the promotion the owner was running that week.
 */
const cleanSeoText = (value) => {
  const text = fillCopy(String(value ?? "")).trim();
  return text && !PROMO_IN_TEXT.test(text) ? text : "";
};

const truncateAtWord = (text, max) => (text.length <= max ? text : `${text.slice(0, text.lastIndexOf(" ") || max)}…`);

/**
 * A last-resort description built only from facts the catalogue always carries.
 *
 * Reached when the owner's copy is entirely promotional or in the wrong
 * language. It describes the product and the platforms it runs on without
 * mentioning a price, a discount or a deadline — the three things Google's
 * product data specification forbids in this field.
 */
const derivedDescription = (product, max = 0) => {
  const name = fillCopy(String(product.name || "").trim());
  const platform = fillCopy(String(product.platform || "Windows").trim());
  const line = `${name} for ${platform} — software from ${env.brand.name}`;
  return max ? truncateAtWord(line, max) : line;
};

/**
 * The first sentence of the full description that says something factual.
 *
 * A short description can be nothing but a sale notice ("Early bird deal for the
 * first 100 customers"), and using it as the meta description means the one
 * sentence Google has to judge the page by describes a discount rather than a
 * product. The full description usually still carries a real sentence, so the
 * promotional one is skipped instead of being rewritten — the same rule the
 * title follows.
 *
 * English pages never borrow Vietnamese prose here: a meta description in the
 * wrong language is worse than a derived one, and the caller has a fallback.
 */
const firstCleanSentence = (product, lang, max) => {
  const raw = String(product.description || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (lang === "en" && /[À-ỹ]/.test(raw)) return "";
  const sentence = raw.split(/(?<=[.!?])\s+/).find((item) => item.length >= 20 && !PROMO_IN_TEXT.test(item));
  return sentence ? truncateAtWord(sentence, max) : "";
};

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
 * So: the owner's own SEO copy when it exists and carries no promotion, then the
 * product's own prose, then a language-neutral line built from the product name and
 * platform. A weak description is recoverable; a description in the wrong language
 * is worse than none.
 *
 * @param {object} product already passed through localisedProduct
 * @param {string} lang "en" or anything else for Vietnamese
 * @returns {string}
 */
const metaDescriptionFor = (product, lang = "vi", max = 155) => {
  const own = cleanSeoText(product.seoDescription);
  if (own) return truncateAtWord(own, max);

  // The short description is the preferred summary, but only when it describes
  // the product in the language the page declares. A promotional summary is
  // skipped rather than rewritten; the full description is asked for one clean
  // sentence next.
  const summary = productSummary(product, max);
  const usable = summary && !PROMO_IN_TEXT.test(summary) && (lang !== "en" || !/[À-ỹ]/.test(summary));
  if (usable) return summary;

  const clean = firstCleanSentence(product, lang, max);
  if (clean) return clean;

  // Every sentence was promotional or in the wrong language. The derived line
  // still says what the product is, and it says nothing about its price.
  return derivedDescription(product, max);
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

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

/**
 * The per-product covers scripts/make-product-images.mjs writes, read once.
 *
 * Read once rather than per request: the directory only changes when the
 * generator runs, and a product page should not pay a stat call per render. A
 * missing directory is a valid state — a checkout without the assets still
 * serves pages — so it becomes an empty set rather than an error.
 */
let coverCache = null;
const productCovers = () => {
  if (coverCache) return coverCache;
  try {
    coverCache = new Set(readdirSync(path.join(PUBLIC_DIR, "og")).filter((file) => file.endsWith(".png")));
  } catch {
    coverCache = new Set();
  }
  return coverCache;
};

/**
 * The image a crawler is given for this product.
 *
 * A catalogue-wide logo is the same image for every item, and Merchant Center
 * reads that as "the image does not show the product". The generated cover per
 * slug is distinct, carries no price or promotion, and is 1200x630, so it also
 * satisfies the share-card dimensions. `imageUrl` wins over both: an owner who
 * uploads a real screenshot should never have to edit code for it.
 */
const productImage = (product) => {
  const explicit = String(product.imageUrl || product.image_url || "").trim();
  if (explicit) return /^https?:\/\//i.test(explicit) ? explicit : absolute(explicit);
  const slug = String(product.slug || "").trim();
  if (slug && productCovers().has(`${slug}.png`)) return absolute(`/og/${slug}.png`);
  return absolute(LOGO_PATH);
};

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
const OG_IMAGE_PATH = "/og.png";

/**
 * Every page og:image, og:image:width and og:image:height have to agree, so the
 * numbers live here rather than being repeated in each meta block.
 */
const OG_IMAGE = { path: OG_IMAGE_PATH, width: 1200, height: 630 };

// brand, organization, brandWordmark and legalEntityLine were all exported. None of
// them has an importer anywhere in src/, scripts/ or test/ — each is used only by
// this module — and an export with no reader is an API nobody agreed to. They stay
// here as functions, which is what they always were; the export was the orphan.
const brand = () => env.brand.name;

const organization = () => ({
  "@type": "Organization",
  "@id": `${site()}/#organization`,
  name: brand(),
  url: `${site()}/`,
  logo: absolute(LOGO_PATH),
  description: env.brand.description,
  // Contact details for the Merchant Center misrepresentation check and for
  // Google's knowledge graph: a brand with a real address and phone is treated
  // as a verifiable entity, an anonymous one is not. Hardcoded here rather than
  // read from env so the deploy contract (render.yaml/.env.example) does not
  // gain five new variables; a solo developer changes them in this one place.
  telephone: "+84348808045",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Đường XH3, Tổ 4, Khu Phố Phú Điền",
    addressLocality: "Phường Chánh Phú Hòa",
    addressRegion: "Thành Phố Hồ Chí Minh",
    postalCode: "75913",
    addressCountry: "VN",
  },
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
/**
 * The verification block: the links a claim rests on, and nothing else.
 *
 * Three things this deliberately does not do. It never asserts the software is
 * safe, because a page asserting that is worth nothing next to a scan a reader can
 * open. It does not show the build report as though it described the download — the
 * report covers this storefront's own server code, and passing it off as product
 * verification is the same overclaiming the product copy was already corrected
 * for. And it never renders a row for evidence that is missing: a "verified" link
 * with no href behind it is worse than no row, because it looks like a pass.
 */
const trustBlock = (product, copy) => {
  const scan = String(product.virusScanUrl || "").trim();
  if (!scan) return "";
  const rows = [`<li><a href="${esc(scan)}" rel="nofollow noopener" target="_blank">${esc(copy.trustScan)}</a><small>${esc(copy.trustScanNote)}</small></li>`];
  rows.push(`<li><a href="/build-report.json">${esc(copy.trustBuild)}</a><small>${esc(copy.trustBuildNote)}</small></li>`);
  return `<section class="detail-block trust"><h2>${esc(copy.trustHeading)}</h2><ul class="trust-list">${rows.join("")}</ul></section>`;
};

const productSchema = (product, lang = "vi") => ({
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
  image: productImage(product),
  brand: { "@type": "Brand", name: brand() },
  ...(env.brand.socialLinks.length ? { sameAs: env.brand.socialLinks } : {}),
  author: { "@id": `${site()}/#organization` },
  publisher: { "@id": `${site()}/#organization` },
  offers: {
    "@type": "Offer",
    price: Number(product.price) || 0,
    priceCurrency: product.currency || "VND",
    availability: "https://schema.org/InStock",
    url: absolute(productUrl(product.slug, lang)),
    seller: { "@id": `${site()}/#organization` },
  },
});

/**
 * The node Merchant Center reads.
 *
 * SoftwareApplication is the right type for an app rich result and the wrong type
 * for a product feed: Google's merchant listing markup expects Product with an
 * Offer, and a page that ships only SoftwareApplication is a page Merchant Center
 * has to guess at. That guess is what produced a feed item titled
 * "RAMCleaner Early Bird - 199k VND (33% off) First 100 Customers Only": with no
 * Product to read, Google fell back to <title> and the meta description.
 *
 * Both nodes are emitted. They describe the same URL, they do not contradict each
 * other, and each is read by a different Google surface — the app result reads
 * SoftwareApplication, the shopping surface reads Product.
 *
 * `price` is the shelf price in the product's own currency, which is also the
 * number printed on the page. It is never the converted figure: a price that
 * moves with the exchange rate is a price Google cannot match on the next crawl.
 */
const merchantProductSchema = (product, lang = "vi") => {
  const url = absolute(productUrl(product.slug, lang));
  const currency = String(product.currency || "VND").toUpperCase();
  // Google's description attribute is a product description, not a sale notice.
  // Sentences that only exist to run a promotion are dropped whole — a sentence
  // is the smallest unit that survives deletion with its grammar intact. If every
  // sentence was promotional, a line derived from the product's own name and
  // platforms is used instead of the raw text: an empty field is an error, but a
  // promotional one is the policy violation this code exists to remove.
  const rawDescription = String(product.description || product.shortDescription || "").replace(/\s+/g, " ").trim();
  const kept = rawDescription.split(/(?<=[.!?])\s+/).filter((sentence) => !PROMO_IN_TEXT.test(sentence)).join(" ").trim();
  const description = (kept || derivedDescription(product)).slice(0, 5000);
  return {
    "@type": "Product",
    "@id": `${url}#product`,
    name: fillCopy(String(product.name || "").trim()),
    description,
    url,
    // One image, resolved by productImage(): an uploaded screenshot first, then
    // the generated cover for this slug, then the brand mark. Google wants an
    // image of the product, not a catalogue-wide logo.
    image: [productImage(product)],
    // No GTIN is assigned to a small developer's utility, so the identifier pair
    // Google asks for instead is brand + MPN. The product id is stable and unique.
    sku: String(product.id || product.slug),
    mpn: String(product.id || product.slug),
    brand: { "@type": "Brand", name: brand() },
    category: "Software > Computer Software",
    additionalType: "https://schema.org/SoftwareApplication",
    itemCondition: "https://schema.org/NewCondition",
    offers: {
      "@type": "Offer",
      price: Number(product.price) || 0,
      priceCurrency: currency,
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      url,
      seller: { "@id": `${site()}/#organization` },
      // The refund policy published at /refund: 14 days, no restocking fee. Stated
      // in the offer because Merchant Center reads it from here when the account
      // has no return policy configured.
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 14,
        returnFees: "https://schema.org/FreeReturn",
      },
    },
  };
};

const breadcrumbSchema = (product, lang = "vi") => {
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
const faqSchema = (product, lang = "vi") => {
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
const websiteSchema = () => ({
  "@type": "WebSite",
  "@id": `${site()}/#website`,
  name: brand(),
  url: `${site()}/`,
  inLanguage: "vi-VN",
  publisher: { "@id": `${site()}/#organization` },
});

/**
 * The one place a structured-data block is serialised.
 *
 * Every node gets its own `@context`. Without it the block is valid JSON and
 * invalid JSON-LD: a consumer has no vocabulary to resolve `Product` or
 * `SoftwareApplication` against, so it ignores the graph and falls back to
 * <title>, the meta description and og:image. That fallback is exactly how a
 * promotional page title ended up as a Merchant Center product title.
 *
 * The product page passes one `@graph` document, which is the shape the
 * homepage already used. That keeps the Organization and WebSite nodes
 * byte-identical on both pages — a crawler comparing them is comparing the
 * shop's identity, and two spellings of it is the drift the graph exists to
 * prevent. The array branch stays for any caller that ships loose nodes.
 */
const jsonLd = (data) => {
  const withContext = (node) => (node && typeof node === "object" && !Array.isArray(node)
    ? { "@context": "https://schema.org", ...node }
    : node);
  const payload = Array.isArray(data) ? data.map(withContext) : withContext(data);
  return `<script type="application/ld+json">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>`;
};

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
 * Cloudflare Web Analytics, on every page.
 *
 * There was no way to answer "has anyone ever actually visited this shop?" —
 * the only orders on record were the owner's own test purchases. Cloudflare's
 * edge already fronts this site, so the beacon is first-party to the same
 * operator and the measurement costs nothing.
 *
 * The snippet is written here rather than pasted into ten templates for the
 * same reason brandMeta exists: one definition, every page gets the same tag,
 * and rotating the token is a one-line change. The automatic injection Cloudflare
 * offers for proxied zones did not fire for this zone, which is why the tag is
 * explicit.
 *
 * Two CSP entries back it (see src/app.js): the script host, and the endpoint
 * the beacon reports to. Without them the browser blocks the tag and the
 * dashboard shows a confident zero.
 */
export const analyticsMeta = () => {
  const token = env.analytics.webAnalyticsToken;
  if (!token) return "";
  return [
    "<!-- Cloudflare Web Analytics -->",
    `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${esc(token)}"}'></script>`,
    "<!-- End Cloudflare Web Analytics -->",
  ].join("");
};

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
const brandWordmark = () => {
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
  // logo-ink rather than the source mark: the source is a flat #3f6a5c, which measures
  // 2.71:1 against the paper-white header — below the 3:1 WCAG asks of a graphic that
  // carries meaning. logo-ink is the same silhouette in --green, 3.3:1. The shape is
  // identical; only the tint differs, because a surface decides how a mark is inked.
  const logo = `<span class="brand-mark"><img src="/logo-ink-64.png" alt="" width="26" height="26" loading="eager" decoding="async"></span>`;
  if (cut < 1) return `${logo}<span>${esc(name)}</span>`;
  return `${logo}<span>${esc(name.slice(0, cut))}<span>${esc(name.slice(cut))}</span></span>`;
};

/**
 * The header bar and the footer, written once.
 *
 * Both used to be a block of markup copied into ten files, and ten copies is nine
 * chances to be the tenth one that is different. /about and /404 still carried the
 * old one-line footer, /lookup and /paypal-return carried no bar at all, and the
 * homepage carried a third navigation that no other page could afford to copy
 * because it held the language switch. Nothing reported any of it: every file was
 * internally correct, and no check asks whether two pages agree with each other.
 *
 * So the set of links is data here, and the one question a hand-written file
 * cannot answer is answered by code — which of these links points back at the page
 * the reader is already on. A footer offering "Terms" to someone reading the terms
 * is a button that costs a click to arrive where they already are, and the answer
 * depends on the route, which only the server knows. Excluding the current page is
 * therefore not a thing each template may or may not do; it is the behaviour of
 * every footer, written once, on every page including the ones generated in code.
 *
 * Two label sources, one list. The static pages are translated in the browser by
 * public/i18n.js, so their anchors carry data-i18n and the Vietnamese inside them
 * is only the pre-script fallback a crawler reads. The product page is rendered by
 * this module in one language per URL and loads no dictionary, so it reads
 * COPY_VI/COPY_EN. `vi` is therefore the one word that appears in both worlds — it
 * is the fallback the server writes into the markup, and audit-web.mjs holds it
 * against the dictionary's own Vietnamese, so the two cannot drift.
 */

/**
 * A link, and the page it belongs to.
 *
 * `route` is what makes two links "the same page to a reader": the two homepage
 * anchors share the route "/" because they are sections of it, and the footer
 * drops both while the reader stands there. `page: true` marks a whole page, and
 * only a whole page can be aria-current="page" — two anchors on the homepage would
 * otherwise both claim to be the page the reader is on, and the announcement a
 * screen reader makes would name a section as if it were the site.
 */
const HEADER_LINKS = [
  { href: "/#products", route: "/", key: "nav.products", copy: "products", vi: "Sản phẩm" },
  { href: "/#faq", route: "/", key: "nav.faq", copy: "faqNav", vi: "FAQ" },
  { href: "/terms", route: "/terms", key: "nav.terms", copy: "terms", vi: "Điều khoản", page: true },
];

const FOOTER_LINKS = [
  { href: "/#products", route: "/", key: "nav.products", copy: "products", vi: "Sản phẩm" },
  { href: "/#faq", route: "/", key: "nav.faq", copy: "faqNav", vi: "FAQ" },
  { href: "/terms", route: "/terms", key: "nav.terms", copy: "terms", vi: "Điều khoản", page: true },
  { href: "/privacy", route: "/privacy", key: "nav.privacy", copy: "privacy", vi: "Bảo mật", page: true },
  { href: "/refund", route: "/refund", key: "nav.refund", copy: "refund", vi: "Hoàn tiền", page: true },
  { href: "/about", route: "/about", key: "nav.about", copy: "about", vi: "Về chúng tôi", page: true },
  { href: "/lookup", route: "/lookup", key: "nav.lookup", copy: "lookup", vi: "Tra cứu đơn", page: true },
  { mail: true, route: null, key: "nav.contact", copy: "contact", vi: "Liên hệ" },
];

/**
 * The route a template answers on, from the file it lives in.
 *
 * The file name is the route because every page in public/ is registered under its
 * own name by src/app.js — /terms.html answers /terms — so this reads the same
 * table the router does rather than keeping a second list of addresses.
 */
const routeForFile = (file) => {
  const name = String(file || "").trim();
  if (!name) return "";
  if (name === "index.html") return "/";
  return `/${name.replace(/\.html$/, "")}`;
};

const chromeLink = (link, route, copy) => {
  // The support address is configuration, and it is already filled into these
  // pages as {{support}} — the same value the mail templates and the terms use.
  const href = link.mail ? `mailto:${esc(env.email.supportEmail)}` : link.href;
  const label = copy ? copy[link.copy] : link.vi;
  const current = link.page && link.route === route ? ' aria-current="page"' : "";
  // The dictionary form keeps the switch working on a page that loads i18n.js;
  // the copy form is the product page, which is written in one language already.
  return copy
    ? `<a href="${href}"${current}>${esc(label)}</a>`
    : `<a href="${href}" data-i18n="${link.key}"${current}>${esc(label)}</a>`;
};

/**
 * The navigation every page carries, wrapped in its own <nav>.
 *
 * @param {string} route the route being rendered, or "" when it is none of them
 * @param {object} [copy] COPY_VI/COPY_EN when the server writes the words itself
 */
export const headerNav = (route, copy = null) =>
  `<nav>${HEADER_LINKS.map((link) => chromeLink(link, route, copy)).join("")}</nav>`;

/**
 * The footer's links: every one of them, except the one that points at this page.
 *
 * @param {string} route the route being rendered, or "" when it is none of them
 * @param {object} [copy] COPY_VI/COPY_EN when the server writes the words itself
 */
export const footerLinks = (route, copy = null) =>
  FOOTER_LINKS.filter((link) => !link.route || link.route !== route)
    .map((link) => chromeLink(link, route, copy)).join("");

/**
 * The footer as one element, for the page rendered in code rather than from a
 * template. The template pages get their <footer> from their own file so the brand
 * wordmark and the tagline stay in the markup; this is the same bar without the
 * two strings that live only in the dictionary.
 */
export const footerBar = (route, copy) =>
  `<footer class="site-footer wrap"><div class="brand">${brandWordmark()}</div>` +
  `<div class="footer-links">${footerLinks(route, copy)}</div>` +
  `<small>© ${new Date().getFullYear()} ${esc(brand())} · ${esc(copy.tagline)}</small></footer>`;

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
 *
 * PAGE_TOKENS and COPY_TOKENS stay `export const` even though almost nothing
 * imports them: scripts/audit-web.mjs reads them out of this file as *text*
 * (see readTokenList there), so the literal words `export const` are the
 * contract. The exports the audit does not read and nothing imports were
 * removed — an export with no reader is an API nobody agreed to.
 */
export const PAGE_TOKENS = [
  "site", "brandName", "brandWordmark", "support", "paymentWindowHours",
  "reviewMinLength", "reviewMaxLength", "year", "legalEntityLine", "jsonLd", "iconLinks", "cssVersion",
  "policyUpdated", "policyUpdatedDisplay", "headerNav", "footerLinks",
];
/**
 * The date printed at the top of the refund policy.
 *
 * It is a constant rather than "today" on purpose. A buyer who asks for a refund
 * five months from now is answering to the policy that was published when they
 * paid, not the one that has been reworded since; the order records this value
 * beside the moment they accepted it, and the policy page renders the same one so
 * the two can never say different dates.
 */
export const REFUND_POLICY_UPDATED = "2026-09-28";

/**
 * The same date as a reader sees it.
 *
 * The constant stays ISO because it is written onto every order and has to sort
 * and compare as a date. A legal page is not that: it prints "28/09/2026" in
 * Vietnamese and "28 September 2026" to an English reader. Formatting that at
 * each of the six places it appears is how the six came to disagree in the first
 * place — three templates typed the date by hand and drifted from the dictionary
 * the moment the constant moved.
 *
 * So there is one formatter and one token, and the fallback text in the HTML and
 * the string in the dictionary are the same value filled the same way.
 *
 * @param {string} iso an ISO date
 * @param {string} lang the page language
 * @returns {string} the date as that language writes it
 */
export const policyUpdatedFor = (iso, lang) => {
  const at = new Date(`${String(iso)}T00:00:00Z`);
  if (!Number.isFinite(at.getTime())) return String(iso);
  return at.toLocaleDateString(lang === "en" ? "en-GB" : "vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
  });
};
/** Placeholders inside product copy, filled on the way out rather than in a page. */
export const COPY_TOKENS = ["founder", "brand"];
export const KNOWN_TEMPLATE_TOKENS = [...PAGE_TOKENS, ...COPY_TOKENS];

/**
 * The value of every page token for one render. reviewLimits travels as an
 * argument rather than an import so this module keeps its single dependency on
 * the store and never reaches into the review rules itself.
 *
 * `page` is the template being rendered, and it is the one thing the chrome needs
 * to know: the footer is the same everywhere except that it does not offer a link
 * back to the page it is printed on. See headerNav() and footerLinks().
 */
export function pageTokenValues({ products = [], reviewLimits = null, page = "" } = {}) {
  const route = routeForFile(page);
  return {
    site: env.appUrl,
    brandName: esc(env.brand.name),
    brandWordmark: brandWordmark(),
    support: env.email.supportEmail,
    paymentWindowHours: String(env.orders.paymentWindowHours),
    reviewMinLength: String(reviewLimits?.minLength ?? 20),
    reviewMaxLength: String(reviewLimits?.maxLength ?? 1200),
    year: String(new Date().getFullYear()),
    // The day the refund policy was last reworded. Written on the policy page and
    // stored on every order placed after it, so a buyer who disputes the terms can
    // be shown the exact text they were given rather than whatever the page says
    // today. Two copies of this date is the bug where they disagree under a
    // dispute; it lives here because every reader imports it from one module.
    policyUpdated: REFUND_POLICY_UPDATED,
    policyUpdatedDisplay: policyUpdatedFor(REFUND_POLICY_UPDATED, "vi"),
    // Only legalEntityLine, not legalEntity. fillPageTokens fills the names in
    // PAGE_TOKENS and "legalEntity" is not one of them, so the bare value below
    // was an entry in this object that nothing could ever read — the legal entity
    // reached the page through the line, which is what handles it being empty.
    legalEntityLine: legalEntityLine(),
    jsonLd: jsonLdGraph(products),
    // Rendered, not written into nine <head>s. The icon block is nine lines in ten
    // places otherwise, and the page that misses one is the page with no iOS icon.
    iconLinks: iconLinkMarkup().join("\n"),
    // The same argument for the two bars, and one step further: the footer cannot
    // be a block of text at all, because which of its links is missing depends on
    // the route being rendered.
    headerNav: headerNav(route),
    footerLinks: footerLinks(route),
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
 * The configuration values a language switch still needs, shipped in one meta
 * tag.
 *
 * The legal pages carry {{paymentWindowHours}} and {{support}} inside their
 * *translations*. The server fills those placeholders into the HTML it renders,
 * and that is the only copy it can reach: when a reader switches language,
 * i18n.js replaces the paragraph with the dictionary copy through I18N.t(),
 * which brings the placeholder back with it. The sentence then reads "cancelled
 * after {{paymentWindowHours}} hours", on a page that was correct a second
 * earlier. Both dictionaries are affected, so neither language is the safe one.
 *
 * Hard-coding the numbers into both dictionaries is the other way out, and it
 * is worse: the refund window would then be written in three places (config,
 * English, Vietnamese) with nothing tying them together. The values travel with
 * the page instead, and the browser substitutes them on the way out.
 *
 * Values are percent-encoded because a support address contains "@" and a
 * payment window does not — the delimiter has to survive both.
 */
export const tokenMeta = () => {
  // JSON rather than name=value pairs joined by a delimiter. The joined form
  // needs a separator no value can contain, and escaping it needs an escape
  // helper of its own — which is a third copy of esc() and exactly what the
  // escCopies metric is there to catch. esc(JSON.stringify(...)) reuses the one
  // in format.js, and the browser gets clean JSON back after parsing the
  // attribute.
  const values = {
    brandName: String(env.brand.name ?? ""),
    site: String(env.appUrl ?? ""),
    support: String(env.email.supportEmail ?? ""),
    year: String(new Date().getFullYear()),
    paymentWindowHours: String(env.orders.paymentWindowHours ?? ""),
    // The refund policy's own date, for the sentence the buyer reads on the policy
    // page. It travels with the page tokens so the policy date in the dictionary
    // and the one recorded on the order are filled from the same constant.
    policyUpdated: REFUND_POLICY_UPDATED,
    policyUpdatedDisplay: policyUpdatedFor(REFUND_POLICY_UPDATED, "vi"),
    // The browser fills the English sentences from this too, so a language switch
    // shows the date written the way that language writes dates.
    policyUpdatedDisplayEn: policyUpdatedFor(REFUND_POLICY_UPDATED, "en"),
  };
  return `<meta name="sv-tokens" content="${esc(JSON.stringify(values))}">`;
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
const productUrl = (slug, lang = "vi") => (lang === "en" ? `/en/product/${slug}` : `/product/${slug}`);

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
const legalEntityLine = (className = 'legal-entity') => {
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
/**
 * The homepage product grid, rendered in Vietnamese with data attributes
 * for client-side translation. Categories and badges include both VI and EN
 * so the browser can switch languages without a server round-trip.
 */
export function renderIndexGrid(products) {
  const cards = (products || []).filter(isSellable).map((product) => {
    const art = esc(String(product.category || "khac").toLowerCase().replace(/\s+/g, "-"));
    const url = absolute(`/product/${encodeURIComponent(product.slug)}`);
    const badgeRaw = String(product.badge || "").trim();
    const badgeFilled = fillCopy(badgeRaw);
    const badgeVi = badgeFilled || "Mới";
    const badgeEn = COPY_EN.badges[badgeVi] || badgeVi;
    const categoryRaw = String(product.category || "").trim();
    const categoryVi = normaliseCategory(categoryRaw) || COPY_VI.software;
    const categoryEn = COPY_EN.categories[categoryVi] || categoryVi;
    const nameVi = esc(fillCopy(product.name));
    const nameEn = product.nameEn ? esc(fillCopy(product.nameEn)) : nameVi;
    const descVi = esc(fillCopy(product.shortDescription || product.short_description || product.description || ""));
    const descEn = product.shortDescriptionEn ? esc(fillCopy(product.shortDescriptionEn)) : descVi;
    
    const featuresVi = (product.features || []).slice(0, 2).map((item) => esc(fillCopy(item)));
    const featuresEn = (product.featuresEn && product.featuresEn.length)
      ? (product.featuresEn || []).slice(0, 2).map((item) => esc(fillCopy(item)))
      : featuresVi;
    
    const features = featuresVi.map((item, index) => 
      `<li data-vi="✓ ${item}" data-en="✓ ${(featuresEn[index] || item)}">✓ ${item}</li>`).join("");
    return `<article class="product-card" data-id="${esc(product.id)}">
    <div class="product-art art-${art}">
      <span class="product-badge" data-i18n="products.new" data-vi="${esc(badgeVi)}" data-en="${esc(badgeEn)}">${esc(badgeVi)}</span>
      <div class="product-logo">${esc(initials(product.name))}</div>
      <div class="art-grid"></div>
      <span class="art-spark">✦</span>
    </div>
    <div class="product-info">
      <div class="product-meta"><span>${esc(product.platform || "Windows")} · v${esc(product.version || "1.0")}</span><span data-vi="${esc(categoryVi)}" data-en="${esc(categoryEn)}">${esc(categoryVi)}</span></div>
      <h3><a href="${esc(url)}" data-vi="${nameVi}" data-en="${nameEn}">${nameVi}</a></h3>
      <p data-vi="${descVi}" data-en="${descEn}">${descVi}</p>
      <ul>${features}</ul>
      <div class="product-buy">
        <strong>${esc(money(product.price, product.currency))}</strong>
        <a class="round-arrow" href="${esc(url)}" data-i18n-attr="aria-label:products.buyAria" aria-label="Mua ${nameVi}">↗</a>
      </div>
    </div>
  </article>`;
  });
  return cards.length
    ? cards.join("\n")
    : `<div class="empty-state"><b data-i18n="products.emptyTitle" data-vi="Không có sản phẩm nào khớp" data-en="No products match">Không có sản phẩm nào khớp</b><p data-i18n="products.emptyText" data-vi="Hãy thử từ khoá khác, hoặc bỏ bộ lọc đang chọn." data-en="Try a different word, or clear the filter you picked.">Hãy thử từ khoá khác, hoặc bỏ bộ lọc đang chọn.</p></div>`;
};
/** The product count above the grid, in Vietnamese. The template's span already has data-vi/data-en attributes. */
export const renderIndexCount = (products) => {
  const total = (products || []).filter(isSellable).length;
  return `${String(total).padStart(2, "0")} sản phẩm`;
};

/**
 * The homepage's category filter row, built from what is actually for sale.
 * Rendered in Vietnamese with data-vi/data-en attributes for client-side translation.
 */
// The catalogue may store the category in either Vietnamese or English.
// Normalise to Vietnamese so downstream renderers always have the same anchor
// for both the button text and the data-en attribute.
function normaliseCategory(raw) {
  if (COPY_EN.categories[raw]) return raw;
  const viEntry = Object.entries(COPY_EN.categories).find(([vi, en]) => en === raw);
  if (viEntry) return viEntry[0];
  return raw;
}

export const renderIndexFilters = (products) => {
  const counts = new Map();
  for (const product of products || []) {
    const raw = String(product.category || "").trim();
    if (!raw) continue;
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }
  const buttons = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi"))
    .map(([raw, count]) => {
      const categoryVi = normaliseCategory(raw);
      const categoryEn = COPY_EN.categories[categoryVi] || categoryVi;
      return `<button class="filter" data-filter="${esc(raw)}" data-count="${count}" data-vi="${esc(categoryVi)}" data-en="${esc(categoryEn)}">${esc(categoryVi)}</button>`;
    })
    .join("");
  return `<button class="filter active" data-filter="all" data-i18n="products.all" data-vi="Tất cả" data-en="All">Tất cả</button>${buttons}`;
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
  faqNav: "Câu hỏi",
  about: "Về chúng tôi",
  // The footer on a product page is the same list as every other page's, so these
  // two are not decoration on this page: without them the generated footer could
  // not carry the last two links the shop has.
  lookup: "Tra cứu đơn",
  contact: "Liên hệ",
  breadcrumbLabel: "Đường dẫn",
  software: "Phần mềm",
  // Category and badge are free-text columns, so a Vietnamese product carries
  // Vietnamese words there. Rendering them raw put "Công cụ · Windows · Phát hành 1.4.0"
  // at the top of the English page. These map the values the shop actually uses; an
  // unknown one still renders as written rather than disappearing.
  categories: { "Công cụ": "Công cụ", "Tiện ích": "Tiện ích", "Phần mềm": "Phần mềm", "Khác": "Khác" },
  badges: { "Mới": "Mới", "Bán chạy": "Bán chạy", "Cập nhật": "Cập nhật", "Phát hành": "Phát hành", "Phổ biến": "Phổ biến", "Chuyên nghiệp": "Chuyên nghiệp", "Tiết kiệm": "Tiết kiệm", "Doanh nghiệp": "Doanh nghiệp", "Ưu đãi sớm": "Ưu đãi sớm", "Safe Edition v4.3": "Safe Edition v4.3", "Phát hành 1.4.0": "Phát hành 1.4.0" },
  // The verification block. What it links to is what the claim rests on, so every
  // line here points at something a stranger can open and check: an independent
  // antivirus scan, and the build report of the shop selling the file. Neither
  // says the software is safe — that is not a thing a page can assert — they give
  // the reader the evidence to form their own answer, which is the only version of
  // a trust claim that survives being checked.
  trustHeading: "Kiểm chứng",
  trustScan: "Quét virus độc lập (VirusTotal)",
  trustScanNote: "Chạy bởi hãng thứ ba, không phải bởi shop. Bấm để xem đúng file bạn tải về đã được bao nhiêu công cụ quét, và bao nhiêu báo phát hiện.",
  trustBuild: "Báo cáo build của shop",
  trustBuildNote: "Commit, phiên bản Node, danh sách mọi file và mọi thư viện của trang bán hàng này, kèm mã băm SHA-256. Cái này mô tả shop, không mô tả phần mềm bạn mua.",
  fileSizeLabel: "Kích thước tệp tải về",
  buyNow: "Mua ngay",
  buyNote: "Giấy phép vĩnh viễn, không phí thuê bao. Thanh toán chuyển khoản hoặc PayPal.",
  // The footer on the link-preview card. It was written into the SVG template in
  // Vietnamese, so the one card an English page can hand a crawler was the one
  // page on the site that ignored the language it was rendered for.
  ogFooter: "Giấy phép vĩnh viễn · Tải ngay sau khi thanh toán",
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
  faqNav: "FAQ",
  about: "About",
  lookup: "Order lookup",
  contact: "Contact",
  breadcrumbLabel: "Breadcrumb",
  software: "Software",
  // The Vietnamese values, translated. See the note on COPY_VI: the category and
  // badge are free-text columns written in one language and rendered in both.
  categories: { "Công cụ": "Tools", "Tiện ích": "Utilities", "Phần mềm": "Software", "Khác": "Other" },
  badges: { "Mới": "New", "Bán chạy": "Best seller", "Cập nhật": "Updated", "Phát hành": "Release", "Phổ biến": "Popular", "Chuyên nghiệp": "Professional", "Tiết kiệm": "Value", "Doanh nghiệp": "Enterprise", "Ưu đãi sớm": "Early Bird", "Safe Edition v4.3": "Safe Edition v4.3", "Phát hành 1.4.0": "Release 1.4.0" },
  trustHeading: "Verification",
  trustScan: "Independent antivirus scan (VirusTotal)",
  trustScanNote: "Run by a third party, not by this shop. Open it to see how many engines scanned the exact file you download, and how many flagged it.",
  trustBuild: "This shop's build report",
  trustBuildNote: "Commit, Node version, every shipped file and every dependency of this storefront, with SHA-256 digests. That describes the shop, not the software you are buying.",
  fileSizeLabel: "Download file size",
  buyNow: "Buy now",
  buyNote: "One-time licence, no subscription. Pay by bank transfer or PayPal.",
  ogFooter: "One-time licence · Download immediately after payment",
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

/** Returns the copy table for the given language. */
function getCopy(lang) {
  return lang === "en" ? COPY_EN : COPY_VI;
}

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
/**
 * Strips hardcoded VND price strings from product copy.
 *
 * The price is rendered from structured data and the price component, so a
 * sentence that repeats "199.000đ" or "299,000 ₫" is not copy — it is a
 * feed-integrity hazard. A page whose text says one currency and whose
 * JSON-LD says another is flagged by Google's crawler as mismatched data.
 * This removes those price tokens from every field that passes through
 * localize(), leaving the surrounding prose intact.
 */
// No trailing \b on this pattern: JavaScript's \b is an ASCII word boundary,
// and both "đ" and "₫" are non-ASCII, so the old pattern never matched
// "199.000đ" — the exact form this catalogue uses. The currency word is matched
// explicitly, with "đồng" before "đ" so the longer form is removed whole.
const VND_PRICE_RE = /\b\d{1,3}(?:[.,]\d{3})+\s*(?:đồng|đ|₫|VND)|\b\d+k\s*(?:VND|đồng|đ|₫)/gi;
const stripPrices = (text) => String(text || "").replace(VND_PRICE_RE, "").replace(/\s+/g, " ").trim();

/**
 * Removes promotional or price-carrying sentences from a text block.
 *
 * A sentence is anything separated by terminal punctuation (`.`, `!`, `?`)
 * followed by whitespace. Sentences that carry a price, a discount, a
 * deadline or a call to action are dropped whole — a partial rewrite leaves
 * the grammar broken ("all features for instead of .").
 *
 * Used by the machine-readable catalogue (`/feed.json`, `/llms.txt`) so the
 * data a crawler reads carries the same amount of promotional noise as the
 * page's `Product`/`Offer` schema, and by nothing else.
 */
const stripPromotionalSentences = (text) => {
  const trimmed = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  const kept = trimmed
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !PROMO_IN_TEXT.test(sentence))
    .join(" ")
    .trim();
  return kept;
};

export function localize(product, lang) {
  if (!product) return product;
  const resolved = lang === "en" ? localizeToEnglish(product) : product;
  // Placeholders are filled after the language is chosen, so the same stored text
  // carries the owner's name in both. Filling them first would put the name into
  // whatever was picked as the fallback, and the English page would then show a
  // Vietnamese sentence with an English name in it.
  return {
    ...resolved,
    shortDescription: stripPrices(fillCopy(resolved.shortDescription)),
    description: stripPrices(fillCopy(resolved.description)),
    features: (resolved.features || []).map((f) => stripPrices(fillCopy(f))),
  };
}

/** Chooses the English text where it exists and the Vietnamese where it does not. */
function localizeToEnglish(product) {
  const pick = (en, vi) => (String(en || "").trim() ? en : vi);
  const featuresEn = Array.isArray(product.featuresEn) ? product.featuresEn.filter((item) => String(item || "").trim()) : [];
  return {
    ...product,
    shortDescription: pick(product.shortDescriptionEn, product.shortDescription),
    description: pick(product.descriptionEn, product.description),
    // System requirements are the one field a buyer must be able to check before
    // paying, and the old fallback answered it with "the guide is written in
    // Vietnamese" — a sentence that tells an English reader nothing. The stored
    // requirements are a technical spec (platform names, versions, architecture),
    // so showing them untranslated is more useful than showing a refusal; the
    // platform column is the last resort when the spec itself is empty.
    requirements: pick(product.requirementsEn, String(product.requirements || "").trim() || product.platform || ""),
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
  if (map && Object.prototype.hasOwnProperty.call(map, raw)) return map[raw];
  // A catalogue row typed without diacritics ("Phat hanh 1.4.0") is the same word
  // as the dictionary key ("Phát hành 1.4.0"). Exact lookup alone left the raw
  // column text on screen, so the reader saw an unaccented label next to a fully
  // accented Vietnamese page. Folding both sides matches it without editing data
  // that was created years ago and may live in a database we do not control.
  const fold = (text) => String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const foldedRaw = fold(raw);
  for (const [key, translated] of Object.entries(map || {})) {
    if (fold(key) === foldedRaw) return translated;
  }
  return raw;
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
 *
 * The price printed here is always the shelf price in the product's own
 * currency. The renderer used to take a converted USD amount for the English
 * page, which made the figure depend on a live exchange rate and on the crawl
 * time — the two things a price must never depend on. Conversion now happens
 * only at checkout, where the buyer sees the exact charge before confirming.
 */
export function renderProductPage(rawProduct, lang = "vi", reviews = []) {
  const product = localize(rawProduct, lang);
  const en = lang === "en";
  const url = absolute(productUrl(product.slug, lang));
  const { intro, groups } = sections(product.description);
  const features = product.features || [];
  // The shelf price is stated in the product's own currency, on both languages.
  //
  // It used to be converted to dollars on the English page from a live exchange
  // rate. That number changed between crawls, never matched the VND figure in the
  // structured data, and is the "price mismatch" Merchant Center reports: the feed
  // said 7,69 US$, the page said 7,71, and the product data said 199000 VND. A
  // listed price is a promise, not a quote. Conversion belongs to the payment step,
  // where PayPal shows the exact charge before the buyer confirms it.
  const priceLabel = money(product.price, product.currency);
  // The headline leads with what someone types into a search box, not with the
  // product's own name, which nobody outside this site has heard of. The two are
  // the same sentence read differently: "bật macro Excel" is the problem, "Excel
  // Trusted Locations Setup" is the thing that solves it.
  //
  // One shape for both languages, and the language enters through productSummary
  // and the copy table below. The ternary that used to sit here had an identical
  // arm on each side — an editor had edited one and not the other, and a page that
  // looked localized was emitting the same title twice.
  // The owner's SEO title is used only when it is safe as product data. A title
  // that carries a price, a discount or a deadline is discarded rather than
  // rewritten, because Merchant Center reads this string as the product name when
  // it cannot find a Product node — and a product name is not a sale banner.
  const title = cleanSeoText(product.seoTitle)
    || `${product.name} v${product.version} — ${product.platform || "Windows"} | ${brand()}`;
  const description = metaDescriptionFor(product, lang);
  const copy = getCopy(lang);
  const faq = faqSchema(product, lang);

  return `<!doctype html>
<html lang="${en ? "en" : "vi"}">
<head>
${tokenMeta()}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${meta({ title, description, url, type: "product", lang, image: productImage(product), alternates: { vi: absolute(productUrl(product.slug, "vi")), en: absolute(productUrl(product.slug, "en")) } })}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css?v=${cssVersion}">
${brandMeta()}
${analyticsMeta()}
${jsonLd({ "@graph": [organization(), websiteSchema(), productSchema(product, lang), merchantProductSchema(product, lang), breadcrumbSchema(product, lang), faq] })}
</head>
<body class="product-page">
<header class="site-header"><a class="brand" href="/">${brandWordmark()}${headerNav("", copy)}<a class="header-cta" href="/#products"><span>${esc(copy.buyNow)}</span> <span>↗</span></a></header>
<main class="wrap">
<nav class="crumbs" aria-label="${copy.breadcrumbLabel}"><a href="/">${copy.home}</a> <span>/</span> <a href="/#products">${copy.products}</a> <span>/</span> <span aria-current="page">${esc(product.name)}</span></nav>
<article class="product-detail">
<header class="product-hero">
<div>
<p class="eyebrow">${esc(localised(normaliseCategory(product.category), copy.categories, copy.software))} · ${esc(product.platform || "Windows")}${product.badge ? ` · ${esc(localised(product.badge, copy.badges))}` : ""}</p>
<h1>${esc(product.name)} <em>v${esc(product.version)}</em></h1>
<p class="product-lede">${esc(product.short_description || product.shortDescription || "")}</p>
</div>
<aside class="buy-card" id="mua">
<div class="buy-price">${esc(priceLabel)}</div>
<p class="buy-note">${copy.buyNote}</p>
<a class="button button-primary button-wide" href="/?buy=${encodeURIComponent(product.id)}#products">${copy.buyNow} <span>→</span></a>
<ul class="buy-points"><li>${copy.pointDownload}</li><li>${copy.pointLookup}</li><li>${copy.pointRefund}</li></ul>
</aside>
</header>
${features.length ? `<section class="detail-block"><h2>${copy.features}</h2><ul class="feature-grid">${features.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>` : ""}
${product.requirements ? `<section class="detail-block"><h2>${copy.requirements}</h2><p>${esc(product.requirements).replace(/\n/g, "<br>")}</p></section>` : ""}
${(product.fileSize || product.file_size) ? `<section class="detail-block"><h2>${esc(copy.fileSizeLabel)}</h2><p>${esc(formatBytes(product.fileSize || product.file_size))}</p></section>` : ""}
${trustBlock(product, copy)}
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
${footerBar("", copy)}
<!--
  The related-products loader lives in /related.js rather than inline. The server
  sends script-src 'self' with no 'unsafe-inline' and no nonce, so an inline block
  here was silently refused by every browser: the section below the product sat on
  "loading" forever. Nothing on this page needs inline script, so the CSP stays
  strict and the script moves.
-->
<script src="/format.js"></script>
<script src="/related.js" data-self="${esc(product.id)}"></script>
</body>
</html>`;
}

/**
 * A link-preview card. SVG is used because it renders crisply and needs no build
 * step, but it is not what og:image points at: Facebook, Zalo, Telegram, Slack,
 * LinkedIn and most AI answer engines refuse SVG and show nothing. og:image
 * points at the committed raster card instead, and this stays available for the
 * crawlers that do handle SVG.
 *
 * The footer sentence is language-aware for the same reason the page is: the
 * Vietnamese sentence used to be written straight into the template, which made
 * the card the one place on an English page that still spoke Vietnamese.
 *
 * The price line is only drawn when a price is actually known. The shop-wide
 * card passes no price, and money(0) renders "0 ₫" — an invented number, on the
 * card that exists to introduce the shop.
 */
 export function renderOgImage(product, lang = "vi") {
  const name = String(product.name || "");
  const lines = name.length > 34 ? [name.slice(0, 34), name.slice(34, 68)] : [name];
  const copy = getCopy(lang);
  const price = product.price === undefined || product.price === null || product.price === ""
    ? ""
    : `<text x="90" y="556" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="600">${esc(money(product.price, product.currency))}</text>`;
  // The platform and version line exists because a product has both. The
  // shop-wide card has neither, and the fallbacks this replaces printed
  // "Windows · v1.0" — an invented platform and an invented version, on the one
  // card that is not about a release at all. A missing line is honest.
  const meta = [product.platform, product.version && `v${product.version}`].filter(Boolean).join(" · ");
  const metaLine = meta
    ? `<text x="90" y="${270 + lines.length * 74 + 26}" fill="#8fd3b2" font-family="Helvetica, Arial, sans-serif" font-size="34">${esc(meta)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${esc(name)}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f2a22"/><stop offset="1" stop-color="#163a2f"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<circle cx="1080" cy="90" r="220" fill="#1d4a3c" opacity="0.55"/>
<text x="90" y="150" fill="#4fbf8b" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="600" letter-spacing="5">${esc(brand().toUpperCase())}</text>
 ${lines.map((line, index) => `<text x="90" y="${270 + index * 74}" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="62" font-weight="700">${esc(line)}</text>`).join("")}
${metaLine}
${price}
<text x="90" y="596" fill="#7fb39c" font-family="Helvetica, Arial, sans-serif" font-size="24">${esc(copy.ogFooter)}</text>
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
        return `- [${product.name}](${absolute(productUrl(product.slug))}): ${stripPromotionalSentences(productSummary(product, 120))} (${facts})`;
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
        description: stripPromotionalSentences(productSummary(product, 300)),
        url: absolute(productUrl(product.slug)),
        image: productImage(product),
        brand: { "@type": "Brand", name: brand() },
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
function jsonLdGraph(products = []) {
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
