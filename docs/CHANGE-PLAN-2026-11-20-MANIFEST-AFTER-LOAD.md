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
