# Change plan — 2026-11-20 auto-deploy Fly when Render is suspended

```yaml
rev: 2
task: "Make a push deploy to Fly automatically when Render cannot deploy, so live sha follows CI without a human flyctl call"

rev_changes:
  - "rev 2: baseline gate `test/checks-workflow.test.js` rejected the hardcoded https://fly.io/install.sh URL in checks.yml. Replaced curl|sh with the official superfly/flyctl-actions/setup-flyctl@master pinned to version 0.5.12 — no real URL in the workflow, deterministic CLI version. No gate was weakened; the invariant was respected."

scope:
  - file: scripts/render-suspended.mjs
    region: "new — GET Render service, parse `suspended`, write GITHUB_OUTPUT"
  - file: test/render-suspended.test.js
    region: "new — pure parse tests (suspended / active / malformed)"
  - file: .github/workflows/checks.yml
    region: "new deploy-fly job; deployed-site needs it before waiting for live sha"
  - file: docs/RUNBOOK.md
    region: "document the automatic Fly fallback and FLY_API_TOKEN placement"
  - file: docs/CHANGE-PLAN-2026-11-20-FLY-AUTO-DEPLOY.md
    region: "this plan"

why: |
  Render is suspended (verified: suspended:"suspended", autoDeploy:"yes" via the
  Render API). The edge balancer fails over *traffic* to Fly, but no workflow
  deploys *code* there: checks.yml only waits for the live sha, and FLY_API_TOKEN
  did not exist. On 2026-11-20 the release had to be deployed by hand with
  flyctl. This change closes that gap: after `checks` pass, read Render's
  suspension state; if suspended, install flyctl and deploy Fly with the exact
  github.sha before the deployed-site gate starts waiting.

design:
  - "scripts/render-suspended.mjs: one GET to /v1/services/{id}, export parseSuspended(body) for offline tests, write `suspended=true|false` to GITHUB_OUTPUT and stdout"
  - "API error or missing RENDER_API_KEY/ID fails the job loudly — never silently skip the check"
  - "deploy-fly needs: checks; runs on main/master; only deploys when steps.render.outputs.suspended == 'true'"
  - "install flyctl with the official Linux script; FLY_API_TOKEN comes from a repo secret and is never printed"
  - "deployed-site needs: [checks, deploy-fly] so the sha can actually land before the 15-minute wait"
  - "When Render is healthy, Fly deploy is skipped and Render auto-deploy is used, unchanged"

external_steps:
  - "flyctl tokens create deploy -a sonvudev-store -n github-actions -x 8760h (1 year)"
  - "pipe the token to `gh secret set FLY_API_TOKEN --repo vutrungson94-stack/sonvudev-store` — never echo the value"

invariants_checked:
  secrets: "no token value in code, logs, outputs or commit; only secret names"
  gates: "deployed-site still waits for the exact sha; no threshold/timeout weakened"
  reuse: "same Render API pattern as scripts/render-service-id.mjs; no new dependency"
  tests: "new parse tests; existing 705 tests and workflow gate stay green"

tests:
  existing: "baseline 705/705 green at HEAD 12c5a86"
  added:
    - "test/render-suspended.test.js: suspended -> true, active -> false, malformed/missing field -> throws"
  changed: "no existing test changed"

risk:
  wrong_behavior: "skip Fly deploy when Render is suspended (live stuck on old sha) or deploy with a stale sha"
  detection: "render-suspended focused test; npm run workflow; push CI shows deploy-fly job + live /api/health commit equals new github.sha"

verified:
  - cmd: node --test test/render-suspended.test.js
    result: "PASS 4/4 (suspended, active, list wrapper, malformed fails loudly)"
  - cmd: npm run lint / audit / case / workflow / metrics / test / coverage / build
    result: "PASS all exit 0 — 709/709 tests, 104 files; first run was red only because curl|sh put a real URL in checks.yml, fixed by the official setup-flyctl action (rev 2), no gate weakened"
  - cmd: _Tests/gtest.ps1 -Project <repo> -NonInteractive
    result: "PASS exit 0 — 709/709, report gtest-SonVuDev-Upload-20261120-114110-381.json"
  - cmd: _Sync/gsync.ps1 -Project <repo> -DryRun
    result: "PASS exit 0 — no changes made at dry-run stage"
  - external: "FLY_API_TOKEN (deploy scope, 1 year) created with flyctl tokens create deploy -a sonvudev-store -n github-actions -x 8760h, piped to gh secret set — value never printed; gh secret list shows FLY_API_TOKEN"
  - cmd: push CI run
    result: "pending — verify deploy-fly job runs (Render is suspended), deployed-site green, live /api/health commit == new github.sha"
```

Revisions: rev 1 — initial plan. Stop and write rev 2 if a file outside scope is needed.
