# AGENTS.md — instructions for humans and AI assistants

Before you change **any** file in this repository, read this file and `WORKFLOW.md`.
They are the contract that keeps the storefront stable while it is being changed.

## 1. Scope discipline

- Fix **only** the thing you were asked to fix. No drive-by rewrites.
- If a fix requires touching a file that is not related to the request, stop and say so — do not decide on your own.
- Never mix reverting work with fixing work in one change.

## 2. The mandatory loop (do not skip)

Every change goes through this loop, in order:

1. **Analyze** — read the code paths involved, the failing log/repro, and `AGENTS.md` invariants. Do not start editing from memory.
2. **Baseline** — run the gates on the untouched tree: `npm test`, `npm run audit`, `npm run lint`, `npm run case`, `npm run workflow`, and `_Tests/gtest.ps1` when a full harness run is available. Write down which checks fail **before** your change.
3. **Design** — write the change plan (`.github/change-plan.yml`): exact files, exact behavior, exact tests that cover it.
4. **Implement — and fix until green.** If a test fails after your change, you do not "accept it for now" — you read the failure, and either fix your code or back the change out and use a different approach. Gates that fail mean the change is not done.
5. **Verify** — all gates pass on the changed tree (see §5), plus a live smoke test if the change touches routing, security, or payment.
6. **Build/Sync** — `_Build/gbuild.ps1` must pass on the committed tree; `_Sync` must push cleanly.

You are not finished when the code looks right. You are finished when the loop is green.

## 3. Why the loop exists

Two regressions that happened here are why:

- A "small" redirect fix produced a 308 on `/` and a 404 `/en/`, then every downstream check failed. It was rolled back three times before the root cause (`preferredLanguage()` returning English for a missing/`*` header, and `/en/` never having a route) was understood and fixed.
- A "small" i18n/localization change made 8 static templates emit a relative `styles.css` link, which on `/de/*` pages resolved to `/de/styles.css` → 404 → "website has no CSS". Localized pages were fine in vi, broken everywhere else. Nothing caught it except a user clicking through.

Both were invisible to a single "it works on my machine" pass. Both were caught by gates — once a gate was written for the specific failure class.

## 4. Invariants — breaking these is a regression, not a feature

- **`src/app.js`** — the homepage `/` and all content paths are Vietnamese routes. `/en/` must exist as a 200 English homepage. Non-vi locale prefixes serve real localized routes (product pages, blog, legal).
- **`public/i18n.js`** — the URL prefix wins. Never rewrite a URL the server already renders in the locale the URL names.
- **`public/index.html` & static legal pages** — the stylesheet link must be absolute (`/styles.css`), never relative (`styles.css`), because prefixes exist.
- **`src/store.js`** — seed products are development data only; production must not ship phantom catalogue entries.
- **`scripts/*.mjs`** — never reintroduce a self-certifying metric (`buildSuccessRate = 100`). Measure, or report `unknown`.
- **`.github/checks.yml`** — `deployed-site` must wait for the deployed commit to match `github.sha` before running `seo:check`.
- **`scripts/seo-check.mjs`** — the gate reads absolute URLs (`href="/styles.css"`). Do not make them relative.
- **Purchase links/flow** — **BẮT BUỘC:** follow [`docs/PURCHASE-LINK-RULES.md`](docs/PURCHASE-LINK-RULES.md). Every “Mua hàng” action (store, blog, CTA, product page) must use `/?buy=<PRODUCT_ID>` and open the **purchase form directly** (`openPurchaseForm` / `?buy` handler in `public/app.js`). Never make `?buy` open only the detail modal; never use `/product/*` navigation as the primary buy action from grid/blog. Do the quick checks in that doc after any link/flow change.
- **Tests** — never change a passing test to make it pass for the wrong reason. If you have to touch a test, prove the test was wrong by first demonstrating it fails on a tree that has your production fix and no test change.

## 5. The gates

```powershell
npm run lint          # parse check, all JS incl. public/
npm run audit         # 32 groups of project-specific rules
npm run case          # case-sensitive imports (Linux CI)
npm run workflow      # workflows parse + jobs well-formed
npm test              # full suite; helpers/env.mjs has fixtures
npm run build         # audits + provenance + artifact packaging

# External harnesses (during this repo's normal dev flow)
_\_Tests\gtest.ps1  -Project . -NonInteractive
_\_Build\gbuild.ps1 -Project . -NonInteractive
_\_Sync\gsync.ps1   -Project . -DryRun   # then -Yes when all gates are green
```

If a gate fails, treat it as an instruction to fix the change, not to weaken the gate — unless the gate itself was provably wrong (then: revert, analyze, change `AGENTS.md`, *then* adjust gate with a note explaining why the test was wrong).

## 6. Rollback protocol

- `git revert <sha>`, never `git reset --hard` on a shared branch.
- If two consecutive rollbacks happen for the same task, stop. The approach is wrong — write down why and pick a different one.
- Never ship "temporary" fixes with the intent of fixing them later; fix the root cause now.

## 7. Definition of done

- All gates green, including the changed tree's CI equivalent.
- No new TODO without a tracking reference.
- A human-readable one-paragraph summary in the commit message of *why*, in addition to *what*.
