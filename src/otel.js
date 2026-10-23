// OTLP/HTTP trace exporter, batching spans instead of one POST per request.
//
// One span per HTTP request is cheap on the shop side and expensive on the
// collector: a storefront doing 30 requests/second used to open 30 connections
// per second and send 30 tiny JSON documents. The collector's own docs ask for
// batches for exactly this reason. Spans are now queued, sent when the queue
// reaches OTEL_BATCH_SIZE, and flushed on a timer otherwise.
//
// Still best effort, deliberately. Tracing is observability, not correctness:
// a missing collector, a slow collector or a full queue must never fail a
// request, block checkout, or grow memory without a bound. The queue is capped;
// when it is full the oldest span is dropped and counted.
//
// Enabled only when OTEL_EXPORTER_OTLP_ENDPOINT is set. Everything else has a
// working default, so a host without a collector pays one boolean check.
import { env } from "./config.js";

const MAX_QUEUE = 512;
const DEFAULT_BATCH = 64;
const DEFAULT_FLUSH_MS = 5000;
const DEFAULT_TIMEOUT_MS = 5000;

let queue = [];
let timer = null;
let flushing = null;
let stats = { queued: 0, exported: 0, dropped: 0, failed: 0, batches: 0, lastError: null };

function numberFrom(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function endpoint() {
  return String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim();
}

function tracesUrl() {
  const base = endpoint().replace(/\/$/, "");
  const tracesPath = String(process.env.OTEL_TRACES_PATH || "/v1/traces").trim();
  return base + (tracesPath.startsWith("/") ? tracesPath : `/${tracesPath}`);
}

function exporterHeaders() {
  // OTLP defines the value as comma-separated key=value pairs. Only used for
  // collector auth (an API key, a tenant header); never for shop secrets.
  const raw = String(process.env.OTEL_EXPORTER_OTLP_HEADERS || "").trim();
  const headers = { "content-type": "application/json" };
  if (!raw) return headers;
  for (const pair of raw.split(",")) {
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (name) headers[name] = value;
  }
  return headers;
}

function batchSize() {
  return numberFrom(process.env.OTEL_BATCH_SIZE, DEFAULT_BATCH, 1, MAX_QUEUE);
}

function flushMs() {
  return numberFrom(process.env.OTEL_FLUSH_MS, DEFAULT_FLUSH_MS, 100, 60000);
}

function timeoutMs() {
  return numberFrom(process.env.OTEL_EXPORTER_OTLP_TIMEOUT, DEFAULT_TIMEOUT_MS, 100, 30000);
}

export function otelEnabled() {
  return Boolean(endpoint());
}

function schedule() {
  if (timer) return;
  // unref: a pending flush must not keep a test run or a stopping process alive.
  timer = setTimeout(() => {
    timer = null;
    flushOtel().catch(() => {});
  }, flushMs());
  timer.unref?.();
}

function bodyFor(spans) {
  return {
    resourceSpans: [{
      resource: {
        attributes: [{
          key: "service.name",
          value: { stringValue: String(process.env.OTEL_SERVICE_NAME || env.brand?.name || "sonvudev-store") },
        }],
      },
      scopeSpans: [{ scope: { name: "sonvudev-store" }, spans }],
    }],
  };
}

/**
 * Queues one span. Resolves immediately; the POST happens in the background.
 *
 * Returns the flush promise when the queue reaches a batch, so a caller that
 * wants to wait (tests, a graceful shutdown) can. Request handlers ignore it.
 */
export function exportSpan(span) {
  if (!span || !otelEnabled()) return Promise.resolve();
  if (queue.length >= MAX_QUEUE) {
    queue.shift();
    stats.dropped += 1;
  }
  queue.push(span);
  stats.queued += 1;
  if (queue.length >= batchSize()) return flushOtel();
  schedule();
  return Promise.resolve();
}

/** Sends the queued spans now. Safe to call when nothing is queued. */
export function flushOtel() {
  if (flushing) return flushing;
  if (!queue.length || !otelEnabled()) return Promise.resolve();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const spans = queue.splice(0, batchSize());
  if (queue.length) schedule();

  flushing = (async () => {
    stats.batches += 1;
    try {
      const response = await fetch(tracesUrl(), {
        method: "POST",
        headers: exporterHeaders(),
        body: JSON.stringify(bodyFor(spans)),
        signal: AbortSignal.timeout(timeoutMs()),
      });
      if (!response.ok) throw new Error(`collector responded ${response.status}`);
      stats.exported += spans.length;
      stats.lastError = null;
    } catch (error) {
      // Spans are not retried. A collector that is down will be down again on
      // the next batch, and replaying a growing backlog is how a tracing outage
      // becomes a memory outage. The counter is what makes it visible.
      stats.failed += spans.length;
      stats.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** Counters for /api/health or a debug endpoint. Never contains span payloads. */
export function otelStats() {
  return { ...stats, queue: queue.length, enabled: otelEnabled() };
}

/** Test-only reset. Not called by the application. */
export function resetOtel() {
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
  flushing = null;
  stats = { queued: 0, exported: 0, dropped: 0, failed: 0, batches: 0, lastError: null };
}
