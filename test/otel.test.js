import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
// Shared shop environment first, like every other test file.
import './helpers/env.mjs';

process.env.NODE_ENV = 'test';
process.env.OTEL_BATCH_SIZE = '64';
process.env.OTEL_FLUSH_MS = '60000';

const otel = await import('../src/otel.js');

const received = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    received.push({
      url: req.url,
      headers: req.headers,
      body: raw ? JSON.parse(raw) : null,
    });
    if (req.url.startsWith('/fail')) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('collector down');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  otel.resetOtel();
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
  delete process.env.OTEL_TRACES_PATH;
  await new Promise((resolve) => server.close(resolve));
});

const span = (name) => ({
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  name,
  startTimeUnixNano: '1',
  endTimeUnixNano: '2',
  attributes: [{ key: 'http.method', value: { stringValue: 'GET' } }],
});

const reset = () => {
  otel.resetOtel();
  received.length = 0;
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = base;
  process.env.OTEL_BATCH_SIZE = '64';
  process.env.OTEL_TRACES_PATH = '/v1/traces';
  delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
};

// The old exporter made one POST per span. A storefront doing 30 requests per
// second opened 30 connections per second to the collector, and a collector
// restart was 30 failures per second. Batching is the production shape of this
// feature, and this test is the one that proves the batching is real.
test('gom nhiều span vào một lần gửi OTLP', async () => {
  reset();
  assert.equal(otel.otelEnabled(), true);
  await otel.exportSpan(span('GET /'));
  await otel.exportSpan(span('GET /api/products'));
  assert.equal(received.length, 0, 'chưa đủ lô thì chưa gửi');
  await otel.flushOtel();

  assert.equal(received.length, 1, 'hai span phải đi trong một request');
  assert.equal(received[0].url, '/v1/traces');
  assert.equal(received[0].headers['content-type'], 'application/json');
  const spans = received[0].body.resourceSpans[0].scopeSpans[0].spans;
  assert.deepEqual(spans.map((s) => s.name), ['GET /', 'GET /api/products']);
  assert.equal(received[0].body.resourceSpans[0].resource.attributes[0].key, 'service.name');

  const stats = otel.otelStats();
  assert.equal(stats.exported, 2);
  assert.equal(stats.failed, 0);
  assert.equal(stats.queue, 0);
});

test('đủ lô thì tự gửi, không chờ hết giờ', async () => {
  reset();
  process.env.OTEL_BATCH_SIZE = '2';
  await otel.exportSpan(span('a'));
  await otel.exportSpan(span('b'));
  assert.equal(received.length, 1, 'span thứ hai phải kích hoạt lô');
  assert.equal(received[0].body.resourceSpans[0].scopeSpans[0].spans.length, 2);
});

test('gửi header xác thực của collector và tôn trọng đường dẫn riêng', async () => {
  reset();
  process.env.OTEL_TRACES_PATH = 'v1/traces';
  process.env.OTEL_EXPORTER_OTLP_HEADERS = 'x-api-key=abc, x-tenant=sonvudev';
  await otel.exportSpan(span('a'));
  await otel.flushOtel();
  assert.equal(received[0].url, '/v1/traces', 'đường dẫn thiếu / phải được thêm vào');
  assert.equal(received[0].headers['x-api-key'], 'abc');
  assert.equal(received[0].headers['x-tenant'], 'sonvudev');
});

test('collector lỗi thì đếm và bỏ span, không ném vào request', async () => {
  reset();
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `${base}/fail`;
  await otel.exportSpan(span('a'));
  await otel.flushOtel();
  const stats = otel.otelStats();
  assert.equal(stats.failed, 1);
  assert.equal(stats.exported, 0);
  assert.match(stats.lastError, /500/);
  assert.equal(stats.queue, 0, 'span lỗi không được dồn vô hạn');
});

test('không đặt endpoint thì không gửi gì', async () => {
  reset();
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  assert.equal(otel.otelEnabled(), false);
  await otel.exportSpan(span('a'));
  await otel.flushOtel();
  assert.equal(received.length, 0);
  assert.equal(otel.otelStats().queue, 0);
});
