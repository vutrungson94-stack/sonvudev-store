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
- **Shipped content vs runtime data** — **BẮT BUỘC:** anything the site must serve in production (blog posts, product copy, legal text, static JSON) lives in **`src/`** or **`public/`**, both of which are copied into the deploy artifact. **`data/` is runtime state only** (orders.json, email previews) and is deliberately excluded from the artifact and rejected by `deploy.sh`. Content placed in `data/` ships as an empty shop: the file is missing in the image, the loader returns `[]`/null, and the page 404s. Blog posts live in `src/blog-posts/` for this reason. `test/content-ships.test.js` fails if a runtime path is used for shipped content.
- **`scripts/*.mjs`** — never reintroduce a self-certifying metric (`buildSuccessRate = 100`). Measure, or report `unknown`.
- **`.github/checks.yml`** — `deployed-site` must wait for the deployed commit to match `github.sha` before running `seo:check`.
- **`scripts/seo-check.mjs`** — the gate reads absolute URLs (`href="/styles.css"`). Do not make them relative.
- **`src/pages.js` merchant listing** — the `Product`/`Offer` graph must keep `hasMerchantReturnPolicy` with `applicableCountry`; for **digital products** `returnMethod` and `shippingDetails` are **omitted** (a digital download has no carrier and no physical return method — emitting them is what GMC flagged). **No** `AggregateRating`/`ratingValue`/`reviewCount`/`bestRating` (the review test forbids self-collected star markup); reviews stay prose.
- **Merchant Center "Trình bày sai" (misrepresentation)** — **BẮT BUỘC:** follow [`docs/MERCHANT-CENTER-MISREPRESENTATION-REMEDIATION.md`](docs/MERCHANT-CENTER-MISREPRESENTATION-REMEDIATION.md). The rules, each enforced by `test/merchant-policy.test.js`: (1) the feed `price` is the product's own shelf price in its own currency — never a hard-coded USD conversion (price mismatch); (2) `public/contact.html` renders phone/address from `{{brandPhone}}`/`{{brandAddress}}`, never hard-coded; (3) product copy in `public/locales/*.json` **and in `data/products.json`** carries no unenforceable scarcity/discount claims ("first 100", "33% off", "only N left"); (4) the refund story is one story — contact page, FAQ and checkout consent must not promise refunds for "wrong purchase" that `refund.html` excludes.
- **Purchase links/flow** — **BẮT BUỘC:** follow [`docs/PURCHASE-LINK-RULES.md`](docs/PURCHASE-LINK-RULES.md). Every explicit **“Mua hàng/Buy”** action (store buy affordance, blog buy CTA, product-page buy button) must use `/?buy=<PRODUCT_ID>` and open the **purchase form directly** (`openPurchaseForm` / `?buy` handler in `public/app.js`). Discovery/navigation links (e.g. “Sản phẩm liên quan/Related product”) must go to the product page, not checkout. Never make `?buy` open only the detail modal; never use `/product/*` navigation as the primary buy action from grid/blog buy affordances. Do the quick checks in that doc after any link/flow change.
- **Repo ↔ live parity** — `data/products.json` is the source of truth; the live shop reads Supabase when configured. Any change to product data/copy (copy, SEO fields, badges, prices, features, requirements, images) is **not done** until the live catalogue matches the repo: `npm run ops:catalog` → `npm run ops:catalog:apply` → verify `GET /api/products` and the product page / `/merchant-feed.tsv` field for field. See `WORKFLOW.md §7.6`. A green repo with a stale live catalog still violates GMC policy.
- **Checkout must show the price before commitment** — the purchase modal (`openCheckout` in `public/app.js`) must display the product name, unit price in the product's own currency, total, the payment conversion note (PayPal VND→USD), the digital-delivery method and the refund window. Never let a buyer reach the pay step without seeing what they are paying.
- **Tests** — never change a passing test to make it pass for the wrong reason. If you have to touch a test, prove the test was wrong by first demonstrating it fails on a tree that has your production fix and no test change.

## 4.1. Codebase quality audit (when assessing or improving the platform)

When asked to audit/improve SonVuDev or evaluate maturity, assess the **actual codebase** (not markdown/docs claims). Review file-by-file and flow-by-flow:

- **Hardcode** — identify hardcoded values/paths/URLs/behavior. Replace with config, env, or shared constants only when safe and dynamic; **preserve hardcodes that cannot be made dynamic** (platform/runtime constraints, required literals, intentional fixed behavior) and document why.
- **Orphans** — find unused exports, dead files/modules, unreachable branches, and stale assets. For each, judge whether it has a valid current/future use in the active architecture; **remove only when inappropriate** (truly dead/misleading). Do not delete code that is intentionally extensible or required by build/runtime contracts.
- **Duplication & reuse** — detect repeated logic, copy-pasted flows, and parallel implementations. Consolidate through shared helpers/modules only when behavior stays identical and tests cover the path. Prefer reuse, but avoid risky abstractions that couple unrelated concerns.
- **Independence & portability** — check that flows run independently where designed, avoid hidden machine-specific assumptions, and work across supported platforms/runtimes. Flag Windows-only paths/commands/shell assumptions when cross-platform support is claimed.
- **Multilingual/i18n** — verify locale handling, fallbacks, URL/prefix ownership, translated content paths, and that new text/flows do not hard-wire a single language.
- **Maturity lens (industrial)** — when requested, evaluate against **CMMI Level 5 Optimizing / enterprise platform maturity** criteria grounded in evidence from the codebase: repeatable gates, measurable quality/security, defect prevention, controlled change/rollback, automation, observability, traceability, governance, and continuous improvement. Report current level candidly with gaps and prioritized remediation.

Quality fixes must follow §2: baseline, smallest safe change, fix-until-green, no regressions. Never “fix” by weakening gates/tests except when a gate is provably wrong (document the reason).

## 4.2. Reuse before you write (code economy)

Every new helper is a new thing to read, test and keep in step. Search first:

- **Shared libraries:** `scripts/lib/*` (file walk, artifact, env, HTTP), `src/lib/*` (assets, inline styles, categories, URLs), `src/format.js` / `public/format.js` (escaping, money, bytes, dates), `src/i18n-registry.mjs` (locale list), `src/pages.js` (renderers), `public/i18n.js` (client strings), `src/notify.js` (outbox mail).
- **The pattern already exists in a sibling file.** A second implementation of escaping, money formatting, locale handling or a route renderer is how the duplication counters in `scripts/metrics.mjs` went up; read one sibling before writing the first line.
- **One implementation per concern.** If you find the same logic twice, consolidate it in the change you are already making — only when behaviour is identical and a test covers the path. Do not create a “shared” module for two unrelated call sites.
- **Short, not clever.** A helper earns its place by removing a repeated block. Prefer a 3-line function in the file that uses it over a new module plus an index; prefer an existing module over a new file. No new dependency for something `node:` or the existing dependencies already do.
- **Delete what your change orphans.** An export nothing imports, a file no route reads, a branch no input can reach: remove it in the same change, or state in the plan why it must stay (a build/runtime contract, intentional extensibility).
- **Say what you reused.** The change plan names the existing helper/module used instead of the new code written. A reviewer can then check the reuse instead of re-deriving it.

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
