import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { env, isConfigured } from "./config.js";
import { ensureSeed, findOrderByIdempotencyKey, getOrder, getProduct, getProductBySlug, isSellable, latestOrder, listExpiringOrders, listOpenOrders, listOrders, listOrdersForRevenue, listProducts, createOrder, updateOrder, createProduct, updateProduct, persistenceMode } from "./store.js";
import { createDownloadUrl, createUploadUrl } from "./r2.js";
import { captureOrder, createOrder as createPayPalOrder, hashToken, newOrderId, newToken, paypalChargeFor, paypalChargeForProduct, paymentMatchesOrder, readOrder, verifyWebhook } from "./paypal.js";
import { paymentInstructions, paymentOptions } from "./payments.js";
import { esc, renderIndexCount, renderIndexGrid, renderOgImage, renderProductPage, verificationFile, verificationMeta } from "./pages.js";
import { isClosed, isUnpaid, markOrderDelivered, markOrderPaid, paymentDeadline, voidPayment } from "./orders.js";
import { notifyOrder, notifyMode } from "./notify.js";
import { resolveCountry } from "./geo.js";
import { pingIndexNow, isIndexNowConfigured } from "./indexnow.js";
import { vndPerUsd } from "./rates.js";

const app = express();
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const json = express.json({ limit: "1mb" });
const publicProduct = (product) => { if (!product) return null; const { fileKey, file_key, ...safe } = product; return safe; };
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
};
const renderedPages = new Map();
// Short-lived on purpose. A price change in the admin panel has to reach the
// bytes a crawler reads: a search result that shows last week's price is worse
// than no price, and the storefront's own script only ever sees the fresh copy.
const PAGE_TTL_MS = 60000;

async function renderPage(file) {
  const cached = renderedPages.get(file);
  if (cached && Date.now() - cached.at < PAGE_TTL_MS) return cached.html;
  const template = await fs.readFile(path.join(publicDir, file), "utf8");
  const products = indexablePages[file].catalog ? await listProducts() : [];
  const html = template
    .replaceAll("{{site}}", env.appUrl)
    .replace("</head>", `${verificationMeta()}\n</head>`)
    .replace(/(<span class="product-count" id="product-count">)[\s\S]*?(<\/span>)/, `$1${esc(renderIndexCount(products))}$2`)
    .replace(/<!--catalog:start-->[\s\S]*?<!--catalog:end-->/, `<!--catalog:start-->${renderIndexGrid(products)}<!--catalog:end-->`);
  renderedPages.set(file, { at: Date.now(), html });
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
for (const file of Object.keys(indexablePages)) {
  app.get(file === "index.html" ? "/" : `/${file}`, sendPage(file));
  if (file !== "index.html") app.get(`/${file.replace(/\.html$/, "")}`, sendPage(file));
}

app.get("/og/:slug.svg", async (req, res) => {
  // A clean site-wide card, so a link shared without a product still previews.
  if (req.params.slug === "sonvudev") {
    return res.set("Cache-Control", "public, max-age=3600").type("image/svg+xml").send(renderOgImage({ name: "Phần mềm Windows cho công việc", platform: "Windows", version: "1.0", price: 0, currency: "VND", priceLabel: "Từ 99.000₫" }));
  }
  const product = await getProductBySlug(req.params.slug);
  if (!product || product.status !== "active" || !product.fileKey || !isConfigured.r2) return res.status(404).type("text/plain").send("Not found");
  res.set("Cache-Control", "public, max-age=3600");
  res.type("image/svg+xml").send(renderOgImage(product));
});

app.get("/product/:slug", async (req, res) => {
  try {
    const product = await getProductBySlug(req.params.slug);
    // A product the storefront would not show is a 404 here too. The seed rows
    // that never got a file attached would otherwise be reachable and indexable
    // even though nobody can buy them.
    if (!isSellable(product)) return res.status(404).sendFile(path.join(publicDir, "404.html"));
    res.set("Cache-Control", "public, max-age=300");
    res.type("html").send(renderProductPage(product));
  } catch (error) { console.error(error); res.status(500).type("text/plain").send("Lỗi máy chủ"); }
});

app.get("/sitemap.xml", async (_req, res) => {
  const base = env.appUrl.replace(/\/$/, "");
  const pages = await fs.readdir(publicDir);
  const urls = pages
    .filter((file) => /^(index|terms|privacy|refund)\.html$/.test(file))
    .map((file) => `<url><loc>${base}/${file === "index.html" ? "" : file.replace(/\.html$/, "")}</loc><changefreq>monthly</changefreq><priority>${file === "index.html" ? "1.0" : "0.3"}</priority></url>`);
  // A product that is not on the sitemap cannot be found, so this is built from
  // the live catalogue rather than from a list someone has to remember to edit.
  // The filter is the storefront's own (isSellable), so a page nobody can buy
  // can never be submitted to Google.
  for (const product of (await listProducts()).filter(isSellable)) {
    const updated = product.updatedAt || product.updated_at;
    urls.push(`<url><loc>${base}/product/${encodeURIComponent(product.slug)}</loc>${updated ? `<lastmod>${new Date(updated).toISOString().slice(0, 10)}</lastmod>` : ""}<changefreq>weekly</changefreq><priority>0.8</priority></url>`);
  }
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`);
});

app.use((req, res, next) => {
  if (wwwHost && req.hostname === wwwHost) return res.redirect(308, `${canonicalOrigin}${req.originalUrl}`);
  next();
});
// Short link for buyers, e.g. /order/SVD-XXXX. The page reads the token from
// sessionStorage, so it is a viewer rather than an entry point.
app.get("/order/:id", (_req, res) => res.sendFile(path.join(publicDir, "order.html")));
app.use(express.static(publicDir, { extensions: ["html"] }));

app.get("/api/health", async (_req, res) => {
  const rate = await vndPerUsd().catch(() => null);
  res.json({
    ok: true, appUrl: env.appUrl, persistence: persistenceMode,
    r2: isConfigured.r2, paypal: isConfigured.paypal, paypalWebhook: isConfigured.paypalWebhook,
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
      expiresAt: new Date(Date.now() + Math.max(1, env.orders.paymentWindowHours) * 60 * 60 * 1000).toISOString(),
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
  if (!order || !token || order.accessTokenHash !== hashToken(token)) { res.status(404).json({ error: "Không tìm thấy đơn hàng" }); return null; }
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
    const [orders, open] = await Promise.all([listOrders({ limit, offset }), listOpenOrders()]);
    res.json({ orders: orders.map(publicOrder), live: open.length, limit, offset, hasMore: orders.length === limit });
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
    const item = await createProduct({
      slug: text(req.body.slug, 80) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name,
      shortDescription: text(req.body.shortDescription, 180), description: text(req.body.description, 2000), category: text(req.body.category, 50) || "Khác", platform: text(req.body.platform, 50) || "Windows", version: text(req.body.version, 30) || "1.0.0", price, currency: text(req.body.currency, 8) || "VND",
      features: Array.isArray(req.body.features) ? req.body.features.map((v) => text(v, 120)).filter(Boolean) : [], featuresEn: Array.isArray(req.body.featuresEn) ? req.body.featuresEn.map((v) => text(v, 200)).filter(Boolean) : [], shortDescriptionEn: text(req.body.shortDescriptionEn, 180), descriptionEn: text(req.body.descriptionEn, 4000), requirements: text(req.body.requirements, 240), seoTitle: text(req.body.seoTitle, 70), seoDescription: text(req.body.seoDescription, 175), status: text(req.body.fileKey, 500) ? (req.body.status === "draft" ? "draft" : "active") : "draft", fileKey: text(req.body.fileKey, 500), badge: text(req.body.badge, 40) || null, featured: Boolean(req.body.featured),
    });
    // Publishing a product is the one event a crawler cannot guess at: the
    // sitemap is only re-read on its own schedule, so without this a new page
    // can stay invisible for days. The ping is fire and forget, because a
    // search engine being slow must not fail a product save.
    await pingIndexNow(["/", `/product/${item.slug}`]);
    res.status(201).json({ product: item });
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
  }
  catch (error) { console.error(error); res.status(500).json({ error: "Không thể cập nhật sản phẩm" }); }
});
app.post("/api/admin/uploads/presign", admin, json, async (req, res) => {
  try {
    const productRef = text(req.body.productRef ?? req.body.productId, 80); const version = text(req.body.version, 30); const fileName = text(req.body.fileName, 140);
    if (!productRef || !version || !fileName) return res.status(400).json({ error: "Thiếu productRef, version hoặc fileName" });
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
  try {
    const status = req.body.status;
    const existing = await getOrder(req.params.id);
    if (!existing) return res.status(404).json({ error: "Không tìm thấy đơn hàng" });
    // Closes a paid order the same way the buyer's browser does, for the times
    // the download link was handed over by hand.
    if (req.body.delivered === true) return res.json({ order: publicOrder(await markOrderDelivered(existing)) });
    // The mirror image. A download that dies halfway still counts as handed
    // over, because the server cannot see a file arrive, so the owner needs one
    // click to undo it when a customer says the file never made it.
    if (req.body.reopen === true) {
      if (!isClosed(existing)) return res.status(409).json({ error: "Đơn này chưa đóng" });
      const now = new Date().toISOString();
      return res.json({ order: publicOrder(await updateOrder(existing.id, { status: "paid", paidAt: existing.paidAt || now, deliveredAt: null, updatedAt: now })) });
    }
    // Money going back: a refund, a chargeback, or a confirmation made by
    // mistake. Recorded as its own figure rather than subtracted from the sale,
    // so the gross number still matches a bank statement.
    if (req.body.refund === true) {
      if (existing.status !== "paid") return res.status(409).json({ error: "Chỉ hoàn tiền được đơn đã thanh toán" });
      const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) return res.status(400).json({ error: "Cần ghi lý do hoàn tiền" });
      return res.json({ order: publicOrder(await voidPayment(existing, { reason })) });
    }
    if (!["pending", "pending_transfer", "paid", "payment_failed", "cancelled", "refunded"].includes(status)) return res.status(400).json({ error: "Trạng thái không hợp lệ" });
    // Confirming by hand goes through the same path as a webhook, so the buyer
    // still gets the mail and paid_count still reflects the real revenue.
    if (status === "paid") return res.json({ order: publicOrder(await markOrderPaid(existing, { source: "admin" })) });
    const item = await updateOrder(req.params.id, { status, paidAt: null, updatedAt: new Date().toISOString() });
    res.json({ order: publicOrder(item) });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể cập nhật đơn hàng" }); }
});

// Anything that fell through is a 404 page, not Express's bare error. It is
// declared noindex, so broken links a crawler discovers do not become thin
// duplicate pages competing with the products.
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.status(404).sendFile(path.join(publicDir, "404.html"));
});

app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: "Internal server error" }); });
export async function createApp() { await ensureSeed(); return app; }
export default app;
