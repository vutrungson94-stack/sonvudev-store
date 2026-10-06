# SonVuDev Store — Process Assets

This document captures the repeatable, measurable development process for this repository.
It is the "multi-team process asset" required for CMMI Level 5: a written process that
any team can pick up and run without tribal knowledge.

---

## 1. Quality Gates (Mandatory, Automated, In Order)

| Gate | Command | Purpose | Failure Action |
|------|---------|---------|----------------|
| Syntax | `node --check src/**/*.js public/**/*.js` | Catch parse errors before tests | Fix syntax, re-run |
| Audit | `npm run audit` | No hardcoded domains, broken links, orphan i18n keys, missing Vietnamese diacritics | Fix reported issues, re-run |
| Case Sensitivity | `npm run case` | All filesystem references match actual casing | Fix imports/paths, re-run |
| Metrics | `npm run metrics` | No metric regressed vs baseline | If intentional: `npm run metrics:update` |
| Tests | `npm test` | 424 tests pass (unit + integration + contract) | Fix failing tests, re-run |
| Lint | `npm run lint` | Code style, no unused vars, consistent patterns | Fix lint errors, re-run |
| Build | `npm run build` | Produce deployable artifact in `publish-output/` | Fix build errors, re-run |

**All gates must pass locally before push.** CI runs the same sequence.

---

## 2. Metrics Baseline — Quantitative Management

### Current Baseline (auto-generated)
- **Location**: `metrics-baseline.json`
- **Updated by**: `npm run metrics:update` (manual) or `npm run metrics:auto` (CI-safe)
- **Trends**: `npm run metrics:trends` — predictive causal analysis (linear regression on last 50 runs)

### Tracked Metrics (direction = regression if moving opposite)

| Metric | Direction | Threshold |
|--------|-----------|-----------|
| tests | up (must not fall) | ≥ baseline |
| testFiles | up | ≥ baseline |
| routes | up | ≥ baseline |
| dependencies | down (must not rise) | ≤ baseline |
| escCopies | down | ≤ baseline |
| moneyCopies | down | ≤ baseline |
| i18nKeys | up | ≥ baseline |
| indexablePages | up | ≥ baseline |
| productPageLocales | up | ≥ baseline |
| localizedPages | up | ≥ baseline |
| productPageRenderers | down | ≤ baseline |

### Auto-Update Rule (CMMI L5: Quantitative Management)
`npm run metrics:auto` updates baseline **only if all metrics improved or held**.
This enables continuous optimization without manual intervention while preventing silent regressions.

---

## 3. Defect Taxonomy & Root Cause Analysis

Every defect (test failure, audit finding, metric regression, production issue) is classified:

| Category | Examples | Root Cause Template |
|----------|----------|---------------------|
| **Regression** | Metric fell, test that passed now fails | What changed since last green? Which gate caught it? |
| **Omission** | Missing i18n key, untranslated page, missing test | Which checklist step was skipped? |
| **Duplication** | New escape helper, second money formatter | Why wasn't shared lib used? (grep before write) |
| **Configuration** | Wrong env var, missing secret, render.yaml drift | Which config gate failed? |
| **External** | API down, rate limit, TLS proxy intercept | Is fallback tested? Is retry logic in place? |
| **Process** | Gate bypassed, manual step forgotten | Which automation should have prevented this? |

**Root Cause Analysis (RCA) Required For:**
- Any production incident
- Any metric regression that reaches baseline
- Any audit finding that escapes CI
- Any test flakiness (run 3x to confirm)

RCA Template: `docs/rca/YYYY-MM-DD-short-description.md`

---

## 4. Branching & Integration

- **main** = deployable at all times (protected, requires CI green)
- **feature/*** = short-lived, rebased onto main daily
- **No long-lived release branches** — deploy from main via tag
- **Merge strategy**: Squash + merge (one commit per feature/PR)

---

## 5. Deployment Process

### Automated (CI/CD)
1. Push to main → GitHub Actions runs all quality gates
2. On success: `npm run render:sync:deploy` (syncs render.yaml, deploys)
3. Post-deploy: `npm run seo:check -- "${APP_URL}"` (health + SEO)
4. Notify on failure (webhook configured in `.github/workflows/checks.yml`)

### Manual (Emergency)
```bash
# Full deploy with verification
npm run render:sync:deploy
npm run seo:check -- "https://your-app.onrender.com"
npm run health:check
```

### Rollback
```bash
# Render: previous deploy in dashboard → "Rollback"
# Or: git revert <commit> && push main
```

---

## 6. Test Strategy (CMMI L5: Verification & Validation)

| Layer | Tool | Scope | Speed |
|-------|------|-------|-------|
| Unit | `node --test` | Pure functions, utils, formatters | <1s |
| Integration | `node --test` | API routes, DB, PayPal mock, R2 mock | 10-30s |
| Contract | `node --test` | render.yaml ↔ config.js, schema ↔ store.js | <5s |
| E2E (manual) | Browser | Full checkout flow, language toggle, admin | 5min |

**Test Isolation**: Each test file sets up its own DB state, no shared fixtures.
**Determinism**: No `Date.now()`, `Math.random()`, or external network in tests (mocked).

---

## 7. Internationalization (i18n) Process

1. **Add key**: Edit `public/i18n.js` (vi + en in same PR)
2. **Use key**: `data-i18n="key.path"` in HTML or `T('key.path', ...)` in JS
3. **Verify**: `npm run audit` catches orphan keys, missing translations
4. **Fill static text**: `npm run i18n:fill` (AI-assisted, cached, review required)
5. **Metrics**: `i18nKeys` and `localizedPages` tracked in baseline

---

## 8. Security & Compliance

- **Secrets**: Never in repo. `.env` gitignored. `.env.example` has placeholders only.
- **Supply Chain**: `npm audit` + gbuild security scan (secret scan, vuln scan, license check)
- **Dependencies**: Minimal (6 total). Audit before adding.
- **CORS**: `cloudflare/r2-cors.json` derived from `APP_URL`, not hand-written.
- **Rate Limiting**: Applied at API layer (checkout, lookup, reviews).

---

## 9. Observability

- **Request ID**: Every request gets `x-request-id` (propagated to logs, emails, DB)
- **Health**: `/api/health` probes DB, storage, mail, PayPal config
- **Metrics**: Build duration, test count, metric trends — exported to gbuild telemetry
- **Audit Trail**: Admin actions logged with request ID, stored in `order_events`

---

## 10. Continuous Process Improvement (CMMI L5: Optimizing)

### Monthly Review (Automated Prompts)
- `npm run metrics:trends` — any negative slopes?
- `git log --oneline --since="1 month ago" --grep="RCA"` — defect patterns?
- `npm audit` — new vulnerabilities?
- Build duration trend (gbuild telemetry)

### Quarterly Retrospective
1. Review top 3 defect categories → add prevention gate
2. Review metric trends → adjust thresholds or add metrics
3. Review process doc → update for new tools, team members, learnings

### Process Change Protocol
1. Propose change in PR with `process:` prefix
2. Must include: rationale, gate impact, rollback plan
3. Review by 1 other engineer
4. Merge → update this document

---

## 11. Quick Reference — Commands

```bash
# Full local quality gate (run before push)
npm run audit && npm run case && npm run metrics && npm test && npm run lint && npm run build

# Update metrics baseline (after intentional improvement)
npm run metrics:update

# Auto-update baseline (CI-safe, only if all metrics improved)
npm run metrics:auto

# Predictive trend analysis
npm run metrics:trends

# Deploy preview (dry run)
npm run render:sync

# Deploy production
npm run render:sync:deploy

# SEO + health check post-deploy
npm run seo:check -- "https://your-app.onrender.com"
npm run health:check
```

---

## 12. Environment Requirements

| Tool | Version | Location |
|------|---------|----------|
| Node.js | ≥20 | `G:\TRUNG SON\TOOLS\node-v20.19.5-win-x64` (portable) |
| npm | ≥10 | Bundled with Node |
| gbuild | Latest | `D:\_Build\gbuild.bat` |
| curl | With `--ssl-no-revoke` | System PATH (TLS proxy workaround) |

**TLS Proxy Note**: Corporate network intercepts TLS. Use `curl.exe --ssl-no-revoke` for external calls. Node.js requires `NODE_EXTRA_CA_CERTS` or same workaround.

---

## 13. Appendix: CMMI Level 5 Mapping

| CMMI L5 Practice | Implementation in This Repo |
|------------------|----------------------------|
| **Quantitative Management** | Metrics baseline + auto-update + trends |
| **Causal Analysis & Resolution** | Defect taxonomy + RCA template + trend alerts |
| **Organizational Process Performance** | `PROCESS.md` (this file) — reusable by any team |
| **Optimizing Processes** | Monthly review + quarterly retrospective + change protocol |
| **Defect Prevention** | Gates ordered by catch-cost (syntax → audit → metrics → tests) |

---

*This document is part of the repository. Changes follow the same PR + review process as code.*