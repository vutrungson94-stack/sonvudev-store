# Change plan — friendly degradation + dual-origin auto-deploy (2026-11-28)

## Task

Make the storefront degrade gracefully when free origins are suspended or
rate-limited, with a friendly localized "we are back at <date>" page at the
edge, and make every push to `main` land on **both** Fly and Render without
extra cost.

## Scope

| File | Region | Change |
|---|---|---|
| `cloudflare/origin-balancer/worker.js` | `fetch()` + new pure helpers | Maintenance page before routing; friendly 429 page; maintenance page instead of raw 502 when all origins fail; `Retry-After`; `Cache-Control: no-store` |
| `test/origin-balancer.test.js` | new tests | Flag on/off/expired, localized body + date, Retry-After, rate-limit page, all-down → 503 with ETA, falsifiability (flag off still routes) |
| `.github/workflows/checks.yml` | `deploy-fly` | Deploy Fly on **every** main push, not only when Render is suspended; Render keeps its existing auto-deploy |
| `docs/MAINTENANCE-MODE.md` | new | Operator guide: what triggers it, how to set/clear `MAINTENANCE_UNTIL`, zero-cost envelope |
| `docs/RUNBOOK.md` | maintenance section | Add the new edge mode and the 429 path |

## Exact behaviour

1. `MAINTENANCE_UNTIL` (ISO string, Worker secret) in the future → every request
   receives a 503 localized HTML page with `Retry-After` and the return time in
   `Asia/Ho_Chi_Minh`. No origin is contacted, no cache is used.
2. If the flag is absent/expired, normal routing is unchanged.
3. All origins down (5xx/suspension) and no stale cache → same friendly 503 page
   with an ETA derived from the circuit cooldown, instead of `Bad gateway (502)`.
4. An origin returning 429 is cooled down briefly and the next origin is tried.
   If all origins are rate-limited → localized 429 page with `Retry-After: 900`.
   API clients (`Accept: application/json`) keep receiving the original JSON 429
   with the new header; only browser navigations get HTML.
5. Locale comes from the URL prefix first (`/en/`, `/de/`, ...), then
   `Accept-Language`, default `vi` — the URL prefix wins, per `AGENTS.md`.
6. Fly deploy job drops its Render-suspended condition; `deployed-site` still
   waits for `github.sha` on the live host. Render auto-deploy remains enabled.

## Reuse

- Existing circuit helpers `isDown`/`markDown`/`markUp`, `withHeader`,
  `isSuspension`, stale-cache path and `COOLDOWN_MS` are reused — no new state
  store, no KV/Durable Object, no new provider.
- Existing locale list (`src/i18n-registry.mjs` / `public/locales/*.json`) is the
  source of the seven locale codes; the edge page keeps a small inline copy of
  the seven display strings because a Worker cannot read the filesystem.

## Tests

- `test/origin-balancer.test.js`: flag active/expired/absent; localized body and
  formatted return date; `Retry-After`; rate-limit HTML vs JSON; all-down → 503
  with ETA; falsifiability (flag off → normal origin selection unchanged).
- Gates: `npm test`, `npm run audit`, `npm run lint`, `npm run case`,
  `npm run workflow`, `npm run build`; `_Build/gbuild.ps1`; `_Sync` dry-run then
  push; live smoke: `curl -sI https://sonvudev.com/` and `/api/health`.

## Invariants checked

- Routing: `/` and `/en/` stay 200 with the flag off; www → apex 308 unchanged.
- i18n: URL prefix wins; no single language hard-wired.
- Content: no shipped content moved into `data/`.
- Checkout: no change to `?buy` flow or price display.
- Security: maintenance page has `noindex,follow`, no secrets, no external assets.

## Risk

- Wrong behaviour: maintenance page shown while origins are healthy → caught by
  the flag-off falsifiability test and live smoke.
- Cost: none — Cloudflare Workers free tier, GitHub Actions free minutes, Render
  Hobby/Fly Free unchanged. Edge page reduces origin bandwidth (helps the 5 GB
  Render limit).

## Definition of done

All gates green, dual-origin deploy verified on the next commit, and the
maintenance mode exercised with a temporary `MAINTENANCE_UNTIL` then cleared.
