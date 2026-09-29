import { env } from "./config.js";

// Product pages are rendered here, on the server, rather than in the browser.
// The storefront ships an empty skeleton and fills it in with JavaScript, which
// is fine for a person but leaves a search engine with a page of empty headings
// and no products. It also leaves link-preview crawlers — the ones Facebook,
// Zalo and Telegram use when someone shares your URL — with nothing at all.
//
// Everything a crawler needs has to be in the bytes the server sends.

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const site = () => env.appUrl.replace(/\/$/, "");

const absolute = (path) => `${site()}${path.startsWith("/") ? path : `/${path}`}`;

const money = (amount, currency) => new Intl.NumberFormat(currency === "USD" ? "en-US" : "vi-VN", currency === "USD" ? { style: "currency", currency } : { maximumFractionDigits: 0 }).format(Number(amount) || 0);

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

const organization = () => ({
  "@type": "Organization",
  "@id": `${site()}/#organization`,
  name: "SonVuDev",
  url: `${site()}/`,
  logo: absolute("/logo.svg"),
  description: "Công cụ và tiện ích phần mềm cho doanh nghiệp và cá nhân tại Việt Nam.",
  address: { "@type": "PostalAddress", addressCountry: "VN" },
});

/**
 * SoftwareApplication is the schema.org type that matches a downloadable tool.
 * Product plus an Offer would also be valid, but SoftwareApplication carries
 * operatingSystem and applicationCategory, which is what makes it eligible for
 * the software rich result.
 */
export const productSchema = (product) => ({
  "@type": "SoftwareApplication",
  "@id": absolute(`/product/${product.slug}#software`),
  name: `${product.name} ${product.version ? `v${product.version}` : ""}`.trim(),
  // altText and the description both take the search phrasing, so the product
  // is findable by the problem it solves and not only by its product name.
  description: product.seoDescription || productSummary(product),
  alternateName: product.seoTitle || undefined,
  url: absolute(`/product/${product.slug}`),
  applicationCategory: product.category || "UtilitiesApplication",
  operatingSystem: product.platform || "Windows",
  softwareVersion: product.version || undefined,
  offers: {
    "@type": "Offer",
    price: Number(product.price) || 0,
    priceCurrency: product.currency || "VND",
    availability: "https://schema.org/InStock",
    priceValidUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    url: absolute(`/product/${product.slug}`),
    seller: { "@id": `${site()}/#organization` },
  },
});

export const breadcrumbSchema = (product) => ({
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Trang chủ", item: `${site()}/` },
    { "@type": "ListItem", position: 2, name: "Sản phẩm", item: `${site()}/#products` },
    { "@type": "ListItem", position: 3, name: product.name, item: absolute(`/product/${product.slug}`) },
  ],
});

export const websiteSchema = () => ({
  "@type": "WebSite",
  "@id": `${site()}/#website`,
  name: "SonVuDev",
  url: `${site()}/`,
  inLanguage: "vi-VN",
  publisher: { "@id": `${site()}/#organization` },
  potentialAction: {
    "@type": "SearchAction",
    target: { "@type": "EntryPoint", urlTemplate: `${site()}/lookup?q={search_term_string}` },
    "query-input": "required name=search_term_string",
  },
});

const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

/** Meta block shared by every indexable page. */
const meta = ({ title, description, url, image, type = "website", published }) => [
  `<title>${esc(title)}</title>`,
  `<meta name="description" content="${esc(description)}">`,
  `<link rel="canonical" href="${esc(url)}">`,
  `<meta property="og:type" content="${type}">`,
  `<meta property="og:site_name" content="SonVuDev">`,
  `<meta property="og:locale" content="vi_VN">`,
  `<meta property="og:title" content="${esc(title)}">`,
  `<meta property="og:description" content="${esc(description)}">`,
  `<meta property="og:url" content="${esc(url)}">`,
  image ? `<meta property="og:image" content="${esc(image)}">` : "",
  image ? `<meta property="og:image:width" content="1200">` : "",
  image ? `<meta property="og:image:height" content="630">` : "",
  `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
  `<meta name="twitter:title" content="${esc(title)}">`,
  `<meta name="twitter:description" content="${esc(description)}">`,
  published ? `<meta property="article:published_time" content="${esc(published)}">` : "",
].filter(Boolean).join("\n");

/** Splits the long form description on the === heading === markers. */
function sections(description) {
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
 * The full product page. It is deliberately standalone HTML: no JavaScript is
 * required to read the whole thing, and the only script on the page opens the
 * existing checkout modal on the storefront rather than duplicating it.
 */
export function renderProductPage(product) {
  const url = absolute(`/product/${product.slug}`);
  const { intro, groups } = sections(product.description);
  const features = product.features || [];
  // The headline leads with what someone types into a search box, not with the
  // product's own name, which nobody outside this site has heard of. The two are
  // the same sentence read differently: "bật macro Excel" is the problem, "Excel
  // Trusted Locations Setup" is the thing that solves it.
  const title = product.seoTitle || `${product.name} v${product.version} — ${product.platform || "Windows"} | SonVuDev`;
  const description = product.seoDescription || productSummary(product);

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${meta({ title, description, url, image: absolute(`/og/${product.slug}.svg`), type: "product" })}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
${jsonLd([organization(), websiteSchema(), productSchema(product), breadcrumbSchema(product)])}
</head>
<body class="product-page">
<header class="site-header"><a class="brand" href="/"><span class="brand-mark">S</span><span>SonVu<span>Dev</span></span></a><nav><a href="/#products">Sản phẩm</a><a href="/#why">Vì sao</a><a href="/#faq">Câu hỏi</a></nav><a class="header-cta" href="#mua">Mua ngay <span>↗</span></a></header>
<main class="wrap">
<nav class="crumbs" aria-label="Đường dẫn"><a href="/">Trang chủ</a> <span>/</span> <a href="/#products">Sản phẩm</a> <span>/</span> <span aria-current="page">${esc(product.name)}</span></nav>
<article class="product-detail">
<header class="product-hero">
<div>
<p class="eyebrow">${esc(product.category || "Phần mềm")} · ${esc(product.platform || "Windows")}${product.badge ? ` · ${esc(product.badge)}` : ""}</p>
<h1>${esc(product.name)} <em>v${esc(product.version)}</em></h1>
<p class="product-lede">${esc(product.short_description || product.shortDescription || "")}</p>
</div>
<aside class="buy-card" id="mua">
<div class="buy-price">${esc(money(product.price, product.currency))}</div>
<p class="buy-note">Giấy phép vĩnh viễn, không phí thuê bao. Thanh toán chuyển khoản hoặc PayPal.</p>
<a class="button button-primary button-wide" href="/?buy=${encodeURIComponent(product.id)}#products">Mua ngay <span>→</span></a>
<ul class="buy-points"><li>Tải ngay sau khi thanh toán</li><li>Mã tra cứu gửi qua email</li><li>Hoàn tiền nếu file lỗi</li></ul>
</aside>
</header>
${features.length ? `<section class="detail-block"><h2>Tính năng</h2><ul class="feature-grid">${features.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>` : ""}
${product.requirements ? `<section class="detail-block"><h2>Yêu cầu hệ thống</h2><p>${esc(product.requirements).replace(/\n/g, "<br>")}</p></section>` : ""}
${intro ? `<section class="detail-block prose">${paragraphBlocks(intro)}</section>` : ""}
${groups.map((group) => `<section class="detail-block prose">${paragraphBlocks(group)}</section>`).join("")}
<section class="detail-block">
<h2>Câu hỏi thường gặp</h2>
<dl class="faq-mini">
<dt>Tôi nhận hàng bằng cách nào?</dt><dd>Thanh toán xong là mã tra cứu gửi qua email ngay, kèm link tải trực tiếp. Không cần chờ ai duyệt.</dd>
<dt>Tải được mấy lần?</dt><dd>Bạn tự tạo link tải mới bất cứ lúc nào bằng mã tra cứu. Link có thời hạn ngắn nhưng không giới hạn số lần tạo.</dd>
<dt>Nếu file lỗi hoặc tôi mua nhầm?</dt><dd>Liên hệ <a href="mailto:${esc(env.email.supportEmail)}">${esc(env.email.supportEmail)}</a> kèm mã đơn. Chúng tôi hoàn tiền hoặc gửi lại bản sửa.</dd>
<dt>Thanh toán bằng cách nào?</dt><dd>Chuyển khoản nội địa (VietQR, MoMo, ZaloPay) và PayPal cho khách quốc tế. Cả hai đều xác nhận tự động.</dd>
</dl>
</section>
</article>
<section class="related"><h2>Sản phẩm khác</h2><div id="related" class="related-grid">Đang tải…</div></section>
</main>
<footer class="site-footer wrap"><p>© 2026 SonVuDev · <a href="/terms">Điều khoản</a> · <a href="/refund">Hoàn tiền</a> · <a href="/privacy">Bảo mật</a></p></footer>
<script>
// The only script on this page fetches the other products so the footer links
// stay useful. Everything above is already in the HTML for crawlers and for
// anyone whose browser has JavaScript turned off.
fetch('/api/products').then((r) => r.json()).then((data) => {
  const others = (data.products || []).filter((p) => p.id !== ${JSON.stringify(product.id)});
  const box = document.getElementById('related');
  if (!box) return;
  box.innerHTML = others.length
    ? others.map((p) => '<a class="related-card" href="/product/' + encodeURIComponent(p.slug) + '"><b>' + p.name + '</b><span>v' + p.version + ' · ' + p.platform + '</span><span>' + new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(p.price) + ' ' + p.currency + '</span></a>').join('')
    : '<p class="related-empty">Đây là sản phẩm duy nhất hiện tại.</p>';
}).catch(() => { document.getElementById('related').textContent = ''; });
</script>
</body>
</html>`;
}

/**
 * A link-preview card. SVG is used because it renders crisply everywhere and
 * needs no build step, but Facebook and Zalo both prefer a raster image, so a
 * single 1200x630 PNG dropped at public/og.png will replace it.
 */
export function renderOgImage(product) {
  const name = String(product.name || "");
  const lines = name.length > 34 ? [name.slice(0, 34), name.slice(34, 68)] : [name];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${esc(name)}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f2a22"/><stop offset="1" stop-color="#163a2f"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<circle cx="1080" cy="90" r="220" fill="#1d4a3c" opacity="0.55"/>
<text x="90" y="150" fill="#4fbf8b" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="600" letter-spacing="5">SONVUDEV</text>
${lines.map((line, index) => `<text x="90" y="${270 + index * 74}" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="62" font-weight="700">${esc(line)}</text>`).join("")}
<text x="90" y="${270 + lines.length * 74 + 26}" fill="#8fd3b2" font-family="Helvetica, Arial, sans-serif" font-size="34">${esc(product.platform || "Windows")} · v${esc(product.version || "1.0")}</text>
<text x="90" y="556" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="600">${esc(product.priceLabel || money(product.price, product.currency))}</text>
<text x="90" y="596" fill="#7fb39c" font-family="Helvetica, Arial, sans-serif" font-size="24">Giấy phép vĩnh viễn · Tải ngay sau khi thanh toán</text>
</svg>`;
}

export { esc, absolute, site, money };
