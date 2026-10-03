import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Shared shop environment first: src/store.js reads configuration at import.
import './helpers/env.mjs';

const { ORDER_STATUSES } = await import('../src/store.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
// The keys of a `{ pending: ..., ... }` object literal, without evaluating it.
const literalKeys = (block) => [...block.matchAll(/([A-Za-z_][\w]*)\s*:/g)].map((m) => m[1]);

test('mọi nơi đặt tên trạng thái đơn đều khớp một danh sách', () => {
  // The browser cannot import src/, so the admin panel and the dictionary carry
  // their own status maps. That is a deliberate copy, not a second definition —
  // and a seventh status added to ORDER_STATUSES but forgotten in either map is
  // an order the panel cannot name and the buyer cannot read. This holds the
  // three together without a bundler.
  const adminSource = read(path.join('public', 'admin.js'));
  const adminLabels = adminSource.match(/labels=\{([^}]+)\}/)?.[1] || '';
  assert.ok(adminLabels, 'public/admin.js phải có bảng labels cho trạng thái đơn');

  const i18nSource = read(path.join('public', 'i18n.js'));
  const statusMap = i18nSource.match(/STATUS_KEYS\s*=\s*\{([^}]+)\}/)?.[1] || '';
  assert.ok(statusMap, 'public/i18n.js phải có STATUS_KEYS cho trạng thái đơn');

  assert.deepEqual(literalKeys(adminLabels).sort(), [...ORDER_STATUSES].sort(), 'labels của admin phải khớp ORDER_STATUSES trong src/store.js');
  assert.deepEqual(literalKeys(statusMap).sort(), [...ORDER_STATUSES].sort(), 'STATUS_KEYS của i18n phải khớp ORDER_STATUSES trong src/store.js');
});

test('nhóm trạng thái chưa trả tiền là tập con của danh sách đầy đủ', async () => {
  const { UNPAID_STATUSES } = await import('../src/store.js');
  assert.ok(UNPAID_STATUSES.length > 0, 'phải có ít nhất một trạng thái chưa trả tiền');
  for (const status of UNPAID_STATUSES) {
    assert.ok(ORDER_STATUSES.includes(status), `${status} phải nằm trong ORDER_STATUSES`);
  }
});
