import test from 'node:test';
import assert from 'node:assert/strict';
// Shared shop environment first, so a real .env on the developer's machine
// cannot fill keys back in.
import './helpers/env.mjs';

test('feature flag mặc định tắt khi không có env', async () => {
  const { isEnabled, allFlags } = await import('../src/feature-flags.js');
  delete process.env.FEATURE_FOO;
  assert.equal(isEnabled('foo'), false);
  assert.equal(isEnabled('foo', true), true);
});

test('feature flag bật khi env = 1/true/yes/on', async () => {
  const { isEnabled } = await import('../src/feature-flags.js');
  for (const value of ['1', 'true', 'yes', 'on', 'TRUE']) {
    process.env.FEATURE_BAR = value;
    assert.equal(isEnabled('bar'), true, value);
  }
  delete process.env.FEATURE_BAR;
});

test('feature flag tắt với giá trị khác', async () => {
  const { isEnabled } = await import('../src/feature-flags.js');
  process.env.FEATURE_BAZ = '0';
  assert.equal(isEnabled('baz'), false);
  process.env.FEATURE_BAZ = 'maybe';
  assert.equal(isEnabled('baz'), false);
  delete process.env.FEATURE_BAZ;
});

test('allFlags chỉ trả về FEATURE_*', async () => {
  const { allFlags } = await import('../src/feature-flags.js');
  process.env.FEATURE_X = '1';
  process.env.NOT_A_FLAG = '1';
  const flags = allFlags();
  assert.equal(flags.x, true);
  assert.equal(flags.not_a_flag, undefined);
  delete process.env.FEATURE_X;
  delete process.env.NOT_A_FLAG;
});
