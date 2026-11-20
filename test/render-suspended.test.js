import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSuspended } from '../scripts/render-suspended.mjs';

// A wrong answer here has a real cost: skip Fly on a suspended Render and the
// live sha never moves; deploy Fly when Render is healthy and we add an
// unnecessary release. The parser is pure so both branches are testable offline.

test('a suspended Render service is detected', () => {
  assert.equal(parseSuspended({ id: 'srv-1', suspended: 'suspended' }), true);
});

test('an active Render service is detected', () => {
  assert.equal(parseSuspended({ id: 'srv-1', suspended: 'active' }), false);
});

test('the list wrapper is accepted', () => {
  assert.equal(parseSuspended([{ service: { id: 'srv-1', suspended: 'suspended' } }]), true);
});

test('a response without the field fails loudly instead of defaulting to active', () => {
  assert.throws(() => parseSuspended({ id: 'srv-1' }), /suspended/);
  assert.throws(() => parseSuspended(null), /suspended/);
});
