# Change plan — 2026-11-20 GMC invalid returnMethod

```yaml
rev: 1
task: "Make MerchantReturnPolicy.returnMethod a Google-supported value so GMC enrichment and GSC rich-result validation can pass"

scope:
  - file: src/pages.js
    region: "merchantReturnPolicy() — returnMethod branch and its comment; productOffer() comment"
  - file: AGENTS.md
    region: "§4 merchant listing invariant — replace the ReturnDownload rule with the documented reason"
  - file: docs/MERCHANT-CENTER-MISREPRESENTATION-REMEDIATION.md
    region: "§1 merchant listing bullet — returnMethod value"
  - file: docs/ADR/0003-merchant-schema-without-ratings.md
    region: "one-line 2026-11-20 re-confirmation note (the ADR already had the correct value)"
  - file: test/purchase-link-contract.test.js
    region: "returnMethod assertion — changed ONLY after the production fix makes it fail"
  - file: docs/rca/2026-11-20-gmc-return-method.md
    region: "new — root cause of the invalid returnMethod warning and the failed validation"

why: |
  Google Search Console reported "Cải thiện giao diện của mục" — 7 items with
  "'returnMethod' không hợp lệ nằm trong 'offers.hasMerchantReturnPolicy'" —
  and "Không thể tiếp tục quy trình xác thực" for three product URLs
  (/product/dotnet-sdk-portable-updater, /product/excel-trusted-locations-setup,
  /product/spark-capacity-tester-pro).

  The repo emits https://schema.org/ReturnDownload for every digital product.
  Google's own documentation for both Merchant listing and MerchantReturnPolicy
  lists exactly three supported values: ReturnAtKiosk, ReturnByMail, ReturnInStore.
  ReturnDownload is not among them, so the value is invalid even though it is a
  real schema.org term. AGENTS.md §4 and a contract test codified the wrong value
  after an earlier fix for a *missing* returnMethod; ADR 0003 had it right from
  the start. No threshold or gate is weakened — the wrong value is replaced with
  the value Google accepts and the documentation that caused the mistake is
  corrected in the same change.

  Out of scope (owner / third party, not in this repo):
  - Chrome DevTools "StorageType.persistent is deprecated" comes from Cloudflare's
    /cdn-cgi/challenge-platform script, not from any first-party file (grep found
    no StorageType/navigator.storage in src/, public/ or scripts/). It only affects
    a challenge issued by Cloudflare's bot/WAF configuration; the owner must check
    Bot Fight / WAF rules in the Cloudflare dashboard if the challenge is unwanted.
  - Re-running GSC validation after deploy is an owner action in Search Console.

invariants_checked:
  policy: "still publishes a 14-day free-return policy under VN jurisdiction — consistent with /refund"
  schema: "returnMethod is one of Google's three supported values; no AggregateRating introduced"
  tests: "no passing test changed until it fails against the production fix; then the reason is recorded"
  scope: "no change to secrets, workflows, deploy config, or Cloudflare settings"

tests:
  existing: "baseline: 703/703 green before this change"
  added:
    - "test/purchase-link-contract.test.js is strengthened to assert a Google-supported value (ReturnByMail) and that ReturnDownload is absent"
  changed:
    - "one assertion + its comment in test/purchase-link-contract.test.js — changed only after demonstrating it fails with the fixed src/pages.js and no test edit"
  negative_control: "run the focused test BEFORE the test edit: it must fail with actual ReturnByMail vs expected ReturnDownload"

risk:
  wrong_behavior: "a value Google rejects stays on product pages; or a test is edited to hide a real regression"
  detection: "focused red first, then npm test 703+/703, audit/case/lint/workflow/metrics, _Tests, gsync dry-run"

verified:
  - cmd: node --test test/purchase-link-contract.test.js (with production fix, before test edit)
    result: "FAIL as required — actual 'https://schema.org/ReturnByMail' vs expected 'https://schema.org/ReturnDownload', exit 1. Proves the old assertion codified a value Google rejects; production was right."
  - cmd: node --test test/purchase-link-contract.test.js (after the test edit)
    result: "PASS 4/4 — asserts ReturnByMail and explicitly forbids ReturnDownload"
  - cmd: npm run lint / audit / case / workflow / metrics / test / coverage / build
    result: "PASS all exit 0 — 232 JS files, no hardcoded domain/route/i18n gap, 422 refs in 246 files, 6 workflows, no metric regressed, 703/703 tests, 103 files"
  - cmd: _Tests/gtest.ps1 -Project <repo> -NonInteractive
    result: "PASS exit 0 — 703/703, report gtest-SonVuDev-Upload-20261120-101210-337.json"
  - cmd: _Sync/gsync.ps1 -Project <repo> -DryRun
    result: "PASS exit 0 — 0 ahead/0 behind, no commit, no working-tree changes"
  - cmd: _Build/gbuild.ps1 -Project <repo> -NonInteractive
    result: "NOT RE-RUN in this revision; pre-existing failure documented in CHANGE-PLAN-2026-11-20-SLO-PARTIAL.md (fly.toml heuristic), untouched by this change"
verified_notes: "This plan is written before edits. If a file outside scope is needed, stop and write rev 2 first."
```

Revisions: rev 1 — initial plan.
