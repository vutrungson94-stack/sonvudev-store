// Backup Supabase (products/orders qua PostgREST) + data/*.json local ra backup/.
// Không cần pg_dump, không thêm dependency. Restore = POST lại qua API hoặc
// copy file; script chỉ thu thập, không ghi đè production.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { supabaseAuthHeaders } from '../src/supabase-http.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), override: true });
const value = (k) => (process.env[k] || '').trim();

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(root, 'backup', stamp);
await mkdir(outDir, { recursive: true });
const saved = [];

for (const local of ['data/products.json', 'data/orders.json']) {
  try {
    const buf = await readFile(path.join(root, local));
    await writeFile(path.join(outDir, path.basename(local)), buf);
    saved.push(local);
  } catch { /* không có file local thì bỏ qua */ }
}

const url = value('SUPABASE_URL').replace(/\/$/, '');
const key = value('SUPABASE_SERVICE_ROLE_KEY');
if (url && key && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
  for (const table of ['products', 'orders']) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
        headers: supabaseAuthHeaders(),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(path.join(outDir, `${table}.json`), JSON.stringify(await res.json(), null, 2));
      saved.push(`supabase/${table}`);
    } catch (e) {
      console.error(`[backup] WARN: không backup được ${table}: ${e.message}`);
    }
  }
} else {
  console.log('[backup] Supabase chưa cấu hình — chỉ backup file local.');
}
console.log(`[backup] PASS: đã lưu ${saved.length} nguồn vào backup/${stamp}/ (${saved.join(', ') || 'trống'}).`);
