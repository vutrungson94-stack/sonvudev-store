# Change plan — GSC canonical / duplicate / redirect fixes (2026-11-12)

rev: 1

task: "Chặn Google crawl các URL trùng (`/?buy=`, trailing slash) và chuẩn hoá canonical để xoá cảnh báo GSC 'Trang trùng lặp' / 'Trang có lệnh chuyển hướng'."

scope:
  - file: src/pages.js
    region: "renderIndexGrid buy <a> (~1446); product page buy <a> (~2105)"
  - file: src/blog.js
    region: "content CTA rewrite (~250-258) — add rel=nofollow on buy links"
  - file: src/app.js
    region: "new trailing-slash normalization middleware, registered before the page routes"
  - file: test/purchase-link-contract.test.js
    region: "assert nofollow on buy links"

why: |
  GSC báo "Trang trùng lặp — Google đã chọn một trang chính tắc khác" (bắt đầu 12/11/2026)
  và "Trang có lệnh chuyển hướng" (xác thực thất bại 13/10–17/10).

  Đã kiểm chứng trên site trực tiếp (sonvudev.com, 12/11/2026):
  - `/?buy=<id>` trả về **byte-identical** với `/` (md5 khớp) và được link 8 lần trên
    homepage, không có `rel="nofollow"` → Google crawl thành trang trùng.
  - Mọi trang có bản `/x/` trả 200, nội dung giống hệt `/x` (md5 khớp trên
    /product/pc-cleanup) → trùng lặp trailing slash.
  - `www.sonvudev.com/*` → 301 non-www (Cloudflare) → GSC "trang có lệnh chuyển hướng".
  - `/` với `Accept-Language: en-US` → 308 `/en/`, nhưng Googlebot **không** gửi
    Accept-Language (Google Search Central), nên redirect này không ảnh hưởng crawler.

invariants_checked:
  - "purchase links: /?buy=<id> stays the buy entrypoint; only rel=nofollow is added"
  - "routing: /en/ stays 200; /en gains a 308 to /en/; /x/ gains a 308 to /x"
  - "styles: no stylesheet change"
  - "metrics: no self-certifying gate added"
  - "merchant: Product/Offer schema untouched"

tests:
  existing: "npm test — 594 tests / 84 files (baseline, all green)"
  added:
    - "test/purchase-link-contract.test.js: assert rel=nofollow on buy links"
    - "test/trailing-slash.test.js: /x/ → 308 /x, /en → 308 /en/, /en/ stays 200"
  changed: "none (assertions extended, not weakened)"

risk:
  wrong_behavior: "buy links stop working, or a canonical page starts redirecting"
  detection: "npm test; live smoke /?buy=<id>, /product/pc-cleanup/, /en, /en/"

verified:
  - cmd: npm test
    result: "baseline PASS — 594 tests / 84 files"
  - cmd: npm run build
    result: "baseline PASS"
