// Cloudflare API token health — status and days to expiry.
//
// A Cloudflare token does not renew itself: it expires 90 days after creation,
// and the first symptom is the daily SLO ingest or the post-deploy purge failing
// at an odd hour. `/user/tokens/verify` reports the real `expires_on`, so the
// schedule can warn while there is still time to roll the token by hand. This
// measures expiry only; it cannot rotate the token without a human or a secret
// manager, and it does not pretend otherwise.
import 'dotenv/config';
import process from 'node:process';

const DAY_MS = 86_400_000;

/**
 * Days left until an ISO expiry. `null` means "no expiry reported" (a
 * non-expiring token), which is a valid state and must not become 0 days.
 */
export function daysUntilExpiry(expiresOn, now = new Date()) {
  if (!expiresOn) return null;
  const at = Date.parse(expiresOn);
  if (!Number.isFinite(at)) return null;
  return (at - now.getTime()) / DAY_MS;
}

/** Verdict for a `/user/tokens/verify` body against a minimum warning window. */
export function evaluateToken(result, { now = new Date(), minDays = 30 } = {}) {
  const status = result?.result?.status ?? null;
  if (result?.success !== true || status !== 'active') {
    return { ok: false, status: status || 'unknown', daysLeft: null, reason: `token status là ${status || 'unknown'}` };
  }
  const daysLeft = daysUntilExpiry(result.result.expires_on, now);
  if (daysLeft != null && daysLeft < minDays) {
    return { ok: false, status, daysLeft, reason: `token hết hạn sau ${daysLeft.toFixed(1)} ngày (< ${minDays} ngày)` };
  }
  return { ok: true, status, daysLeft, reason: `token active, còn ${daysLeft == null ? 'vô hạn' : daysLeft.toFixed(1) + ' ngày'}` };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('cloudflare-token-check.mjs');
if (invokedDirectly) {
  const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  if (!token) {
    console.error('[cf:token] CLOUDFLARE_API_TOKEN không được đặt.');
    process.exit(2);
  }
  const minDaysArg = process.argv.find((arg) => arg.startsWith('--min-days='));
  const minDays = minDaysArg ? Number(minDaysArg.slice('--min-days='.length)) : 30;
  if (!Number.isFinite(minDays) || minDays <= 0) {
    console.error('[cf:token] --min-days phải là số dương.');
    process.exit(2);
  }
  const response = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`[cf:token] HTTP ${response.status}: ${text.slice(0, 300)}`);
    process.exit(1);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    console.error(`[cf:token] phản hồi không phải JSON: ${text.slice(0, 300)}`);
    process.exit(1);
  }
  const verdict = evaluateToken(body, { minDays });
  console.log(`[cf:token] ${verdict.reason} (expires_on=${body?.result?.expires_on || 'none'})`);
  if (!verdict.ok) process.exit(1);
}
