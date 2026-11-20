import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { accountIdFromZone } from '../scripts/gha-cf-account-id.mjs';

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

test('accountIdFromZone lấy account.id từ zone response', () => {
  assert.equal(accountIdFromZone({ success: true, result: { account: { id: ID } } }), ID);
  assert.equal(accountIdFromZone({ result: { account: { id: ID.toUpperCase() } } }), ID.toUpperCase());
});

test('accountIdFromZone không đoán khi response thiếu account.id', () => {
  assert.equal(accountIdFromZone(null), null);
  assert.equal(accountIdFromZone({}), null);
  assert.equal(accountIdFromZone({ result: { account: {} } }), null);
  assert.equal(accountIdFromZone({ result: { account: { id: 'not-an-id' } } }), null,
    'một giá trị sai định dạng không được đưa vào wrangler');
});
