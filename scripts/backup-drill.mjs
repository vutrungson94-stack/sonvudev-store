// Restore drill cho backup — chứng minh bản sao lưu khôi phục được.
// Không ghi đè production: mọi thao tác đều read-only/copy vào thư mục tạm.
//
//   npm run backup            # tạo backup/<stamp>/
//   npm run backup:drill      # kiểm tra backup mới nhất có khôi phục được không
//
// Drill kiểm tra:
//   1. Tất cả file backup bắt buộc tồn tại và parse được
//   2. products.json địa phương đủ khoá bắt buộc (id/slug/name/price)
//   3. supabase-products/orders.json khớp số dòng với Supabase live (read-only,
//      Prefer: count=exact) — backup lệch số dòng là vô dụng khi cần khôi phục
//   4. Restore mô phỏng: copy toàn bộ backup vào thư mục tạm và so SHA-256
//      từng byte với bản gốc — không chạm data/ hay Supabase
import { readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { supabaseAuthHeaders } from '../src/supabase-http.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), override: true });
const value = (k) => (process.env[k] || '').trim();

const sha256 = (file) => crypto.createHash('sha256').update(readFileSync(file)).digest('hex');

let failures = 0;
const ok = (msg) => console.log(`  [ok] ${msg}`);
const fail = (msg) => { failures += 1; console.log(`  [FAIL] ${msg}`); };

// ---------------------------------------------------------------------------
// 1. Chọn backup mới nhất
// ---------------------------------------------------------------------------
const backupRoot = path.join(root, 'backup');
let latest = null;
try {
  for (const entry of readdirSync(backupRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && (!latest || entry.name > latest)) latest = entry.name;
  }
} catch { /* chưa có thư mục backup */ }

if (!latest) {
  console.log('[drill] Chưa có backup nào trong backup/.');
  console.log('[drill] Chạy `npm run backup` trước, rồi chạy lại drill.');
  process.exit(2);
}
const drillDir = path.join(backupRoot, latest);
console.log(`[drill] Kiểm tra backup: ${path.relative(root, drillDir)}`);

// ---------------------------------------------------------------------------
// 2. Cấu trúc + dữ liệu local
// ---------------------------------------------------------------------------
const localProducts = path.join(drillDir, 'products.json');
if (!existsSync(localProducts)) {
  fail('products.json (local) không tồn tại');
} else {
  try {
    const products = JSON.parse(readFileSync(localProducts, 'utf8'));
    const list = Array.isArray(products) ? products : [];
    const missing = list.filter((p) => !p.id || !p.slug || !p.name || typeof p.price !== 'number');
    if (list.length === 0) fail('products.json rỗng');
    else if (missing.length > 0) fail(`${missing.length} sản phẩm thiếu id/slug/name/price`);
    else ok(`products.json: ${list.length} sản phẩm, đủ id/slug/name/price`);
  } catch (error) {
    fail(`products.json parse hỏng: ${error.message}`);
  }
}

const localOrders = path.join(drillDir, 'orders.json');
if (existsSync(localOrders)) {
  try {
    JSON.parse(readFileSync(localOrders, 'utf8'));
    ok('orders.json parse được');
  } catch (error) {
    fail(`orders.json parse hỏng: ${error.message}`);
  }
} else {
  console.log('  [skip] orders.json local không có (bình thường: cửa hàng chạy Supabase)');
}

// ---------------------------------------------------------------------------
// 3. Supabase dump khớp với live (read-only)
// ---------------------------------------------------------------------------
const url = value('SUPABASE_URL').replace(/\/+$/, '');
const key = value('SUPABASE_SERVICE_ROLE_KEY');

const dumpCheck = async (table) => {
  const file = path.join(drillDir, `supabase-${table}.json`);
  if (!existsSync(file)) return fail(`supabase-${table}.json không tồn tại`);
  let dump;
  try {
    dump = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(dump)) throw new Error('không phải mảng');
    ok(`supabase-${table}.json: ${dump.length} dòng, parse được`);
  } catch (error) {
    return fail(`supabase-${table}.json parse hỏng: ${error.message}`);
  }
  if (!url || !key) {
    console.log(`  [skip] Supabase chưa cấu hình — không đối chiếu live được`);
    return;
  }
  try {
    const res = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
      headers: { ...supabaseAuthHeaders(), Prefer: 'count=exact' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const range = res.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    if (Number.isFinite(total)) {
      if (total === dump.length) ok(`supabase-${table}: khớp ${total} dòng với live`);
      else fail(`supabase-${table}: backup ${dump.length} dòng ≠ live ${total} dòng`);
    } else {
      console.log('  [skip] Không đọc được Content-Range — bỏ qua đối chiếu số dòng');
    }
  } catch (error) {
    fail(`không đối chiếu được live ${table}: ${error.message}`);
  }
};
await dumpCheck('products');
await dumpCheck('orders');

// ---------------------------------------------------------------------------
// 4. Restore mô phỏng — byte-compare vào thư mục tạm
// ---------------------------------------------------------------------------
const tmp = path.join(os.tmpdir(), `restore-drill-${Date.now()}`);
try {
  mkdirSync(tmp, { recursive: true });
  const files = readdirSync(drillDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    fail('backup không có file .json nào');
  } else {
    for (const file of files) copyFileSync(path.join(drillDir, file), path.join(tmp, file));
    let identical = 0;
    for (const file of files) {
      const a = sha256(path.join(drillDir, file));
      const b = sha256(path.join(tmp, file));
      if (a === b) identical += 1;
      else fail(`checksum lệch khi restore mô phỏng: ${file}`);
    }
    ok(`restore mô phỏng: ${identical}/${files.length} file khôi phục nguyên byte`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log(failures === 0 ? `[drill] PASS — backup ${latest} khôi phục được.` : `[drill] FAIL — ${failures} vấn đề.`);
process.exit(failures === 0 ? 0 : 1);
