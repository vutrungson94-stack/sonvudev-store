# Change plan — let the edge negotiate Brotli + gzip on public HTML (trial)

```yaml
rev: 1
task: "Try Cloudflare's built-in Brotli/gzip negotiation for HTML by removing no-transform, and keep it only if JSD injection does not come back"

scope:
  - file: src/app.js
    region: "PUBLIC_PAGE_CACHE constant and its comment (no-transform removed)"
  - file: test/html-cache.test.js
    region: "the cache-control assertion for public HTML"
  - file: docs/CHANGE-PLAN-2026-11-20-EDGE-BROTLI-GZIP.md
    region: "this plan"

why: |
  Zone setting `brotli` is on, but `no-transform` on public HTML stops Cloudflare
  from compressing those responses, so the ~115 KB page travels uncompressed.
  no-transform was added on 20/11 to stop Cloudflare injecting the deprecated-API
  JSD script, which took live Lighthouse Best Practices from 81 to 100 while
  Performance stayed 99 (gate 85). The 5018a75 attempt to compress in the Worker
  instead broke production (1101 + gzip bytes without Content-Encoding) and was
  reverted. The edge is the right place to negotiate br/gzip — the question is
  only whether JSD comes back. This is a measured trial, not a permanent decision.

design:
  - "remove no-transform from PUBLIC_PAGE_CACHE only; do not touch minify/rocket_loader/brotli zone settings"
  - "no origin gzip, no zlib, no Worker change — Cloudflare chooses br or gzip from Accept-Encoding"
  - "cache lifetime, stale-if-error and API no-store are unchanged"
  - "the only behavioural risk is JSD injection returning (Best Practices regression); measure and revert if it does"

invariants_checked:
  - "public HTML still public, max-age=86400, stale-while-revalidate, stale-if-error=2592000"
  - "API/admin paths still no-store"
  - "CSP nonce still fresh per response"
  - "no new secret, no dependency, no Worker/cache change"

success_criteria:
  - "GET / with Accept-Encoding: br,gzip returns Content-Encoding: br (or gzip), Vary includes Accept-Encoding"
  - "HTML does NOT contain /cdn-cgi/challenge-platform/scripts/jsd/main.js"
  - "npm gates green; CI checks run green including deployed-site seo:check 212/212"
  - "live lighthouse best-practices >= 90 and performance >= 85"

rollback:
  - "re-add no-transform to PUBLIC_PAGE_CACHE and restore the test assertion; git revert, push via _Sync, purge edge cache"
  - "the 20/11 baseline (BP 100 / Perf 99, no compression) is known-good, so rollback is cheap"
```
