# Change plan — 2026-11-18 — Free origin balancer (Wave 2)

## task

Spread visits across multiple free hosts and fail over when one is suspended.

## why

Wave 1 (long HTML TTL + keep-awake at 5 min) cuts origin bandwidth, but all
traffic still lands on a single Render host. When that workspace is suspended,
checkout breaks. Cloudflare Load Balancer is paid; DNS round-robin has no health
signal. A free Worker can do both: distribute by client-IP hash and drop a host
that returns 5xx or the suspension page.

## scope

| file | region |
| --- | --- |
| `cloudflare/origin-balancer/worker.js` | new — hash selection, cooldown, edge cache keyed by original URL, stale fallback |
| `cloudflare/origin-balancer/wrangler.jsonc` | new — config; ORIGINS is a secret (no domain in repo) |
| `test/origin-balancer.test.js` | new — distribution, cooldown, cache policy, suspension detection |
| `docs/RUNBOOK.md` | setup steps + Fly/Koyeb host guidance |

## behavior

- `pickOrigin` hashes `${cf-connecting-ip}|${path}` into the healthy set; one
  visitor stays on one warm origin, a population spreads evenly, no shared
  counter/KV needed.
- An origin returning 5xx or the "suspended" body is skipped for `COOLDOWN_MS`
  (2 min) then re-probed. When all are cooling down, rotation still probes.
- HTML cache uses the Cache API under the ORIGINAL request URL (not per origin),
  so HIT rate survives multiple origins. A 30-day "stale" copy is served with
  `Warning: 110` only when every origin fails — read-only failover.
- `/api/*` and `/admin` are never cached. Response header `X-SVD-Origin` shows
  which host answered (or `edge-cache`), for live verification.

## invariants checked

- No hardcoded domain in repo (ORIGINS is a wrangler secret; test uses `.example`).
- `/api/*` no-store preserved. CSP nonce unaffected (Worker only proxies headers).
- No new dependency; Node test imports the Worker's pure exports.

## reuse

Existing `cloudflare/keep-awake/wrangler.jsonc` pattern for Worker config; no new
shared module needed — routing logic is new and isolated.

## tests

- added: `test/origin-balancer.test.js` (7 tests)
- negative control: constant-first selection or no cooldown fails the spread and
  drop tests.

## live verification (after deploy, blocked while Render suspended)

- `curl -sI https://sonvudev.com/ | grep x-svd-origin` across IPs → different hosts.
- Suspend one origin → its requests skipped within one cooldown, site stays 200.
- `cf-cache-status` on cached HTML still HIT.
