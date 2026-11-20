# Change plan — CSP nonce for Cloudflare JavaScript Detections

## task
Stop the browser CSP console error caused by Cloudflare Bot Fight Mode's inline
JavaScript Detection loader, without allowing `unsafe-inline` or weakening the
policy.

## why (actual evidence)
Live fetch of `https://sonvudev.com/` shows the site's own HTML is clean and the
`<script defer src="/locale-registry.js">` fix from `7737679` is present. The
inline script at the end of the served document is injected by Cloudflare:

```
(index):1131 Executing inline script violates the following Content Security
Policy directive 'script-src 'self''. ... hash
('sha256-bm/DeqEJHMWFCBa28I00ONwL5xduxANQq2nVjAt3jyc=') ... The action has
been blocked.
```

Its body sets `window.__CF$cv$params={r:'<ray>',t:'<time>'}` and loads
`/cdn-cgi/challenge-platform/scripts/jsd/main.js`. The hash contains the ray id,
so it changes on every request and cannot be allowlisted. Cloudflare docs state
JavaScript Detections is automatically enabled with Bot Fight Mode and cannot be
disabled; when the CSP header carries a `nonce`, Cloudflare parses the header and
stamps that nonce onto the scripts it injects.

## scope
- `src/app.js` — CSP middleware only: add a fresh per-response nonce to
  `script-src`, keep `'self'` and keep everything else in the policy byte-identical.
- `test/ai-discovery.test.js` — assert the nonce is present, is not
  `unsafe-inline`, and changes between responses; update one stale comment.
- `README.md` — the paragraph describing the strict CSP.
- `WORKFLOW.md` — pre-sync no-regress list: hold the nonce contract.

Reused: `crypto` is already imported in `src/app.js` (line 5); no new module,
no new dependency, no HTML rewriting (Cloudflare reads the header).

## invariants_checked
- No `unsafe-inline` in `script-src`; `style-src 'self' 'unsafe-inline'` stays as-is.
- No inline `<script>` added to any template — existing assertions still hold.
- Same-origin external scripts keep loading through `'self'`; the five defer
  scripts and their order in `WORKFLOW.md §7.5` are untouched.
- No route, locale, catalogue, payment or content change. `n/a (no catalog change)`.
- Every test file still imports `./helpers/env.mjs` first.

## tests
- existing: `CSP chặn script inline, và không trang nào còn script inline`
  (asserts `script-src 'self'` and no `unsafe-inline`) — unchanged.
- added: `CSP có nonce mỗi response để Cloudflare JSD không bị chặn` — fetches
  twice, extracts the nonce from each CSP header, asserts both exist and differ.
- changed: comment in `script ngoài phải được phép chạy theo chính CSP đó`.

## risk
If Cloudflare does not pick up the header nonce, the console error remains —
caught by the live smoke test (`curl -I` plus a real browser console check after
deploy). If the nonce were shared with attacker-controlled markup it would weaken
the policy; no page renders user HTML, and a fresh nonce is generated per
response. Reusing a cached nonce at the edge for at most 5 minutes does not add
an injection path because no inline content is user-controlled.

## verified
- baseline before change: `npm test` 660/660, `npm run lint/audit/case/workflow`
  and `npm run build` green on this tree (recorded earlier in the session).
- after change: gates re-run below, plus live browser smoke after deploy.

## Update 2026-11-20 — JSD is not immutable

The note above that JavaScript Detections "cannot be disabled" was wrong for this
zone. JSD is the `enable_js` field of `GET/PUT /zones/{zone_id}/bot_management`,
not a `/settings/*` value, and the Free plan accepts `enable_js: false`. It was
turned off on 2026-11-20 after confirming that `fight_mode` is off and no WAF rule
uses `cf.bot_management.js_detection.passed`; only that field changed. The nonce
stays in the CSP header as defence in depth.
