import test from 'node:test';
import assert from 'node:assert/strict';
// The shared test environment, before the script is imported.
import './helpers/env.mjs';
import { daysUntilExpiry, evaluateToken } from '../scripts/cloudflare-token-check.mjs';

const NOW = new Date('2026-11-17T12:00:00Z');

test('daysUntilExpiry tính theo mốc thời gian và coi thiếu hạn là vô hạn', () => {
  assert.equal(daysUntilExpiry('2026-11-22T12:00:00Z', NOW), 5);
  assert.equal(daysUntilExpiry('2026-12-17T12:00:00Z', NOW), 30);
  assert.equal(daysUntilExpiry(null, NOW), null, 'token không hết hạn không được tính là 0 ngày');
  assert.equal(daysUntilExpiry('bad', NOW), null);
});

test('evaluateToken báo lỗi khi token không active hoặc đã hết hạn', () => {
  const inactive = evaluateToken({ success: true, result: { status: 'disabled', expires_on: '2027-02-15T00:00:00Z' } }, { now: NOW });
  assert.equal(inactive.ok, false);
  assert.match(inactive.reason, /disabled/);

  const expired = evaluateToken({ success: true, result: { status: 'active', expires_on: '2026-11-10T00:00:00Z' } }, { now: NOW, minDays: 30 });
  assert.equal(expired.ok, false);
  assert.equal(expired.daysLeft < 0, true);
});

test('evaluateToken cảnh báo trước ngưỡng và nhận token còn hạn', () => {
  const soon = evaluateToken({ success: true, result: { status: 'active', expires_on: '2026-11-30T12:00:00Z' } }, { now: NOW, minDays: 30 });
  assert.equal(soon.ok, false, '13 ngày còn lại phải nằm trong ngưỡng cảnh báo');
  assert.match(soon.reason, /13\.0 ngày/);

  const healthy = evaluateToken({ success: true, result: { status: 'active', expires_on: '2027-02-15T00:00:00Z' } }, { now: NOW, minDays: 30 });
  assert.equal(healthy.ok, true);
  assert.equal(healthy.daysLeft > 30, true);

  const never = evaluateToken({ success: true, result: { status: 'active', expires_on: null } }, { now: NOW, minDays: 30 });
  assert.equal(never.ok, true, 'token không hết hạn là trạng thái hợp lệ');
});
