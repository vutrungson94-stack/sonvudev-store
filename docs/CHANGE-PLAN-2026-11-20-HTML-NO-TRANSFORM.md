# Change plan — 2026-11-20 stop Cloudflare JSD injection on public HTML

```yaml
rev: 1
task: "Add no-transform to public HTML so Cloudflare stops injecting its deprecated-API JavaScript Detection script, raising live Lighthouse Best Practices above the gate"

scope:
  - file: src/app.js
    region: "PUBLIC_PAGE_CACHE constant only (public HTML, 404, rendered product/legal pages)"
  - file: test/html-cache.test.js
    region: "one assertion that public HTML carries no-transform"
  - file: docs/CHANGE-PLAN-2026-11-20-HTML-NO-TRANSFORM.md
    region: "this plan"

why: |
  live Lighthouse: performance 100, best-practices 81. The only failing audit is
  `deprecations` (weight 5, score 0) with two warnings, both sourced to
  /cdn-cgi/challenge-platform/scripts/jsd/main.js injected by Cloudflare.
  Repo has zero deprecated-API calls (grep verified). Cloudflare docs state JSD
  injection is disabled when the origin sends `Cache-Control: no-transform`.
  Security Events show no challenge/Managed Challenge at all and no WAF custom
  rule uses cf.bot_management.js_detection.passed, so disabling the JSD signal
  removes no current enforcement. Managed rules (Block on scanner IPs) stay on.

design:
  - "append `no-transform` to PUBLIC_PAGE_CACHE — HTML only; CSS/JS/images keep their own cache headers"
  - "no new dependency, no origin gzip in this revision: measure live Lighthouse first"
  - "expected: Best Practices ~100; Performance may drop from 100 because Cloudflare stops brotli on HTML — must stay >= 85 (threshold with 15-point headroom)"
  - "if Performance drops below 90, add origin gzip with zlib + Vary in a separate revision (and check the origin-balancer Worker cache behaviour)"

verification:
  - "npm run lint/audit/case/workflow/metrics/test/coverage/build + _Tests gtest"
  - "_Sync -Yes auto-commit/push; CI deploy-fly + deployed-site must stay green"
  - "purge edge cache after deploy; curl -I / must show Cache-Control with no-transform and cf-cache-status HIT"
  - "live Lighthouse: best-practices >= 90 AND performance >= 85"
  - "live /api/health commit must equal github.sha"

rollback: "remove `no-transform` from PUBLIC_PAGE_CACHE and let _Sync push; no WAF/secret changes to undo"

## Kết quả đo sau deploy (2026-11-20)

```yaml
commit: ae8507c
ci_run: 44706721503   # xanh: node 24/22, lighthouse, deploy-fly, deployed-site, release-tag
live_lighthouse_before: { performance: 100, best_practices: 81 }
live_lighthouse_after:  { performance: 99,  best_practices: 100 }
deprecations_audit: "score=1, 0 warnings (trước: score=0, 2 warnings từ jsd/main.js)"
live_html: "GET / → 200, cache-control=...stale-if-error=2592000, no-transform; cf-cache-status=HIT sau khi ấm; content-encoding=null; jsd_present=false"
health_commit: ae8507c7ab4ad8add8e8e3d4c67029bfd6023698
decision: "Không cần gzip origin để giữ gate — Perf 99 vẫn dư 14 điểm so với ngưỡng 85. Edge HIT ổn định nên origin không nhận thêm tải. Tuy nhiên chủ cửa hàng yêu cầu triệt để insight 'No compression applied'; xem CHANGE-PLAN-2026-11-20-ORIGIN-GZIP.md cho bước nén bổ sung (không đổi no-transform)."
known_tooling_issue: "gbuild.ps1 đỏ ở Preflight: fly.toml bị heuristic TOML trong _Build/Modules/SharedUtils.psm1:1044 đánh là 'suspicious TOML (no section header)' vì file bắt đầu bằng comment + khóa top-level trước section đầu tiên. fly.toml có từ các commit Fly trước đó, lỗi có sẵn, không do change này; không sửa tool/gate để làm xanh."
```

