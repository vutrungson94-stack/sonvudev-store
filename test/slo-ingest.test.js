import test from 'node:test';
import assert from 'node:assert/strict';
// The shared test environment, before the script is imported.
import './helpers/env.mjs';
import {
  isServerError,
  statusOfSeries,
  sumRequests,
  toSeconds,
  latencyP95,
  summarizeRecords,
  cloudflareGroupsToSummary,
  cloudflareEmptyDiagnostic,
  cloudflareObservedRange,
} from '../scripts/slo-ingest.mjs';

const series = (status, value, unit = '') => ({
  labels: status ? [{ field: 'statusCode', value: status }] : [],
  values: [{ timestamp: '2026-11-16T00:00:00Z', value, unit }],
  unit,
});

test('isServerError chỉ tính 5xx', () => {
  assert.equal(isServerError('500'), true);
  assert.equal(isServerError('503'), true);
  assert.equal(isServerError('5xx'), true);
  assert.equal(isServerError('404'), false);
  assert.equal(isServerError('200'), false);
  assert.equal(isServerError(''), false);
});

test('statusOfSeries đọc nhãn statusCode', () => {
  assert.equal(statusOfSeries(series('503', 1)), '503');
  assert.equal(statusOfSeries(series(null, 1)), null);
});

test('sumRequests cộng đúng và tách phần không có nhãn', () => {
  const result = sumRequests([
    series('200', 900),
    series('404', 50),
    series('500', 10),
    series(null, 40),
  ]);
  assert.deepEqual(result, { total: 1000, serverErrors: 10, unknown: 40 });
});

test('toSeconds đổi ms sang giây', () => {
  assert.equal(toSeconds(250, 'ms'), 0.25);
  assert.equal(toSeconds(0.25, 's'), 0.25);
  assert.equal(toSeconds('12', 'seconds'), 12);
  assert.equal(toSeconds('bad', 'ms'), null);
});

test('latencyP95 lấy max của chuỗi p95 (thận trọng)', () => {
  const result = latencyP95([
    series(null, 0.2, 's'),
    series(null, 0.35, 's'),
  ]);
  assert.equal(result.p95Seconds, 0.35);
  assert.equal(result.points, 2);
  assert.deepEqual(result.units, ['s']);
});

test('cloudflareGroupsToSummary đếm 5xx theo edgeResponseStatus, không đoán khi thiếu status', () => {
  const groups = [
    { count: 900, dimensions: { edgeResponseStatus: '200' } },
    { count: 50, dimensions: { edgeResponseStatus: '404' } },
    { count: 10, dimensions: { edgeResponseStatus: '503' } },
  ];
  const result = cloudflareGroupsToSummary(groups);
  assert.deepEqual(result, { total: 960, serverErrors: 10, unknown: 0, availability: (950 / 960) * 100, errorRate: (10 / 960) * 100 });

  const withUnknown = cloudflareGroupsToSummary([
    { count: 5, dimensions: { edgeResponseStatus: '200' } },
    { count: 1, dimensions: {} },
  ]);
  assert.equal(withUnknown.unknown, 1);
  assert.equal(withUnknown.availability, null, 'thiếu nhãn status thì availability vẫn unknown');
});

test('Cloudflare trả 0 dòng là lỗi nguồn, không phải phép đo 0%', () => {
  // The real failure this guards: a token with only Zone Analytics: Read gets an
  // empty list from httpRequestsAdaptiveGroups while the account-level query
  // answers "not authorized for that account". Recording that as availability
  // would erase a real measurement, so the diagnostic names the permission.
  const empty = cloudflareEmptyDiagnostic({ total: 0 }, 30);
  assert.match(empty, /Account Analytics/);
  assert.match(empty, /--allow-empty/);
  assert.equal(cloudflareEmptyDiagnostic({ total: 5 }, 30), null, 'có dữ liệu thì không báo lỗi');
  assert.equal(cloudflareEmptyDiagnostic(null, 30), null);
});

test('cloudflareObservedRange đo cửa sổ thật từ bucket, không gán cửa sổ yêu cầu', () => {
  // The edge was switched on partway through the requested 30-day window. The
  // oldest non-empty five-minute bucket is the true start of evidence; the last
  // bucket is still open, so its end is five minutes after its timestamp.
  const range = cloudflareObservedRange('2026-11-17T10:25:00Z', '2026-11-17T10:40:00Z');
  assert.equal(range.observedFrom, '2026-11-17T10:25:00.000Z');
  assert.equal(range.observedTo, '2026-11-17T10:45:00.000Z');
  assert.ok(Math.abs(range.coverageDays - 20 / 1440) < 1e-12, 'coverage là 20 phút, không phải 30 ngày');

  const oneBucket = cloudflareObservedRange('2026-11-17T10:25:00Z', '2026-11-17T10:25:00Z');
  assert.equal(oneBucket.coverageDays, 5 / 1440, 'một bucket rỗng không phải cửa sổ 0');

  const missing = cloudflareObservedRange(null, '2026-11-17T10:40:00Z');
  assert.deepEqual(missing, { observedFrom: null, observedTo: null, coverageDays: 0 });
});

test('summarizeRecords tính availability/errorRate và không đoán khi thiếu status', () => {
  const allKnown = summarizeRecords([
    ...Array.from({ length: 9 }, () => ({ status: 200, latencyMs: 100 })),
    { status: 503, latencyMs: 500 },
  ]);
  assert.equal(allKnown.total, 10);
  assert.equal(allKnown.serverErrors, 1);
  assert.equal(allKnown.availability, 90);
  assert.equal(allKnown.errorRate, 10);
  assert.equal(allKnown.p95Seconds, 0.5);

  const withUnknown = summarizeRecords([
    { status: 200 },
    { status: 500 },
    { latencyMs: 100 },
  ]);
  assert.equal(withUnknown.total, 3);
  assert.equal(withUnknown.unknown, 1);
  assert.equal(withUnknown.availability, null, 'có record thiếu status thì không được đoán');
  assert.equal(withUnknown.errorRate, null);
});

test('summarizeRecords lọc theo cửa sổ và nhận duration (giây)', () => {
  const now = Date.now();
  const records = [
    { timestamp: new Date(now - 60_000).toISOString(), status: 200, duration: 0.2 },
    { timestamp: new Date(now - 40 * 86400000).toISOString(), status: 500, duration: 9 },
  ];
  const result = summarizeRecords(records, 30);
  assert.equal(result.total, 1, 'record cũ hơn 30 ngày phải bị loại');
  assert.equal(result.serverErrors, 0);
  assert.equal(result.p95Seconds, 0.2);
});