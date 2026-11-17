import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.mjs';
import { adminEntries, matchAdminToken } from '../src/admin-auth.js';

test('ADMIN_API_TOKEN đơn lẻ là admin, không expiry, không role phụ', () => {
  const entries = adminEntries('test-admin-token');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].role, 'admin');
  assert.ok(matchAdminToken('test-admin-token', entries));
  assert.equal(matchAdminToken('sai', entries), null);
});

test('không có token thì không có entry nào, sai token không lọt', () => {
  assert.deepEqual(adminEntries(''), []);
  assert.equal(matchAdminToken('', adminEntries('a')), null);
  assert.equal(matchAdminToken('b', adminEntries('a')), null);
});

test('khoảng trắng quanh token bị cắt, không tạo ra nhiều token', () => {
  const entries = adminEntries('  tok  ');
  assert.equal(entries.length, 1);
  assert.ok(matchAdminToken('tok', entries));
});
