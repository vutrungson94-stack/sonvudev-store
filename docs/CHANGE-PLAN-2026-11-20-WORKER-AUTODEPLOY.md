# Change plan — deploy the origin-balancer Worker from CI

```yaml
rev: 1
task: "Remove the manual wrangler deploy from the release path: deploy the Worker from the commit the checks just certified, before the live SEO gate runs"

scope:
  - file: .github/workflows/checks.yml
    region: "new deploy-worker job (needs: checks, main/master only) + deployed-site needs list"
  - file: docs/RUNBOOK.md
    region: "origin balancer configure block — CI is the deploy path, manual wrangler is the fallback"
  - file: docs/CHANGE-PLAN-2026-11-20-WORKER-AUTODEPLOY.md
    region: "this plan"

why: |
  On 20/11 a source fix for the gzip Worker (5018a75) was pushed and its checks
  went green, but the Worker kept running the old script on Cloudflare because
  `wrangler deploy` was only documented in RUNBOOK.md and never automated. The
  edge served gzipped HTML with no Content-Encoding header and threw 1101 on a
  cache miss, so the browser showed garbage and the deployed-site SEO gate
  failed with 144/208 — a code fix that was correct in the repo and absent from
  the zone. The Cloudflare token already lives in Render and
  scripts/gha-read-cf-token.mjs already brings it into CI for the SLO ingest and
  the cache purge; the deploy simply was not wired into the job graph.

design:
  - "deploy-worker needs checks and runs only on main/master, like deploy-fly"
  - "read CLOUDFLARE_API_TOKEN from Render with --required: a deploy without a token fails loudly, never silently skips"
  - "pin wrangler@4.165.0, the same way flyctl is pinned in deploy-fly — an unpinned npx changes behaviour between runs of one commit"
  - "ORIGINS stays a Worker secret in Cloudflare; it is preserved across deploys and never copied into the repo"
  - "job-level concurrency cancel-in-progress:false so a later push cannot cancel a deploy halfway through"
  - "deployed-site needs deploy-worker, so purge + seo:check measure the edge running this commit"
  - "no new secret, no new third-party action, no change to the token rotation flow"

invariants_checked:
  - "no Cloudflare token or domain in source; token still comes from Render at job time"
  - "no change to the Worker route config in wrangler.jsonc (routes already attach on deploy)"
  - "existing SLO/cache-purge token reads are untouched"
  - "manual wrangler deploy remains available as a fallback, not the release path"

tests:
  - "npm run workflow — parses the workflow and validates jobs/steps"
  - "npm run audit ; npm run lint ; npm test — unchanged behaviour gates"
  - "live: after a main push, /api/health commit matches github.sha and the homepage HTML has a single <title>, canonical, h1 and product cards"

risk:
  wrong_behavior: "the Render token has no Account → Workers Scripts:Edit permission and wrangler deploy fails"
  detection: "deploy-worker is a hard failure; grant Workers Scripts:Edit to the token in Cloudflare (no repo change needed)"
  rollback: "revert this change; the documented manual wrangler deploy still works"
```
