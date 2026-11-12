# Change plan — Lighthouse: deploy artifact đã minify + manifest off critical path

rev: 1

task: "Khiến Lighthouse hết báo 'Minify JavaScript' (17 KiB) và 'Network dependency tree' (781 ms) bằng cách deploy artifact đã minify và defer manifest."

scope:
  - file: render.yaml
    region: "buildCommand + startCommand"
  - file: src/pages.js
    region: "ICON_LINKS (~356-366) — bỏ manifest khỏi <head>"
  - file: public/quality.js
    region: "thêm injection manifest sau khi trang tải"
  - file: scripts/seo-check.mjs
    region: "thêm mục 4d: JS live phải là bản minify"
  - file: WORKFLOW.md
    region: "§7.5 no-regress + §6 verify"

why: |
  Lighthouse (DevTools) báo ba thứ:
  1. "Minify JavaScript — Est savings 17 KiB": /app.js 15,1 KiB, /i18n.js 39,1 KiB
     chưa minify. Đo trên site: live phục vụ app.js 45.939 B và i18n.js 127.210 B
     (bản nguồn), trong khi artifact chứa 26.971 B và 109.492 B.
     Nguyên nhân: render.yaml chạy `npm ci --omit=dev` rồi `npm start`, không
     chạy `npm run build`; server phục vụ `public/` nguồn.
  2. "Network dependency tree — Maximum critical path latency 781 ms": chuỗi
     HTML (297 ms) → /site.webmanifest (781 ms). Manifest nằm trong <head> nên
     bị coi là critical request.
  3. "Reduce unused JavaScript — 443 KiB": URL là
     chrome-extension://aapbdbdomjkkjkaonfhkkikfgjllcleb/bubble_compiled.js —
     extension Google Translate của trình duyệt, không phải code site. Gate
     lighthouse-check.mjs đã chạy --disable-extensions nên không phải sửa code.

invariants_checked:
  - "build: artifact được build và deploy, không phải working tree"
  - "csp: manifest injection qua script ngoài (quality.js), không thêm inline script"
  - "routing: /site.webmanifest vẫn 200"
  - "seo: canonical/sitemap không đổi"

tests:
  existing: "npm test 601/85 (baseline xanh)"
  added:
    - "seo-check.mjs: 2 ca JS live phải minify"
    - "test/pwa-and-fonts.test.js: manifest vẫn có mặt (qua injection)"
  changed: "none"

risk:
  wrong_behavior: "manifest không còn được phát hiện → PWA install prompt mất"
  detection: "npm test; live: /site.webmanifest 200 và có <link rel=manifest> sau JS chạy"

verified:
  - cmd: npm test
    result: "baseline PASS — 601 tests / 85 files"
  - cmd: npm run build
    result: "baseline PASS"
