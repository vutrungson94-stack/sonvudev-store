# Change plan — 2026-11-20 SLO partial window vs declared window

```yaml
rev: 1
task: "Stop a short Cloudflare edge sample from being reported as a full-window SLO breach, and restore the site broken by the gzip Worker change"

scope:
  - file: scripts/lib/slo.mjs
    region: "coverageOf() partialWindow rule and the window-status withdrawal in measureSLOs()"
  - file: test/slo-partial-window.test.js
    region: "new negative controls for a short window with a bad value and for a near-full window"
  - file: docs/CHANGE-PLAN-2026-11-20-SLO-WINDOW-SCOPE.md
    region: "this plan"
  - file: cloudflare/origin-balancer/worker.js, src/app.js, test/html-cache.test.js,
      test/origin-balancer.test.js, WORKFLOW.md, docs/CHANGE-PLAN-2026-11-20-ORIGIN-GZIP.md,
      docs/CHANGE-PLAN-2026-11-20-HTML-NO-TRANSFORM.md
    region: "git revert of 5018a75 — its own commit, per AGENTS.md §1 (never mix reverting with fixing)"

why: |
  The metrics-trends run 44722149015 failed at [slo] with "2 SLO breached without
  corrective action: availability, errorRate". The Cloudflare 30-day ingest saw
  10,970 requests with 1,850 5xx (availability 83.14%, errorRate 16.86%), but its
  own metadata says coverage=3.017d and observedFrom=2026-11-17T10:25Z: the edge
  only has three days of traffic, not the thirty the objective is defined over.
  measureSLOs() defines partialWindow as coverageDays < 1, so 3.017d is treated
  as a full window, and it withdraws only "ok" for a partial window — never
  "breach". The result is asymmetric: a 20-minute 100% sample is unknown, but a
  3-day 83% sample is a hard 30-day breach. The same bad Worker that produced
  those 5xx also breaks the live page: the edge serves single-gzipped HTML with
  no Content-Encoding header, and a fresh request throws Cloudflare 1101
  ("Worker threw exception"). 5018a75's own change plan names rollback of its two
  source files as the remedy; the revert is kept separate from the SLO fix.

design:
  - "partialWindow means the evidence covers materially less than windowDays (95% tolerance), not less than one day"
  - "keep the old coverageDays < 1 fallback when windowDays is absent"
  - "a partial window withdraws BOTH ok and breach: status becomes unknown and breached becomes false; the measured value stays visible"
  - "no target, threshold, or gate is weakened: a full window with a bad value is still a breach and still fails"
  - "the finder/gate code (slo-monitor, sla-monitor, public/status.js) is unchanged — it already keys on status/breached"

invariants_checked:
  - "measurement: unknown/null is never turned into 0 or 100; value is preserved in the evidence file"
  - "full windows still report ok/breach from the same targets"
  - "no change to SPC gates, thresholds, deployment or secrets"
  - "revert keeps the earlier no-transform/JSD fix intact"

tests:
  added:
    - "test/slo-partial-window.test.js — 3.017d of 30d with availability 83.14 and errorRate 16.86 stays unknown, breached false, value visible"
    - "test/slo-partial-window.test.js — 29.9d of 30d is a full window (tolerance), so a healthy value still reports ok"
  changed: none

risk:
  wrong_behavior: "a genuine 30-day breach measured with 3 days of evidence is shown as unknown instead of breach"
  detection: "the raw value and coverageDays stay in metrics-slo.json; once 30 days exist the same code reports breach"

verification:
  - cmd: "npm test ; npm run audit ; npm run lint ; npm run case ; npm run workflow"
    result: "recorded in the commit / session log"
  - cmd: "npm run slo:check"
    result: "after the fix the gate reports OK with gaps and exits 0; CI commits the real Cloudflare evidence"
  - cmd: "live probe of https://sonvudev.com/"
    result: "after reverting 5018a75 the Worker must be redeployed and the edge cache purged; no local CF/Wrangler credentials are available in this session"
```
