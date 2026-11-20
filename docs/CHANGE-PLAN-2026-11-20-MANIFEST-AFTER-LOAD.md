# Change plan — 2026-11-20 move the manifest out of the initial navigation

```yaml
rev: 1
task: "Register /site.webmanifest from the window load event so it leaves Lighthouse's initial network dependency tree"

scope:
  - file: public/quality.js
    region: "manifest registration at the top of the IIFE"
  - file: test/logo.test.js
    region: "new behavioural test that runs quality.js in a VM and asserts append timing"
  - file: WORKFLOW.md
    region: "the web app manifest invariant"
  - file: docs/CHANGE-PLAN-2026-11-20-MANIFEST-AFTER-LOAD.md
    region: "this plan"

why: |
  Lighthouse DevTools showed "Network dependency tree" with
  https://sonvudev.com/ → /site.webmanifest as one chain, 509 ms, 1.42 KiB.
  The manifest is not in the HTML head; public/quality.js appends it. But the
  script is deferred, and deferred scripts run before `load`. On a slow
  connection the manifest fetch therefore starts while the initial navigation
  is still in flight, and Lighthouse charts it as a child of the document. The
  existing test only asserted that the link is not in the head, so it did not
  catch the timing.

design:
  - "wait for `load` in quality.js; keep the readyState === complete fallback for a late script"
  - "do not move the link back into the head, do not add a preload, do not remove the manifest"
  - "behavioural test runs quality.js in node:vm with a fake document/window: before load nothing is appended, on load exactly one link appears"
  - "no new dependency, no route change, no CSP change, no cache-header change, no Cloudflare change"

verification:
  - "npm run lint/audit/case/workflow/test/build + _Tests gtest + _Build gbuild"
  - "_Sync -Yes; CI deploy-fly + deploy-worker + deployed-site + lighthouse green"
  - "purge edge; live Lighthouse Network dependency tree must not list /site.webmanifest under the document"
  - "live Lighthouse best-practices >= 90, performance >= 85; SEO 212/212; /api/health commit matches github.sha"

rollback: "git revert this commit; the manifest returns to being registered before load, no data/zone change to undo"
```

## Kết quả đo sau deploy (2026-11-20)

```yaml
commit_deployed: 788b97e
ci_run: 44773013541   # xanh: node 22/24, lighthouse, deploy-fly, deploy-worker, deployed-site, release-tag
live_quality_js: "GET /quality.js → 200; có addEventListener('load', addManifest); append không còn chạy ngay khi script defer chạy"
live_lighthouse:
  - report: build-reports/lighthouse-2026-11-20T16-34-31-376Z.json
    scores: { performance: 100, accessibility: 100, best_practices: 100, seo: 100 }
    network_dependency_tree: "longest chain 93 ms, only the document; /site.webmanifest không còn là con của document"
    manifest_request: "878 ms (sau observedLoad 129 ms), ngoài initial navigation"
  - report: build-reports/lighthouse-2026-11-20T16-35-02-745Z.json
    scores: { performance: 100, accessibility: 100, best_practices: 100, seo: 100 }
    network_dependency_tree: "longest chain 108 ms, only the document; /site.webmanifest không còn trong cây"
    manifest_request: "605 ms (sau observedLoad 177 ms), ngoài initial navigation"
seo_check: "212/212"
live_html: "GET /?manifest-check=788b97e → 200, content-encoding br, 1 title / 1 h1 / 1 canonical, jsd=false"
health_commit: 788b97ef2d60c8d1619263bc3956f8509e1dfcea
decision: "Giữ. Manifest vẫn được đăng ký cho PWA nhưng chỉ sau load, nên không còn trên initial navigation; điểm số không đổi."
```
