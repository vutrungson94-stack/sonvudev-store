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

test('mọi nơi đặt tên trạng thái đơn dùng một danh sách', () => {
  // The browser cannot import src/, but it no longer has to carry its own list
  // either. The table lives in public/format.js, which every page loads — the
  // admin panel included — so the panel, the buyer's order page and the server
  // all read one set of six names.
  //
  // This used to assert that two separate copies in admin.js and i18n.js each
  // covered ORDER_STATUSES. That held the key sets together while letting the
  // wording drift, and the wording is what a support call is made of: "Chờ xử lý"
  // in the panel against "Đang chờ thanh toán" on the buyer's page.
  const formatSource = read(path.join('public', 'format.js'));
  const exported = /ORDER_STATUSES\s*=\s*\[([^\]]*)\]/.exec(formatSource)?.[1] || '';
  const viBlock = /vi\s*:\s*\{([^}]*)\}/.exec(formatSource)?.[1] || '';
  const enBlock = /en\s*:\s*\{([^}]*)\}/.exec(formatSource)?.[1] || '';
  assert.ok(exported, 'public/format.js phải khai báo ORDER_STATUSES');
  assert.ok(viBlock && enBlock, 'public/format.js phải có bảng tiếng Việt và tiếng Anh');

  const listed = exported.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.deepEqual([...listed].sort(), [...ORDER_STATUSES].sort(),
    'ORDER_STATUSES trong public/format.js phải khớp src/store.js');
  assert.deepEqual(literalKeys(viBlock).sort(), [...ORDER_STATUSES].sort(),
    'bảng tiếng Việt phải phủ đúng các trạng thái này, không thiếu và không thừa');
  assert.deepEqual(literalKeys(enBlock).sort(), [...ORDER_STATUSES].sort(),
    'bảng tiếng Anh phải phủ đúng các trạng thái này, không thiếu và không thừa');

  // No second home. A copy left behind is exactly what drifted before, and the
  // audit's orphan-key check cannot see a table that is not a dictionary.
  for (const file of ['admin.js', 'i18n.js']) {
    const source = read(path.join('public', file));
    assert.ok(!/STATUS_KEYS\s*=/.test(source), `public/${file} không được mang bảng nhãn riêng nữa`);
    assert.ok(!/labels\s*=\s*\{\s*pending\s*:/.test(source),
      `public/${file} không được mang bảng nhãn riêng — lấy từ format.js`);
    assert.ok(!/'order\.status\./.test(source),
      `public/${file} không được chứa khoá order.status.* — nhãn lấy từ format.js`);
  }
});

test('mọi trạng thái lên từ format.js, không phải lặt rút một lần', () => {
  // Read through the real file rather than a regex of its source: the table is
  // data, and a page rendering the wrong name for an order is the failure this
  // consolidation exists to stop.
  const window = {};
  new Function('window', read(path.join('public', 'format.js')))(window);
  const F = window.SVDFormat;
  assert.ok(F, 'format.js phải gán window.SVDFormat');
  for (const status of ORDER_STATUSES) {
    const vi = F.statusLabel(status, 'vi');
    const en = F.statusLabel(status, 'en');
    assert.ok(vi && vi !== status, `trạng thái ${status} phải có nhãn tiếng Việt, không rơi về chính nó`);
    assert.ok(en && en !== status, `trạng thái ${status} phải có nhãn tiếng Anh, không rơi về chính nó`);
    assert.notEqual(vi, en, `hai ngôn ngữ của ${status} không nên trùng nhau`);
  }
  // An unknown status is shown as itself. Substituting a different one would
  // misreport an order rather than admit the table is behind.
  assert.equal(F.statusLabel('some_future_status', 'vi'), 'some_future_status');
  // Anything that is not English is Vietnamese, the same fallback the rest of
  // the browser code uses.
  assert.equal(F.statusLabel('paid', 'fr'), F.statusLabel('paid', 'vi'));
});

test('nhóm trạng thái chưa trả tiền là tập con của danh sách đầy đủ', async () => {
  const { UNPAID_STATUSES } = await import('../src/store.js');
  assert.ok(UNPAID_STATUSES.length > 0, 'phải có ít nhất một trạng thái chưa trả tiền');
  for (const status of UNPAID_STATUSES) {
    assert.ok(ORDER_STATUSES.includes(status), `${status} phải nằm trong ORDER_STATUSES`);
  }
});
