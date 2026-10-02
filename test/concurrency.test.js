import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';

// Two order updates landing at the same instant, on the local JSON store.
//
// The write queue only ever covered the write. Every caller read the file first,
// outside that queue, then queued its write: two concurrent updates both read the
// same starting state, both built a new array from it, and the second write
// silently discarded the first. Nothing throws, nothing is logged, and the file on
// disk is valid — it is simply wrong. On this data that means a lost payment
// count, or a refund that never reaches the ledger, which is the kind of mistake
// nobody notices until a month of revenue does not add up.
//
// Postgres was never affected, so this only ever bit local development and the
// offline fallback. Which is exactly why it needed a test rather than a note.
process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-race-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
process.env.RESEND_API_KEY = '';
process.env.INDEXNOW_KEY = '';
process.env.APP_URL = 'http://127.0.0.1:4295';

const { createApp } = await import('../src/app.js');
const { createOrder, getOrder, listOrders, updateOrder } = await import('../src/store.js');

let server;
let base;

test.before(async () => {
  server = (await createApp()).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  server?.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

const seed = (id, extra = {}) => ({
  id,
  orderNumber: id,
  status: "pending_transfer",
  amount: 100,
  currency: "VND",
  items: [{ productId: "p1", name: "Tool", version: "1.0.0", price: 100, currency: "VND", fileKey: "k" }],
  customerEmail: `${id.toLowerCase()}@example.com`,
  customerName: "Buyer",
  paymentProvider: "bank_transfer",
  accessTokenHash: `hash-${id}`,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...extra,
});

test('đọc và ghi JSON diễn ra trong cùng một hàng đợi', async () => {
  await createOrder(seed("SVD-RACE-A"));

  // Ten updates fired together, none of them awaiting the previous one. Before the
  // fix each read the same base array, so the ten attempts to increment a counter
  // collapsed to whichever write landed last.
  await Promise.all(Array.from({ length: 10 }, (_, index) =>
    updateOrder("SVD-RACE-A", { attempts: index + 1, note: `v${index + 1}` })));

  const stored = await getOrder("SVD-RACE-A");
  // The last writer is not the point: nothing is lost is. With the read inside the
  // queue every patch is applied to the state the previous one produced.
  assert.equal(stored.attempts, 10, 'mọi lần ghi phải được giữ lại');
  assert.equal(stored.note, "v10");

  // And the file itself must still be readable: a queue that deadlocked would
  // leave the last caller hanging forever rather than returning wrong data.
  const raw = JSON.parse(await fs.readFile(path.join(tempDir, "data", "orders.json"), "utf8"));
  assert.equal(raw.length, 1);
  assert.equal(raw[0].attempts, 10);
});

test('tạo đơn đồng thời không làm mất đơn nào', async () => {
  const ids = Array.from({ length: 12 }, (_, index) => `SVD-RACE-N${index + 1}`);
  await Promise.all(ids.map((id) => createOrder(seed(id))));

  const stored = await listOrders();
  for (const id of ids) {
    assert.ok(stored.some((order) => order.id === id), `${id} phải còn trong file`);
  }
  assert.equal(stored.length, ids.length + 1, 'không được mất hay ghi thêm đơn');
});

test('hàng đợi không bị kẹt khi một lần ghi thất bại', async () => {
  await createOrder(seed("SVD-RACE-B"));
  // A poisoned chain is the other way this can go wrong: if one write rejects and
  // the chain keeps the rejection, every later write is refused too, forever, and
  // the store silently stops accepting changes.
  await Promise.all([
    updateOrder("SVD-RACE-B", { first: true }),
    updateOrder("SVD-RACE-B", { second: true }),
    updateOrder("SVD-RACE-B", { third: true }),
  ]);
  const stored = await getOrder("SVD-RACE-B");
  assert.equal(stored.first, true);
  assert.equal(stored.third, true, 'lần ghi sau cùng vẫn phải chạy được');
});

test('cập nhật trên đơn không tồn tại trả về null chứ không phải bản sao', async () => {
  assert.equal(await updateOrder("SVD-KHONG-CO", { anything: true }), null);
});
