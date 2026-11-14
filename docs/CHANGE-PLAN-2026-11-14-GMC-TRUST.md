# Change plan — 2026-11-14 — GMC "Trình bày sai": catalog, identity, checkout, schema

rev: 1

task: "Sửa catalog/repo/live, danh tính doanh nghiệp, checkout và structured data để GMC không còn căn cứ gắn 'Trình bày sai', và thêm gate chống hồi quy."

scope:
  - file: data/products.json
    region: "toàn bộ: làm sạch claim khuyến mãi/scarcity/tự tống cổ; điền đúng vi cho các sản phẩm; badge rỗng"
  - file: src/store.js
    region: "seedProducts: earlybird badge/copy; giữ seed khớp nguồn"
  - file: src/blog-posts/ramcleaner-earlybird.json
    region: "title/description/content các locale: bỏ 'giá ưu tiên giới hạn', 'limited offer'"
  - file: public/app.js
    region: "openCheckout(): thêm khối giá/tổng/cách nhận/hoàn tiền trước khi submit"
  - file: public/i18n.js
    region: "cart.* vi+en cho khối giá"
  - file: src/pages.js
    region: "productSchema: bỏ offers trùng; digitalShippingDetails: thêm deliveryTime; giữ một Offer duy nhất"
  - file: test/purchase-link-contract.test.js
    region: "schema digital: bổ sung deliveryTime; khóa một Offer duy nhất"
  - file: test/seo.test.js
    region: "đọc Offer từ node Product (không còn SoftwareApplication.offers)"
  - file: test/merchant-policy.test.js
    region: "mở rộng quét claim sang products.json/store seed/blog; thêm test checkout giá"
  - file: .env
    region: "BRAND_LEGAL_ENTITY; thống nhất email (không commit)"
  - file: docs/MERCHANT-CENTER-MISREPRESENTATION-REMEDIATION.md
    region: "cập nhật hiện trạng live↔repo và hành động đã làm"
  - file: docs/QUALITY-L4-L5-BACKLOG.md
    region: "đánh dấu mục GMC đã xử lý"
  - file: postmortems/2026-11-14-gmc-misrepresentation.json
    region: "mới"
  - file: docs/rca/2026-11-14-gmc-misrepresentation.md
    region: "mới"
  - file: AGENTS.md / WORKFLOW.md
    region: "invariant mới: checkout phải thấy giá; không claim khuyến mãi ở product data"

why: |
  GMC: "Trình bày sai" 8/8 sản phẩm (100%), chặn xác minh ở 3 landing page
  (pc-cleanup, mousewheel-vba, ramcleaner-business). Bằng chứng live:
  /api/products trả earlybird shortDescription "Ưu đãi sớm - chỉ 199.000đ (giảm 33%)
  cho 100 khách đầu tiên", badge "Ưu đãi sớm"; excel badge "Safe Edition v4.3" khi
  version 4.4 — repo đã sạch nhưng live Supabase chưa từng được sync. openCheckout
  (public/app.js:525) không hiện giá/tổng. Product JSON-LD trùng Offer với
  SoftwareApplication và thiếu deliveryTime (GMC "Cải thiện giao diện": 6 mục).

invariants_checked:
  - routing: "không đổi route; /?buy= giữ nguyên"
  - i18n: "product.copy/locale giữ nguyên cấu trúc; thêm key vi+en cùng lượt"
  - styles: "không đụng CSS"
  - merchant_policy: "không thêm AggregateRating/review tự thu thập; giá vẫn là giá niêm yết VND"
  - metrics: "không thêm metric tự chứng nhận; gate mới phải đo được"
  - checkout: "vẫn chỉ thu họ tên + email; không thu thêm dữ liệu nhạy cảm"

tests:
  existing: "npm test — 623 pass / 0 fail / 89 file; audit 33 nhóm; case 371 ref"
  added:
    - "test/merchant-policy.test.js: quét claim ở data/products.json, src/store.js seed, src/blog-posts, vi locale"
    - "test/merchant-policy.test.js: checkout phải hiện giá/tổng/cách nhận/hoàn tiền"
    - "test/purchase-link-contract.test.js: một Offer duy nhất; digital có deliveryTime"
  changed:
    - "test/seo.test.js: đọc Offer từ Product (SoftwareApplication.offers bị bỏ có chủ đích)"

risk:
  wrong_behavior: "live catalog bị ghi đè bởi bản sync sai; JSON-LD hỏng; vi copy bị thay bằng EN"
  detection: "npm test + npm run audit; sync dry-run trước; đối chiếu GET /api/products sau apply; đọc lại trang sản phẩm live"

verified:
  - cmd: "npm run lint; npm run audit; npm run case; npm run workflow"
    result: "PASS — 199 JS files; audit 33 nhóm 0 vấn đề; case 371 ref; workflow 3 files"
  - cmd: "npm test"
    result: "PASS — 627 tests, 89 files (623 baseline + 4 mới)"
  - cmd: "npm run metrics; npm run build"
    result: "PASS — metrics không lùi; build PASS 83 required files; provenance PASS"
  - cmd: "_Tests/gtest.ps1 + _Build/gbuild.ps1"
    result: "xem commit log"
