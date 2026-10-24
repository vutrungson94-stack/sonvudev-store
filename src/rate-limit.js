// Rate limiter with a pluggable store.
//
// `tooMany` is async so a store can be remote (Supabase, Redis) without
// changing the callers' shape beyond an `await`. The default store is in-memory
// and is used unless RATE_LIMIT_STORE=supabase with Supabase configured.
import { env, isConfigured } from "./config.js";
import { supabaseRequest } from "./supabase-http.js";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 20000;

export function createMemoryStore() {
  const map = new Map();
  return {
    get: (key) => map.get(key),
    set: (key, value) => { map.set(key, value); },
    delete: (key) => { map.delete(key); },
    keys: () => map.keys(),
    clear: () => { map.clear(); },
    size: () => map.size,
  };
}

export function createSupabaseStore() {
  const table = "rate_limit_hits";
  return {
    get: async (key) => {
      try {
        const rows = await supabaseRequest(`${table}?key=eq.${encodeURIComponent(key)}&select=hits&limit=1`);
        return Array.isArray(rows) && rows[0] ? rows[0].hits : undefined;
      } catch { return undefined; }
    },
    set: async (key, value) => {
      try {
        await supabaseRequest(table, { method: "POST", body: JSON.stringify({ key, hits: value, updated_at: new Date().toISOString() }), headers: { Prefer: "resolution=merge-duplicates" } });
      } catch { /* best effort */ }
    },
    delete: async (key) => {
      try { await supabaseRequest(`${table}?key=eq.${encodeURIComponent(key)}`, { method: "DELETE" }); } catch { /* best effort */ }
    },
    keys: () => [],
    clear: () => {},
    size: () => 0,
  };
}

export function resolveRateLimitStore() {
  const mode = String(process.env.RATE_LIMIT_STORE || "").toLowerCase();
  if (mode === "memory") return createMemoryStore();
  if (mode === "supabase") return createSupabaseStore();
  // Default to the shared store when Supabase is configured, so a multi-instance
  // production host does not silently fall back to per-process memory.
  if (isConfigured.supabase) return createSupabaseStore();
  return createMemoryStore();
}

export function createRateLimiter({ windowMs = WINDOW_MS, maxKeys = MAX_KEYS, store = null } = {}) {
  const attempts = store || resolveRateLimitStore();
  const tooMany = async (key, limit) => {
    const now = Date.now();
    const stored = await Promise.resolve(attempts.get(key));
    const recent = (Array.isArray(stored) ? stored : []).filter((time) => now - time < windowMs);
    recent.push(now);
    await Promise.resolve(attempts.set(key, recent));
    const size = await Promise.resolve(attempts.size());
    if (size > maxKeys) {
      const keys = await Promise.resolve(attempts.keys());
      const it = typeof keys?.next === "function" ? keys : null;
      const oldest = it ? it.next() : { done: true };
      if (!oldest.done) await Promise.resolve(attempts.delete(oldest.value));
    }
    return recent.length > limit;
  };
  const reset = () => { try { attempts.clear(); } catch {} };
  const size = () => attempts.size();
  return { tooMany, reset, size, windowMs, store: attempts };
}

const limiter = createRateLimiter();
const tooMany = (key, limit) => limiter.tooMany(key, limit);
export const tooManyAttempts = (req) => tooMany(`ip:${req.ip || 'unknown'}`, 10);
export const adminThrottled = (req) => tooMany(`admin:${req.ip || 'unknown'}`, 30);
export const healthThrottled = (req) => tooMany(`health:${req.ip || 'unknown'}`, 10000);
export async function checkoutThrottled(req, email) {
  return await tooMany(`checkout-ip:${req.ip || 'unknown'}`, 30)
    || (Boolean(email) && await tooMany(`checkout-email:${email}`, 12));
}