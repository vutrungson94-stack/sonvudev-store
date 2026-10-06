import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.mjs';
import { parseAdminTokens, matchAdminToken, isExpired } from '../src/admin-auth.js';

test('token đơn cũ vẫn là admin full quyền, không expiry', () => {
  const entries = parseAdminTokens({ primary: 'test-admin-token', extra: '' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].role, 'admin');
  assert.equal(entries[0].expiresAt, null);
  assert.ok(matchAdminToken('test-admin-token', entries));
  assert.equal(matchAdminToken('sai', entries), null);
});

test('token phụ hỗ trợ role viewer và expiry', () => {
  const entries = parseAdminTokens({
    primary: 'p',
    extra: 'owner:tok1:admin, staff:tok2:viewer@2027-01-01, het:tok3@2000-01-01',
  });
  const viewer = matchAdminToken('tok2', entries);
  assert.ok(viewer && viewer.role === 'viewer');
  assert.equal(matchAdminToken('tok3', entries, Date.parse('2026-01-01T00:00:00Z')), null);
  assert.ok(isExpired(entries.find((e) => e.token === 'tok3'), Date.parse('2026-01-01T00:00:00Z')));
});

test('sai token không lọt dù có nhiều token', () => {
  const entries = parseAdminTokens({ primary: 'a', extra: 'b,c' });
  assert.equal(matchAdminToken('', entries), null);
  assert.equal(matchAdminToken('d', entries), null);
});
