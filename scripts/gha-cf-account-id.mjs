// Resolve CLOUDFLARE_ACCOUNT_ID from the zone id CI already holds as a secret.
//
// The Cloudflare token lives in Render (one source of truth) and is loaded into
// a job by scripts/gha-read-cf-token.mjs. That token can read zones and purge
// cache, but it has no "Account Settings: Read", so wrangler cannot enumerate
// accounts and `deploy` fails before it uploads anything. The zone response
// carries its account id, so ask Cloudflare for the zone instead of widening
// the token's permissions or adding a second copy of the account id to CI.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';

/** The account id on a Cloudflare zone response, or null when it is absent. */
export const accountIdFromZone = (payload) => {
  const id = payload?.result?.account?.id;
  return /^[0-9a-f]{32}$/i.test(String(id || '')) ? id : null;
};

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const fail = (message) => {
    console.error(`::error::${message}`);
    process.exit(1);
  };
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const zoneId = String(process.env.CLOUDFLARE_ZONE_ID || '').trim();
  const githubEnv = String(process.env.GITHUB_ENV || '').trim();
  if (!token) fail('Thiếu CLOUDFLARE_API_TOKEN — chạy gha-read-cf-token.mjs trước.');
  if (!zoneId) fail('Thiếu CLOUDFLARE_ZONE_ID (secret của repo).');
  if (!githubEnv) fail('Thiếu GITHUB_ENV — không thể truyền account id cho bước sau.');

  let payload;
  try {
    const response = await fetch(`${API}/zones/${encodeURIComponent(zoneId)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    payload = await response.json();
    if (!response.ok || payload?.success === false) {
      throw new Error(JSON.stringify(payload?.errors || []).slice(0, 200));
    }
  } catch (error) {
    fail(`Không đọc được zone ${zoneId}: ${String(error?.message || error).slice(0, 200)}`);
  }
  const accountId = accountIdFromZone(payload);
  if (!accountId) fail('Zone response không có account.id — không thể deploy Worker.');
  appendFileSync(githubEnv, `CLOUDFLARE_ACCOUNT_ID=${accountId}\n`, { encoding: 'utf8', flag: 'a' });
  console.log('[gha-cf-account-id] đã nạp CLOUDFLARE_ACCOUNT_ID từ zone');
}
