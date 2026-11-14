# RCA: GMC "Trình bày sai" 8/8 sản phẩm, chặn xác minh doanh nghiệp

- **Ngày:** 2026-11-14
- **Loại:** compliance-escape / live-drift
- **Mức:** high
- **Owner:** chủ sở hữu repo
- **Postmortem:** `postmortems/2026-11-14-gmc-misrepresentation.json`

## Hiện tượng

Google Merchant Center ngày 14/11/2026:

- "Trình bày sai" (answer/6150127): **8/8 sản phẩm (100%)**, 28 ngày kể từ lần vi phạm gần nhất; 5 sản phẩm hiển thị trong danh sách: PC Cleanup v1.0.0, .NET SDK Portable Updater v1.0.0, RAMCleaner Business v2.0.0, Excel Trusted Locations Setup v4.4, MouseWheel for VBA v1.0.0.
- "Không thể tiếp tục quy trình xác thực": 3 URL bị ảnh hưởng — `https://sonvudev.com/product/pc-cleanup`, `/product/mousewheel-vba`, `/product/ramcleaner-business`.
- "Cải thiện giao diện của mục" (không phải lỗi): thiếu `aggregateRating`/`review` (6 mục) và thiếu `deliveryTime` trong `offers.shippingDetails` (6 mục).

## Nguyên nhân gốc

Ba lớp, cùng một gốc là **repo và live tách phát triển, và không gate nào bắt được khoảng lệch**:

1. **Live catalogue lệch repo (Supabase).** Remediation doc tuyên bố claim Early Bird đã được làm sạch trong `data/products.json` — đúng, nhưng production đọc Supabase. `GET /api/products` (live, 14/11) vẫn trả `shortDescription: "Ưu đãi sớm - chỉ 199.000đ (giảm 33%) cho 100 khách đầu tiên"`, `badge: "Ưu đãi sớm"`, Excel `badge: "Safe Edition v4.3"` (version 4.4). Bước đồng bộ `npm run ops:catalog:apply` chưa từng được chạy sau khi repo được làm sạch. Gate test chỉ quét `public/locales/*.json` nên xanh trong khi live vi phạm.
2. **Checkout thiếu minh bạch giá.** `openCheckout` (public/app.js) yêu cầu họ tên + email và chọn phương thức thanh toán mà **không hiển thị giá**, quy đổi PayPal VND→USD, cách nhận sản phẩm số hay cửa sổ hoàn tiền — vi phạm "Giá và điều kiện giao dịch không trung thực" (phải công bố tổng giá và mô hình thanh toán trước khi cam kết).
3. **Danh tính doanh nghiệp yếu/lệch.** `BRAND_LEGAL_ENTITY` rỗng trong env; live dùng Gmail (`vutrungson94@gmail.com`) trong Organization schema và contact/FAQ trong khi repo `.env` để `hello@sonvudev.com`; trang About nói "Không công ty"; Google Business Profile chưa có. Xác minh doanh nghiệp (answer/17123828) đòi giấy tờ khớp tên pháp lý + địa chỉ — lệch là tự động từ chối.

**Vì sao gates không bắt được:** `npm test`/audit/case/lint/build đều đo trên repo tĩnh. Không có gate nào (a) quét claim trong product data/blog, (b) đối chiếu repo ↔ live catalogue, (c) yêu cầu checkout hiển thị giá, (d) kiểm tra tính nhất quán danh tính giữa env/schema/contact/GMC. Process có RCA/postmortem template nhưng chưa có postmortem nào; metric "defect escape" vẫn là `unknown`/proxy, SLO 5/7 chỉ số `unknown` — nghĩa là hệ thống đo không có kênh đo rủi ro compliance/uy tín.

## Hành động khắc phục

- Catalog: dọn claim ở `data/products.json` (PC Cleanup, MouseWheel, Early Bird, Personal), điền lại tiếng Việt cho 3 sản phẩm; badge Excel clear qua sync; `src/store.js` seed; `src/blog-posts/ramcleaner-earlybird.json` (mọi locale).
- Checkout (`public/app.js:525`): hiển thị tên/giá/currency, quy đổi PayPal, cách nhận số và hoàn tiền 14 ngày trước nút thanh toán; CSS `.checkout-price`/`.cart-terms`; i18n vi+en + de/es/fr/ja/zh-CN.
- Structured data (`src/pages.js`): một Offer duy nhất (bỏ offers khỏi SoftwareApplication); `deliveryTime` 0 ngày trong `offers.shippingDetails` với `shippingRate` 0 VND.
- Tests: `test/merchant-policy.test.js` (quét products.json/store seed/blog/vi locale + test checkout giá + locale parity), `test/purchase-link-contract.test.js` (một Offer; shippingDetails có deliveryTime), `test/seo.test.js`/`test/ai-discovery.test.js` (đọc Offer từ node Product).
- Identity: `BRAND_LEGAL_ENTITY=Vũ Trung Sơn` (về local .env — owner phải đặt trên Render), about/contact copy "Doanh nghiệp cá nhân"/"A sole-proprietor business".
- Governance: `WORKFLOW.md §7.6` (repo↔live parity là bước bắt buộc sau mọi thay đổi product data), `AGENTS.md §4` (2 invariant mới), `WORKFLOW.md §7.5`.

## Phòng ngừa

- `test/merchant-policy.test.js`: `catalogue (products.json)`, `seed catalogue`, `blog posts` — gate chạy trên dữ liệu thật của cửa hàng, không chỉ locale.
- `test/merchant-policy.test.js`: `checkout hiển thị giá, quy đổi PayPal, cách nhận và hoàn tiền trước khi trả` — khoá hành vi mua.
- `test/purchase-link-contract.test.js`: khoá một Offer + deliveryTime.
- `WORKFLOW.md §7.6`: mọi thay đổi product data/copy kết thúc bằng `npm run ops:catalog:apply` + Verify `GET /api/products`, trang sản phẩm và `/merchant-feed.tsv` — repo xanh + live stale được tính là đỏ.
- Postmortem → defect prevention: owner cập nhật `metrics-postmortem.json` sau khi verification chạy lại, và đưa trạng thái GMC/GSC vào monthly review.

## Bài học

**"Repo xanh" không bảo đảm "cửa hàng xanh".** Mọi gate đo file tĩnh đều mượn một phần sự thật từ production. Với dữ liệu runtime (Supabase) và compliance bên ngoài (GMC/GSC), phải có một phép đo trực tiếp trên live hoặc không đo được thì nói thẳng là `unknown`. Mọi remediation chỉ đóng khi verification lại xanh — không đóng vì code đã merge.
