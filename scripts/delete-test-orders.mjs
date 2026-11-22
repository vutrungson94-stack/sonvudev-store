// Xóa 3 đơn hàng test (test-arch-1/2/3) khỏi Supabase.
// Chạy: node scripts/delete-test-orders.mjs
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseAuthHeaders } from '../src/supabase-http.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), override: true });
const value = (k) => (process.env[k] || '').trim();

const url = value('SUPABASE_URL').replace(/\/$/, '');
const key = value('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) { console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const ids = ['test-arch-1', 'test-arch-2', 'test-arch-3'];
for (const id of ids) {
  const res = await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: supabaseAuthHeaders(),
  });
  console.log(`${id}: HTTP ${res.status} ${res.ok ? 'deleted' : await res.text()}`);
}
console.log('Xong.');