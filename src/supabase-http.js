// The PostgREST client, shared by the server and the scripts that talk to the
// database from outside it.
//
// There were two copies: one in src/store.js and one in scripts/publish-product.
// They agreed, which is exactly why the drift was invisible — until the moment one
// gained the Prefer header or the JWT sniffing and the other did not, and a
// release published by hand went to a database that had never heard of it.
//
// The header set lives here so there is one place that knows how this project
// authenticates, which is the thing most worth keeping in one piece: the service
// role key. It must never reach a browser, and a second copy of the code that
// attaches it is a second place to get that wrong.
import { env, isConfigured } from "./config.js";

export function supabaseHeaders() {
  return {
    apikey: env.supabase.serviceRoleKey,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    // PostgREST accepts the service key as apikey alone; sending it as a bearer as
    // well is harmless and keeps older Supabase projects working.
    ...(env.supabase.serviceRoleKey.startsWith("eyJ") ? { Authorization: `Bearer ${env.supabase.serviceRoleKey}` } : {}),
  };
}

/**
 * Calls PostgREST and returns the parsed body.
 *
 * A thrown error carries `status` and `code`, so a caller can tell a constraint
 * violation from an outage instead of reading both as "Supabase said no".
 */
export async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${env.supabase.url}/rest/v1/${pathname}`, {
    ...options,
    headers: { ...supabaseHeaders(), ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let parsed = {};
    try { parsed = JSON.parse(detail); } catch { /* not JSON */ }
    const error = new Error(`Supabase ${response.status}: ${String(parsed.message || detail || "?").slice(0, 300)}`);
    error.status = response.status;
    error.code = parsed.code || null;
    error.details = parsed.details || parsed.hint || null;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

/** Fails loudly rather than writing to a database nobody configured. */
export function requireSupabase() {
  if (!isConfigured.supabase) throw new Error("Thiếu cấu hình Supabase trong .env");
}
