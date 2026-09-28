import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { env, isConfigured } from "./config.js";
import { ensureSeed, getOrder, getProduct, listOrders, listProducts, createOrder, updateOrder, createProduct, updateProduct, persistenceMode } from "./store.js";
import { createDownloadUrl, createUploadUrl } from "./r2.js";
import { captureOrder, createOrder as createPayPalOrder, hashToken, newOrderId, newToken, paypalChargeFor, paypalChargeForProduct, paymentMatchesOrder, verifyWebhook } from "./paypal.js";
import { paymentInstructions, paymentOptions } from "./payments.js";
import { resolveCountry } from "./geo.js";
import { vndPerUsd } from "./rates.js";

const app = express();
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const json = express.json({ limit: "1mb" });
const publicProduct = (product) => { if (!product) return null; const { fileKey, file_key, ...safe } = product; return safe; };
const publicOrder = (order) => { if (!order) return null; const { accessTokenHash, access_token_hash, ...safe } = order; return { ...safe, items: (safe.items || []).map(({ fileKey, file_key, ...item }) => item) }; };
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
// walk the id space. A per-IP window is enough here: the app runs as a single
// process and this only needs to make guessing impractical, not bulletproof.
const attempts = new Map();
const tooManyAttempts = (req) => {
  const key = req.ip || "unknown";
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 5000) attempts.clear();
  return recent.length > 10;
};

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://img.vietqr.io; connect-src 'self' https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
});
app.get("/robots.txt", (_req, res) => res.type("text/plain").send("User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/\nSitemap: https://sonvudev.com/sitemap.xml\n"));
// Built from the public directory so a new page is indexed without a second
// list to keep in sync. The lookup and admin pages are deliberately absent.
app.get("/sitemap.xml", async (_req, res) => {
  const pages = await fs.readdir(publicDir);
  const urls = pages
    .filter((file) => /^(index|terms|privacy|refund)\.html$/.test(file))
    .map((file) => `<url><loc>https://sonvudev.com/${file === "index.html" ? "" : file.replace(/\.html$/, "")}</loc><changefreq>monthly</changefreq><priority>${file === "index.html" ? "1.0" : "0.3"}</priority></url>`)
    .join("");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

app.use((req, res, next) => {
  if (req.hostname === "www.sonvudev.com") return res.redirect(308, `https://sonvudev.com${req.originalUrl}`);
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
    vndPerUsd: rate ? { rate: Math.round(rate.rate * 100) / 100, source: rate.source, live: env.paypal.vndToUsdRate === "live" } : null,
  });
});
app.get("/api/products", async (_req, res) => {
  try { res.json({ products: (await listProducts()).filter((product) => product.status === "active" && product.fileKey && isConfigured.r2).map(publicProduct) }); }
  catch (error) { console.error(error); res.status(500).json({ error: "Không thể tải danh mục" }); }
});
app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await getProduct(req.params.id);
    if (!product || product.status !== "active") return res.status(404).json({ error: "Không tìm thấy sản phẩm" });
    if (!product.fileKey || !isConfigured.r2) return res.status(404).json({ error: "Sản phẩm chưa sẵn sàng" });
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
      options: paymentOptions(country, {
        bank: isConfigured.bank,
        momo: Boolean(env.bank.momo),
        zalopay: Boolean(env.bank.zalopay),
        paypal: isConfigured.paypal,
      }),
    });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không tải được phương thức thanh toán" }); }
});

app.post("/api/checkout", json, async (req, res) => {
  try {
    const email = text(req.body.email, 160).toLowerCase();
    const productId = text(req.body.productId, 80);
    const method = req.body.paymentMethod === "paypal" ? "paypal" : "bank_transfer";
    if (!isEmail(email)) return res.status(400).json({ error: "Email không hợp lệ" });
    const product = await getProduct(productId);
    if (!product || product.status !== "active") return res.status(404).json({ error: "Sản phẩm không khả dụng" });
    if (!product.fileKey || !isConfigured.r2) return res.status(503).json({ error: "Sản phẩm chưa sẵn sàng để nhận thanh toán" });
    if (method === "bank_transfer" && !isConfigured.bank) return res.status(503).json({ error: "Phương thức chuyển khoản chưa được cấu hình" });
    if (method === "paypal" && !isConfigured.paypal) return res.status(503).json({ error: "PayPal chưa được cấu hình. Hãy chọn chuyển khoản hoặc cấu hình PayPal trên server." });
    const accessToken = newToken();
    const id = newOrderId();
    const paypalQuote = method === "paypal" ? await paypalChargeForProduct(product) : null;
    const paypalCharge = paypalQuote?.charge ?? null;
    const order = {
      id, orderNumber: id, accessTokenHash: hashToken(accessToken), customerEmail: email,
      customerName: text(req.body.customerName, 100), status: "pending", paymentProvider: method,
      providerOrderId: null, amount: Number(product.price), currency: product.currency || "VND",
      items: [{ productId: product.id, name: product.name, version: product.version, price: product.price, currency: product.currency, fileKey: product.fileKey || "", paypalAmount: paypalCharge?.amount ?? null, paypalCurrency: paypalCharge?.currency ?? null, paypalRate: paypalQuote?.rate?.vndPerUsd ?? null }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await createOrder(order);
    if (method === "bank_transfer") {
      await updateOrder(order.id, { status: "pending_transfer", updatedAt: new Date().toISOString() });
      return res.json({ order: publicOrder({ ...order, status: "pending_transfer" }), accessToken, payment: paymentInstructions(order) });
    }
    const paypal = await createPayPalOrder({ orderId: order.id, product, customerEmail: email, returnUrl: `${env.appUrl}/paypal-return.html`, cancelUrl: `${env.appUrl}/?paypal=cancelled`, amount: paypalCharge.amount, currency: paypalCharge.currency });
    const approvalUrl = (paypal.links || []).find((link) => link.rel === "payer-action" || link.rel === "approve")?.href;
    await updateOrder(order.id, { providerOrderId: paypal.id, updatedAt: new Date().toISOString() });
    res.json({ order: publicOrder({ ...order, providerOrderId: paypal.id }), accessToken, approvalUrl });
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
  try { const order = await requireOrder(req, res); if (order) res.json({ order: publicOrder(order), payment: order.paymentProvider === "bank_transfer" ? paymentInstructions(order) : null }); }
  catch (error) { console.error(error); res.status(500).json({ error: "Không thể tải đơn hàng" }); }
});
app.get("/api/orders/:id/download", async (req, res) => {
  try {
    const order = await requireOrder(req, res);
    if (!order) return;
    if (order.status !== "paid") return res.status(409).json({ error: "Đơn hàng chưa được thanh toán" });
    const item = order.items?.[0];
    if (!item?.fileKey) return res.status(409).json({ error: "Sản phẩm chưa có file phát hành" });
    if (!isConfigured.r2) return res.status(503).json({ error: "R2 chưa được cấu hình" });
    res.json({ url: await createDownloadUrl(item.fileKey, `${item.name}-${item.version}.zip`), expiresIn: env.r2.downloadTtl });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể tạo link tải" }); }
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
    res.json({ order: publicOrder(await getOrder(order.id)), accessToken });
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
        if (order && paymentMatchesOrder(resource, order) && order.status !== "paid") {
          await updateOrder(order.id, { status: "paid", paidAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
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
    const capture = await captureOrder(order.providerOrderId);
    if (capture.status !== "COMPLETED" || !paymentMatchesOrder(capture, order)) {
      return res.status(409).json({ error: "PayPal chưa xác nhận đúng đơn hàng hoặc số tiền" });
    }
    const status = "paid";
    await updateOrder(order.id, { status, paidAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    res.json({ order: publicOrder(await getOrder(order.id)) });
  } catch (error) { console.error(error); res.status(502).json({ error: "Không thể xác nhận thanh toán PayPal" }); }
});

// Cheap poll target for the admin badge. The full order list carries customer
// details and is much heavier, so the notification loop hits this instead and
// only downloads rows when something actually changed.
app.get("/api/admin/orders/pending", admin, async (_req, res) => {
  try {
    const orders = await listOrders();
    const at = (order) => new Date(order.createdAt || order.created_at || 0).getTime();
    const latest = orders.length ? at(orders[0]) : 0;
    res.json({
      latest,
      pending: orders.filter((order) => order.status === "pending_transfer").length,
      // The newest order is echoed back so a new arrival can be named in the
      // alert without a second request.
      newest: orders[0] ? { id: orders[0].id, status: orders[0].status, createdAt: orders[0].createdAt || orders[0].created_at || null } : null,
    });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không kiểm tra được đơn hàng" }); }
});

app.get("/api/admin/orders", admin, async (_req, res) => {
  try { res.json({ orders: (await listOrders()).map(publicOrder) }); }
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
      features: Array.isArray(req.body.features) ? req.body.features.map((v) => text(v, 120)).filter(Boolean) : [], requirements: text(req.body.requirements, 240), status: text(req.body.fileKey, 500) ? (req.body.status === "draft" ? "draft" : "active") : "draft", fileKey: text(req.body.fileKey, 500), badge: text(req.body.badge, 40) || null, featured: Boolean(req.body.featured),
    });
    res.status(201).json({ product: item });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể tạo sản phẩm" }); }
});
app.patch("/api/admin/products/:id", admin, json, async (req, res) => {
  try { const item = await updateProduct(req.params.id, { ...req.body, updatedAt: new Date().toISOString() }); if (!item) return res.status(404).json({ error: "Không tìm thấy sản phẩm" }); res.json({ product: item }); }
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
app.patch("/api/admin/orders/:id", admin, json, async (req, res) => {
  try {
    const status = req.body.status;
    if (!["pending", "pending_transfer", "paid", "payment_failed", "cancelled"].includes(status)) return res.status(400).json({ error: "Trạng thái không hợp lệ" });
    const item = await updateOrder(req.params.id, { status, paidAt: status === "paid" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() });
    if (!item) return res.status(404).json({ error: "Không tìm thấy đơn hàng" }); res.json({ order: publicOrder(item) });
  } catch (error) { console.error(error); res.status(500).json({ error: "Không thể cập nhật đơn hàng" }); }
});

app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: "Internal server error" }); });
export async function createApp() { await ensureSeed(); return app; }
export default app;
