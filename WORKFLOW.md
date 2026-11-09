# WORKFLOW.md — enterprise release workflow for SonVuDev Store

This file defines **how every change ships**. It is versioned and audited.
When reality and this file disagree, reality does not silently win — update this file first, with the reason.

## 0. Before anything

1. Read `AGENTS.md` invariants.
2. Identify the **exact commit** this change builds on. Never start from memory of "latest".
3. List the files you expect to touch. More than 5 files = stop and get explicit approval.

## 1. Analyze phase — no edits allowed

- Read changed commit(s) since last release: `git log --oneline -5`, `git diff <last-release>`.
- Find the **root cause**. The failing symptom (e.g. a 308 on `/`) is never the root cause; it is always two or three commits of drift upstream.
- For quality/maturity work, perform a codebase-grounded audit per `AGENTS.md §4.1`: scan relevant files and flows for hardcode (keep non-dynamic hardcodes), orphans (remove only if inappropriate), duplication/reuse, cross-platform/multilingual independence, and evidence for CMMI L5/platform maturity.
- Write the analysis down in the commit message or `docs/` — never in your head.

## 2. Baseline gate

Run and record:

```powershell
npm run lint; npm run audit; npm run case; npm run workflow
npm test
npm run build
```

If anything is red **before** you touch anything, record it. Your change must leave at least as green as it found.

## 3. Design gate — `.github/change-plan.yml`

Fill in the template (see `docs/CHANGE-PLAN.md`):

- `task` — one sentence, imperative.
- `scope` — files, with line ranges for the behavior.
- `why` — the failure this fixes, with the actual log line.
- `invariants_checked` — which invariants from `AGENTS.md` touch this change and how they were preserved.
- `tests` — tests that already covered it / new tests to add / test changes and why they are correct.
- `risk` — what breaks if this is wrong, and how it is caught.

No plan = no edit.

## 4. Implement

- Smallest possible change that makes the failing test/repro pass.
- No refactoring opportunism. If you see a dead branch unrelated to the task, log it and move on.
- `npm run format` gates apply as usual.

## 5. Fix-until-green — the rule that is never relaxed

For every gate you fail after your change:

1. Read the failure **as written** (file, line, actual output).
2. If the failure is in a file you did not touch: your change broke an assumption — revert your change to the part that matters or remake it.
3. If the failure points at a test being wrong: prove it by checking the test file first; only then touch the test, and only with a reason.
4. Never disable, skip, or `.skip` a test. Never lower a workflow's confidence level.
5. If the same red persists after two different attempts, that is the signal the approach is wrong — back the change out and take a different one.

## 6. Verify phase

- All gates re-run green.
- `npm run build` produces `publish-output/node` clean.
- If the change touches routing/payment/legal/i18n: `npm run seo:check -- https://sonvudev.com` must be green against the live site after deploy. If you cannot verify live, say so explicitly — do not claim it works.

## 7. Build & sync

```powershell
_Tests/gtest.ps1 -Project . -NonInteractive
_Build/gbuild.ps1 -Project . -NonInteractive
_Sync/gsync.ps1   -Project . -DryRun        # then -Yes when clean
```

`_Build` runs `npm run build` + `npm test` + security/policy scan offline. `_Sync` commits and pushes only after the build is green.

## 8. Post-release

- Watch `checks.yml` — specifically the `deployed-site` job, which now polls `/api/health` for the commit sha before auditing.
- If the deploy is red:
  1. `git revert <released-sha>` — preferred — `git revert` is non-destructive and leaves a clear history.
  2. Do not cherry-pick partial fixes into the live branch while the health check is failing.
  3. Write a postmortem in `postmortems/YYYY-MM-DD-<slug>.json`.

## 9. Emergency changes

If something is actively burning:

- Revert to last green on `main` with `git revert` rather than patching forward under pressure.
- Apply the emergency fix only if revert is impossible or makes it worse. Emergency fixes still get a full postmortem and a gate-run in the same session.

---

This file is the source of truth for "how do we ship here". If it is being violated in practice, either fix the practice or update this file — never ignore it silently.
