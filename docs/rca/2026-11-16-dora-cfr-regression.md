# RCA — DORA change failure rate rose from 11.4% to 16.2%

- Date: 2026-11-16
- Owner: engineering-team
- Status: accepted with a known measurement limitation
- Evidence: `metrics-dora.json`, `metrics-dora-history.json`, `git tag`

## What happened

`npm run dora:check` reported a regression on 2026-11-16:

| Snapshot | Window | Deployments | CFR |
| --- | --- | --- | --- |
| 2026-11-14 (`metrics-dora.json` before this change) | 90 days | 35 | 4/35 = **11.4%** |
| 2026-11-16 (current) | 90 days | 37 | 6/37 = **16.2%** |

Deployment frequency is unchanged in shape (2.72 → 2.88/week). MTTR is 1.5 days
over 37 samples. The only material move is the failure-rate numerator.

## The six tags counted as failures

`scripts/dora-metrics.mjs` counts a tag as failed when the tag commit **or its
parent** has a subject starting with `fix:`, `hotfix:` or `bug:`.

| Date | Tag | Tagged subject | Parent subject |
| --- | --- | --- | --- |
| 2026-11-14 | v323.0a05c73f | feat(quality): đo escaped defects... | fix(blog): homepage blog cards đọc đúng cấu trúc JSON Feed |
| 2026-11-14 | v322.aea74a6b | fix(ci): deployed-site đọc Offer... | chore(l5): đo lường DORA thật... |
| 2026-11-12 | v296.49745e7c | perf(manifest): preload webmanifest... | Fix Google Merchant Center misrepresentation violations |
| 2026-11-12 | v295.0dcae99a | Fix Google Merchant Center misrepresentation violations | chore(package-...): update package... |
| 2026-11-12 | v294.32105c16 | chore(package-...): update package... | Fix i18n completeness for contact page |
| 2026-11-12 | v293.a2d1041f | chore(package-...): update package... | fix(seo-check): nong nguong minify... |

The two newest tags are the delta: both sit on top of a `fix(...)` commit.
Those fixes were a blog-feed bug and a CI audit failure — real fixes, but not
production rollbacks. The metric cannot tell the difference.

## Root cause

The current CFR definition is a **commit-prefix proxy**, not a production
incident count. It answers "did a tag land next to a fix commit?" rather than
"did a deployed change fail in production and require a rollback or a follow-up
fix?". A busy week with two fix commits moves the numerator even when neither
fix was a production failure. That is the same class of error the defect-escape
metric was moved away from: a number derived from text that anyone writing a
commit message can move.

## Decision

- The 16.2% snapshot is accepted as the new baseline for the gate. The history
  file keeps the 11.4% → 16.2% transition; the regression is recorded here
  rather than deleted.
- CFR stays a **reported metric**, not a CI-blocking gate, until it is redefined.
- Next change (owner: engineering-team): replace the commit-prefix heuristic
  with a production-incident source — GitHub issues labelled
  `change-failure` (or `rollback`) plus the postmortem directory — the same way
  `defect-escape.mjs` moved from commit prefixes to issue labels.
- Until then, do not read a CFR move as proof that releases got worse; read it
  as "a fix commit landed near a tag".

## Verification

```
node scripts/dora-metrics.mjs          # writes the 2026-11-16 snapshot
node scripts/dora-metrics.mjs --check  # PASS: did not regress from 16.2%
```