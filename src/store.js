import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, isConfigured } from "./config.js";
import { supabaseRequest } from "./supabase-http.js";

/**
 * Where this process keeps its files.
 *
 * One definition, because two modules write under it and the second used to
 * recompute the same expression with the same DATA_DIR override, so the only way
 * the two could agree was if the two lines never drifted. notify.js imports this
 * instead.
 */
export const projectRoot = env.dataDir ? path.resolve(env.dataDir) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = projectRoot;
// Exported because it is a thing the health probe has to be able to test. A check
// that cannot ask "can this process write where it says it writes" is a
// configuration report, and a configuration report answers "ok" for a server whose
// disk is full.
export const dataDir = path.join(root, "data");
const files = { products: path.join(dataDir, "products.json"), orders: path.join(dataDir, "orders.json") };
let writeChain = Promise.resolve();
const readJson = async (file, fallback) => { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; } };
const writeJson = (file, data) => { writeChain = writeChain.then(() => fs.writeFile(file, JSON.stringify(data, null, 2))); return writeChain; };

/**
 * Read, change and write a JSON file as one indivisible step.
 *
 * writeJson only queued the write. Every caller still read the file first, outside
 * that queue, so two updates landing at the same time both read the same starting
 * state, both built a new array from it, and the second write silently discarded
 * the first — which on this data means a lost payment count or a refund that never
 * reaches the ledger. Serialising the read inside the same queue is what makes the
 * local path behave the way Postgres already does.
 */
const mutateJson = (file, change) => {
  writeChain = writeChain.then(async () => {
    const current = await readJson(file, []);
    const next = await change(current);
    await fs.writeFile(file, JSON.stringify(next, null, 2));
    return next;
  });
  return writeChain;
};

const seedProducts = [
  { id: "sonvu-starter", slug: "sonvu-starter", name: "SonVu Starter", shortDescription: "Bộ công cụ nền cho người mới bắt đầu.", description: "Sản phẩm mẫu. Thay nội dung này bằng mô tả phần mềm thật của bạn.", category: "Công cụ", platform: "Windows", version: "1.0.0", price: 149000, currency: "VND", badge: "Phổ biến", features: ["Giao diện tiếng Việt", "Cập nhật miễn phí trong 12 tháng", "Hỗ trợ qua email"], requirements: "Windows 10/11, 4 GB RAM", status: "active", fileKey: "", featured: true, createdAt: new Date().toISOString() },
  { id: "sonvu-pro", slug: "sonvu-pro", name: "SonVu Pro", shortDescription: "Bộ tính năng nâng cao cho người dùng chuyên nghiệp.", description: "Sản phẩm mẫu cho gói Pro.", category: "Công cụ", platform: "Windows", version: "2.0.0", price: 349000, currency: "VND", badge: "Chuyên nghiệp", features: ["Đầy đủ tính năng Pro", "Ưu tiên hỗ trợ", "Cập nhật lâu dài"], requirements: "Windows 10/11, 8 GB RAM", status: "active", fileKey: "", featured: true, createdAt: new Date().toISOString() },
  { id: "sonvu-lifetime", slug: "sonvu-lifetime", name: "SonVu Lifetime", shortDescription: "Một lần mua, sử dụng lâu dài.", description: "Sản phẩm mẫu cho gói Lifetime.", category: "Bundle", platform: "Windows", version: "1.0.0", price: 699000, currency: "VND", badge: "Tiết kiệm", features: ["Tất cả gói hiện có", "License cá nhân", "Ưu tiên cập nhật"], requirements: "Windows 10/11, 4 GB RAM", status: "active", fileKey: "", featured: false, createdAt: new Date().toISOString() },
];

export async function ensureSeed() { await fs.mkdir(path.join(root, "data"), { recursive: true }); if (local) { if (!(await fs.stat(files.products).catch(() => null))) await writeJson(files.products, seedProducts); if (!(await fs.stat(files.orders).catch(() => null))) await writeJson(files.orders, []); return; } try { const rows = await supabase("products?select=id&limit=1"); if (!rows?.length) await supabase("products", { method: "POST", body: JSON.stringify(seedProducts.map(toProduct)) }); } catch (error) {
  // Fail closed, never silent: when Supabase is configured but unreachable,
  // falling back to local JSON would write paid orders to this host's ephemeral
  // disk while every other host keeps writing to Postgres — revenue split across
  // two stores with no error anywhere. So a configured-but-down database stops
  // the boot with an error (the host restarts, /api/health goes 503) instead of
  // quietly becoming a second, forgetful shop. The local fallback remains for
  // hosts that never configured Supabase at all.
  console.error(`[store] Supabase configured but unreachable, refusing local fallback: ${error.message}`);
  throw error;
} }

// The one way this project talks to Postgres: one header set, one error shape, one
// file. See src/supabase-http.js for why the client lives on its own.
//
// `Prefer: return=representation` makes PostgREST hand back the row it wrote, so a
// create does not have to read it again and lose a write that landed in between.
// The thrown error keeps the status and the SQLSTATE, which is what lets a caller
// tell "this exact checkout attempt already produced an order" — 23505 on the
// unique idempotency key — apart from "the database is unreachable". The first is
// a success the buyer should be shown; the second is an outage. Both used to arrive
// as one opaque "Supabase 409/500" string, so the checkout path had to guess.
const supabase = (pathname, options = {}) => supabaseRequest(pathname, options);
const fromProduct = (row) => row ? { ...row, shortDescription: row.shortDescription ?? row.short_description ?? "", description: row.description ?? "", fileKey: row.fileKey ?? row.file_key ?? "", shortDescriptionEn: row.shortDescriptionEn ?? row.short_description_en ?? "", descriptionEn: row.descriptionEn ?? row.description_en ?? "", featuresEn: row.featuresEn ?? row.features_en ?? [], seoTitle: row.seoTitle ?? row.seo_title ?? "", seoDescription: row.seoDescription ?? row.seo_description ?? "", createdAt: row.createdAt ?? row.created_at, updatedAt: row.updatedAt ?? row.updated_at } : null;
const fromOrder = (row) => row ? { ...row, orderNumber: row.orderNumber ?? row.order_number, accessTokenHash: row.accessTokenHash ?? row.access_token_hash, providerOrderId: row.providerOrderId ?? row.provider_order_id, customerEmail: row.customerEmail ?? row.customer_email, customerName: row.customerName ?? row.customer_name, paymentProvider: row.paymentProvider ?? row.payment_provider, paidAt: row.paidAt ?? row.paid_at, expiresAt: row.expiresAt ?? row.expires_at ?? null, cancelledAt: row.cancelledAt ?? row.cancelled_at ?? null, cancelReason: row.cancelReason ?? row.cancel_reason ?? null, deliveredAt: row.deliveredAt ?? row.delivered_at ?? null, paidCount: row.paidCount ?? row.paid_count ?? 0, paidAmount: row.paidAmount ?? row.paid_amount ?? 0, paidProviderAmount: row.paidProviderAmount ?? row.paid_provider_amount ?? 0, paidProviderCurrency: row.paidProviderCurrency ?? row.paid_provider_currency ?? null, refundedAt: row.refundedAt ?? row.refunded_at ?? null, refundReason: row.refundReason ?? row.refund_reason ?? null, refundedCount: row.refundedCount ?? row.refunded_count ?? 0, refundedAmount: row.refundedAmount ?? row.refunded_amount ?? 0, refundedProviderAmount: row.refundedProviderAmount ?? row.refunded_provider_amount ?? 0, idempotencyKey: row.idempotencyKey ?? row.idempotency_key ?? null, notifications: row.notifications ?? {}, reviews: row.reviews ?? [], createdAt: row.createdAt ?? row.created_at, updatedAt: row.updatedAt ?? row.updated_at } : null;
const toProduct = (p) => { const { shortDescription, fileKey, shortDescriptionEn, descriptionEn, featuresEn, seoTitle, seoDescription, createdAt, updatedAt, ...columns } = p; return { ...columns, ...(shortDescription !== undefined ? { short_description: shortDescription } : {}), ...(fileKey !== undefined ? { file_key: fileKey } : {}), ...(shortDescriptionEn !== undefined ? { short_description_en: shortDescriptionEn } : {}), ...(descriptionEn !== undefined ? { description_en: descriptionEn } : {}), ...(seoTitle !== undefined ? { seo_title: seoTitle } : {}), ...(seoDescription !== undefined ? { seo_description: seoDescription } : {}), ...(featuresEn !== undefined ? { features_en: featuresEn } : {}), ...(createdAt !== undefined ? { created_at: createdAt } : {}), ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}) }; };
const toOrder = (o) => { const { orderNumber, accessTokenHash, providerOrderId, customerEmail, customerName, paymentProvider, paidAt, expiresAt, cancelledAt, cancelReason, deliveredAt, paidCount, paidAmount, paidProviderAmount, paidProviderCurrency, refundedAt, refundReason, refundedCount, refundedAmount, refundedProviderAmount, idempotencyKey, notifications, reviews, createdAt, updatedAt, ...columns } = o; return { ...columns, ...(orderNumber !== undefined ? { order_number: orderNumber } : {}), ...(accessTokenHash !== undefined ? { access_token_hash: accessTokenHash } : {}), ...(providerOrderId !== undefined ? { provider_order_id: providerOrderId } : {}), ...(customerEmail !== undefined ? { customer_email: customerEmail } : {}), ...(customerName !== undefined ? { customer_name: customerName } : {}), ...(paymentProvider !== undefined ? { payment_provider: paymentProvider } : {}), ...(paidAt !== undefined ? { paid_at: paidAt } : {}), ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}), ...(cancelledAt !== undefined ? { cancelled_at: cancelledAt } : {}), ...(cancelReason !== undefined ? { cancel_reason: cancelReason } : {}), ...(deliveredAt !== undefined ? { delivered_at: deliveredAt } : {}), ...(paidCount !== undefined ? { paid_count: paidCount } : {}), ...(paidAmount !== undefined ? { paid_amount: paidAmount } : {}), ...(paidProviderAmount !== undefined ? { paid_provider_amount: paidProviderAmount } : {}), ...(paidProviderCurrency !== undefined ? { paid_provider_currency: paidProviderCurrency } : {}), ...(refundedAt !== undefined ? { refunded_at: refundedAt } : {}), ...(refundReason !== undefined ? { refund_reason: refundReason } : {}), ...(refundedCount !== undefined ? { refunded_count: refundedCount } : {}), ...(refundedAmount !== undefined ? { refunded_amount: refundedAmount } : {}), ...(refundedProviderAmount !== undefined ? { refunded_provider_amount: refundedProviderAmount } : {}), ...(idempotencyKey !== undefined ? { idempotency_key: idempotencyKey } : {}), ...(notifications !== undefined ? { notifications } : {}), ...(reviews !== undefined ? { reviews } : {}), ...(createdAt !== undefined ? { created_at: createdAt } : {}), ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}) }; };
let local = !isConfigured.supabase;

/**
 * Whether a product can actually be bought.
 *
 * Four places used to ask this separately — the catalogue API, the product page,
 * the sitemap and the homepage — and they did not agree. The sitemap counted a
 * product as sellable while the storefront filtered it out, which handed Google
 * three URLs that lead to a 404. One rule, used by all of them, is the only way
 * "listed" and "buyable" can stay the same set.
 */
export const isSellable = (product) => Boolean(product)
  && product.status === "active"
  && Boolean(product.slug)
  && Boolean(product.fileKey)
  && isConfigured.r2;

export async function listProducts({ includeDrafts = false } = {}) { if (!local) { const query = includeDrafts ? "select=*" : "select=*&status=eq.active"; return (await supabase(`products?${query}&order=created_at.desc`)).map(fromProduct); } const items = await readJson(files.products, []); return includeDrafts ? items : items.filter((p) => p.status === "active"); }
export async function getProduct(id) { if (!local) return fromProduct((await supabase(`products?id=eq.${encodeURIComponent(id)}&limit=1`))[0]); return (await readJson(files.products, [])).find((p) => p.id === id || p.slug === id) || null; }
// Product pages are addressed by slug because it is what goes in a URL and in
// the sitemap. Slugs are unique, so an ambiguous match is a data problem worth
// surfacing rather than silently picking one.
export async function getProductBySlug(slug) { if (!local) return fromProduct((await supabase(`products?slug=eq.${encodeURIComponent(slug)}&select=*&limit=2`))[0] || null); return (await readJson(files.products, [])).find((p) => p.slug === slug) || null; }
export async function createProduct(product) { if (!local) return fromProduct((await supabase("products", { method: "POST", body: JSON.stringify(toProduct({ ...product, id: product.id || crypto.randomUUID() })) }))[0]); const items = await readJson(files.products, []); const item = { ...product, id: product.id || crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; await writeJson(files.products, [item, ...items]); return item; }
export async function updateProduct(id, patch) { if (!local) return fromProduct((await supabase(`products?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(toProduct(patch)) }))[0]); const items = await readJson(files.products, []); const item = items.find((p) => p.id === id); if (!item) return null; Object.assign(item, patch, { updatedAt: new Date().toISOString() }); await writeJson(files.products, items); return item; }
// Every order ever written, newest first. This is deliberately the wide one: the
// admin history view shows the lot. Anything on a timer or a poll must use one of
// the narrow queries below instead, because the cost of this one grows forever
// while the work those callers do does not.
/**
 * How many orders exist in total.
 *
 * The admin panel used to label "orders in the system" with
 * `page * pageSize`, which is how many orders have been *scrolled through* — after
 * one page of 50 it said "50 orders in the system" about a shop with two. A figure
 * that is right by coincidence is worse than no figure, because the owner stops
 * looking at it and then cannot tell a real spike from a rendering bug.
 *
 * PostgREST reports the total in Content-Range when asked to count exactly, so this
 * costs one header on a query that fetches a single id rather than the table.
 */
export async function countOrders() {
  if (local) return (await readJson(files.orders, [])).length;
  const headers = { apikey: env.supabase.serviceRoleKey, Prefer: "count=exact", Range: "0-0" };
  if (env.supabase.serviceRoleKey.startsWith("eyJ")) headers.Authorization = `Bearer ${env.supabase.serviceRoleKey}`;
  const response = await fetch(`${env.supabase.url}/rest/v1/orders?select=id`, { headers });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  // "0-0/2" — the part after the slash is the total, not the length of the slice.
  const total = Number(String(response.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

export async function listOrders({ limit = 200, offset = 0 } = {}) {
  if (local) {
    const items = (await readJson(files.orders, [])).slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return items.slice(offset, offset + limit);
  }
  return (await supabase(`orders?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`)).map(fromOrder);
}

/**
 * Unpaid orders that nobody has been handed the file for yet.
 *
 * The expiry sweep used to read the whole table once a minute to find these. An
 * order from last year can never expire again, so that query grew with history
 * while its actual work stayed flat — a shop with a few thousand orders ended up
 * moving a few thousand fat rows a minute, for ever, to look at rows it had
 * already dealt with. The (status, expires_at) index answers this shape exactly,
 * so the cost now tracks the orders open right now rather than every order ever
 * created.
 *
 * The null branch keeps legacy rows written before expires_at existed, whose
 * deadline is derived from their creation time. A range comparison never matches
 * null, so without it those orders would quietly stop being cancelled.
 *
 * The bound is inclusive. An order sitting exactly one warning window from its
 * deadline is at the very start of the window and is owed a reminder, and an
 * exclusive bound silently dropped it — the one order a buyer was closest to
 * losing.
 */
/**
 * The statuses an order can still be paid in.
 *
 * One list, used by the JSON filter, by both PostgREST queries and by the sweep's
 * own rule. It was previously three separate definitions and they had drifted: the
 * JSON path filtered on "not delivered and one of these two", while the Supabase
 * queries asked for `status=eq.pending_transfer` only. A PayPal order is `pending`
 * until its capture lands, so those queries never saw one — a customer who abandoned
 * PayPal checkout left an order that could never expire, never got its reminder
 * mail, and sat in the admin list for ever. The JSON path was right, the SQL was
 * wrong, and every test ran against JSON, so nothing noticed.
 *
 * Lives here rather than in orders.js because orders.js already imports this
 * module; the other way round is a cycle.
 */
export const UNPAID_STATUSES = Object.freeze(["pending", "pending_transfer"]);

/**
 * Every order status the shop can hold, in lifecycle order. This is the one
 * definition: the admin validation whitelist, the frontend status maps and the
 * unpaid subset above all derive from it, because a seventh status added in one
 * place and forgotten in another is an order the panel cannot display and the
 * API refuses to set. The unpaid subset stays separate — it is a business rule
 * about money, not the enumeration itself.
 */
export const ORDER_STATUSES = Object.freeze(["pending", "pending_transfer", "paid", "payment_failed", "cancelled", "refunded"]);

/** PostgREST `in` filter for the unpaid statuses, from the one list above. */
const unpaidFilter = () => `status=in.(${UNPAID_STATUSES.join(",")})`;

export async function listExpiringOrders({ before } = {}) {
  if (local) {
    const cutoff = before ? new Date(before).getTime() : Infinity;
    return (await readJson(files.orders, [])).filter((order) => !isSettled(order)
      && (Number.isFinite(cutoff) ? deadlineOf(order) <= cutoff : true));
  }
  const deadline = before ? new Date(before).toISOString() : new Date(8.64e15).toISOString();
  return (await supabase(`orders?${unpaidFilter()}&delivered_at=is.null&or=(expires_at.lte.${deadline},expires_at.is.null)&select=*&order=expires_at.asc`)).map(fromOrder);
}

/** Unpaid and not yet delivered, with no deadline bound. Bounded by open orders. */
export async function listOpenOrders() {
  const columns = { accessTokenHash: 0, access_token_hash: 0, idempotencyKey: 0, idempotency_key: 0, notifications: 0 };
  const strip = (order) => Object.fromEntries(Object.entries(order).filter(([key]) => !(key in columns)));
  if (local) return (await readJson(files.orders, [])).filter((order) => !isSettled(order)).map(strip);
  return (await supabase(`orders?${unpaidFilter()}&delivered_at=is.null&select=id,status,amount,currency,created_at,expires_at&order=created_at.desc`)).map(fromOrder);
}

/**
 * The newest single order, for the admin badge poll that runs while the tab is open.
 *
 * Projected rather than handed over whole, in both backends. The Supabase path
 * can ask for columns and the local path cannot, and a function that returns
 * three fields on one backend and every field on the other is a trap for whoever
 * reads it next — especially when one of those fields is the buyer's access
 * token hash.
 */
export async function latestOrder() {
  if (local) {
    const row = (await readJson(files.orders, []))[0];
    // An empty store is the normal first state of a new install, not an error,
    // and the badge poll asks this every few seconds from the moment the admin
    // panel opens.
    if (!row) return null;
    const { accessTokenHash, access_token_hash, idempotencyKey, idempotency_key, notifications, ...rest } = row;
    return rest;
  }
  return fromOrder((await supabase("orders?select=id,status,created_at&order=created_at.desc&limit=1"))[0]);
}

/**
 * Every order, but only the columns the revenue report reads.
 *
 * A full row carries the access-token hash, the per-order notification log and
 * the line items. The report needs none of them, and skipping them turns a
 * multi-megabyte response into a few kilobytes once the shop has history.
 */
export async function listOrdersForRevenue() {
  if (local) return (await readJson(files.orders, [])).map(({ accessTokenHash, idempotencyKey, notifications, ...rest }) => rest);
  const columns = "id,status,amount,currency,items,delivered_at,created_at,expires_at,paid_count,refunded_count,paid_amount,refunded_amount,paid_provider_amount,refunded_provider_amount";
  return (await supabase(`orders?select=${columns}`)).map(fromOrder);
}

const isSettled = (order) => Boolean(order?.deliveredAt) || !order || !UNPAID.has(order.status);
  // The same list the PostgREST filters above are built from. Two definitions of
  // "unpaid" is how a PayPal order came to never expire: the JSON filter knew
  // about `pending` and the SQL did not.
  const UNPAID = new Set(UNPAID_STATUSES);
const deadlineOf = (order) => {
  const stored = order?.expiresAt ? new Date(order.expiresAt).getTime() : NaN;
  if (Number.isFinite(stored)) return stored;
  const created = new Date(order?.createdAt || "").getTime();
  return Number.isFinite(created) ? created : Infinity;
};

export async function getOrder(id) { return local ? (await readJson(files.orders, [])).find((o) => o.id === id) : fromOrder((await supabase(`orders?id=eq.${encodeURIComponent(id)}&limit=1`))[0]); }
/**
 * Whether this token opens this order.
 *
 * Written here rather than in each caller because every feature that acts on
 * somebody's order — the download, the PayPal capture recovery, writing a review
 * — has to answer it the same way. It hashes and compares instead of reading the
 * stored hash, so the check is a single function and there is nowhere for a second
 * implementation to drift from the first.
 */
export const isOrderOwner = (order, accessToken) => {
  const stored = order?.accessTokenHash || order?.access_token_hash;
  const offered = String(accessToken || "");
  if (!stored || !offered) return false;
  const expected = Buffer.from(stored);
  const actual = Buffer.from(crypto.createHash("sha256").update(offered).digest("hex"));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};
// Lets a buyer who lost the response to checkout find the order they already
// created, instead of opening a second one for the same purchase.
export async function findOrderByIdempotencyKey(key) { if (!key) return null; return local ? (await readJson(files.orders, [])).find((o) => o.idempotencyKey === key) || null : fromOrder((await supabase(`orders?idempotency_key=eq.${encodeURIComponent(key)}&limit=1`))[0]); }
/**
 * Stores a new order, or returns the one this checkout attempt already created.
 *
 * The idempotency key is unique in the database, so the race the check-then-insert
 * in the route could not close is closed here instead: whichever request loses
 * gets 23505, reads the row the winner wrote, and returns it. From the buyer's
 * side the two requests are indistinguishable, which is the point — a checkout
 * that answers the same way twice is safe, and one that answers with two orders is
 * not, whatever the code believed.
 *
 * A 23505 for any other reason is not swallowed: only one that names the
 * idempotency key counts, so a genuine collision on the primary key still surfaces.
 */
export async function createOrder(order) {
  if (!local) {
    try {
      return fromOrder((await supabase("orders", { method: "POST", body: JSON.stringify(toOrder(order)) }))[0]);
    } catch (error) {
      if (error.code !== "23505" || !order.idempotencyKey || !/idempotency/i.test(error.details || "")) throw error;
      return findOrderByIdempotencyKey(order.idempotencyKey);
    }
  }
  let saved = null;
  await mutateJson(files.orders, (orders) => {
    // The same rule, enforced in the only place that can enforce it without a
    // transaction: inside the write queue, where reading and writing are one step.
    const existing = orders.find((o) => o.idempotencyKey && o.idempotencyKey === order.idempotencyKey);
    if (existing) { saved = existing; return orders; }
    saved = order;
    return [order, ...orders];
  });
  return saved;
}
export async function updateOrder(id, patch) { if (!local) return fromOrder((await supabase(`orders?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(toOrder(patch)) }))[0]); let saved = null; await mutateJson(files.orders, (orders) => { const order = orders.find((o) => o.id === id); if (!order) return orders; Object.assign(order, patch, { updatedAt: new Date().toISOString() }); saved = order; return orders; }); return saved; }
/**
 * Orders whose file was actually handed over, with just enough on each to answer
 * "did this customer review this product, and what did they say".
 *
 * A narrow query with an index behind it rather than reading the whole table:
 * reviews are rare, and a page load that pulled every order in the shop to find
 * them would get slower forever.
 *
 * The filter is delivered_at rather than status, because delivering an order
 * resets its status to pending on purpose — that is what lets a buyer download a
 * second time — so "paid" and "delivered" are never both true on the same row.
 */
export async function listFulfilledOrderReviews() {
  if (local) return (await readJson(files.orders, [])).filter((o) => o.deliveredAt);
  const columns = "id,status,items,reviews,paid_at,paid_count,created_at,delivered_at";
  return (await supabase(`orders?select=${columns}&delivered_at=not.is.null`)).map(fromOrder);
}

export let persistenceMode = local ? "local-json" : "supabase";
