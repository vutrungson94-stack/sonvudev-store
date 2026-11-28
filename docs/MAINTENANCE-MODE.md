# Edge degradation / maintenance mode

The origin balancer Worker (`cloudflare/origin-balancer/worker.js`) can show a
friendly, localized page instead of a bare 502/503. It runs at the edge, so no
origin is contacted and no paid Cloudflare product is involved.

## Modes

| Mode | Trigger | Response |
|---|---|---|
| Normal | no flag, at least one healthy origin | unchanged routing + edge cache |
| Manual maintenance | `MAINTENANCE_UNTIL` in the future | 503 HTML, localized, `Retry-After`, `Cache-Control: no-store` |
| Rate limit | origin returns 429 | API clients keep JSON 429 + `Retry-After: 900`; browser navigations get a friendly 429 page after all origins are throttled |
| All origins down | every origin 503/suspended and no stale cache | 503 HTML with an ETA (`MAINTENANCE_ETA_MS`, default 30 min) instead of `Bad gateway (502)` |
| Stale cache | all origins down but a cached page exists | last good page with `Warning: 110` (read-only) |

The flag is **automatic by default**: an empty/absent `MAINTENANCE_UNTIL` means
normal routing. Set it only for planned maintenance.

## Operator commands

```powershell
# Announce planned maintenance (ISO timestamp, Vietnam time zone is shown to buyers)
npx wrangler secret put MAINTENANCE_UNTIL --config cloudflare/origin-balancer/wrangler.jsonc
# e.g. 2026-12-01T10:00:00+07:00

# Optional reason line shown on the page
npx wrangler secret put MAINTENANCE_REASON --config cloudflare/origin-balancer/wrangler.jsonc

# Clear it (press Enter on an empty value, or set a past timestamp)
npx wrangler secret put MAINTENANCE_UNTIL --config cloudflare/origin-balancer/wrangler.jsonc
```

`MAINTENANCE_ETA_MS` is a plain var in `wrangler.jsonc` (default 1,800,000 ms).
No KV, Durable Object, or paid Worker feature is used; the page is inline HTML
with seven locale strings (vi/en/de/es/fr/ja/zh). URL prefix wins over
`Accept-Language`, matching `AGENTS.md`.

## Auto recovery of free origins

`.github/workflows/auto-heal.yml` runs every 30 minutes (free schedule):

1. `scripts/origin-commit.mjs` reads `/api/health` from the URLs in secrets
   `FLY_HEALTH_URL` and `RENDER_HEALTH_URL`.
2. A **healthy** origin whose `commit` differs from `github.sha` is stale → the
   workflow deploys the latest commit there.
3. A suspended origin is left alone (`scripts/render-suspended.mjs`); there is
   nothing to gain by deploying into a suspension.
4. On the normal push path, `checks.yml` deploys Fly on **every** main push and
   Render auto-deploys from the same commit. `deployed-site` still waits for the
   live sha before `seo:check`.

Cost envelope: Cloudflare free Worker requests, GitHub free scheduled minutes,
Render Hobby and Fly Free. No plan change is required for this mechanism.

## Third origin (in progress)

A GCP Always Free `e2-micro` is being prepared as an optional third origin. Billing was reopened and a $1 alerts-only budget exists, but **no VM is serving yet** — see `docs/THIRD-ORIGIN-GCP.md` for the exact remaining steps and stop condition. Until that document says the VM is live, `ORIGINS` contains Fly + Render only.

## Caveats

- The ETA is an honest estimate from the circuit cooldown, not a guarantee.
- A stale cached page may still be served when all origins are down; that is
  deliberate — it keeps the storefront readable while the gate recovers.
- The maintenance page is `noindex,follow` so it does not damage search ranking.
