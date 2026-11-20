# Change plan — 2026-11-20 rotate FLY_API_TOKEN automatically

```yaml
rev: 3
task: "Put FLY_API_TOKEN on the same rotation footing as the Cloudflare token: Render is the source of truth, a monthly CI job rolls it and revokes the old value"

rev_changes:
  - "rev 3: first live dispatch went green but left the old token active — deleteLimitedAccessToken with the token value (incl. FlyV1 prefix) did not revoke; verified revoke by id works and GraphQL cannot list limited tokens. Store FLY_TOKEN_ID next to FLY_API_TOKEN in Render env and revoke by id; rollback restores both values."

rev_changes:
  - "rev 2: added scripts/fly-rotate-cli.mjs as the npm script entrypoint (dotenv + summary-only console output); added FLY_ADMIN_TOKEN/FLY_ORG_ID/FLY_APP_NAME to Render env via the existing Render API using the owner's personal Fly token, because both deploy and org tokens were verified UNAUTHORIZED for createLimitedAccessToken."

scope:
  - file: scripts/fly-rotation.mjs
    region: "new — Fly GraphQL create/verify/revoke deploy token + Render env update + mail"
  - file: scripts/fly-rotate-cli.mjs
    region: "new — npm script entrypoint (dotenv, summary-only output)"
  - file: scripts/gha-read-render-secret.mjs
    region: "new — read any Render env var into GITHUB_ENV with add-mask"
  - file: test/fly-rotation.test.js
    region: "new — pure input builders + happy path + rollback tests with mocked fetch"
  - file: package.json
    region: "add npm run fly:rotate"
  - file: .github/workflows/checks.yml
    region: "deploy-fly reads FLY_API_TOKEN from Render instead of a GitHub secret"
  - file: .github/workflows/fly-token-rotate.yml
    region: "new — monthly schedule + workflow_dispatch"
  - file: docs/RUNBOOK.md
    region: "document Fly token placement and the personal FLY_ADMIN_TOKEN caveat"
  - file: docs/CHANGE-PLAN-2026-11-20-FLY-TOKEN-ROTATION.md
    region: "this plan"

why: |
  FLY_API_TOKEN was created on 20/11 with a 1-year expiry and lived only as a
  GitHub secret. cf-token-reminder rotates only CLOUDFLARE_API_TOKEN, so the Fly
  token would silently expire and auto-deploy would break. A deploy-scoped Fly
  token cannot create tokens (verified: createLimitedAccessToken returns
  UNAUTHORIZED), and an org deploy token cannot either (verified the same way).
  The only credential with token-create rights is the owner's Fly personal
  token, stored on Render as FLY_ADMIN_TOKEN. Render becomes the source of truth
  for FLY_API_TOKEN; CI reads it at job time, like CLOUDFLARE_API_TOKEN.

design:
  - "new deploy token: createLimitedAccessToken { name, organizationId, profile:'deploy', profileParams:{ app_id }, expiry:'8760h' }"
  - "verify with GraphQL app(name: appName) using the new token"
  - "update Render env FLY_API_TOKEN, then revoke the old token by value via deleteLimitedAccessToken"
  - "on any failure before revoke: revoke the replacement, restore Render env to the old value, mail failure; old token stays valid"
  - "monthly workflow reads FLY_ADMIN_TOKEN/FLY_ORG_ID/FLY_APP_NAME from Render via RENDER_API_KEY, then runs npm run fly:rotate"
  - "deploy-fly job uses gha-read-render-secret.mjs for FLY_API_TOKEN; GitHub secret FLY_API_TOKEN is deleted after the workflow is verified"

invariants_checked:
  secrets: "no token value in logs, mails, outputs or commits; GITHUB_ENV writes are masked"
  gates: "deployed-site still waits for exact sha; no threshold changed"
  tests: "new offline tests; all existing 709 tests stay green"

verified:
  - cmd: node --test test/fly-rotation.test.js
    result: "pending"
  - cmd: npm run lint / audit / case / workflow / metrics / test / coverage / build
    result: "pending"
  - cmd: CI run with fly-token-rotate workflow + deploy-fly reading Render
    result: "pending"
```

Revisions: rev 1 — initial plan.
