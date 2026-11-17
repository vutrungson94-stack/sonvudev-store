# Change plan — one-click Cloudflare token rotation by email

## task
Replace the 90-day manual Cloudflare token roll with a signed email link: one
click, one POST confirmation, then the system creates a replacement token,
updates its consumers and revokes the old one.

## why
The current token expires `2027-02-15` and has already appeared in chat. A token
cannot renew itself; the existing `cf:token:check:30` only warns. The owner chose
"email, press confirm, done" as the zero-touch mechanism.

## scope
- `src/lib/cloudflare-rotation.mjs` (new) — HMAC link build/verify, Cloudflare
  token read/create/delete, Render env update + deploy, Resend mail, orchestration.
- `src/app.js` — two routes: `GET /api/rotation/confirm` (shows a POST form so
  mail-client link scanners cannot trigger a rotation) and `POST /api/rotation/execute`.
- `scripts/cf-token-remind.mjs` (new) — monthly CLI that emails the signed link.
- `.github/workflows/cf-token-reminder.yml` (new) — cron on the 1st.
- `checks.yml`, `metrics-trends.yml` — read the current Cloudflare token from
  Render at runtime instead of a GitHub Secret, so rotation has one source of
  truth and no GitHub PAT with secret-write scope is needed.
- `package.json`, `test/cloudflare-rotation.test.js`, `docs/RUNBOOK.md`,
  `docs/PROCESS-SLO.md` — script, tests, operator instructions, SLO note.

Reused: `tooManyAttempts` from `src/rate-limit.js` (10 requests / 15 min / IP),
`crypto` (already a Node built-in used in `src/app.js`), the Resend + Render API
patterns from `scripts/rotate-admin-token.mjs`, `esc` from `src/format.js`.

## invariants_checked
- No `unsafe-inline`; the confirmation page has no inline script.
- No route/locale/catalogue/payment change. `n/a (no catalog change)`.
- Every new test file imports `./helpers/env.mjs` first.
- No secret is ever written to source, logs or the browser; the mail contains
  only a signed short-lived link, never a token value.
- Edge cache: HTML pages stay `max-age=300`; the two new routes are API paths and
  are excluded from the edge cache rule (`/api/`).

## tests
- added `test/cloudflare-rotation.test.js`: signature round-trip, tampered/expired
  links, policy sanitisation, next-expiry calculation, and a mocked full rotation
  that verifies the order (read → create → verify → Render env → deploy → mail →
  delete old) and rollback (new token deleted, old left intact) on failure.
- existing: `npm run workflow`, `npm test`, `npm run audit`, `npm run build`.

## risk
A bad HMAC key or an exposed mail would let someone rotate the token — mitigated
by a 72-hour expiry, token-id binding, a POST step, and per-IP throttling. If the
Render update fails after a new token is created, the new token is deleted and
the old one is untouched. If only the final revoke fails, both tokens work and
the operator gets a mail naming the stale token id to revoke by hand.

## verified (pending)
Gates will be recorded after implementation; live rotation cannot be exercised
until `CLOUDFLARE_MASTER_TOKEN` and `ROTATION_SIGNING_KEY` exist in Render env.
