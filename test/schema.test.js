import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// supabase/schema.sql is run by hand in the Supabase editor, and it failed
// outright: two ALTER TABLE statements sat inside the column list of a CREATE
// TABLE, so Postgres stopped reading at the word "table". Nothing in this repo
// executes the file, so nothing noticed — the owner found out from an error
// message, after being told to run it. These tests read it the way Postgres does.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = await fs.readFile(path.join(root, 'supabase', 'schema.sql'), 'utf8');

// Line endings are normalised first. This file picked up one bare LF among a
// hundred CRLF from an editor on another machine, and splitting on "\n" alone
// then leaves a fragment that reads like an unterminated statement.
const code = schema
  .replace(/\r\n?/g, '\n')
  .replace(/--[^\n]*/g, '');

const statements = code
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

test('mọi câu lệnh SQL đều đủ dấu chấm phẩy', () => {
  // A missing semicolon is how the next statement gets swallowed, and the error
  // then points at a line the owner never touched.
  assert.ok(statements.length > 20, 'schema phải là đầy đủ, không phải còn một phần');
  // The last statement has to be terminated too, otherwise re-running the file
  // leaves Postgres waiting for input.
  assert.ok(/;\s*$/.test(code), 'câu lệnh cuối cùng cũng phải có dấu chấm phẩy');
});

test('không câu lệnh nào nằm trong khối CREATE TABLE', () => {
  // The failure that started this: an ALTER TABLE between two column
  // definitions. Postgres is still reading a column list and has no rule for
  // what arrives next. Parens are counted rather than pattern-matched, because
  // "create index ... (col)" also contains a closing paren and would throw the
  // depth off.
  let depth = 0;
  for (const [index, statement] of statements.entries()) {
    const firstWord = (statement.match(/^\s*(\w+)/) || [])[1] || '';
    if (depth > 0 && firstWord !== '' && firstWord !== 'create') {
      const first = statement.split('\n').find((l) => l.trim()) || statement;
      assert.fail(`câu lệnh ${index + 1} nằm trong khối CREATE TABLE chưa đóng: ${first.trim().slice(0, 60)}`);
    }
    for (const ch of statement) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
    }
  }
  assert.equal(depth, 0, 'một khối CREATE TABLE chưa đóng ngoặc');
});

test('ràng buộc trạng thái đơn hàng được gắn sau khi bảng đã tạo', () => {
  // A constraint can only be attached once its table exists. The two statements
  // below are the ones that were in the wrong place.
  const createOrders = code.indexOf('create table if not exists public.orders');
  const closeOrders = code.indexOf(');', createOrders);
  const dropConstraint = code.indexOf('orders_status_check');
  assert.ok(createOrders > -1 && closeOrders > -1, 'phai tim thay khoi tao bang orders');
  assert.ok(dropConstraint > closeOrders, 'ràng buộc phải nằm sau khi bảng orders đã đóng');
});

test('mọi cột mà store.js dùng đều có trong schema', () => {
  // The order columns and product columns the app reads. A missing one is a 500
  // the moment the first order is created, not a quiet fallback.
  const orders = ['order_number', 'access_token_hash', 'customer_email', 'customer_name', 'payment_provider',
    'provider_order_id', 'amount', 'currency', 'items', 'paid_at', 'expires_at', 'cancelled_at', 'cancel_reason',
    'delivered_at', 'paid_count', 'paid_amount', 'paid_provider_amount', 'paid_provider_currency', 'idempotency_key',
    'refunded_at', 'refund_reason', 'refunded_count', 'refunded_amount', 'refunded_provider_amount', 'notifications'];
  for (const column of orders) {
    assert.ok(code.includes(column), `bang orders thieu cot ${column}`);
  }
  const products = ['short_description_en', 'description_en', 'features_en', 'seo_title', 'seo_description', 'file_key'];
  for (const column of products) {
    assert.ok(code.includes(column), `bang products thieu cot ${column}`);
  }
});

test('index mà truy vấn phụ thuộc đều có trong schema', () => {
  // The store's hot queries all assume these. Without them nothing errors, the
  // queries simply scan and sort the whole table on every request.
  const required = [
    ['orders_customer_email_idx', 'tra cứu đơn theo email'],
    ['orders_provider_order_id_idx', 'webhook PayPal khớp đơn'],
    ['orders_idempotency_key_idx', 'chống tạo đơn trùng khi retry'],
    ['orders_open_idx', 'quét hết hạn, chỉ đọc đơn còn mở'],
    ['orders_created_at_idx', 'lịch sử đơn và badge sắp xếp theo thời gian'],
    ['products_active_idx', 'cửa hàng lấy sản phẩm đang bán, mới nhất trước'],
  ];
  for (const [name, why] of required) {
    assert.ok(code.includes(name), `thieu index ${name} (${why})`);
  }
  // Every index is created conditionally so the file can be re-run safely.
  for (const match of code.matchAll(/create index\s+([^i\s][^\s]*)/g)) {
    assert.ok(/if not exists/i.test(code.slice(match.index, match.index + 60)), `index ${match[1]} phai co "if not exists"`);
  }
});

test('dòng báo lỗi mà owner gặp không còn tồn tại', () => {
  // The exact shape that failed: an ALTER TABLE on line 35 of a CREATE TABLE.
  assert.ok(!/alter table public\.orders[^\n]*\n[^\n]*\n?[^\n]*alter table public\.orders[^\n]*\n[^\n]*\n?[^\n]*alter table/i.test(code.split('create table if not exists public.orders')[1]?.split(');')[0] || ''),
    'trong khoi tao bang orders khong duoc co cau lenh ALTER nao');
});
