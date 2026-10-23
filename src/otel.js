// Minimal OTLP/HTTP trace exporter. No dependency: uses fetch.
//
// Enabled only when OTEL_EXPORTER_OTLP_ENDPOINT is set, so a host without an
// OTLP collector pays nothing. Export is fire-and-forget: a slow or missing
// collector must never turn a request into a failure.
import { env } from "./config.js";

export function otelEnabled() {
  return Boolean(String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim());
}

export async function exportSpan(span) {
  const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim();
  if (!endpoint) return;
  const tracesPath = String(process.env.OTEL_TRACES_PATH || "/v1/traces").trim();
  const url = endpoint.replace(/\/$/, "") + (tracesPath.startsWith("/") ? tracesPath : `/${tracesPath}`);
  const body = {
    resourceSpans: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: env.brand?.name || "sonvudev-store" } }] },
      scopeSpans: [{ scope: { name: "sonvudev-store" }, spans: [span] }],
    }],
  };
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    // Best effort: tracing is observability, not correctness.
  }
}