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
  assert.ok(createOrders > -1 && closeOrders > -1, 'phải tìm thấy khối tạo bảng orders');
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

test('idempotency_key có ràng buộc UNIQUE, không chỉ có index', () => {
  // This is the difference between the checkout promising "a lost response cannot
  // create a second order" and the database enforcing it.
  //
  // A plain index makes the lookup fast and does nothing else. The application
  // looked the key up before inserting, which is a check-then-act with nothing
  // holding the middle: two requests arriving together both find nothing and both
  // insert. PostgREST cannot run a transaction, so no amount of care in src/ closes
  // that window — two orders, one payment, and a webhook that cannot tell which of
  // them it belongs to.
  //
  // So the guarantee has to be a constraint. `create index if not exists` accepts
  // an existing index of the same name and leaves it non-unique, which is why the
  // test looks for the word `unique` on this index and not merely for its name.
  const lines = statements.filter((s) => /orders_idempotency_key/i.test(s));
  assert.ok(lines.length >= 1, 'phai co index cho idempotency_key');
  const unique = lines.filter((s) => /create\s+unique\s+index/i.test(s));
  assert.equal(unique.length, 1, 'dung mot index unique cho idempotency_key');
  assert.match(unique[0], /orders_idempotency_key_uniq/);
  // Excluding nulls keeps every historical row, all of which have one, from
  // having to be cleaned before the index can be created.
  assert.match(unique[0], /where\s+idempotency_key\s+is\s+not\s+null/i, 'index unique phải bỏ qua dòng có key NULL');
  // And the file has to say how to clean up a database that already has duplicates,
  // because the create fails on them and a failed migration reads like a broken
  // schema rather than like "you have old duplicates".
  assert.match(schema, /delete\s+from\s+public\.orders[\s\S]{0,240}idempotency_key\s*=\s*b\.idempotency_key/i,
    'schema.sql phai kem cach don du lieu trung truoc khi tao index unique');
});

test('index mà truy vấn phụ thuộc đều có trong schema', () => {
  // The store's hot queries all assume these. Without them nothing errors, the
  // queries simply scan and sort the whole table on every request.
  const required = [
    ['orders_customer_email_idx', 'tra cứu đơn theo email'],
    ['orders_provider_order_id_idx', 'webhook PayPal khớp đơn'],
    ['orders_idempotency_key_idx', 'đọc lại đơn của một lần thanh toán'],
    ['orders_open_idx', 'quét hết hạn, chỉ đọc đơn còn mở'],
    ['orders_created_at_idx', 'lịch sử đơn và badge sắp xếp theo thời gian'],
    ['orders_delivered_idx', 'đọc đánh giá mà không quét cả bảng đơn'],
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
