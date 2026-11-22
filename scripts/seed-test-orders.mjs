// Seed 3 đơn hàng test (>30 ngày, đã giao/hủy) để thử workflow archive-orders.
// Chạy: node scripts/seed-test-orders.mjs
// Sau khi test xong, xóa các đơn này trong Supabase hoặc qua admin panel.
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

const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();

const orders = [
  { id: 'test-arch-1', status: 'delivered', paidAt: oldDate, amount: 100000, currency: 'VND', buyerEmail: 'test1@example.com', deliveredAt: oldDate, productId: 'test-product', productName: 'Test Product 1', paidCount: 1, paidAmount: 100000 },
  { id: 'test-arch-2', status: 'cancelled', paidAt: oldDate, amount: 200000, currency: 'VND', buyerEmail: 'test2@example.com', cancelledAt: oldDate, cancelReason: 'test', productId: 'test-product', productName: 'Test Product 2', paidCount: 1, paidAmount: 200000 },
  { id: 'test-arch-3', status: 'refunded', paidAt: oldDate, amount: 150000, currency: 'VND', buyerEmail: 'test3@example.com', refundedAt: oldDate, productId: 'test-product', productName: 'Test Product 3', paidCount: 1, paidAmount: 150000 },
];

for (const o of orders) {
  const res = await fetch(`${url}/rest/v1/orders`, {
    method: 'POST',
    headers: { ...supabaseAuthHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(o),
  });
  const body = await res.text();
  console.log(`${o.id}: HTTP ${res.status} ${res.ok ? 'OK' : body.slice(0, 200)}`);
}
console.log('Xong. Chạy workflow "archive đơn hàng cũ" trong GitHub Actions để test.');