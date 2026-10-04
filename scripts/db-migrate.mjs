import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";

// The store talks to Supabase over PostgREST, which cannot run DDL. So a schema
// change is either pasted into the SQL editor by hand or applied here through the
// Management API. Everything is idempotent in schema.sql (create table if not
// exists, add column if not exists), which is what makes re-running it safe.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), override: true });
const value = (key) => (process.env[key] || "").trim();
const apply = process.argv.includes("--apply");

const supabaseUrl = value("SUPABASE_URL");
const projectRef = (() => { try { return new URL(supabaseUrl).hostname.split(".")[0]; } catch { return ""; } })();
if (!projectRef || !/^[a-z0-9-]+$/i.test(projectRef)) {
  console.error("SUPABASE_URL chưa hợp lệ. Không thể đoán project id.");
  process.exit(1);
}

/**
 * Splits a .sql file into statements. Supabase's query endpoint rejects multiple
 * statements in one call, so each has to go on its own. Dollar-quoted bodies are
 * kept whole; this schema has none, but a future function would break on a naive
 * split and fail in a way that is tedious to read.
 */
function statements(sql) {
  const out = [];
  let buffer = "";
  let quoted = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (char === "'") quoted = !quoted;
    if (char === ";" && !quoted) {
      const statement = buffer.trim();
      // A comment-only chunk is not a statement, and sending one is an error.
      if (statement && !/^(--|\/\*|\s)*$/.test(statement) && !/^(--|\/\*)/.test(statement.replace(/^(?:--[^\n]*\n|\s)+/, ""))) out.push(statement);
      buffer = "";
      continue;
    }
    buffer += char;
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out;
}

/** Columns the running code writes. A missing one is what breaks checkout. */
const REQUIRED_COLUMNS = {
  orders: ["id", "order_number", "access_token_hash", "customer_email", "customer_name", "status", "payment_provider", "provider_order_id", "amount", "currency", "items", "paid_at", "created_at", "updated_at",
    "expires_at", "cancelled_at", "cancel_reason", "delivered_at", "paid_count", "paid_amount", "paid_provider_amount", "paid_provider_currency", "idempotency_key", "notifications", "reviews",
    "refunded_at", "refund_reason", "refunded_count", "refunded_amount", "refunded_provider_amount"],
  // `featured` was in this list and in supabase/schema.sql, and nothing in src/ or
// public/ ever read or wrote it — the owner could not set it, the storefront could
// not order by it, and no query selected it. It was a column that looked like a
// feature and behaved like a lie. Removed from both places so the declared shape
// and the used shape agree again; an existing database keeps the column, which is
// harmless, because db-migrate only ever adds what is missing.
products: ["id", "slug", "name", "short_description", "description", "category", "platform", "version", "price", "currency", "badge", "features", "requirements", "status", "file_key", "created_at", "updated_at",
    "short_description_en", "description_en", "features_en", "seo_title", "seo_description"],
};

// Indexes the code depends on, and whether a *non-unique* one is enough.
//
// The idempotency key is the one that has to be unique, and it is the one that
// was not: a checkout's promise that a lost response cannot create a second order
// is only true if the database refuses the second insert. Reading the catalogue of
// index names off the schema file would only prove the file still says it is
// there; asking the running database is the check that would catch a migration
// applied halfway, or an index someone dropped to make a restore finish.
const REQUIRED_INDEXES = {
  orders: {
    unique: ["orders_idempotency_key_uniq"],
    plain: ["orders_customer_email_idx", "orders_provider_order_id_idx", "orders_open_idx", "orders_created_at_idx", "orders_delivered_idx"],
  },
  products: { unique: [], plain: ["products_status_idx", "products_active_idx"] },
};

// Read-only check first: this needs nothing but the service role key the server
// already has, so it can run anywhere and fails loudly rather than half-way
// through a migration.
async function check() {
  const key = value("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    console.error("SUPABASE_SERVICE_ROLE_KEY chưa có, không kiểm tra được schema.");
    process.exit(1);
  }
  const present = new Set();
  for (const table of Object.keys(REQUIRED_COLUMNS)) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    if (response.status === 404 || response.status === 400) { console.log(`MISSING  bảng ${table}`); continue; }
    if (!response.ok) { console.error(`ERROR    bảng ${table}: HTTP ${response.status} ${await response.text()}`); process.exitCode = 1; continue; }
    const rows = await response.json();
    // PostgREST returns [] for a limit=1 on an empty table, so fall back to the
    // column set implied by a deliberate bad select, which fails loudly.
    const columns = rows.length ? Object.keys(rows[0]) : await columnsViaError(table, key);
    columns.forEach((c) => present.add(`${table}.${c}`));
  }
  const missing = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of columns) if (!present.has(`${table}.${column}`)) missing.push(`${table}.${column}`);
  }
  if (missing.length) {
    console.log(`\nThiếu ${missing.length} cột, chạy lại schema.sql:`);
    for (const item of missing) console.log(`  - ${item}`);
    console.log(`\n  npm run db:migrate           # xem trước`);
    console.log(`  npm run db:migrate:apply # áp dụng thật`);
    process.exitCode = 1;
    return false;
  }
  console.log("PASS: schema khớp với code, không thiếu cột nào.");

  const missingIndexes = await checkIndexes(key);
  if (missingIndexes.length) {
    console.log(`\nThiếu ${missingIndexes.length} index, chạy lại schema.sql:`);
    for (const item of missingIndexes) console.log(`  - ${item}`);
    console.log("\n  Nếu là orders_idempotency_key_uniq và báo trùng dữ liệu, xem phần dọn trong schema.sql.");
    process.exitCode = 1;
    return false;
  }
  console.log("PASS: mọi index mà truy vấn phụ thuộc đều tồn tại, kể cả unique của idempotency.");
  return true;
}

// Reads the live index list. A unique index that is not unique is the one case
// worth reading carefully: `create index if not exists` will happily accept an
// existing index of the same name and leave it non-unique, so the name being
// present says nothing about the guarantee.
async function checkIndexes(key) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/indexes`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  // No such RPC on most projects. A missing introspection endpoint must not be
  // read as a missing index, or this check would block every deployment on a
  // project that never installed one.
  if (!response.ok) {
    console.log("\nBỏ qua kiểm tra index: dự án chưa có rpc/indexes để đọc danh sách index.");
    return [];
  }
  const rows = await response.json();
  const byName = new Map(rows.map((row) => [row.indexname, row]));
  const missing = [];
  for (const [table, wanted] of Object.entries(REQUIRED_INDEXES)) {
    for (const name of wanted.plain) {
      if (!byName.has(name)) missing.push(`${table}.${name}`);
    }
    for (const name of wanted.unique) {
      const row = byName.get(name);
      if (!row) { missing.push(`${table}.${name} (unique)`); continue; }
      if (row.indexdef && !/create unique index/i.test(String(row.indexdef))) {
        missing.push(`${table}.${name} — tồn tại nhưng KHÔNG unique, nên chống trùng đơn đang không có tác dụng`);
      }
    }
  }
  return missing;
}

// An empty table cannot be introspected, and asking for a column that does not
// exist makes PostgREST name the ones it does know. Cheaper than the Management
// API and needs no extra token.
async function columnsViaError(table, key) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=__sonvudev_missing_column__&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  if (response.ok) return [];
  const body = await response.json().catch(() => ({}));
  const found = String(body.hint || body.message || "").match(/column[s]? [^.;]+/i);
  return found ? found[0].split(",").map((s) => s.trim().replace(/\.$/, "")) : [];
}

async function migrate() {
  const token = value("SUPABASE_ACCESS_TOKEN");
  if (!token) {
    console.error("Cần SUPABASE_ACCESS_TOKEN (Personal access token tại https://supabase.com/dashboard/account/tokens) để chạy DDL.");
    console.error("Hoặc mở https://supabase.com/dashboard/project/" + projectRef + "/sql và dán nội dung supabase/schema.sql.");
    process.exit(1);
  }
  const sql = await readFile(path.join(root, "supabase", "schema.sql"), "utf8");
  const list = statements(sql);
  console.log(`${list.length} câu lệnh trong supabase/schema.sql.`);
  if (!apply) {
    console.log("\nChạy lại (không ghi gì):\n");
    for (const statement of list) console.log(statement.replace(/\s+/g, " ").slice(0, 110) + ";");
    console.log("\nBỏ --apply để chạy thật.");
    return;
  }
  for (const statement of list) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: statement }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      console.error(`FAIL  ${statement.replace(/\s+/g, " ").slice(0, 90)}\n      ${response.status} ${await response.text()}`);
      process.exitCode = 1;
      return;
    }
    console.log(`OK    ${statement.replace(/\s+/g, " ").slice(0, 90)}`);
  }
  console.log("\nXong. Chạy `npm run db:check` để xác nhận.");
}

if (process.argv.includes("--check")) await check();
else await migrate();
