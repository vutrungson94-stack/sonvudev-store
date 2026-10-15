import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { env, isConfigured } from "./config.js";
import { ORDER_STATUSES, countOrders, countOrdersForProduct, dataDir, ensureSeed, findOrderByIdempotencyKey, getOrder, getProduct, getProductBySlug, isOrderOwner, isSellable, latestOrder, listOpenOrders, listOrders, listOrdersForRevenue, listProducts, listRefundedEmails, createOrder, updateOrder, createProduct, updateProduct, deleteProduct, persistenceMode } from "./store.js";
import { supabaseRequest } from "./supabase-http.js";
import { slugify } from "./format.js";
import { paypalEnvironmentIsSet } from "./config.js";
import { createDownloadUrl, createUploadUrl } from "./r2.js";
import { captureOrder, createOrder as createPayPalOrder, hashToken, newOrderId, newToken, paypalChargeForProduct, paymentMatchesOrder, readOrder, verifyWebhook } from "./paypal.js";
import { paymentInstructions, paymentOptions } from "./payments.js";
import { analyticsMeta, brandMeta, esc, fillCopy, fillPageTokens, pageTokenValues, renderFeed, renderIndexCount, renderIndexFilters, renderIndexGrid, renderLlmsTxt, renderOgImage, renderProductPage, renderStats, tokenMeta, verificationFile, verificationMeta, REFUND_POLICY_UPDATED } from "./pages.js";
import { hasPayment, isClosed, isUnpaid, markOrderDelivered, markOrderPaid, paymentDeadline, sweeperRunning, voidPayment } from "./orders.js";
import { notifyOrder, notifyMode } from "./notify.js";
import { resolveCountry } from "./geo.js";
import { pingIndexNow, isIndexNowConfigured } from "./indexnow.js";
import { vndPerUsd } from "./rates.js";
import { createReview, listReviewsForProduct, reviewLimits } from "./reviews.js";
import { refuse } from "./refuse.js";
import { renderRobotsTxt } from "./robots.js";
import { adminThrottled, healthThrottled, tooManyAttempts, checkoutThrottled } from "./rate-limit.js";
import { parseAdminTokens, matchAdminToken } from "./admin-auth.js";

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
  const copy = ["name", "shortDescription", "short_description", "description", "descriptionEn", "description_en", "shortDescriptionEn", "short_description_en", "seoTitle", "seo_title", "seoDescription", "seo_description", "seoTitleEn", "seo_title_en", "seoDescriptionEn", "seo_description_en"];
  const filled = { ...safe };
  for (const field of copy) if (typeof filled[field] === "string") filled[field] = fillCopy(filled[field]);
  for (const field of ["features", "featuresEn", "features_en"]) if (Array.isArray(filled[field])) filled[field] = filled[field].map(fillCopy);
  return filled;
};
const publicOrder = (order) => { if (!order) return null; const { accessTokenHash, access_token_hash, idempotencyKey, idempotency_key, notifications, ...safe } = order; return { ...safe, items: (safe.items || []).map(({ fileKey, file_key, ...item }) => item) }; };
// The three kinds of refund, and the amount each one is allowed to move.
//
// A defect or a duplicate is the shop's fault and returns everything. The third is
// the one the policy exists for — a buyer who has the file and has changed their
// mind — and it moves only the part the owner types in. The bounds are the whole
// point: an amount of zero would sell the software for nothing, an amount equal to
// the payment would refund in full against a policy that says not to, and anything
// above the payment would refund money that was never taken.
const REFUND_CATEGORIES = ["defect", "duplicate", "changed_mind"];
const refundAmountFor = (category, order, partial) => {
  const paid = Number(order?.paidAmount || order?.amount || 0);
  if (category !== "changed_mind") return paid;
  const amount = Number(partial);
  if (!Number.isFinite(amount) || amount <= 0 || amount >= paid) return null;
  return amount;
};

// The USD figure a buyer is actually charged, attached in front of the public
// copy of a product so a storefront read in English quotes the same number
// PayPal takes.
//
// It is resolved through paypalChargeForProduct — the same function checkout
// uses — rather than by dividing the shelf price by the raw rate. The raw
// division is a number nobody pays: checkout adds the rate margin first, so a
// page showing the raw conversion quotes low and the buyer discovers the real
// amount at the payment step.
//
// When there is no rate and no fallback the product is returned untouched. A
// missing priceUsd makes every caller render the VND shelf price, which is
// wrong for the language but is never a sum the buyer is not charged.
async function withUsdPrice(product) {
  if (!product) return product;
  if (String(product.currency || "VND").toUpperCase() !== "VND") return product;
  try {
    const { charge } = await paypalChargeForProduct(product);
    return { ...product, priceUsd: charge.amount, priceUsdCurrency: charge.currency };
  } catch {
    return product;
  }
}
// A countdown is only correct if it is measured against the server's clock, so
// the deadline and the server's own time always travel together.
const deadlinePayload = (order) => {
  const at = isUnpaid(order) && !isClosed(order) ? paymentDeadline(order) : null;
  return { expiresAt: at ? new Date(at).toISOString() : null, serverTime: new Date().toISOString() };
};
const text = (value, max = 180) => String(value || "").trim().slice(0, max);
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const adminEntries = () => parseAdminTokens({ primary: env.adminToken, extra: env.adminTokens });
const adminEntryFor = (req) => {
  const supplied = req.get("x-admin-token") || (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return matchAdminToken(supplied, adminEntries());
};
// GET cho phép viewer + admin, ghi (POST/PATCH/PUT/DELETE) chỉ admin.
// Token cũ không role mặc định admin nên mọi test/caller hiện tại giữ nguyên.
const admin = (req, res, next) => {
  if (adminThrottled(req)) {
    return res.status(429).json(refuse("api.err.rateLimited", "Quá nhiều yêu cầu. Vui lòng thử lại sau.", 429));
  }
  const entry = adminEntryFor(req);
  if (!entry) return res.status(401).json(refuse("api.err.unauthorized", "Không có quyền.", 401));
  req.admin = { name: entry.name, role: entry.role };
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" && entry.role !== "admin") {
    return res.status(403).json(refuse("api.err.forbidden", "Vai trò viewer chỉ được đọc.", 403));
  }
  next();
};

// The health probe, open to anybody and limited like any other public route.
//
// A monitor has no admin token and cannot be given one, so this cannot simply be
// an admin route. It sets req.owner rather than refusing, so the route can answer
// an anonymous caller with the liveness facts and the owner with the whole
// configuration. The limit itself lives in src/rate-limit.js with every other one.
const adminOrHealth = (req, res, next) => {
  if (healthThrottled(req)) {
    return res.status(429).json(refuse("api.err.rateLimited", "Quá nhiều yêu cầu. Vui lòng thử lại sau.", 429));
  }
  req.owner = Boolean(adminEntryFor(req));
  next();
};

// Order ids are short, so a lookup endpoint without a limit would let anyone
// walk the id space. Limit logic lives in src/rate-limit.js so every route
// shares one window and tests can reset it; the comment about CGNAT/email split
// below explains the policy this wiring implements.
//
// Keyed rather than counted by IP alone, on purpose. Vietnamese mobile carriers
// put a lot of unrelated buyers behind one public address, so a limit read only
// by IP starts refusing real orders to whoever happens to be the eleventh buyer on
// that address. Counting the email as well splits the two abuse cases apart: one
// script on one machine walks many emails, and many machines behind one address
// hammer the same one. Each has its own budget, so blocking one does not starve
// the other.

app.set("trust proxy", env.trustProxy);
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

// The slug that answers the site-wide share card at /og/<slug>.svg.
//
// It used to be the literal "sonvudev", written into the route: renaming BRAND_NAME
// made /og/sonvudev.svg 404 while every other page on the site carried the new name,
// so the one image a link preview depended on was the only thing still wearing the
// old brand. Derived from configuration instead, so it follows the name.
const siteCardSlug = slugify(env.brand.name) || "shop";

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // script-src and connect-src carry static.cloudflareinsights.com and
// cloudflareinsights.com because analyticsMeta() in src/pages.js puts the Web
// Analytics beacon on every page. Without the two entries the browser blocks
// the tag and Cloudflare reports a confident zero, which is worse than not
// measuring: the shop would look visited when nobody had been.
res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://img.vietqr.io; connect-src 'self' https://*.r2.cloudflarestorage.com https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
});
app.get("/robots.txt", (_req, res) => {
  // Built by src/robots.js, which is also what scripts/seo-check.mjs asserts the
  // live file against. The list used to be written here and there, and /paypal-return
  // had already been added to one and forgotten in the other.
  res.type("text/plain").send(renderRobotsTxt(env.appUrl));
});

app.get("/site.webmanifest", (_req, res) => {
  // Served rather than committed as a static file, for the same reason the canonical
  // URL and the verification tags are: the name in here is the brand, and a brand
  // written into a JSON file is a second place to forget to change it. A manifest is
  // also what makes the shop installable and what names its icon on an Android home
  // screen, which is a slot the logo otherwise never reaches.
  res.set("Cache-Control", "public, max-age=3600").type("application/manifest+json").send(JSON.stringify({
    name: env.brand.name,
    short_name: env.brand.name,
    description: env.brand.description,
    lang: "vi",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // The tile background is the brand dark from styles.css, and the mark on it is
    // the same mark the apple-touch-icon composites onto that same colour.
    background_color: "#0f2a22",
    theme_color: "#0f2a22",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // maskable asks the launcher to crop the icon to its own shape, which needs
      // the mark inside the safe zone rather than edge to edge. The source has the
      // mark filling the frame, so this points at the padded tile instead.
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "maskable" },
    ],
  }, null, 2));
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
//
// Only the page tokens are substituted, and deliberately so: the panel is served as a
// file rather than through renderPage, so nothing else could be filled in there
// without handing the admin page the ownership tags and the catalogue the other
// pages get. The one thing it still had hardcoded was the shop's name.
app.get(["/admin", "/admin.html", "/admin.js"], async (_req, res) => {
  res.set("Cache-Control", "no-store");
  if (_req.path === "/admin.js") return res.sendFile(path.join(publicDir, "admin.js"));
  try {
    const html = await fs.readFile(path.join(publicDir, "admin.html"), "utf8");
    res.type("html").send(fillPageTokens(html, pageTokenValues({ page: "admin.html" })));
  } catch (error) {
    console.error(error);
    res.sendFile(path.join(publicDir, "admin.html"));
  }
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
  // The page tokens come from pageTokenValues() in src/pages.js — one list, one
  // builder — so a token the renderer fills can never be unknown to the audit or
  // the byte-level tests again. What follows the tokens is structure, not values:
  // verification tags, the catalogue and the counts, each derived from the same
  // product list the tokens describe.
  const html = fillPageTokens(template, pageTokenValues({ products, reviewLimits, page: file }))
    .replace("</head>", `${tokenMeta()}\n${verificationMeta()}\n${brandMeta()}\n${analyticsMeta()}\n</head>`)
    .replace(/(<span[^>]*class="product-count"[^>]*id="product-count"[^>]*>)[\s\S]*?(<\/span>)/, `$1${esc(renderIndexCount(products))}$2`)
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
    // One homepage, one language at a time: i18n.js switches it in the browser and
    // reads the stored choice before the first paint. The second argument this call
    // used to pass ("vi") named nothing — sendPage takes one parameter — so it
    // implied a server-side language that does not exist and would only ever be vi.
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
  // Cache HIT phải trả về nội dung đã render, không phải cả object bao
  // {at, value}: lần đầu (miss) trả string/object đúng, lần hai trong 60s
  // trả nguyên wrapper khiến /llms.txt thành JSON và /feed.json bọc 2 lớp.
  if (hit && Date.now() - hit.at < TEXT_TTL_MS) return hit.value;
  const value = build(await listProducts());
  textCache.set(key, { at: Date.now(), value });
  return value;
};

app.get("/llms.txt", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "public, max-age=3600").type("text/plain; charset=utf-8")
      .send(await cachedText("llms", renderLlmsTxt));
  } catch (error) { next(error); }
});

app.get("/feed.json", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "public, max-age=3600").type("application/json")
      .send(await cachedText("feed", renderFeed));
  } catch (error) { next(error); }
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
    //
    // Rendered through the same 404 handler as every other missing page. This
    // used to sendFile the raw template, so /product/<anything> answered with
    // the literal {{brandWordmark}} and {{year}} while every other 404 was
    // substituted — a leak no file-based check could see, because the file on
    // disk is meant to carry those tokens.
    if (!isSellable(product)) {
      return notFound(req, res);
    }
    const reviews = await listReviewsForProduct(product.id);
    // Only the English page needs a dollar figure: the Vietnamese shelf price is
    // the price a Vietnamese buyer is charged, and converting it for a reader who
    // is about to pay in dong adds nothing but a rounded number. The figure is
    // resolved with the same function checkout uses, so what the page states and
    // what PayPal takes cannot drift apart.
    let usd = null;
    if (lang === "en") {
      try {
        const { charge } = await paypalChargeForProduct(product);
        usd = charge.amount;
      } catch {
        // Rate unavailable: the page falls back to the shelf price rather than
        // inventing a dollar amount. Charging still works — checkout resolves
        // the rate again at order time.
      }
    }
    res.set("Cache-Control", "public, max-age=600").type("html").send(renderProductPage(product, lang, reviews, usd));
  } catch (error) {
    console.error(error);
    try {
      res.status(500).type("html").send(await renderPage("404.html"));
    } catch {
      res.status(500).sendFile(path.join(publicDir, "404.html"));
    }
  }
};
app.get("/product/:slug", productPage("vi"));
app.get("/en/product/:slug", productPage("en"));

app.get("/og/:slug.svg", async (req, res, next) => {
  try {
  // A clean site-wide card, so a link shared without a product still previews.
  // The price used to be written into this line as "Từ 99.000₫" and the platform
  // and version as literals, so a shop that changed either kept publishing the
  // old numbers. There is no price here at all: a card that invents a number is
  // worse than a card that states none. The platform, version and price
  // fallbacks live in the generator, so this call no longer repeats them.
  //
  // The language is an optional query parameter rather than a second route: the
  // card renders in the language it is asked for, and an English page that
  // hands this URL to a crawler can say so.
  if (req.params.slug === siteCardSlug) {
    return res.set("Cache-Control", "public, max-age=3600").type("image/svg+xml").send(renderOgImage({ name: env.brand.name }, req.query.lang === "en" ? "en" : "vi"));
  }
  const product = await getProductBySlug(req.params.slug);
  // isSellable rather than a second copy of its rule. The rule — active, has a
  // file, storage configured — was written out inline here and once more in
  // renderProductPage's caller, and a third time with a different order of the
  // same three conditions further down. Three spellings of one rule means a change
  // to it has to find all three, and the one nobody found is a product page that
  // renders for something with no file behind it.
  if (!isSellable(product)) return res.status(404).type("text/plain").send("Not found");
  res.set("Cache-Control", "public, max-age=3600");
  res.type("image/svg+xml").send(renderOgImage(product, req.query.lang === "en" ? "en" : "vi"));
  } catch (error) { next(error); }
});

app.get("/sitemap.xml", async (_req, res, next) => {
  try {
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
  } catch (error) { next(error); }
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
  // The header is client-controlled and it is about to be written into the access
  // log and sent back on the response, so it is trimmed to the characters an id
  // is made of. Slicing alone left a caller free to put spaces and punctuation in
  // the one field every log line is searched by.
  const supplied = String(req.headers["x-request-id"] || "").trim();
  const requestId = /^[A-Za-z0-9._:-]{1,64}$/.test(supplied) ? supplied : crypto.randomUUID();
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
// Five minutes, not an hour.
//
// A stylesheet fix that takes an hour to reach a browser is indistinguishable from
// a fix that did not work: the deploy lands, every gate is green, and the person
// who just shipped it is told the page is still wrong. That cost was paid twice
// here before the cause turned out to be this header rather than the CSS — and the
// second time it was this line of reasoning that found it.
//
// express still sends ETag and Last-Modified, so a revalidation is a 304 with no
// body. Five minutes of reuse per asset is plenty for a shop with this little
// traffic, and a deploy becomes visible on the next page load instead of an hour
// later — which is the only property that actually matters here.
app.use(express.static(publicDir, { maxAge: "5m", index: false }));

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
//
// Four things this endpoint used to do that it had no business doing, all of them
// paid for by whoever calls it:
//
//  - it had no rate limit, while probing the database and the FX rate on every
//    request. An unauthenticated GET that reaches Supabase is a free amplifier, and
//    /api/health is a name every scanner already knows;
//  - the storage probe called fs.mkdir on every request, so an unauthenticated GET
//    wrote to the filesystem;
//  - it printed the absolute path of the data directory, and the raw text of a
//    PostgREST error, to anybody who asked;
//  - it printed the PayPal webhook id, on the grounds that it is not a secret.
//    It is not, but it is also not needed by anything except the owner, who already
//    has the dashboard.
//
// The detail is still here for the owner; it now has to say who it is.
app.get("/api/health", adminOrHealth, async (req, res) => {
  const checks = {};
  const startedAt = process.hrtime.bigint();
  // One row, no columns: enough to prove the network path, the service key and the
  // database all work, and it cannot be slow because of the size of the result.
  if (isConfigured.supabase) checks.database = await probe(async () => { await supabaseRequest("products?select=id&limit=1"); return "ok"; }, "supabase");
  else checks.database = `skipped (${persistenceMode})`;
  // The storage probe only means something when this host is the datastore. With
  // Supabase configured, a read-only filesystem is the expected state — the
  // deployment is a bundle, not a checkout — and probing it produced a 503 on
  // every request from every platform that does not hand out a writable disk.
  //
  // It is a worse failure than a false alarm, because a monitor reading ok:false
  // here concludes the database is unreachable when the database probe above it
  // says "ok". The two lines sit next to each other in the same JSON object and
  // disagree.
  //
  // mkdir is out, and so is asking only about permissions: a health check that
  // creates what it inspects is a write on every poll, and a path that is not a
  // directory at all is writable in the access(2) sense while being useless as a
  // place to keep orders. Both are checked, neither is created — and a directory
  // that does not exist is reported as the failure it is, because ensureSeed()
  // makes it at boot and nothing after that removes it.
  if (isConfigured.supabase) checks.storage = "skipped (supabase)";
  else checks.storage = await probe(async () => {
    await fs.access(dataDir, fs.constants.W_OK);
    if (!(await fs.stat(dataDir)).isDirectory()) throw new Error("not a directory");
    return "ok";
  }, "data directory not writable");
  const rate = await vndPerUsd().catch(() => null);
  const ok = !Object.values(checks).some((value) => typeof value !== "string" || value.startsWith("!"));
  // What an anonymous caller gets. Enough to answer "is it up", which is what a
  // load balancer or a public uptime page needs, and nothing else.
  // These booleans are configuration, not secrets - see the test that named that
  // trade: a dashboard or a probe can see at a glance whether the site is claimed
  // with the search engines. The actual verification tokens never travel.
  const searchState = {
    google: Boolean(env.site.googleVerification),
    bing: Boolean(env.site.bingVerification),
    indexNow: Boolean(env.site.indexNowKey),
  };
  const publicView = {
    ok, requestId: req.requestId, checks,
    elapsedMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
    uptime: Math.round(process.uptime()),
    persistence: persistenceMode,
    r2: isConfigured.r2, paypal: isConfigured.paypal, email: notifyMode(),
    orderWindowHours: env.orders?.paymentWindowHours ?? null,
    sweeper: sweeperRunning(),
    search: searchState,
  };
  if (!req.owner) return res.status(ok ? 200 : 503).json(publicView);
  res.status(ok ? 200 : 503).json({
    ...publicView,
    appUrl: env.appUrl,
    r2: isConfigured.r2, paypal: isConfigured.paypal, paypalWebhook: isConfigured.paypalWebhook,
    // Which PayPal this host is actually talking to, and whether that was decided or
    // assumed. A host that has never been told falls back to sandbox, and sandbox
    // credentials authenticate perfectly against the sandbox API — so every other
    // signal says healthy while real payments cannot be captured. Naming it here is
    // what makes the question answerable against the running server.
    paypalEnvironment: paypalEnvironmentIsSet ? env.paypal.environment : "unset (treated as sandbox)",
    // The configured webhook id, so a mismatch is visible.
    //
    // `paypalWebhook` above only says the variable is not empty, and it is true
    // whether or not the id belongs to a webhook on this account. Verification
    // passes the id to PayPal, which compares it against the webhook that actually
    // delivered the event and rejects the delivery when they differ — so a
    // stale id after a webhook is re-created produces a checkout where the
    // buyer is charged, every webhook returns 400, and the order never becomes
    // paid. The id is not a secret: it is printed in the PayPal developer
    // dashboard next to the webhook URL, to anyone with access to the app.
    paypalWebhookId: env.paypal.webhookId || null,
    bank: isConfigured.bank, momo: Boolean(env.bank.momo), zalopay: Boolean(env.bank.zalopay), admin: isConfigured.admin,
    // "outbox" means there is no mail provider yet: order mail is being written
    // to data/outbox instead of being delivered.
    email: notifyMode(), orderWindowHours: env.orders.paymentWindowHours,
    // The real timer, not a restatement of the flag that would have disabled it.
    // See sweeperRunning() in src/orders.js: this used to read ORDER_SWEEP_DISABLED
    // directly, which nothing but two test files ever set and which startSweeper()
    // never consulted — so the monitor's only view of the sweeper was fiction.
    sweeper: sweeperRunning(),
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
  try {
    const products = (await listProducts()).filter(isSellable).map(publicProduct);
    res.json({ products: await Promise.all(products.map(withUsdPrice)) });
  } catch (error) { console.error(error); res.status(500).json(refuse("api.err.catalogLoad", "Không thể tải danh mục", 500)); }
});
// GET /api/products/:id used to sit here.
//
// Nothing called it. The storefront reads the whole catalogue from /api/products, the
// product page is rendered on the server, and no script, test or document in this
// repository ever asked for a single product by id. It was public and unauthenticated,
// disclosing the same fields the list endpoint already publishes (including the USD
// figure) and scripts/metrics.mjs then pinned it as a route that must never go down,
// so a dead endpoint became the one thing on this server a regression gate defended.
//
// The collection endpoint already answers "give me this product" for any consumer that
// needs it. If a single-product endpoint is ever genuinely wanted, it belongs behind
// the admin token like every other per-record read.

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
  } catch (error) { console.error(error); res.status(500).json(refuse("api.err.methodsLoad", "Không tải được phương thức thanh toán", 500)); }
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
// Implemented in src/rate-limit.js; kept here only as documentation of position.

app.post("/api/checkout", json, async (req, res) => {
  try {
    const email = text(req.body.email, 160).toLowerCase();
    const productId = text(req.body.productId, 80);
    const method = req.body.paymentMethod === "paypal" ? "paypal" : "bank_transfer";
    const idempotencyKey = text(req.body.idempotencyKey, 64);
    if (!isEmail(email)) return res.status(400).json(refuse("api.err.invalidEmail", "Email không hợp lệ", 400));
    // A buyer whose connection dropped mid-request may already have an order.
    // Handing it back beats silently opening a second one — and it must not be
    // asked to consent a second time, so the consent check sits after this.
    const repeated = idempotencyKey ? await findOrderByIdempotencyKey(idempotencyKey) : null;
    if (repeated) return res.json(await resumeOrder(repeated));
    // The one thing a refund dispute turns on. A policy nobody ticked is a policy
    // nobody agreed to, so the checkout refuses to take money without the box, and
    // what was ticked is written onto the order beside the version of the policy it
    // pointed at and the address it came from. Split three ways because the browser
    // sends "on" for a checkbox, JSON for anything else, and both must be accepted.
    if (req.body.acceptPolicy !== true && req.body.acceptPolicy !== "on" && req.body.acceptPolicy !== "true") {
      return res.status(400).json(refuse("api.err.policyNotAccepted", "Bạn cần đồng ý với điều khoản và chính sách hoàn tiền trước khi thanh toán", 400));
    }
    const product = await getProduct(productId);
    if (!product || product.status !== "active") return res.status(404).json(refuse("api.err.productUnavailable", "Sản phẩm không khả dụng", 404));
    if (!product.fileKey || !isConfigured.r2) return res.status(503).json(refuse("api.err.productNotSellable", "Sản phẩm chưa sẵn sàng để nhận thanh toán", 503));
    if (method === "bank_transfer" && !isConfigured.bank) return res.status(503).json(refuse("api.err.transferUnconfigured", "Phương thức chuyển khoản chưa được cấu hình", 503));
    if (method === "paypal" && !isConfigured.paypal) return res.status(503).json(refuse("api.err.paypalUnconfigured", "PayPal chưa được cấu hình. Hãy chọn chuyển khoản hoặc cấu hình PayPal trên server.", 503));
    // Placed here, after everything above has already proved this request is a
    // genuinely new order. See checkoutThrottled for why the position matters.
    if (checkoutThrottled(req, email)) return res.status(429).json(refuse("api.err.rateLimitedCreate", "Bạn đã tạo quá nhiều đơn hàng. Vui lòng thử lại sau 15 phút.", 429));
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
      // What the buyer agreed to, when, from where, and which version of the
      // policy they were shown. Four separate facts because a dispute argues about
      // all four separately: that they consented, that it was before the money
      // moved, that it was this person, and that the text is the one still quoted.
      policyAcceptedAt: now, policyAcceptedIp: req.ip || null, policyAcceptedVersion: REFUND_POLICY_UPDATED,
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
  } catch (error) { console.error(error); res.status(500).json(refuse("api.err.orderCreate", "Không thể tạo đơn hàng", 500)); }
});

function validOrderToken(req) { return req.get("x-order-token") || text(req.query.token, 100) || null; }
async function requireOrder(req, res) {
  const order = await getOrder(req.params.id);
  const token = validOrderToken(req);
  // isOrderOwner hashes and compares in constant time. The inline comparison this
  // replaced was a plain === on a hash, which leaks how many leading characters
  // matched, and it was the fourth copy of this check in the codebase.
  if (!isOrderOwner(order, token)) { res.status(404).json(refuse("api.err.orderNotFound", "Không tìm thấy đơn hàng", 404)); return null; }
  return order;
}
app.get("/api/orders/:id", async (req, res) => {
  try { const order = await requireOrder(req, res); if (order) res.json({ order: publicOrder(order), payment: order.paymentProvider === "bank_transfer" ? paymentInstructions(order) : null, ...deadlinePayload(order) }); }
  catch (error) { console.error(error); res.status(500).json(refuse("api.err.orderLoad", "Không thể tải đơn hàng", 500)); }
});
app.get("/api/orders/:id/download", async (req, res) => {
  try {
    const order = await requireOrder(req, res);
    if (!order) return;
    // The only gate that matters is here. The button state in the browser is a
    // convenience; this is what actually decides whether bytes leave R2.
    if (order.status !== "paid") return res.status(409).json(isClosed(order)
      ? refuse("api.err.orderAlreadyDelivered", "Đơn hàng đã được giao, không thể tải lại", 409)
      : refuse("api.err.orderUnpaid", "Đơn hàng chưa được thanh toán", 409));
    const item = order.items?.[0];
    if (!item?.fileKey) return res.status(409).json(refuse("api.err.noReleaseFile", "Sản phẩm chưa có file phát hành", 409));
    if (!isConfigured.r2) return res.status(503).json(refuse("api.err.r2Unconfigured", "R2 chưa được cấu hình", 503));
    // Every download is counted on the order. This is the only evidence the shop
    // has that a file ever left, and a refund argument turns on it: "tải ba lần rồi
    // đòi hoàn" is a different conversation from "chưa tải lần nào". Writing it
    // here, where the link is issued, means it cannot be skipped by a browser that
    // never calls the endpoint that reports the transfer finished.
    await updateOrder(order.id, { downloads: Number(order.downloads || 0) + 1, updatedAt: new Date().toISOString() });
    res.json({ url: await createDownloadUrl(item.fileKey, `${item.name}-${item.version}.zip`), expiresIn: env.r2.downloadTtl });
  } catch (error) { console.error(error); res.status(500).json(refuse("api.err.downloadLink", "Không thể tạo link tải", 500)); }
});
// Called once the browser has actually started the transfer. The server cannot
// observe the file arriving, so the client is what tells it the release is out.
app.post("/api/orders/:id/delivered", json, async (req, res) => {
  try {
    const order = await requireOrder(req, res);
    if (!order) return;
    const updated = await markOrderDelivered(order);
    res.json({ order: publicOrder(updated), ...deadlinePayload(updated) });
  } catch (error) { console.error(error); res.status(500).json(refuse("api.err.orderUpdate", "Không thể cập nhật đơn hàng", 500)); }
});

app.post("/api/orders/lookup", json, async (req, res) => {
  try {
    if (tooManyAttempts(req)) return res.status(429).json(refuse("api.err.rateLimitedLookup", "Bạn đã tra cứu quá nhiều lần. Vui lòng thử lại sau 15 phút.", 429));
    const id = text(req.body.orderId, 80).toUpperCase();
    const email = text(req.body.email, 160).toLowerCase();
    if (!id || !isEmail(email)) return res.status(400).json(refuse("api.err.invalidOrderRef", "Mã đơn hoặc email không hợp lệ", 400));
    const order = await getOrder(id);
    // One message for "no such order" and "email does not match", so the
    // endpoint never reveals which order ids exist.
    const invalid = refuse("api.err.lookupMismatch", "Không tìm thấy đơn hàng với mã và email này", 404);
    if (!order || String(order.customerEmail || order.customer_email || "").toLowerCase() !== email) return res.status(404).json(invalid);
    // The original token only ever existed in the buyer's browser, so recovery
    // means issuing a new one and invalidating the old.
    const accessToken = newToken();
    await updateOrder(order.id, { accessTokenHash: hashToken(accessToken), updatedAt: new Date().toISOString() });
    res.json({ order: publicOrder(await getOrder(order.id)), accessToken, ...deadlinePayload(await getOrder(order.id)) });
  } catch (error) { console.error(error); res.status(500).json(refuse("api.err.lookupFailed", "Không thể tra cứu đơn hàng", 500)); }
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
    // Pass-through, and deliberately not wrapped in refuse(): src/reviews.js
    // already returns {code, error, status} and its key is spelled out at the
    // call site there. Re-wrapping it here would build the key a second time and
    // put the dictionary's connection to the server back out of the audit's
    // reach — the reason the whole key travels with the refusal.
    res.status(201).json({ review: result.review });
    // The words are now on the product page, which was already rendered and cached.
    invalidatePages();
  } catch (error) { console.error(error); res.status(500).json(refuse("api.err.reviewSave", "Không thể lưu đánh giá", 500)); }
});

app.post("/api/paypal/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!(await verifyWebhook(req.body, req.headers))) return res.status(400).json(refuse("api.err.webhookSignature", "Chữ ký webhook không hợp lệ", 400));
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
  } catch (error) { console.error(error); res.status(400).json(refuse("api.err.webhookRejected", "Webhook bị từ chối", 400)); }
});
app.post("/api/paypal/capture", json, async (req, res) => {
  try {
    const order = await requireOrder(req, res);
    if (!order) return;
    if (order.paymentProvider !== "paypal" || !order.providerOrderId) return res.status(400).json(refuse("api.err.notPaypalOrder", "Đơn hàng không dùng PayPal", 400));
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
      return res.status(409).json(refuse("api.err.paypalMismatch", "PayPal chưa xác nhận đúng đơn hàng hoặc số tiền", 409));
    }
    const capture0 = capture.purchase_units?.[0]?.payments?.captures?.[0] || capture;
    const updated = await markOrderPaid(order, { source: "capture", providerAmount: Number(capture0.amount?.value || 0), providerCurrency: capture0.amount?.currency_code || null });
    res.json({ order: publicOrder(updated), ...deadlinePayload(updated) });
  } catch (error) { console.error(error); res.status(502).json(refuse("api.err.paypalConfirm", "Không thể xác nhận thanh toán PayPal", 502)); }
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
  } catch (error) { console.error(error); res.status(500).json(refuse("api.err.orderCheck", "Không kiểm tra được đơn hàng", 500)); }
});

// The history view, paged and filtered. Capping it matters for the same reason: an
// admin panel that silently stops showing older orders is a trap, so the total count
// travels with the page and the panel can say what it is not showing. Filtering
// narrows the count along with the page, or the two disagree about what exists.
app.get("/api/admin/orders", admin, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    // The same filter object goes to the page and to the count. A status that is
    // not one of the six reaches the store as "no filter" rather than as a query
    // that matches nothing, so a hand-edited URL shows the orders, not an empty
    // table that looks like an outage.
    const filter = { q: text(req.query.q, 80), status: ORDER_STATUSES.includes(text(req.query.status, 30)) ? text(req.query.status, 30) : "" };
    const [orders, open, total, refundedEmails] = await Promise.all([listOrders({ ...filter, limit, offset }), listOpenOrders(), countOrders(filter), listRefundedEmails()]);
    res.json({ orders: orders.map(publicOrder), live: open.length, limit, offset, hasMore: orders.length === limit, total, filter, refundedEmails });
  }
  catch (error) { console.error(error); res.status(500).json(refuse("api.err.orderLoad", "Không thể tải đơn hàng", 500)); }
});
// The product list, optionally narrowed the same way. `includeDrafts` stays on
// because this is the owner's own list: a draft and an archived product both have
// to be reachable from here or there is nowhere left to finish or restore them.
app.get("/api/admin/products", admin, async (req, res) => {
  try { res.json({ products: await listProducts({ includeDrafts: true, q: text(req.query.q, 80), status: text(req.query.status, 30) }) }); }
  catch (error) { console.error(error); res.status(500).json(refuse("api.err.productLoad", "Không thể tải sản phẩm", 500)); }
});
app.post("/api/admin/products", admin, json, async (req, res) => {
  try {
    const name = text(req.body.name, 120); const price = Number(req.body.price);
    if (!name || !Number.isFinite(price) || price < 0) return res.status(400).json(refuse("api.err.invalidProductInput", "Tên hoặc giá sản phẩm không hợp lệ", 400));
    const slug = text(req.body.slug, 80) || slugify(name);
    // Checked here as well as by the unique index, so the panel gets a sentence it
    // can show rather than a 500. Postgres rejects the second row with a 23505
    // that used to reach the owner as "server error" with no way to tell which
    // field was the problem. The index stays the real guarantee; this is the
    // message.
    if (!slug) return res.status(400).json(refuse("api.err.slugRequired", "Tên sản phẩm không tạo được đường dẫn. Hãy nhập slug.", 400));
    if (await getProductBySlug(slug)) return res.status(409).json(refuse("api.err.slugTaken", "Đường dẫn này đã có sản phẩm khác dùng rồi.", 409));
    const item = await createProduct({
      slug, name,
      shortDescription: text(req.body.shortDescription, 180), description: text(req.body.description, 2000), category: text(req.body.category, 50) || "Khác", platform: text(req.body.platform, 50) || "Windows", version: text(req.body.version, 30) || "1.0.0", price, currency: text(req.body.currency, 8) || "VND",
      features: Array.isArray(req.body.features) ? req.body.features.map((v) => text(v, 120)).filter(Boolean) : [], featuresEn: Array.isArray(req.body.featuresEn) ? req.body.featuresEn.map((v) => text(v, 200)).filter(Boolean) : [], shortDescriptionEn: text(req.body.shortDescriptionEn, 180), descriptionEn: text(req.body.descriptionEn, 4000), requirements: text(req.body.requirements, 240), seoTitle: text(req.body.seoTitle, 70), seoDescription: text(req.body.seoDescription, 175), seoTitleEn: text(req.body.seoTitleEn, 70), seoDescriptionEn: text(req.body.seoDescriptionEn, 175), status: text(req.body.fileKey, 500) ? (req.body.status === "draft" ? "draft" : "active") : "draft", fileKey: text(req.body.fileKey, 500), badge: text(req.body.badge, 40) || null,
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
  } catch (error) { console.error(error); res.status(500).json(refuse("api.err.productCreate", "Không thể tạo sản phẩm", 500)); }
});
app.patch("/api/admin/products/:id", admin, json, async (req, res) => {
  try {
    // The allow-list, because the body is not the editor's to trust.
    //
    // This spread the whole request body into the row. The claim above it — that
    // "the admin's SEO editor sends only these fields" — is a statement about the
    // client, and a client is not a boundary: a bug in the panel, a stale tab, or
    // anybody holding an admin token could write id, status, fileKey, price,
    // createdAt or any column the database happens to have. toProduct() sends the
    // keys it was given and drops nothing.
    //
    // So the server decides what may change, and the panel's form is free to send
    // whatever it likes: an unknown field is ignored rather than obeyed. The one
    // thing that needs care is slug — POST checks uniqueness and this route did not,
    // so two products could end up answering at the same address.
    const caps = {
      name: 120, slug: 80, shortDescription: 180, description: 2000, shortDescriptionEn: 180,
      descriptionEn: 4000, category: 50, platform: 50, version: 30, currency: 8,
      badge: 40, requirements: 240, fileKey: 500, seoTitle: 70, seoDescription: 175,
      seoTitleEn: 70, seoDescriptionEn: 175,
    };
    const patch = {};
    for (const [field, cap] of Object.entries(caps)) {
      if (req.body[field] !== undefined) patch[field] = text(req.body[field], cap);
    }
    for (const field of ["features", "featuresEn"]) {
      if (req.body[field] !== undefined) {
        patch[field] = Array.isArray(req.body[field])
          ? req.body[field].map((v) => text(v, field === "features" ? 120 : 200)).filter(Boolean) : [];
      }
    }
    if (req.body.price !== undefined) {
      const price = Number(req.body.price);
      if (!Number.isFinite(price) || price < 0) return res.status(400).json(refuse("api.err.invalidPrice", "Giá không hợp lệ", 400));
      patch.price = price;
    }
    if (req.body.status !== undefined) patch.status = req.body.status === "archived" ? "archived" : (req.body.status === "draft" ? "draft" : "active");
    // A partial edit must not blank a field the caller never mentioned, which is
    // why every key above is guarded on `!== undefined` rather than defaulted.
    if (req.body.slug !== undefined && patch.slug) {
      const clash = await getProductBySlug(patch.slug);
      if (clash && clash.id !== req.params.id) return res.status(409).json(refuse("api.err.slugTaken", "Đường dẫn này đã có sản phẩm khác dùng rồi.", 409));
    }
    patch.updatedAt = new Date().toISOString();
    const item = await updateProduct(req.params.id, patch);
    if (!item) return res.status(404).json(refuse("api.err.productNotFound", "Không tìm thấy sản phẩm", 404));
    // Price and description are what a search result shows, so an edit here is
    // exactly as indexable as a new page.
    await pingIndexNow(["/", `/product/${item.slug}`]);
    res.json({ product: item });
    invalidatePages();
  }
  catch (error) { console.error(error); res.status(500).json(refuse("api.err.productUpdate", "Không thể cập nhật sản phẩm", 500)); }
});
// Removing a product from the catalogue.
//
// Two ways to take a product off sale, and the difference is the buyer who already
// has one. An archived product simply stops being sold and keeps its page, its
// reviews and its history. A deleted one is gone from the owner's records too —
// which nothing on the buyer's side notices, because their order carries its own
// copy of the item and the download reads that copy rather than this row.
//
// What deleting *does* erase is the link between those orders and a name and a
// price, so a product with orders behind it cannot be deleted: the owner is told
// how many there are and to archive instead, rather than finding out the next time
// the revenue report reads short.
app.delete("/api/admin/products/:id", admin, async (req, res) => {
  try {
    const item = await getProduct(req.params.id);
    if (!item) return res.status(404).json(refuse("api.err.productNotFound", "Không tìm thấy sản phẩm", 404));
    const sold = await countOrdersForProduct(item.id);
    if (sold > 0) return res.status(409).json(refuse("api.err.productHasOrders", `Sản phẩm này đã có ${sold} đơn hàng. Hãy lưu trữ thay vì xoá để giữ lịch sử bán hàng.`, 409));
    const removed = await deleteProduct(item.id);
    if (!removed) return res.status(404).json(refuse("api.err.productNotFound", "Không tìm thấy sản phẩm", 404));
    // The sitemap served the deleted page, and only IndexNow is told it is gone;
    // the homepage, /llms.txt and /feed.json cached the catalogue that no longer
    // has it. Same treatment a new product gets.
    await pingIndexNow(["/"]);
    res.json({ ok: true, id: removed.id });
    invalidatePages();
  }
  catch (error) { console.error(error); res.status(500).json(refuse("api.err.productDelete", "Không thể xoá sản phẩm", 500)); }
});
app.post("/api/admin/uploads/presign", admin, json, async (req, res) => {
  try {
    const productRef = text(req.body.productRef ?? req.body.productId, 80); const version = text(req.body.version, 30); const fileName = text(req.body.fileName, 140);
    if (!productRef || !version || !fileName) return res.status(400).json(refuse("api.err.missingFileRef", "Thiếu productRef, version hoặc fileName", 400));
    // The release formats, in one place. This gate used to name three extensions
    // while the shop sells Windows software, which is the whole catalogue: there
    // is no Apple or Linux build, and pretending otherwise in the uploader would
    // only produce a file the product page then misdescribes.
    if (!/\.(zip|exe|msi|7z)$/i.test(fileName)) return res.status(400).json(refuse("api.err.unsupportedFileType", "Chỉ hỗ trợ file .zip, .exe, .msi hoặc .7z", 400));
    if (!isConfigured.r2) return res.status(503).json(refuse("api.err.r2Unconfigured", "R2 chưa được cấu hình", 503));
    res.json(await createUploadUrl({ productRef, version, fileName, contentType: text(req.body.contentType, 120) }));
  } catch (error) { console.error(error); res.status(500).json(refuse("api.err.uploadLink", "Không thể tạo link upload", 500)); }
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
    // Outstanding is bucketed per currency for the same reason net is: an unpaid
    // order is not necessarily a VND one. A PayPal order inside its payment
    // window is unpaid, and its amount is in PAYPAL_CURRENCY — so summing it into
    // a single number and labelling the total "VND" reported a live dollar amount
    // as if it were dong, on the one panel the owner reconciles against a bank
    // statement with.
    const waiting = {};
    for (const order of orders) {
      const item = order.items?.[0] || {};
      // paidCount is what makes a delivered order still count as revenue.
      const count = Number(order.paidCount || 0);
      const back = Number(order.refundedCount || 0);
      if (count <= 0 && back <= 0) {
        if (isUnpaid(order) && !isClosed(order) && paymentDeadline(order) && paymentDeadline(order) > Date.now()) {
          const pendingCurrency = order.currency || "VND";
          waiting[pendingCurrency] = (waiting[pendingCurrency] || 0) + Number(order.amount || 0);
        }
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
    res.json({ currency: env.paypal.currency, gross, refunds: moneyBack, net, outstanding: waiting, paidOrders, refundedOrders, products: rows, generatedAt: new Date().toISOString() });
  } catch (error) { console.error(error); res.status(500).json(refuse("api.err.revenue", "Không tổng hợp được doanh thu", 500)); }
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
    if (!existing) return res.status(404).json(refuse("api.err.orderNotFound", "Không tìm thấy đơn hàng", 404));
    // Closes a paid order the same way the buyer's browser does, for the times
    // the download link was handed over by hand.
    if (req.body.delivered === true) { acted("deliver"); return res.json({ order: publicOrder(await markOrderDelivered(existing)) }); }
    // The mirror image. A download that dies halfway still counts as handed
    // over, because the server cannot see a file arrive, so the owner needs one
    // click to undo it when a customer says the file never made it.
    if (req.body.reopen === true) {
      if (!isClosed(existing)) return res.status(409).json(refuse("api.err.orderNotClosed", "Đơn này chưa đóng", 409));
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
      if (!hasPayment(existing)) return res.status(409).json(refuse("api.err.refundNotPaid", "Chỉ hoàn tiền được đơn đã nhận tiền", 409));
      const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) return res.status(400).json(refuse("api.err.refundReasonRequired", "Cần ghi lý do hoàn tiền", 400));
      // Which of the three refunds this is. Picked from a list rather than typed,
      // because the category decides the amount and the category is the part that
      // has to be arguable later: a defect and a duplicate are the shop's fault and
      // refund everything; a buyer who already holds the file and wants their money
      // back is the case the policy is written for, and only moves the part the
      // owner types in — never zero, which would sell the product for nothing, and
      // never the whole payment, which would sell it for nothing on purpose.
      const category = REFUND_CATEGORIES.includes(req.body.category) ? req.body.category : "";
      if (!category) return res.status(400).json(refuse("api.err.refundCategoryRequired", "Cần chọn loại lý do hoàn tiền", 400));
      const amount = refundAmountFor(category, existing, req.body.partialAmount);
      if (amount === null) return res.status(400).json(refuse("api.err.refundPartialAmountRequired", "Hoàn kiểu “khách đổi ý” phải ghi số tiền lớn hơn 0 và nhỏ hơn số đã thu", 400));
      // The reason is in the order row; the request that carried it is here.
      acted("refund", { amount: existing.amount, currency: existing.currency, reason, category });
      return res.json({ order: publicOrder(await voidPayment(existing, { reason, category, amount })) });
    }
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json(refuse("api.err.invalidStatus", "Trạng thái không hợp lệ", 400));
    if (status === "paid") {
      // An order that already recorded a payment is not receiving a second one. It
      // is an operator correcting the state — a refund issued by mistake, most
      // often. Recording a payment again would double the revenue figure and mail
      // the buyer a second confirmation for money that only arrived once, so this
      // path restores the state and leaves the money record exactly as it is.
      if (hasPayment(existing)) {
        acted("restore-paid");
        const restored = new Date().toISOString();
        return res.json({ order: publicOrder(await updateOrder(existing.id, {
          status: "paid", paidAt: existing.paidAt || restored, updatedAt: restored,
        })) });
      }
      // No payment on it yet: this is a confirmation, and it goes through the same
      // path a webhook takes so the buyer is emailed and paid_count reflects the
      // revenue that really arrived.
      acted("confirm-paid", { amount: existing.amount, currency: existing.currency });
      return res.json({ order: publicOrder(await markOrderPaid(existing, { source: "admin" })) });
    }
    acted("status", { to: status });
    const item = await updateOrder(req.params.id, { status, paidAt: null, updatedAt: new Date().toISOString() });
    res.json({ order: publicOrder(item) });
  } catch (error) { console.error(error); res.status(500).json(refuse("api.err.orderUpdate", "Không thể cập nhật đơn hàng", 500)); }
});

// Anything that fell through is the 404 page, not Express's bare error. It is
// declared noindex, so broken links a crawler discovers do not become thin
// duplicate pages competing with the products. Rendered rather than sendFile, so
// the footer carries the year instead of the template token; the handler itself is
// defined with the other page routes.
app.use((req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json(refuse("api.err.notFound", "Không tìm thấy", 404));
  return notFound(req, res);
});

// The one place an error becomes a response.
//
// Three things it did not do, all of which turn a diagnosable failure into an
// undiagnosable one:
//
//  - it never checked headersSent, so an error raised after a response had begun
//    made this handler throw ERR_HTTP_HEADERS_SENT on top of the real error;
//  - it logged the error with no request id, which is the one field that ties a
//    line in the log to the buyer who reported it — the access line carries the
//    id and this line did not, so the two halves of one request never met;
//  - it answered every route with JSON, so a person whose page failed to render
//    was shown {"code":"api.err.internal"} where a page should have been.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(`[error] ${req.requestId || "-"} ${req.method} ${req.path}:`, error);
  const wantsHtml = !req.path.startsWith("/api/") && String(req.accepts(["html", "json"]) || "").startsWith("html");
  if (wantsHtml && !res.statusCode) {
    // The rendered 404 is the page that already exists for "this did not work",
    // and it still carries the shop's own navigation. A JSON body in a browser
    // tab is not a recovery path; it is a dead end with a status code on it.
    return notFound(req, res);
  }
  res.status(res.statusCode || 500).json(refuse("api.err.internal", "Lỗi máy chủ", 500));
});
export async function createApp() { await ensureSeed(); return app; }
export default app;

