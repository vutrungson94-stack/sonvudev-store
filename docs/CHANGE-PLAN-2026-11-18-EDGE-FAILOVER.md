# Change plan — 2026-11-18 — Edge failover through cache

## task

Cut Render origin bandwidth to near zero and keep the storefront readable while
the origin is suspended, then reduce the frequency of the keep-awake ping.

## why

The Render Hobby workspace was suspended after consuming its 5 GB monthly
outbound bandwidth. Root cause: before O2O was enabled on 2026-11-17 every
request (HTML, CSS, images) reached the origin; the origin is the only thing
that counts against Render bandwidth, while Cloudflare edge does not. With the
edge now caching, the remaining origin traffic is the 5-minute HTML revalidation
(288/day per page) and a keep-awake ping every minute (43,200/month).

## scope

| file | region |
| --- | --- |
| `src/app.js` | shared `PUBLIC_PAGE_CACHE` constant; `sendPage`, `notFound`, `productPage`, `blogPage`, `blogIndexPage` headers |
| `cloudflare/keep-awake/wrangler.jsonc` | cron `* * * * *` -> `*/5 * * * *` |
| `test/html-cache.test.js` | new: HTML cache header + API no-store + CSP nonce |

## behavior

- Public HTML: `public, max-age=86400, stale-while-revalidate=604800, stale-if-error=2592000`.
  `stale-if-error` is the failover: when the Render origin is suspended and answers
  503, Cloudflare serves the last cached HTML instead of the suspension page.
  `max-age=86400` cuts revalidation from 288/day to 1/day per page.
- `/api/*` keeps `no-store` (unchanged).
- CSP nonce stays per-response (unchanged); a cached HTML response carries the
  nonce it was generated with, which is the accepted trade-off for
  edge-cached HTML (documented in RUNBOOK).
- Keep-awake cron 5-minute interval stays under Render's 15-minute sleep
  threshold, so it still prevents a cold start while cutting pings by 80%.

## invariants checked

- `/api/*` responses remain `no-store` (orders, one-time tokens).
- CSP `script-src` still has a fresh `'nonce-...'` per origin response.
- Stylesheet link stays absolute; no routing/i18n change.
- `cache:purge` still runs after a verified deploy so a long TTL never serves a
  stale release.

## reuse

One `PUBLIC_PAGE_CACHE` constant in `src/app.js` instead of five inline header
strings. No new module or dependency.

## tests

- added: `test/html-cache.test.js` (header value, api no-store, nonce differs)
- negative control: a wrong TTL (300) or missing `stale-if-error` fails the test.
