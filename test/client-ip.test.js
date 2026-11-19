import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.mjs';
import { clientIp } from '../src/client-ip.js';

test('the edge header wins over the proxy address req.ip names', () => {
  assert.equal(
    clientIp({ headers: { 'cf-connecting-ip': '113.161.160.81' }, ip: '10.0.0.1' }),
    '113.161.160.81',
  );
});

test('a direct request keeps req.ip', () => {
  assert.equal(clientIp({ headers: {}, ip: '8.8.8.8' }), '8.8.8.8');
  assert.equal(clientIp({ ip: '8.8.8.8' }), '8.8.8.8');
});

test('a malformed header falls back instead of poisoning the key', () => {
  assert.equal(clientIp({ headers: { 'cf-connecting-ip': 'not-an-ip' }, ip: '8.8.8.8' }), '8.8.8.8');
  assert.equal(clientIp({ headers: { 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' }, ip: '8.8.8.8' }), '1.2.3.4');
});

test('an IPv6 edge address is kept intact', () => {
  assert.equal(clientIp({ headers: { 'cf-connecting-ip': '2606:4700::1111' }, ip: '10.0.0.1' }), '2606:4700::1111');
});
