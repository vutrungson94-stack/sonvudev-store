# Owner checklist — SonVuDev (sonvudev.com)

One-time setup after GA4 is live. All items are owner actions; no code change is needed.

## 1. Google Analytics 4 (GA4)

- [ ] **Property created** with measurement ID `G-...` set as `GA_MEASUREMENT_ID` / `GA4_MEASUREMENT_ID` in hosting env (Render).
- [ ] **GA4 ↔ Search Console linked** (GA4 Admin → Product links → Search Console links).
- [ ] **Data collection / Google signals** toggled on if GA4 warns it is still off.
- [ ] **Conversions marked** in GA4 Admin → Events → Mark as conversion, for the funnel events the site already sends (no PII):
  - `view_item` — product detail opened.
  - `begin_checkout` — purchase form opened.
  - `add_payment_info` — checkout submitted (with `payment_type`).
  - `purchase` — order marked paid (transaction id, currency, value, item).
- [ ] Verify in **GA4 Realtime / DebugView** that `first_visit`, `page_view`, `session_start`, `search` appear when browsing `sonvudev.com` (adblock/proxy may block the beacon — that is expected, not a defect).

## 2. Google Search Console (GSC)

- [ ] Property added and verified (URL prefix `https://sonvudev.com`, plus domain property if preferred).
- [ ] Sitemap submitted: `https://sonvudev.com/sitemap.xml` (server-rendered).
- [ ] Merchant Center listing enhancements checked — `Product`/`Offer` with `hasMerchantReturnPolicy` + `shippingDetails` already rendered on product pages; no `AggregateRating`/`reviewCount` (self-collected stars are forbidden).
- [ ] Review queries/CTR after 2–4 weeks; adjust page titles/meta/headings based on real query data (do not guess keywords).

## 3. Bing Webmaster Tools

- [ ] Site submitted and verified (same ownership as GSC).
- [ ] Sitemap submitted: `https://sonvudev.com/sitemap.xml`.

## 4. Google Merchant Center (GMC)

- [ ] Feed connected (already handled in P0; keep `Product`/`Offer` return/shipping fields intact).
- [ ] No fake urgency/scarcity or self-collected `AggregateRating` markup anywhere.

## 5. Uptime / alerting (free tier is enough)

- [ ] HTTP monitor for `https://sonvudev.com` (homepage returns 200).
- [ ] HTTP monitor for `https://sonvudev.com/api/health` (returns `{"commit": "<sha>"}`).
- [ ] Alert channel: email / Telegram / Slack, so you are told before buyers are.
- [ ] When a deploy lands, verify `/api/health` reports the new commit (CI already waits for this, but an independent monitor is safer).

## 6. Core Web Vitals / quality monitoring (P3)

- [ ] `public/quality.js` already sends LCP/CLS/TTFB/FID/INP + JS error count to `POST /api/quality` (same origin, no PII) on production-like hosts only.
- [ ] Read the beacon log with: `npm run quality:report` (prints count, avg/p75/max per metric and top paths).
- [ ] If Lighthouse on a real device still flags render-blocking or contrast, reopen a task — do not guess.

## 7. Do NOT do

- [ ] Do not add fake `AggregateRating` / star counts / review counts (explicitly forbidden; review test blocks it).
- [ ] Do not add urgency/scarcity copy ("only X left", countdown fabricated).
- [ ] Do not change `/?buy=<id>` purchase flow or make discovery links point to checkout (see `docs/PURCHASE-LINK-RULES.md`).
- [ ] Do not hard-code `sonvudev.com` or `localhost` into HTML/JS — use `{{site}}`, `process.env.APP_URL`, or the audit's own-host rule.

## How to read results

- GA4: Realtime → events; Conversions → purchase/begin_checkout.
- GSC: Performance → queries, pages, CTR.
- Quality beacons: `npm run quality:report` against the server log containing `[quality]` lines.
