// Canary assignment, shared by the stable and the canary instance.
//
// The deploy layer decides *where* a request is served (deploy/Caddyfile.canary
// routes on the svd_canary cookie); this module decides *which visitors* get
// that cookie. Both instances read the same percentage, so a visitor is assigned
// once and keeps the same answer after a restart.
//
// The percentage can come from two places, in order:
//
//   1. CANARY_FILE (default /etc/sonvudev-store.canary in production) - written
//      by deploy/canary.sh, so widening 5% -> 25% -> 100% needs no restart.
//   2. CANARY_PERCENT - the fallback for a host that does not use the script.
//
// A stale or unreadable file must not take the storefront down or silently roll
// 100% of traffic onto a canary. It falls back to the environment value, which
// defaults to zero (stable).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const COOKIE = "svd_canary";
const CACHE_MS = 5000;
const DEFAULT_FILE = process.env.NODE_ENV === "production" ? "/etc/sonvudev-store.canary" : "";

let cache = { at: 0, percent: 0, key: null };

/** Forgets the cached percentage. Used by split and by tests. */
export function resetCanaryCache() {
  cache = { at: 0, percent: 0, key: null };
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function canaryFile() {
  return String(process.env.CANARY_FILE || DEFAULT_FILE || "").trim();
}

/**
 * Current roll-out percentage. Reads the file at most once every five seconds;
 * in between it is a number already in memory, not a per-request syscall.
 */
export function canaryPercent() {
  const file = canaryFile();
  const now = Date.now();
  if (cache.key === file && now - cache.at < CACHE_MS) return cache.percent;

  let percent = clampPercent(process.env.CANARY_PERCENT || 0);
  if (file) {
    try {
      const raw = readFileSync(file, "utf8").trim();
      if (raw !== "") percent = clampPercent(raw);
    } catch {
      // No file means the roll-out has not been started on this host. The
      // environment value (usually 0) stays in charge.
    }
  }
  cache = { at: now, percent, key: file };
  return percent;
}

function readCookie(req, name) {
  return String(req?.headers?.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => {
      const eq = part.indexOf("=");
      if (eq < 0) return false;
      return part.slice(0, eq) === name && part.slice(eq + 1) === "1";
    });
}

/**
 * What this request should do with the canary cookie.
 *
 * `assign` means the response must set svd_canary=1 so Caddy routes the *next*
 * request to the canary instance. `clear` means a rollback is in progress and a
 * visitor left on the canary must be released.
 *
 * The bucket is derived from the client address so the same visitor gets the
 * same answer before the cookie exists, and the assignment survives a lost
 * cookie instead of flapping between builds.
 */
export function canaryAssignment(req) {
  const percent = canaryPercent();
  const sticky = readCookie(req, COOKIE);
  if (percent <= 0) {
    return { percent, assignment: "off", assign: false, clear: sticky };
  }
  if (sticky) {
    return { percent, assignment: "canary", assign: false, clear: false };
  }
  const ip = String(req?.ip || "unknown");
  const hash = createHash("sha256").update(ip).digest();
  const bucket = (hash[0] / 255) * 100;
  const chosen = bucket < percent;
  return { percent, assignment: chosen ? "canary" : "stable", assign: chosen, clear: false };
}

export function canaryCookie() {
  return `${COOKIE}=1; Path=/; Max-Age=3600; SameSite=Lax`;
}

export function canaryClearCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
