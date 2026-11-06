# Change plan — required before any edit

Fill this in and include it in your analysis notes (or paste it into the
commit message trailer) before running the implementation phase.

```yaml
# Copy this file, rename it, fill it in. Delete it or commit it to docs/.

# One sentence, imperative.
task: "Fix X so that Y works again"

# Files you expect to touch. If you touch a file not listed here, stop and re-plan.
scope:
  - file: src/app.js
    region: "the ?buy= handler around the deep-link check"
  - file: public/app.js
    region: "the wanted/checkout branch"
  - file: src/blog.js
    region: "buyHref helper + related link"

# The actual failing behavior, with a log line or repro, not a guess.
why: |
  Clicking "Mua ngay" on a server-rendered product page linked to /?buy=<id> and
  opened the product *detail* modal instead of checkout, so buyers hit a dead
  end. Blog post CTAs around /product/<slug> had the same problem.

# Which invariants from AGENTS.md this change must preserve, and how.
invariants_checked:
  routing: "/?buy= deep-link stays a 200 on / and /de/, no redirect introduced"
  i18n: "URL prefix wins in boot(), no rewrite of localized URLs"
  styles: "styles.css referenced absolute, not relative"
  metrics: "no self-certifying gate added"

# Tests that already cover the touched behavior / tests that were added / any
# test changed, and exactly why changing it is correct.
tests:
  existing: "npm test — all green (see baseline log)"
  added:
    - "test/... to prove X"
  changed: "none"

# What breaks if this is wrong, and how you find out fast.
risk:
  wrong_behavior: "buyer lands on checkout for a product they cannot buy"
  detection: "npm test order-status/static-localized; live smoke via /?buy=<id> and blog CTA links of a known product"

# The exact verification steps you ran, with pass/fail and numbers.
verified:
  - cmd: npm test
    result: "PASS — N tests, 73 files (or previous count)"
  - cmd: _Build/gbuild.ps1
    result: "PASS"
  - cmd: npm run seo:check -- https://sonvudev.com
    result: "PASS 199/199"
```

Revisions: every time a plan is written, append `rev: N` and a one-line summary of what changed vs the previous revision.
