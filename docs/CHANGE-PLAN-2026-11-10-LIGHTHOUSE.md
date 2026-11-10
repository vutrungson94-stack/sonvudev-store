# Change plan — 2026-11-10 — Lighthouse performance + asset integrity

## task

Close the actionable Lighthouse findings without reopening the stylesheet/CLS
incident: self-host fonts, defer the analytics beacon, content-version every
static asset in the build, and minify the two largest browser scripts.

## scope

| file | region |
| --- | --- |
| `public/styles.css` | `@font-face` block before `:root` |
| `public/fonts/*` | five woff2 files + OFL licences (new) |
| `public/*.html` | remove Google Fonts tags, add local font preloads |
| `src/pages.js` | product-page head, `analyticsMeta()`, asset URLs |
| `src/blog.js` | asset URLs for stylesheet and page scripts |
| `src/app.js` | CSP font/style hosts, immutable header for versioned files |
| `src/lib/assets.mjs` | manifest-aware `assetUrl()` (new) |
| `public/cf-beacon.js` | load Cloudflare beacon after `load` (new) |
| `scripts/minify-js.mjs` | esbuild minify of the artifact copies (new) |
| `scripts/build-web.mjs` | minify, content-hash manifest, HTML rewrite |
| `scripts/check-publish-output.mjs` | allow the two artifact-only minified files |
| `scripts/audit-web.mjs` | accept `i18n.min.js`/`app.min.js` references |
| `scripts/metrics.mjs` | same acceptance for the `localizedPages` metric |
| `WORKFLOW.md` | font/cache/minify invariants |
| `docs/CMMI-L5-ROADMAP.md` | staged L4→L5 plan (new) |
| `package.json` / lockfile | `esbuild` dev dependency |

## why

Lighthouse on production reported:

- Google Fonts CSS render-blocking: 2 requests, ~260 ms, plus a duplicate
  preload/stylesheet pair caused by a missing `crossorigin` match.
- Critical path 573 ms: HTML → Google Fonts CSS → woff2.
- `Cache-Control: public, max-age=31536000` on `/app.js` and `/styles.min.css`,
  while the homepage links them without any version. A deploy therefore cannot
  invalidate them.
- `/app.js` 45.9 KB raw / 15.1 KB brotli, and `i18n.js` 127.2 KB raw / 39.3 KB
  gzip, both unminified.

The build's cache-busting block rewrote `styles.css`, a file no page loads.

## invariants checked

- **Stylesheet loading:** every page keeps a direct
  `<link rel="stylesheet" href="/styles.min.css">`; no preload+defer CSS.
  Inline critical CSS was deliberately not introduced for the same reason.
- **Absolute URLs:** all asset links stay absolute (`/…`) so locale prefixes
  cannot turn them into `/de/styles.min.css`.
- **CSP:** self-hosted fonts need only `font-src 'self'`; the dynamically
  inserted beacon stays inside the existing `script-src`/`connect-src` hosts.
- **`display=optional`:** kept everywhere; the product page's `swap` is gone.
- **Metrics:** `localizedPages` still counts the dictionary on the same pages.
- **No self-certifying gate:** the manifest hashes bytes on disk.

## tests

- Existing: `npm run lint`, `npm run audit`, `npm run case`,
  `npm run workflow`, `npm test`, `npm run build`.
- Assertions that pin the stylesheet link (`styles-min.test.js`,
  `static-localized.test.js`) must stay green unchanged.
- New behaviour is exercised by `npm run build` + inspecting
  `publish-output/node/public/asset-manifest.json` and the rewritten HTML.

## risk

| wrong behaviour | detection |
| --- | --- |
| A page loses its blocking stylesheet | `npm run audit` (`missing stylesheet`) |
| Asset URL gains a locale prefix | `static-localized.test.js` |
| Beacon blocked by CSP | browser console + `/api/quality` still receives events |
| Hash rewrite misses a script | `npm run build` + grep the artifact HTML |
| Fonts 404 | `npm run build` required-file gate + live smoke |

## verified

| cmd | result |
| --- | --- |
| `npm run lint` | PASS — 181 JavaScript files |
| `npm run audit` | PASS — 33 nhóm, 0 vấn đề |
| `npm run case` | PASS — 313 tham chiếu / 192 file |
| `npm run workflow` | PASS — 3 workflow |
| `npm test` | PASS — 577 test / 76 file |
| `npm run metrics` | PASS (baseline updated: dependencies 6 → 7, vì thêm `esbuild`) |
| `npm run build` | PASS — 81 required files, 171 file đóng gói |
| `npm run check:publish-output` | PASS — 139 file khớp artifact |
| smoke server (artifact) | `/` → 200, không còn tham chiếu `fonts.google*`; `/styles.min.css?v=…` → `public, max-age=31536000, immutable`; `/fonts/dm-sans-latin.woff2?v=…` → 200 `font/woff2`; CSP `font-src 'self'`; beacon render thành `<script defer src="/cf-beacon.js?v=…">` |

### Số đo trước / sau

| Mục | Trước | Sau |
| --- | --- | --- |
| Font | `fonts.googleapis.com` (2 request, ~260 ms) + `fonts.gstatic.com` | `/fonts/*.woff2` (cùng origin) |
| Beacon | `<script type="module">` trong `<head>` | `public/cf-beacon.js`, tải sau `load` |
| `/app.js` | 45.662 byte, không minify | 26.970 byte (artifact) |
| `/i18n.js` | 118.087 byte, không minify | 109.479 byte (artifact) |
| Cache asset | `max-age=31536000`, không có gì để vô hiệu hoá | `max-age=31536000, immutable` + `?v=<hash nội dung>` |

### Đã cố ý không làm

- **Inline critical CSS + defer phần CSS còn lại**: `WORKFLOW.md §7.5` ghi rõ
  preload+defer từng gây CLS ~0.5. Muốn làm thì phải có critical CSS đầy đủ cho
  above-the-fold và Lighthouse CI đo CLS trước/sau.
- **Minify `admin.js`, `related.js`, …**: ngoài phạm vi Lighthouse đã báo.
- **Chia nhỏ từ điển i18n theo ngôn ngữ**: `i18n.js` phần lớn là dữ liệu, minify
  chỉ giảm 7%. Tách theo locale là thay đổi kiến trúc, để ở giai đoạn 2.
