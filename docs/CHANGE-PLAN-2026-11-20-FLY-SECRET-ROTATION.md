# Change plan — 2026-11-20 rotate Cloudflare token on Fly too

```yaml
rev: 1
task: "Close the real gap: token rotation updates Fly secrets as well as Render env, with safe rollback"

scope:
  - file: src/lib/cloudflare-rotation.mjs
    region: "rotationConfig (FLY_*), new setFlySecret helper, rotateCloudflareToken ordering + rollback"
  - file: test/cloudflare-rotation.test.js
    region: "mockFetch Fly branch + 2 new tests (happy path and Fly-failure rollback)"
  - file: docs/RUNBOOK.md
    region: "rotation order, token placement table, secret-list note"
  - file: .env.example
    region: "optional FLY_API_TOKEN / FLY_APP_NAME for rotation (commented)"
  - file: docs/CHANGE-PLAN-2026-11-20-FLY-SECRET-ROTATION.md
    region: "this plan"

why: |
  Render holds CLOUDFLARE_API_TOKEN and GitHub CI reads it from Render, but Fly
  also holds Cloudflare credentials (per BAN-GIAO-19-11-2026 Fly secrets) that
  the rotation flow never touches. After a roll, Render uses the new token while
  Fly can keep the revoked one — a genuine split-brain gap.

  Fly GraphQL API (introspected 2026-11-20 with the existing authenticated CLI
  token, values not logged): Mutations.setSecrets(input: SetSecretsInput!) with
  SetSecretsInput { appId: ID!, secrets: [SecretInput!]!, replaceAll: Boolean },
  SecretInput { key: String!, value: String! }, payload SetSecretsPayload { app, release }.

design:
  order:
    - "verify replacement"
    - "read current Render value (only when Fly enabled — needed for rollback)"
    - "update Render env + deploy (unchanged steps)"
    - "set Fly secret CLOUDFLARE_API_TOKEN (new step)"
    - "mail success"
    - "revoke old token"
  optional: "Fly update runs only when both FLY_API_TOKEN and FLY_APP_NAME are set; without them behaviour is byte-identical to today (existing tests must stay green unchanged)"
  rollback: |
    If a later step fails after Fly was updated, restore the Fly secret to the
    value read from Render before the change, restore Render env to that value,
    re-deploy Render, delete the replacement token, then mail failure. The old
    token stays valid until every rollback attempt finishes.

invariants_checked:
  secrets: "no token value in any log/onStep/mail; only ids and step names"
  api: "Fly GraphQL mutation verified against live schema, not guessed"
  tests: "existing rotation tests unchanged and green; 2 new tests pin Fly success and Fly failure"
  scope: "no change to GitHub secrets, Cloudflare policy copy, deploy config or SLO work"

tests:
  existing: "baseline 703/703 green"
  added:
    - "Fly configured: step order and GraphQL variables assert appId/key/value; no step string contains the token value"
    - "Fly failure: rejects, restores Fly + Render to the old value, redeploys Render, deletes replacement, never revokes old"
  changed: "no existing assertion changed"

risk:
  wrong_behavior: "Render and Fly end up on different Cloudflare tokens, or old token revoked while a consumer still uses it"
  detection: "focused rotation tests; full gate suite; _Tests harness; gsync dry run"

verified:
  - cmd: node --test test/cloudflare-rotation.test.js
    result: "PASS 11/11 — 9 existing + 2 new (Fly success, Fly failure rollback)"
  - cmd: npm run lint / audit / case / workflow / metrics / test / coverage / build
    result: "PASS all exit 0 — 232 JS, 422 refs/246 files, 6 workflows, no metric regressed, 705/705 tests"
  - cmd: _Tests/gtest.ps1 -Project <repo> -NonInteractive
    result: "PASS exit 0 — 705/705, report gtest-SonVuDev-Upload-20261120-104100-089.json"
  - cmd: _Sync/gsync.ps1 -Project <repo> -DryRun
    result: "PASS exit 0 — no changes made at dry-run stage"
```

Revisions: rev 1 — initial plan. Stop and write rev 2 if a file outside scope is needed.
