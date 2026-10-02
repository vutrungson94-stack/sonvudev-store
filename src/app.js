import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { env, isConfigured } from "./config.js";
import { countOrders, dataDir, ensureSeed, findOrderByIdempotencyKey, getOrder, getProduct, getProductBySlug, isOrderOwner, isSellable, latestOrder, listExpiringOrders, listOpenOrders, listOrders, listOrdersForRevenue, listProducts, createOrder, updateOrder, createProduct, updateProduct, persistenceMode } from "./store.js";
import { supabaseRequest } from "./supabase-http.js";
import { paypalEnvironmentIsSet } from "./config.js";
import { createDownloadUrl, createUploadUrl } from "./r2.js";
import { captureOrder, createOrder as createPayPalOrder, hashToken, newOrderId, newToken, paypalChargeFor, paypalChargeForProduct, paymentMatchesOrder, readOrder, verifyWebhook } from "./paypal.js";
import { paymentInstructions, paymentOptions } from "./payments.js";
import { brandMeta, esc, fillCopy, jsonLdGraph, renderFeed, renderIndexCount, renderIndexFilters, renderIndexGrid, renderLlmsTxt, renderOgImage, renderProductPage, renderStats, verificationFile, verificationMeta } from "./pages.js";
import { hasPayment, isClosed, isUnpaid, markOrderDelivered, markOrderPaid, paymentDeadline, voidPayment } from "./orders.js";
import { notifyOrder, notifyMode } from "./notify.js";
import { resolveCountry } from "./geo.js";
import { pingIndexNow, isIndexNowConfigured } from "./indexnow.js";
import { vndPerUsd } from "./rates.js";
import { createReview, listReviewsForProduct, reviewLimits } from "./reviews.js";

const app = express();
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const json = express.json({ limit: "1mb" });
// What the storefront and the public API are allowed to see of a product.
//
// The copy is filled on the way out, not on the way in, so a description that
// carries {{founder}} resolves to the owner named in configuration rather than to
// whatever spelling someone typed into the text field once. It is done here as well
// as on the rendered pages because the catalogue API feeds the product modal and the
// homepage grid, and a name that reads one way on the server and another way in the
// modal is the same defect in a smaller window.
const publicProduct = (product) => {
  if (!product) return null;
  const { fileKey, file_key, ...safe } = product;
  // Both naming conventions, because both are present: PostgREST hands back the
  // column names as they are, and fromProduct adds the camelCase spelling on top.
  // Filling only one of them left description_en coming out of the API with the
  // placeholder still in it while descriptionEn came out filled — the same field,
  // two answers, which is the defect this function exists to prevent.
  const copy = ["name", "shortDescription", "short_description", "description", "descriptionEn", "description_en", "shortDescriptionEn", "short_description_en", "seoTitle", "seo_title", "seoDescription", "seo_description"];
  const filled = { ...safe };
  for (const field of copy) if (typeof filled[field] === "string") filled[field] = fillCopy(filled[field]);
  for (const field of ["features", "featuresEn", "features_en"]) if (Array.isArray(filled[field])) filled[field] = filled[field].map(fillCopy);
  return filled;
};
const publicOrder = (order) => { if (!order) return null; const { accessTokenHash, access_token_hash, idempotencyKey, idempotency_key, notifications, ...safe } = order; return { ...safe, items: (safe.items || []).map(({ fileKey, file_key, ...item }) => item) }; };
// A countdown is only correct if it is measured against the server's clock, so
// the deadline and the server's own time always travel together.
const deadlinePayload = (order) => {
  const at = isUnpaid(order) && !isClosed(order) ? paymentDeadline(order) : null;
  return { expiresAt: at ? new Date(at).toISOString() : null, serverTime: new Date().toISOString() };
};
const text = (value, max = 180) => String(value || "").trim().slice(0, max);
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isAdmin = (req) => {
  const supplied = req.get("x-admin-token") || (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const expected = env.adminToken;
  if (!expected || !supplied || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
};
const admin = (req, res, next) => { if (!isAdmin(req)) return res.status(401).json({ error: "Unauthorized" }); next(); };

// Order ids are short, so a lookup endpoint without a limit would let anyone
// walk the id space. A per-key window is enough here: the app runs as a single
// process and this only needs to make guessing impractical, not bulletproof.
//
// Keyed rather than counted by IP alone, on purpose. Vietnamese mobile carriers
// put a lot of unrelated buyers behind one public address, so a limit read only
// by IP starts refusing real orders to whoever happens to be the eleventh buyer on
// that address. Counting the email as well splits the two abuse cases apart: one
// script on one machine walks many emails, and many machines behind one address
// hammer the same one. Each has its own budget, so blocking one does not starve
// the other.
const attempts = new Map();
const tooMany = (key, limit) => {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 20000) attempts.clear();
  return recent.length > limit;
};
const tooManyAttempts = (req) => tooMany(`ip:${req.ip || "unknown"}`, 10);

app.set("trust proxy", 1);
app.disable("x-powered-by");

// Where the site canonically lives, read from APP_URL instead of written out.
// The same file also serves localhost and the test suite, so a redirect bound to
// one hard-coded domain stops matching the moment APP_URL changes, and the www
// copy quietly keeps serving a duplicate of every page.
const canonicalOrigin = (() => {
  try { return new URL(env.appUrl).origin; } catch { return ""; }
})();
const canonicalHost = (() => {
  try { return new URL(env.appUrl).hostname; } catch { return ""; }
})();
// localhost and IP hosts have no meaningful www twin, so nothing is redirected.
const wwwHost = canonicalHost && !/^(localhost|127\.|0\.0\.0\.0|\[?::1|.*\.local)$/i.test(canonicalHost) ? `www.${canonicalHost}` : "";

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://img.vietqr.io; connect-src 'self' https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
});
app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send([
    "User-agent: *",
    "Allow: /",
    // Private by design: the admin panel, and the order and lookup pages that
    // hold a buyer's access token in the URL or the session.
    "Disallow: /admin",
    "Disallow: /api/",
    "Disallow: /order/",
    "Disallow: /lookup",
    "Disallow: /paypal-return",
    "",
    // Text agents, named one by one rather than left to the default. The default
    // already allowed them, so nothing changes for the major crawlers; what
    // changes is that the decision is written down instead of implied, and that a
    // shop which later wants to opt out of one has the exact block to copy.
    //
    // They are allowed on purpose. Answer engines are where people ask this kind
    // of question now, and a store that hides its catalogue from them is only
    // hiding it from the people who are looking for it.
    "User-agent: GPTBot",
    "Allow: /",
    "",
    "User-agent: OAI-SearchBot",
    "Allow: /",
    "",
    "User-agent: ChatGPT-User",
    "Allow: /",
    "",
    "User-agent: ClaudeBot",
    "Allow: /",
    "",
    "User-agent: anthropic-ai",
    "Allow: /",
    "",
    "User-agent: PerplexityBot",
    "Allow: /",
    "",
    "User-agent: Google-Extended",
    "Allow: /",
    "",
    `Sitemap: ${env.appUrl.replace(/\/$/, "")}/sitemap.xml`,
    "",
  ].join("\n"));
});

// Site ownership for the search engines that will actually crawl this thing.
//
// Google accepts a meta tag or an HTML file at the site root, and the two are
// derived from the same string, so whichever method the dashboard hands out
// works here without a code change. Only the exact configured name is answered:
// a catch-all that served every /google*.html would publish an unbounded set of
// files that exist for nobody, and would hand a wrong token a plausible-looking
// proof of ownership.
//
// Bing is served the same way, with two differences worth knowing. Its meta tag
// is the method Bing's own help documents as reliable, and its file method is
// BingSiteAuth.xml whose body Bing generates per site — so there is nothing here
// to serve for that without guessing at the token's format. The ms<token>.txt
// route below is the older Bing format, kept because it costs nothing and only
// answers the exact configured name.
app.get(/^\/(google[0-9a-z]+\.html|ms[0-9a-z]+\.txt)$/i, (req, res, next) => {
  const name = req.path.slice(1);
  const google = verificationFile("google", ".html", env.site.googleVerification);
  const bing = verificationFile("ms", ".txt", env.site.bingVerification);
  const file = [google, bing].find((item) => item && item.name.toLowerCase() === name.toLowerCase());
  // Anything else falls through, so a real file in public/ that happens to match
  // the pattern is still served from there.
  if (!file) return next();
  res.type("text/plain").send(file.body);
});
// IndexNow proves ownership the same way: Bing fetches /<key>.txt and compares
// the body with the key it issued.
app.get(/^\/[0-9a-z-]{8,128}\.txt$/i, (req, res, next) => {
  const key = req.path.slice(1, -4);
  if (!env.site.indexNowKey || key.toLowerCase() !== env.site.indexNowKey.toLowerCase()) return next();
  res.type("text/plain").send(key);
});

// The admin panel is an internal page opened rarely, so a cached copy of its
// script sits in a browser for weeks. When a fix finally lands, the owner keeps
// running the old one and the panel silently does the wrong thing with no error
// anywhere. Freshness beats caching for a page nobody but the owner visits.
app.get(["/admin", "/admin.html", "/admin.js"], (_req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(publicDir, _req.path === "/admin" ? "admin.html" : _req.path.slice(1)));
});

// The pages a search engine is meant to index, and what the server has to decide
// about each one. Everything else in public/ is a static file served untouched.
//
// Three things are filled in at serve time because none of them should be
// committed to a file: the origin every canonical and Open Graph URL is built
// from, the search engine ownership tags, and — on the homepage — the catalogue.
// A crawler reads the bytes this sends, so what it gets has to be the real
// products rather than three grey placeholders.
const indexablePages = {
  "index.html": { catalog: true },
  "terms.html": {},
  "privacy.html": {},
  "refund.html": {},
  "about.html": {},
};
// The pages a buyer reaches after paying. Not indexable, so no ownership tag and
// no catalogue, but they quote the support address and that has to come from
// config: the same value is in the outgoing email, in the terms, and on three
// static pages, and a change made in one place used to leave the others pointing
// at an address nobody reads.
const supportPages = ["order.html", "paypal-return.html"];
// Rendered but reached by their own route rather than by a bare filename.
//
// lookup.html carries {{support}} and 404.html carries {{year}}. Neither was in
// the table below, so express.static answered both from the file on disk and the
// substitution never ran: /lookup printed the literal "{{support}}" as the support
// address — on the recovery page, the one a PayPal buyer reaches after losing
// their session — and the 404 footer printed "© {{year}}". Every other gate was
// green, because the token name itself was known and only the page's route was
// not.
//
// So being rendered and being routed are now separate questions, and a file that
// carries a token has to be in the first list. See renderPage and the audit's
// "token chua noi" check, which reads this list rather than guessing.
const renderedPages = { ...Object.fromEntries(supportPages.map((file) => [file, {}])) };
const extraRendered = { "lookup.html": {}, "404.html": {} };
const served = { ...indexablePages, ...renderedPages, ...extraRendered };
const pageCache = new Map();
// Short-lived on purpose. A price change in the admin panel has to reach the
// bytes a crawler reads: a search result that shows last week's price is worse
// than no price, and the storefront's own script only ever sees the fresh copy.
const PAGE_TTL_MS = 60000;

// Every rendered page is derived from the catalogue, and the catalogue is
// editable from the panel. Caching without this meant a price edit took up to a
// minute to reach the homepage, an hour to reach a share card, and left
// /llms.txt and /feed.json describing products at prices that no longer existed.
const invalidatePages = () => {
  pageCache.clear();
  textCache.clear();
};

async function renderPage(file) {
  const cached = pageCache.get(file);
  if (cached && Date.now() - cached.at < PAGE_TTL_MS) return cached.html;
  const template = await fs.readFile(path.join(publicDir, file), "utf8");
  // Optional rather than assumed: a file missing from the table is rendered with
  // no catalogue and no verification tags instead of throwing on the first read.
  const products = served[file]?.catalog ? await listProducts() : [];
  const html = template
    .replaceAll("{{site}}", env.appUrl)
    .replaceAll("{{brandName}}", esc(env.brand.name))
    .replaceAll("{{support}}", env.email.supportEmail)
    // The payment window is quoted in the terms rather than decided silently by
    // the server. It used to be the number 24 written into three files, so
    // changing ORDER_PAYMENT_WINDOW_HOURS made the terms promise something the
    // server did not do.
    .replaceAll("{{paymentWindowHours}}", String(env.orders.paymentWindowHours))
    // The review box's own limits, as the server set them. They used to be a
    // literal 1200 on the textarea, which meant the two numbers that decide
    // whether a sentence is publishable lived in different files and nothing
    // could tell when they disagreed.
    .replaceAll("{{reviewMinLength}}", String(reviewLimits.minLength))
    .replaceAll("{{reviewMaxLength}}", String(reviewLimits.maxLength))
    .replaceAll("{{year}}", String(new Date().getFullYear()))
    // The legal entity behind the shop. It belongs on the terms page because that
    // is the page a buyer reads when they are deciding whether to dispute a
    // payment, and a page that names a brand but no entity behind it gives them
    // nothing to name. Whatever goes here should be the entity a customer would
    // actually see on their PayPal or bank statement, not the trading name.
    .replaceAll("{{legalEntity}}", env.brand.legalEntity)
    // The homepage's structured data comes from the same functions the product
    // pages use, so the two can no longer describe the shop differently.
    .replaceAll("{{jsonLd}}", jsonLdGraph(products))
    .replace("</head>", `${verificationMeta()}\n${brandMeta()}\n</head>`)
    .replace(/(<span class="product-count" id="product-count">)[\s\S]*?(<\/span>)/, `$1${esc(renderIndexCount(products))}$2`)
    .replace(/<!--filters:start-->[\s\S]*?<!--filters:end-->/, `<!--filters:start-->${renderIndexFilters(products)}<!--filters:end-->`)
    .replace(/(<section class="stats wrap" id="stats">)([\s\S]*?)(<\/section>)/, (_all, open, _body, close) => {
      // The three counts come from the catalogue, so they are never stale. With
      // nothing on sale the strip is removed rather than zeroed — see renderStats.
      const stats = renderStats(products);
      if (!stats) return "";
      return `${open}<div data-stat="products"><strong><span id="stat-products">${stats.products}</span></strong><small data-i18n="stats.1">Sản phẩm đang bán</small></div><div data-stat="platforms"><strong><span id="stat-platforms">${stats.platforms}</span></strong><small data-i18n="stats.2">Nền tảng được hỗ trợ</small></div><div data-stat="releases"><strong><span id="stat-releases">${stats.releases}</span></strong><small data-i18n="stats.3">Bản phát hành đã xuất bản</small></div><div class="stats-note"><span class="spark">✦</span><p data-i18n="stats.note">Mỗi sản phẩm đều được làm ra để giải quyết một vấn đề thật.</p></div>${close}`;
    })
    .replace(/<!--catalog:start-->[\s\S]*?<!--catalog:end-->/, `<!--catalog:start-->${renderIndexGrid(products)}<!--catalog:end-->`);
  pageCache.set(file, { at: Date.now(), html });
  return html;
}

const sendPage = (file) => async (_req, res) => {
  try {
    res.set("Cache-Control", "public, max-age=300").type("html").send(await renderPage(file));
  } catch (error) {
    console.error(error);
    // A broken template must not take the storefront down with it.
    res.sendFile(path.join(publicDir, file));
  }
};

// The 404 page. Declared here, next to the routes that use it, because one of
// them does: /404.html is a real file in public/, so express.static answers it
// before the catch-all ever runs and hands back the raw template. The one URL
// where someone is already lost is not the place to show them "© {{year}}".
const notFound = async (_req, res) => {
  try {
    res.status(404).set("Cache-Control", "public, max-age=300").type("html").send(await renderPage("404.html"));
  } catch (error) {
    console.error(error);
    res.status(404).sendFile(path.join(publicDir, "404.html"));
  }
};
for (const file of Object.keys(served)) {
  // 404.html and lookup.html are registered below, at the URLs they should answer
  // on. Giving them the generic bare-name routes here would add a /404 that means
  // "found", and duplicate the one lookup already has.
  if (file in extraRendered) continue;
  // index.html answers on "/" and, deliberately, on its own name too. The bare
  // filename is a real file in public/, so express.static would otherwise answer
  // /index.html with the raw template — tokens, links and all — after the home
  // page had been rendering correctly for years. It was the one URL in the project
  // where a person could paste the address bar they were given and get a different
  // page from the one they were looking at.
  if (file === "index.html") {
    app.get(["/", "/index.html"], sendPage(file));
    continue;
  }
  app.get(`/${file}`, sendPage(file));
  app.get(`/${file.replace(/\.html$/, "")}`, sendPage(file));
}
// The recovery form, served by the renderer rather than by express.static: it
// prints the support address, and the raw file leaves {{support}} in the markup
// for the dictionary to resolve to a literal. This is the page a PayPal buyer
// reaches after losing their session.
app.get(["/lookup", "/lookup.html"], sendPage("lookup.html"));
app.get("/404.html", notFound);
// The order page is reached as /order/<id> — the lookup form and the PayPal
// return both link that shape. Registering only /order and /order.html left the
// page a buyer actually lands on being served as a raw file, with the template
// tokens still in it and the substituted values never applied.
app.get("/order/:id", sendPage("order.html"));

// Machine-readable entry points.
//
// Both are one route over the live catalogue and nothing else. An answer engine
// asked what this shop sells would otherwise have to read three product pages to
// answer it; here it is one fetch. Neither is a substitute for the pages — they
// exist so a crawler that wants structure can get it without parsing a hero
// image and a testimonial.
//
// The shared TTL exists so a price edit in the panel cannot leave these quoting
// numbers the shop no longer honours. invalidatePages() clears both.
const textCache = new Map();
const TEXT_TTL_MS = 60000;
const cachedText = async (key, build) => {
  const hit = textCache.get(key);
  if (hit && Date.now() - hit.at < TEXT_TTL_MS) return hit;
  const value = build(await listProducts());
  textCache.set(key, { at: Date.now(), value });
  return value;
};

app.get("/llms.txt", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600").type("text/plain; charset=utf-8")
    .send(await cachedText("llms", renderLlmsTxt));
});

app.get("/feed.json", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600").type("application/json")
    .send(await cachedText("feed", renderFeed));
});

/**
 * The product page, in whichever language the URL asks for.
 *
 * The English copy has been in the database since the columns were added, and the
 * browser has used it since the storefront got a language switch — but the server
 * rendered Vietnamese only. So an assistant asked in English could find the page
 * and still had nothing quotable on it. One renderer, two languages, one source
 * of truth for the wording.
 */
const productPage = (lang) => async (req, res) => {
  try {
    const product = await getProductBySlug(req.params.slug);
    // A draft, or one with no file behind it, must read as a 404 rather than as a
    // noindex page: the second is a page Google has already been told about, and
    // leaving it reachable invites the URL being kept and re-submitted.
    if (!product || product.status !== "active" || !product.fileKey || !isConfigured.r2) {
      return res.status(404).sendFile(path.join(publicDir, "404.html"));
    }
    const reviews = await listReviewsForProduct(product.id);
    res.set("Cache-Control", "public, max-age=600").type("html").send(renderProductPage(product, lang, reviews));
  } catch (error) {
    console.error(error);
    res.status(500).sendFile(path.join(publicDir, "404.html"));
  }
};
app.get("/product/:slug", productPage("vi"));
app.get("/en/product/:slug", productPage("en"));

app.get("/og/:slug.svg", async (req, res) => {
  // A clean site-wide card, so a link shared without a product still previews.
  // The price used to be written into this line as "Từ 99.000₫" and the platform
  // and version as literals, so a shop that changed either kept publishing the
  // old numbers. There is no price here at all: a card that invents a number is
  // worse than a card that states none.
  if (req.params.slug === "sonvudev") {
    return res.set("Cache-Control", "public, max-age=3600").type("image/svg+xml").send(renderOgImage({ name: "Phần mềm Windows cho công việc", platform: "Windows", version: "1.0", price: 0, currency: "VND" }));
  }
  const product = await getProductBySlug(req.params.slug);
  if (!product || product.status !== "active" || !product.fileKey || !isConfigured.r2) return res.status(404).type("text/plain").send("Not found");
  res.set("Cache-Control", "public, max-age=3600");
  res.type("image/svg+xml").send(renderOgImage(product));
});

app.get("/sitemap.xml", async (_req, res) => {
  const base = env.appUrl.replace(/\/$/, "");
  const pages = await fs.readdir(publicDir);
  const urls = pages
    .filter((file) => /^(index|terms|privacy|refund|about)\.html$/.test(file))
    .map((file) => `<url><loc>${base}/${file === "index.html" ? "" : file.replace(/\.html$/, "")}</loc><changefreq>monthly</changefreq><priority>${file === "index.html" ? "1.0" : "0.3"}</priority></url>`);
  // A product that is not on the sitemap cannot be found, so this is built from
  // the live catalogue rather than from a list someone has to remember to edit.
  // The filter is the storefront's own (isSellable), so a page nobody can buy
  // can never be submitted to Google.
  //
  // Each product contributes two URLs with hreflang pointing at each other. A
  // sitemap that lists only the Vietnamese page tells a crawler the English one
  // is a duplicate to be dropped, which is the opposite of what the two-language
  // setup is for.
  for (const product of (await listProducts()).filter(isSellable)) {
    const updated = product.updatedAt || product.updated_at;
    const lastmod = updated ? `<lastmod>${new Date(updated).toISOString().slice(0, 10)}</lastmod>` : "";
    const vi = `${base}/product/${encodeURIComponent(product.slug)}`;
    const en = `${base}/en/product/${encodeURIComponent(product.slug)}`;
    urls.push(`<url><loc>${vi}</loc>${lastmod}<changefreq>weekly</changefreq><priority>0.8</priority><xhtml:link rel="alternate" hreflang="vi" href="${vi}"/><xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${vi}"/></url>`);
    const hasEnglish = String(product.descriptionEn || "").trim() || String(product.shortDescriptionEn || "").trim() || (Array.isArray(product.featuresEn) && product.featuresEn.length);
    if (hasEnglish) urls.push(`<url><loc>${en}</loc>${lastmod}<changefreq>weekly</changefreq><priority>0.7</priority><xhtml:link rel="alternate" hreflang="vi" href="${vi}"/><xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${vi}"/></url>`);
  }
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join("")}</urlset>`);
});

// One line per request, with an id that also comes back on the error.
//
// There was no request log at all: the only things the process ever said were the
// five lines at boot and whatever an unhandled error printed. So "a buyer says it
// did not work" could not be turned into a question the logs could answer, and the
// first place anyone looked was PayPal's dashboard — which knows about a payment
// and nothing about the eleven requests around it.
//
// The id is the point. A buyer can read it off a failed checkout if it is shown to
// them, and one grep finds every line that request produced, including the ones
// from a worker or a sweep that happened in the middle. The id is taken from
// X-Request-Id when something upstream already set one, so a proxy's id and ours
// stay the same line.
//
// One line per request, not one per event. A shop's whole traffic is a handful of
// humans and their crawlers, and the log is read by a person.
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const requestId = String(req.headers["x-request-id"] || "").slice(0, 64) || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    // Skipped for the crawlers' asset requests, which is most of them: a 404 on a
    // .png is still logged, because that is the thing worth seeing, but a hit on
    // every stylesheet is noise that buries the one line that mattered.
    const query = req.originalUrl.includes("?") ? `${req.originalUrl.split("?")[0]}?…` : req.originalUrl;
    console.log(`${requestId} ${res.statusCode} ${req.method} ${query} ${ms.toFixed(1)}ms`);
  });
  next();
});

app.use((req, res, next) => {
  if (wwwHost && req.hostname === wwwHost) return res.redirect(308, `${canonicalOrigin}${req.originalUrl}`);
  next();
});
// Short link for buyers, e.g. /order/SVD-XXXX. The page reads the token from
// sessionStorage, so it is a viewer rather than an entry point. It goes through
// the renderer like every other page, because this is the shape the lookup form
// and the PayPal return both link to: serving the raw file here left the real
// order page carrying template tokens that nothing would ever replace.
// Static assets only: css, js, images, fonts, the og card.
//
// `extensions: ["html"]` used to be here, which quietly added a second,
// unrendered way to reach every page. With it on, /index.html and /index answered
// from disk while / answered from renderPage — so the homepage had two addresses
// and one of them returned the raw template, links pointing at {{site}} and a
// footer reading {{year}}. No route was registered for it, so every check that
// read the route list saw a clean page.
//
// Every multi-shape URL the shop wants is registered above, explicitly. Anything
// not registered now falls through to the 404 page, which is rendered — so a URL
// that does not exist cannot hand a visitor a page with its own variables still
// inside it.
app.use(express.static(publicDir, { maxAge: "1h", index: false }));

// Reports which configuration is active and whether the three things an order
// depends on are usable. Used by the deploy script and by anyone checking a
// running server without a browser.
//
// The report used to answer 200 unconditionally. It read configuration flags —
// which is a report, not a probe — and never touched the database or the data
// directory, so it said OK for a server that could not reach Supabase, could not
// write a single order, or was pointing at a bucket that no longer existed.
// Anything monitoring this URL saw green while orders were failing, which is worse
// than having no probe at all: it is a probe that reports on the wrong thing.
//
// So the answer now comes from touching the two things an order needs, each with
// its own short timeout so a slow dependency cannot make the probe hang, and the
// status code is 503 when either fails — which is the entire purpose of a probe,
// since whatever watches it acts on the code and not on the words in the body.
//
// The configuration flags stay, because they are genuinely useful when something
// has gone wrong: "paypal: off" alongside a failed checkout explains the failure in
// a way a stack trace never will.
//
// The probes are the cheapest honest ones. Nothing here writes an order, confirms a
// payment, or sends a mail.
app.get("/api/health", async (req, res) => {
  const checks = {};
  const startedAt = process.hrtime.bigint();
  // One row, no columns: enough to prove the network path, the service key and the
  // database all work, and it cannot be slow because of the size of the result.
  if (isConfigured.supabase) checks.database = await probe(async () => { await supabaseRequest("products?select=id&limit=1"); return "ok"; }, "supabase");
  else checks.database = `skipped (${persistenceMode})`;
  checks.storage = await probe(async () => { await fs.mkdir(dataDir, { recursive: true }); await fs.access(dataDir, fs.constants.W_OK); return "ok"; }, `${dataDir} not writable`);
  const rate = await vndPerUsd().catch(() => null);
  const ok = !Object.values(checks).some((value) => typeof value !== "string" || value.startsWith("!"));
  res.status(ok ? 200 : 503).json({
    ok, requestId: req.requestId,
    checks,
    elapsedMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
    uptime: Math.round(process.uptime()),
    appUrl: env.appUrl, persistence: persistenceMode,
    r2: isConfigured.r2, paypal: isConfigured.paypal, paypalWebhook: isConfigured.paypalWebhook,
    // Which PayPal this host is actually talking to, and whether that was decided or
    // assumed. A host that has never been told falls back to sandbox, and sandbox
    // credentials authenticate perfectly against the sandbox API — so every other
    // signal says healthy while real payments cannot be captured. Naming it here is
    // what makes the question answerable against the running server.
    paypalEnvironment: paypalEnvironmentIsSet ? env.paypal.environment : "unset (treated as sandbox)",
    bank: isConfigured.bank, momo: Boolean(env.bank.momo), zalopay: Boolean(env.bank.zalopay), admin: isConfigured.admin,
    // "outbox" means there is no mail provider yet: order mail is being written
    // to data/outbox instead of being delivered.
    email: notifyMode(), orderWindowHours: env.orders.paymentWindowHours, sweeper: Boolean(process.env.ORDER_SWEEP_DISABLED) ? false : true,
    // Whether the domain has been claimed with the search engines that crawl it.
    // A store can be perfectly healthy and still invisible, and this is the one
    // fact about that which is not visible anywhere else.
    search: { google: Boolean(env.site.googleVerification), bing: Boolean(env.site.bingVerification), indexNow: isIndexNowConfigured() },
    vndPerUsd: rate ? { rate: Math.round(rate.rate * 100) / 100, source: rate.source, live: env.paypal.vndToUsdRate === "live" } : null,
  });
});

// One dependency check, one short timeout, and the reason it failed rather than a
// bare "false". A probe that only says "not ok" sends whoever is on call looking
// for what failed; one without a timeout takes the monitoring down with it.
async function probe(check, label) {
  try {
    return await Promise.race([check(), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))]);
  } catch (error) {
    return `!${label}: ${error.message}`;
  }
}
app.get("/api/products", async (_req, res) => {
  try { res.json({ products: (await listProducts()).filter(isSellable).map(publicProduct) }); }
  catch (error) { console.error(error); res.status(500).json({ error: "Không thể tải danh mục" }); }
});
app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await getProduct(req.params.id);
    // Same rule as the storefront and the sitemap, so a product cannot be
    // readable through the API while being invisible on the page.
    if (!isSellable(product)) return res.status(404).json({ error: "Không tìm thấy sản phẩm" });
    res.json({ product: publicProduct(product) });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể tải sản phẩm" }); }
});

// Tells the storefront where the visitor is, so checkout can put the sensible
// rail first. It is advisory only: the client renders whatever comes back and
// the /api/checkout endpoint still accepts any configured method, so a blocked
// or wrong guess can never stop someone from paying.
app.get("/api/checkout/options", async (req, res) => {
  try {
    const country = await resolveCountry(req);
    res.set("Cache-Control", "private, max-age=3600");
    res.json({
      country: country || null,
      inVietnam: !country || country === "VN",
      // The checkout form promises this window, so it comes from the same place
      // the sweeper enforces it rather than being written into the markup twice.
      paymentWindowHours: env.orders.paymentWindowHours,
      options: paymentOptions(country, {
        bank: isConfigured.bank,
        momo: Boolean(env.bank.momo),
        zalopay: Boolean(env.bank.zalopay),
        paypal: isConfigured.paypal,
      }),
    });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không tải được phương thức thanh toán" }); }
});

// Re-issues the access token for an order the buyer already started. Without
// this, a lost response to /api/checkout leaves the buyer with an order they
// can never open, and retrying creates a second order for one purchase.
async function resumeOrder(order) {
  const accessToken = newToken();
  const now = new Date().toISOString();
  let current = await updateOrder(order.id, { accessTokenHash: hashToken(accessToken), updatedAt: now });
  const item = (current.items || [])[0];
  if (current.paymentProvider === "paypal" && current.status !== "paid" && item?.paypalAmount) {
    const product = await getProduct(item.productId);
    if (product) {
      // PayPal keys the request on the order id, so this returns the same
      // approval the buyer already has. The old one is simply left uncaptured.
      const paypal = await createPayPalOrder({ orderId: current.id, product, customerEmail: current.customerEmail, returnUrl: `${env.appUrl}/paypal-return.html`, cancelUrl: `${env.appUrl}/?paypal=cancelled`, amount: item.paypalAmount, currency: item.paypalCurrency });
      current = await updateOrder(order.id, { providerOrderId: paypal.id, updatedAt: now });
      const approvalUrl = (paypal.links || []).find((link) => link.rel === "payer-action" || link.rel === "approve")?.href;
      return { order: publicOrder(current), accessToken, approvalUrl, ...deadlinePayload(current) };
    }
  }
  return { order: publicOrder(current), accessToken, payment: current.paymentProvider === "bank_transfer" ? paymentInstructions(current) : null, ...deadlinePayload(current) };
}

// Checkout is the one public endpoint that writes a row and calls a paid API, so
// it needs a guard of its own. The address gets a generous budget because one
// carrier address legitimately serves many buyers; each email gets a tighter one,
// because nobody opens six real orders in fifteen minutes.
//
// The check sits after the duplicate lookup and the availability checks, not on
// the route. It counts orders created rather than requests received, which is the
// only thing worth bounding: a buyer on a bad connection who taps Mua lần thứ hai
// sends the same idempotency key, gets their original order handed back, and is
// never near a limit. Charging them for the retry would lose the sale and fix
// nothing. The IP budget stays generous for the same CGNAT reason as the lookup
// form: one public address can legitimately be many different buyers.
function checkoutThrottled(req, email) {
  return tooMany(`checkout-ip:${req.ip || "unknown"}`, 30) || Boolean(email) && tooMany(`checkout-email:${email}`, 12);
}

app.post("/api/checkout", json, async (req, res) => {
  try {
    const email = text(req.body.email, 160).toLowerCase();
    const productId = text(req.body.productId, 80);
    const method = req.body.paymentMethod === "paypal" ? "paypal" : "bank_transfer";
    const idempotencyKey = text(req.body.idempotencyKey, 64);
    if (!isEmail(email)) return res.status(400).json({ error: "Email không hợp lệ" });
    // A buyer whose connection dropped mid-request may already have an order.
    // Handing it back beats silently opening a second one.
    const repeated = idempotencyKey ? await findOrderByIdempotencyKey(idempotencyKey) : null;
    if (repeated) return res.json(await resumeOrder(repeated));
    const product = await getProduct(productId);
    if (!product || product.status !== "active") return res.status(404).json({ error: "Sản phẩm không khả dụng" });
    if (!product.fileKey || !isConfigured.r2) return res.status(503).json({ error: "Sản phẩm chưa sẵn sàng để nhận thanh toán" });
    if (method === "bank_transfer" && !isConfigured.bank) return res.status(503).json({ error: "Phương thức chuyển khoản chưa được cấu hình" });
    if (method === "paypal" && !isConfigured.paypal) return res.status(503).json({ error: "PayPal chưa được cấu hình. Hãy chọn chuyển khoản hoặc cấu hình PayPal trên server." });
    // Placed here, after everything above has already proved this request is a
    // genuinely new order. See checkoutThrottled for why the position matters.
    if (checkoutThrottled(req, email)) return res.status(429).json({ error: "Bạn đã tạo quá nhiều đơn hàng. Vui lòng thử lại sau 15 phút." });
    const accessToken = newToken();
    const id = newOrderId();
    const now = new Date().toISOString();
    const paypalQuote = method === "paypal" ? await paypalChargeForProduct(product) : null;
    const paypalCharge = paypalQuote?.charge ?? null;
    const order = {
      id, orderNumber: id, accessTokenHash: hashToken(accessToken), customerEmail: email,
      customerName: text(req.body.customerName, 100), status: "pending", paymentProvider: method,
      providerOrderId: null, amount: Number(product.price), currency: product.currency || "VND",
      // The deadline the buyer is shown on the form is written down here, so the
      // countdown they read and the moment the sweep acts on cannot drift apart.
      expiresAt: new Date(Date.now() + env.orders.paymentWindowHours * 60 * 60 * 1000).toISOString(),
      idempotencyKey: idempotencyKey || null, notifications: {},
      items: [{ productId: product.id, name: product.name, version: product.version, price: product.price, currency: product.currency, fileKey: product.fileKey || "", paypalAmount: paypalCharge?.amount ?? null, paypalCurrency: paypalCharge?.currency ?? null, paypalRate: paypalQuote?.rate?.vndPerUsd ?? null }],
      createdAt: now, updatedAt: now,
    };
    await createOrder(order);
    // The mail carries the deadline and the order id, which is what makes the
    // order recoverable after a lost browser session.
    await notifyOrder(order, "created");
    if (method === "bank_transfer") {
      const saved = await updateOrder(order.id, { status: "pending_transfer", updatedAt: now });
      return res.json({ order: publicOrder(saved), accessToken, payment: paymentInstructions(saved), ...deadlinePayload(saved) });
    }
    const paypal = await createPayPalOrder({ orderId: order.id, product, customerEmail: email, returnUrl: `${env.appUrl}/paypal-return.html`, cancelUrl: `${env.appUrl}/?paypal=cancelled`, amount: paypalCharge.amount, currency: paypalCharge.currency });
    const approvalUrl = (paypal.links || []).find((link) => link.rel === "payer-action" || link.rel === "approve")?.href;
    const saved = await updateOrder(order.id, { providerOrderId: paypal.id, updatedAt: now });
    res.json({ order: publicOrder(saved), accessToken, approvalUrl, ...deadlinePayload(saved) });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể tạo đơn hàng" }); }
});

function validOrderToken(req) { return req.get("x-order-token") || text(req.query.token, 100) || null; }
async function requireOrder(req, res) {
  const order = await getOrder(req.params.id);
  const token = validOrderToken(req);
  // isOrderOwner hashes and compares in constant time. The inline comparison this
  // replaced was a plain === on a hash, which leaks how many leading characters
  // matched, and it was the fourth copy of this check in the codebase.
  if (!isOrderOwner(order, token)) { res.status(404).json({ error: "Không tìm thấy đơn hàng" }); return null; }
  return order;
}
app.get("/api/orders/:id", async (req, res) => {
  try { const order = await requireOrder(req, res); if (order) res.json({ order: publicOrder(order), payment: order.paymentProvider === "bank_transfer" ? paymentInstructions(order) : null, ...deadlinePayload(order) }); }
  catch (error) { console.error(error); res.status(500).json({ error: "Không thể tải đơn hàng" }); }
});
app.get("/api/orders/:id/download", async (req, res) => {
  try {
    const order = await requireOrder(req, res);
    if (!order) return;
    // The only gate that matters is here. The button state in the browser is a
    // convenience; this is what actually decides whether bytes leave R2.
    if (order.status !== "paid") return res.status(409).json({ error: isClosed(order) ? "Đơn hàng đã được giao, không thể tải lại" : "Đơn hàng chưa được thanh toán" });
    const item = order.items?.[0];
    if (!item?.fileKey) return res.status(409).json({ error: "Sản phẩm chưa có file phát hành" });
    if (!isConfigured.r2) return res.status(503).json({ error: "R2 chưa được cấu hình" });
    res.json({ url: await createDownloadUrl(item.fileKey, `${item.name}-${item.version}.zip`), expiresIn: env.r2.downloadTtl });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể tạo link tải" }); }
});
// Called once the browser has actually started the transfer. The server cannot
// observe the file arriving, so the client is what tells it the release is out.
app.post("/api/orders/:id/delivered", json, async (req, res) => {
  try {
    const order = await requireOrder(req, res);
    if (!order) return;
    const updated = await markOrderDelivered(order);
    res.json({ order: publicOrder(updated), ...deadlinePayload(updated) });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể cập nhật đơn hàng" }); }
});

app.post("/api/orders/lookup", json, async (req, res) => {
  try {
    if (tooManyAttempts(req)) return res.status(429).json({ error: "Bạn đã tra cứu quá nhiều lần. Vui lòng thử lại sau 15 phút." });
    const id = text(req.body.orderId, 80).toUpperCase();
    const email = text(req.body.email, 160).toLowerCase();
    if (!id || !isEmail(email)) return res.status(400).json({ error: "Mã đơn hoặc email không hợp lệ" });
    const order = await getOrder(id);
    // One message for "no such order" and "email does not match", so the
    // endpoint never reveals which order ids exist.
    const invalid = { error: "Không tìm thấy đơn hàng với mã và email này" };
    if (!order || String(order.customerEmail || order.customer_email || "").toLowerCase() !== email) return res.status(404).json(invalid);
    // The original token only ever existed in the buyer's browser, so recovery
    // means issuing a new one and invalidating the old.
    const accessToken = newToken();
    await updateOrder(order.id, { accessTokenHash: hashToken(accessToken), updatedAt: new Date().toISOString() });
    res.json({ order: publicOrder(await getOrder(order.id)), accessToken, ...deadlinePayload(await getOrder(order.id)) });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể tra cứu đơn hàng" }); }
});

/**
 * A review, from someone who paid and was given the file.
 *
 * The access token is the whole authorisation: it is what opens the order, and
 * buyers are only ever shown it after checkout. So the review can only ever be
 * attached to a purchase whose download the caller could actually open, and there
 * is nothing to moderate beyond that.
 */
app.post("/api/reviews", json, async (req, res) => {
  try {
    const result = await createReview({
      orderId: text(req.body.orderId, 80).toUpperCase(),
      accessToken: text(req.body.accessToken, 200),
      productId: text(req.body.productId, 80),
      body: req.body.body,
      authorName: req.body.authorName,
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error, code: result.code || null });
    res.status(201).json({ review: result.review });
    // The words are now on the product page, which was already rendered and cached.
    invalidatePages();
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể lưu đánh giá" }); }
});

app.post("/api/paypal/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!(await verifyWebhook(req.body, req.headers))) return res.status(400).json({ error: "Webhook signature invalid" });
    const event = JSON.parse(req.body.toString("utf8"));
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const resource = event.resource || {};
      const customId = resource.purchase_units?.[0]?.custom_id || resource.custom_id;
      if (customId) {
        const order = await getOrder(customId);
        // A capture that lands after the expiry sweep still has to grant the
        // download: the money is in the account, so the order is not a lost sale.
        if (order && paymentMatchesOrder(resource, order) && order.status !== "paid") {
          const paid = resource.purchase_units?.[0]?.payments?.captures?.[0] || resource.payments?.captures?.[0] || resource;
          await markOrderPaid(order, { source: "webhook", providerAmount: Number(paid?.amount?.value || 0), providerCurrency: paid?.amount?.currency_code || null });
        }
      }
    }
    res.json({ received: true });
  } catch (error) { console.error(error); res.status(400).json({ error: "Webhook rejected" }); }
});
app.post("/api/paypal/capture", json, async (req, res) => {
  try {
    const order = await requireOrder(req, res);
    if (!order) return;
    if (order.paymentProvider !== "paypal" || !order.providerOrderId) return res.status(400).json({ error: "Đơn hàng không dùng PayPal" });
    if (order.status === "paid") return res.json({ order: publicOrder(order) });
    let capture;
    try {
      capture = await captureOrder(order.providerOrderId);
    } catch (error) {
      // The capture may already have succeeded and the buyer simply never saw
      // the answer. Only PayPal can settle that, so ask it what really happened
      // before telling a paying buyer their payment failed.
      const remote = await readOrder(order.providerOrderId).catch(() => null);
      if (!remote || remote.status !== "COMPLETED" || !paymentMatchesOrder(remote, order)) throw error;
      console.warn(`[paypal] capture failed but the order is already COMPLETED; reconciling ${order.id}`);
      capture = remote;
    }
    if (capture.status !== "COMPLETED" || !paymentMatchesOrder(capture, order)) {
      return res.status(409).json({ error: "PayPal chưa xác nhận đúng đơn hàng hoặc số tiền" });
    }
    const capture0 = capture.purchase_units?.[0]?.payments?.captures?.[0] || capture;
    const updated = await markOrderPaid(order, { source: "capture", providerAmount: Number(capture0.amount?.value || 0), providerCurrency: capture0.amount?.currency_code || null });
    res.json({ order: publicOrder(updated), ...deadlinePayload(updated) });
  } catch (error) { console.error(error); res.status(502).json({ error: "Không thể xác nhận thanh toán PayPal" }); }
});

// Poll target for the admin badge. It used to read the whole order table every
// few seconds just to work out how many were waiting: the cost grew with the shop
// while the answer did not. Now it asks for the newest row on its own and counts
// the open ones, and both answers come off the (status, expires_at) index.
app.get("/api/admin/orders/pending", admin, async (_req, res) => {
  try {
    const [newest, open] = await Promise.all([latestOrder(), listOpenOrders()]);
    const at = (order) => new Date(order?.createdAt || order?.created_at || 0).getTime();
    res.json({
      latest: newest ? at(newest) : 0,
      pending: open.filter((order) => order.status === "pending_transfer" && !isClosed(order)).length,
      // The newest order is echoed back so a new arrival can be named in the
      // alert without a second request.
      newest: newest ? { id: newest.id, status: newest.status, createdAt: newest.createdAt || newest.created_at || null } : null,
    });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không kiểm tra được đơn hàng" }); }
});

// The history view, paged. Capping it matters for the same reason: an admin
// panel that silently stops showing older orders is a trap, so the total count
// travels with the page and the panel can say what it is not showing.
app.get("/api/admin/orders", admin, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const [orders, open, total] = await Promise.all([listOrders({ limit, offset }), listOpenOrders(), countOrders()]);
    res.json({ orders: orders.map(publicOrder), live: open.length, limit, offset, hasMore: orders.length === limit, total });
  }
  catch (error) { console.error(error); res.status(500).json({ error: "Không thể tải đơn hàng" }); }
});
app.get("/api/admin/products", admin, async (_req, res) => {
  try { res.json({ products: await listProducts({ includeDrafts: true }) }); }
  catch (error) { console.error(error); res.status(500).json({ error: "Không thể tải sản phẩm" }); }
});
app.post("/api/admin/products", admin, json, async (req, res) => {
  try {
    const name = text(req.body.name, 120); const price = Number(req.body.price);
    if (!name || !Number.isFinite(price) || price < 0) return res.status(400).json({ error: "Tên hoặc giá sản phẩm không hợp lệ" });
    const slug = text(req.body.slug, 80) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    // Checked here as well as by the unique index, so the panel gets a sentence it
    // can show rather than a 500. Postgres rejects the second row with a 23505
    // that used to reach the owner as "server error" with no way to tell which
    // field was the problem. The index stays the real guarantee; this is the
    // message.
    if (!slug) return res.status(400).json({ error: "Tên sản phẩm không tạo được đường dẫn. Hãy nhập slug." });
    if (await getProductBySlug(slug)) return res.status(409).json({ error: `Đường dẫn /product/${slug} đã có sản phẩm khác dùng rồi.` });
    const item = await createProduct({
      slug, name,
      shortDescription: text(req.body.shortDescription, 180), description: text(req.body.description, 2000), category: text(req.body.category, 50) || "Khác", platform: text(req.body.platform, 50) || "Windows", version: text(req.body.version, 30) || "1.0.0", price, currency: text(req.body.currency, 8) || "VND",
      features: Array.isArray(req.body.features) ? req.body.features.map((v) => text(v, 120)).filter(Boolean) : [], featuresEn: Array.isArray(req.body.featuresEn) ? req.body.featuresEn.map((v) => text(v, 200)).filter(Boolean) : [], shortDescriptionEn: text(req.body.shortDescriptionEn, 180), descriptionEn: text(req.body.descriptionEn, 4000), requirements: text(req.body.requirements, 240), seoTitle: text(req.body.seoTitle, 70), seoDescription: text(req.body.seoDescription, 175), status: text(req.body.fileKey, 500) ? (req.body.status === "draft" ? "draft" : "active") : "draft", fileKey: text(req.body.fileKey, 500), badge: text(req.body.badge, 40) || null, featured: Boolean(req.body.featured),
    });
    // Publishing a product is the one event a crawler cannot guess at: the
    // sitemap is only re-read on its own schedule, so without this a new page
    // can stay invisible for days. The ping is fire and forget, because a
    // search engine being slow must not fail a product save.
    await pingIndexNow(["/", `/product/${item.slug}`]);
    res.status(201).json({ product: item });
    // A new product changes what the homepage, /llms.txt and /feed.json say, and
    // all three were allowed to keep serving the previous catalogue for a minute.
    // Creating is rare; being wrong about a price is not.
    invalidatePages();
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể tạo sản phẩm" }); }
});
app.patch("/api/admin/products/:id", admin, json, async (req, res) => {
  try {
    // The admin's SEO editor sends only these two fields. Passing the body
    // through as-is is deliberate: toProduct() sends only the keys it was
    // given, so a partial edit cannot blank out the description or features.
    // The one exception is the two SEO fields, which are trimmed and capped
    // here so no caller can store a title longer than a search result shows.
    const patch = { ...req.body, updatedAt: new Date().toISOString() };
    if (req.body.seoTitle !== undefined) patch.seoTitle = text(req.body.seoTitle, 70);
    if (req.body.seoDescription !== undefined) patch.seoDescription = text(req.body.seoDescription, 175);
    const item = await updateProduct(req.params.id, patch);
    if (!item) return res.status(404).json({ error: "Không tìm thấy sản phẩm" });
    // Price and description are what a search result shows, so an edit here is
    // exactly as indexable as a new page.
    await pingIndexNow(["/", `/product/${item.slug}`]);
    res.json({ product: item });
    invalidatePages();
  }
  catch (error) { console.error(error); res.status(500).json({ error: "Không thể cập nhật sản phẩm" }); }
});
app.post("/api/admin/uploads/presign", admin, json, async (req, res) => {
  try {
    const productRef = text(req.body.productRef ?? req.body.productId, 80); const version = text(req.body.version, 30); const fileName = text(req.body.fileName, 140);
    if (!productRef || !version || !fileName) return res.status(400).json({ error: "Thiếu productRef, version hoặc fileName" });
    // The release formats, in one place. This gate used to name three extensions
    // while the shop sells Windows software, which is the whole catalogue: there
    // is no Apple or Linux build, and pretending otherwise in the uploader would
    // only produce a file the product page then misdescribes.
    if (!/\.(zip|exe|msi|7z)$/i.test(fileName)) return res.status(400).json({ error: "Chỉ hỗ trợ file .zip, .exe, .msi hoặc .7z" });
    if (!isConfigured.r2) return res.status(503).json({ error: "R2 chưa được cấu hình" });
    res.json(await createUploadUrl({ productRef, version, fileName, contentType: text(req.body.contentType, 120) }));
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể tạo link upload" }); }
});
/**
 * Sums revenue per product, in the currency the buyer actually paid in.
 *
 * The order amount is the shelf price, so for a PayPal order the number that
 * matters is the captured USD minus nothing else yet. Reporting the VND list
 * price as "revenue" would hide both the currency conversion and the ~3-4%
 * PayPal fee, and a store owner reconciling against a PayPal statement needs
 * the figure that lands in the account.
 *
 * Delivered orders are counted, not just ones still sitting in "paid": closing
 * an order after delivery resets its status but keeps paidAmount, so a report
 * that filtered on status would shrink the day a customer downloads.
 */
app.get("/api/admin/revenue", admin, async (_req, res) => {
  try {
    const orders = await listOrdersForRevenue();
    const products = new Map();
    let gross = { VND: 0, USD: 0 };
    let moneyBack = { VND: 0, USD: 0 };
    let paidOrders = 0;
    let refundedOrders = 0;
    let outstanding = 0;
    for (const order of orders) {
      const item = order.items?.[0] || {};
      // paidCount is what makes a delivered order still count as revenue.
      const count = Number(order.paidCount || 0);
      const back = Number(order.refundedCount || 0);
      if (count <= 0 && back <= 0) {
        if (isUnpaid(order) && !isClosed(order) && paymentDeadline(order) && paymentDeadline(order) > Date.now()) outstanding += Number(order.amount || 0);
        continue;
      }
      paidOrders += count;
      refundedOrders += back;
      const collected = Number(order.paidAmount || 0) || Number(order.amount || 0);
      const returned = Number(order.refundedAmount || 0);
      const providerCollected = Number(order.paidProviderAmount || 0);
      const providerReturned = Number(order.refundedProviderAmount || 0);
      const key = item.productId || item.name || "unknown";
      const entry = products.get(key) || { productId: key, name: item.name || key, version: item.version || "", price: Number(order.amount || 0), currency: order.currency || "VND", units: 0, revenue: 0, refunds: 0, provider: 0, orders: 0 };
      entry.units += count;
      entry.orders += 1;
      entry.revenue += collected;
      entry.refunds += returned;
      if (providerCollected > 0) entry.provider += providerCollected;
      products.set(key, entry);
      // The currency bucket is decided per order, never per product. Two buyers
      // can pay the same product in different currencies, and reading the bucket
      // off the shared product row would drop one of the two totals on the
      // floor the moment the second kind of order arrived.
      //
      // A PayPal order counts as USD only. Adding its VND shelf price as well
      // would book one sale twice in two currencies and quietly inflate the
      // report by the price of every foreign order.
      if (order.paidProviderCurrency && providerCollected > 0) {
        gross[order.paidProviderCurrency] = (gross[order.paidProviderCurrency] || 0) + providerCollected;
        moneyBack[order.paidProviderCurrency] = (moneyBack[order.paidProviderCurrency] || 0) + providerReturned;
      } else {
        const currency = order.currency || "VND";
        gross[currency] = (gross[currency] || 0) + collected;
        moneyBack[currency] = (moneyBack[currency] || 0) + returned;
      }
    }
    // A mixed list of VND and USD cannot be summed honestly, so each is kept
    // separate and the UI shows them side by side rather than inventing a total.
    const rows = [...products.values()].sort((a, b) => b.units - a.units);
    for (const row of rows) {
      row.avg = row.units ? Math.round(row.revenue / row.units) : 0;
      row.net = row.revenue - row.refunds;
    }
    const net = {};
    for (const currency of new Set([...Object.keys(gross), ...Object.keys(moneyBack)])) {
      net[currency] = (gross[currency] || 0) - (moneyBack[currency] || 0);
    }
    res.json({ currency: env.paypal.currency, gross, refunds: moneyBack, net, paidOrders, refundedOrders, outstanding, products: rows, generatedAt: new Date().toISOString() });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không tổng hợp được doanh thu" }); }
});

app.patch("/api/admin/orders/:id", admin, json, async (req, res) => {
  // Every change a person makes to an order is written down with the id of the
  // request that caused it.
  //
  // The order row remembers *what* happened — it moved to refunded, with a reason
  // — and nothing recorded *who* or *when it was asked for*, so the shop had no way
  // to answer "was this refunded, and was it a mistake", which is exactly the
  // question that arrives when a buyer says they never got the money back. The
  // order keeps the reason because the order is the durable record; this keeps the
  // provenance, because the log is the only place that has it.
  //
  // One line, on the same stream as the access log and tagged with the same
  // request id, so a refund is one grep away from the request that caused it.
  const acted = (action, extra = {}) => console.log(`${req.requestId} admin ${action} ${req.params.id} ${JSON.stringify(extra)}`);
  try {
    const status = req.body.status;
    const existing = await getOrder(req.params.id);
    if (!existing) return res.status(404).json({ error: "Không tìm thấy đơn hàng" });
    // Closes a paid order the same way the buyer's browser does, for the times
    // the download link was handed over by hand.
    if (req.body.delivered === true) { acted("deliver"); return res.json({ order: publicOrder(await markOrderDelivered(existing)) }); }
    // The mirror image. A download that dies halfway still counts as handed
    // over, because the server cannot see a file arrive, so the owner needs one
    // click to undo it when a customer says the file never made it.
    if (req.body.reopen === true) {
      if (!isClosed(existing)) return res.status(409).json({ error: "Đơn này chưa đóng" });
      acted("reopen");
      const now = new Date().toISOString();
      return res.json({ order: publicOrder(await updateOrder(existing.id, { status: "paid", paidAt: existing.paidAt || now, deliveredAt: null, updatedAt: now })) });
    }
    // Money going back: a refund, a chargeback, or a confirmation made by
    // mistake. Recorded as its own figure rather than subtracted from the sale,
    // so the gross number still matches a bank statement.
    if (req.body.refund === true) {
      // hasPayment, not status === "paid": a delivered order is no longer "paid"
      // by design, and refusing those made the most common refund impossible.
      if (!hasPayment(existing)) return res.status(409).json({ error: "Chỉ hoàn tiền được đơn đã nhận tiền" });
      const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) return res.status(400).json({ error: "Cần ghi lý do hoàn tiền" });
      // The reason is in the order row; the request that carried it is here.
      acted("refund", { amount: existing.amount, currency: existing.currency, reason });
      return res.json({ order: publicOrder(await voidPayment(existing, { reason })) });
    }
    if (!["pending", "pending_transfer", "paid", "payment_failed", "cancelled", "refunded"].includes(status)) return res.status(400).json({ error: "Trạng thái không hợp lệ" });
    // Confirming by hand goes through the same path as a webhook, so the buyer
    // still gets the mail and paid_count still reflects the real revenue.
    if (status === "paid") { acted("confirm-paid", { amount: existing.amount, currency: existing.currency }); return res.json({ order: publicOrder(await markOrderPaid(existing, { source: "admin" })) }); }
    acted("status", { to: status });
    const item = await updateOrder(req.params.id, { status, paidAt: null, updatedAt: new Date().toISOString() });
    res.json({ order: publicOrder(item) });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể cập nhật đơn hàng" }); }
});

// Anything that fell through is the 404 page, not Express's bare error. It is
// declared noindex, so broken links a crawler discovers do not become thin
// duplicate pages competing with the products. Rendered rather than sendFile, so
// the footer carries the year instead of the template token; the handler itself is
// defined with the other page routes.
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  return notFound(req, res);
});

app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: "Internal server error" }); });
export async function createApp() { await ensureSeed(); return app; }
export default app;
