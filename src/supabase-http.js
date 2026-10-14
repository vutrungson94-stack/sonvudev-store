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

function supabaseHeaders() {
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

/**
 * The header set, for a caller that needs to shape its own request.
 *
 * Exported because six places had rebuilt this pair by hand — src/store.js twice
 * and three scripts — and one of them sent an unconditional bearer while the
 * server sniffed for a JWT first. Both readings are defensible; only one of them
 * can be right at a time, and which one was in force depended on which file the
 * request came from.
 *
 * @param {Record<string, string>} [extra] headers to add or override
 * @returns {Record<string, string>}
 */
export function supabaseAuthHeaders(extra = {}) {
  return { ...supabaseHeaders(), ...extra };
}

/**
 * Counts matching rows with a range request, which is how PostgREST reports a
 * total without sending the rows.
 *
 * The two callers that need a count had each written this block themselves, down
 * to the content-range arithmetic and the error message. They agreed, which is
 * how a third copy of the service-key header could go unnoticed beside them.
 *
 * @param {string} pathname the table, e.g. "orders"
 * @param {string} [query] a pre-encoded query string, without the leading "?"
 * @returns {Promise<number>} the total, or 0 when the header is missing or odd
 */
export async function supabaseCount(pathname, query = "") {
  const response = await fetch(`${env.supabase.url}/rest/v1/${pathname}${query ? `?${query}` : ""}`, {
    headers: supabaseAuthHeaders({ Prefer: "count=exact", Range: "0-0" }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text().catch(() => "")}`);
  // "0-0/2" — the part after the slash is the total, not the length of the slice.
  const total = Number(String(response.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}
