// Negative controls for the SPC gate. On 2026-11-18 the 8th daily snapshot
// made six perfectly constant metrics go red: hasRunSameSide used >=/<=, so a
// flat series (every value == mean) counted as "8 points above the mean".
// That was a gate bug, not a process signal — these tests hold the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.mjs';
import { mean, stdev, hasRunSameSide, hasSteadyTrend } from '../scripts/lib/spc.mjs';

test('a perfectly flat series is NOT out of control', () => {
  const flat = [2, 2, 2, 2, 2, 2, 2, 2, 2];
  assert.equal(mean(flat), 2);
  assert.equal(stdev(flat), 0);
  assert.equal(hasRunSameSide(flat, mean(flat)), false,
    'constant values sit on the mean, never strictly on one side');
});

test('eight strictly-above points ARE a run signal', () => {
  // mean of [1..8 plus one low] is still below the eight high points.
  const values = [0, 5, 5, 5, 5, 5, 5, 5, 5];
  assert.equal(hasRunSameSide(values, mean(values)), true);
});

test('eight strictly-below points ARE a run signal', () => {
  const values = [10, 5, 5, 5, 5, 5, 5, 5, 5];
  assert.equal(hasRunSameSide(values, mean(values)), true);
});

test('a flat series never triggers the steady-trend rule', () => {
  assert.equal(hasSteadyTrend([2, 2, 2, 2, 2, 2, 2, 2]), false);
});

test('a real steady increase still triggers the trend rule', () => {
  // Seven consecutive increases need eight points (seven gaps).
  assert.equal(hasSteadyTrend([1, 2, 3, 4, 5, 6, 7, 8]), true);
});
