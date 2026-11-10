# Quality / L4–L5 backlog (evidence-based)

Đánh giá dựa trên **codebase + gate/test/build hiện tại**, không dựa vào tuyên bố trong MD. Mục tiêu: từng bước từ **L3 cao / tiệm cận L4** lên **L4**, tạo nền cho **L5 (Optimizing, mức tổ chức)**.

> Lộ trình nâng cấp chi tiết theo giai đoạn (kèm tiêu chí nghiệm thu đo được) nằm ở
> [`CMMI-L5-ROADMAP.md`](CMMI-L5-ROADMAP.md). File này giữ danh sách việc cụ thể;
> file kia giữ mức trưởng thành và thứ tự nâng cấp.

## Đã hoàn thành (đợt này)
- [x] **GSC merchant listings**: bổ sung `applicableCountry` + `returnMethod` trong `MerchantReturnPolicy` và `shippingDetails` (`OfferShippingDetails`, phí 0 cho sản phẩm số) cho `Product`/`Offer`; có contract test. Giữ nguyên quyết định **không** phát `AggregateRating`/sao (self-collected không đủ điều kiện rich result, test `review.test.js` chặn).
- [x] Phân biệt **CTA mua** (`/?buy=<PRODUCT_ID>` + `openPurchaseForm`) vs **khám phá/liên quan** (trang sản phẩm locale). Sửa blog “Sản phẩm liên quan” → trang sản phẩm.
- [x] Chuẩn hóa rewrite `/product/<slug>` trong nội dung blog: mặc định discovery → trang sản phẩm; CTA mua rõ ràng (`data-buy`/`data-purchase`/class buy/purchase/checkout, hoặc text mua rõ ràng) → checkout.
- [x] Contract tests: store grid, trang sản phẩm SSR (nút mua chính + sản phẩm khác), blog related + blog body intent.
- [x] Cập nhật `AGENTS.md §4.1`, `WORKFLOW.md`, `docs/PURCHASE-LINK-RULES.md`.
- [x] Gates xanh: lint/case/workflow/audit, `npm test` (568/74), `_Tests/gtest.ps1`, `_Build/gbuild.ps1`, `_Sync`.

## GSC / Merchant Center theo dõi
- **“Đã thu thập dữ liệu – hiện chưa được lập chỉ mục” (Crawled – currently not indexed), 0 trang bị ảnh hưởng**: không phải lỗi code; là tín hiệu Google đã crawl nhưng chưa chọn index. Theo dõi thêm trong GSC; nếu số trang tăng, kiểm tra canonical/noindex/nội dung mỏng/trùng lặp và internal links. Không “sửa” bằng cách thêm trang mỏng hoặc gỡ noindex sai.
- **“Cải thiện giao diện mục”**: `aggregateRating`/`review` là **tùy chọn**; codebase chủ động không phát star rating. Chỉ xem lại nếu có nguồn review đủ điều kiện và quyết định sản phẩm mới.
- **Merchant Center “Trình bày sai” / “Các phương thức kinh doanh không được chấp nhận”**: xem `docs/MERCHANT-CENTER-MISREPRESENTATION-REMEDIATION.md`. Codebase đã gỡ hardcode địa chỉ/điện thoại schema/about và làm trung thực dữ liệu sản phẩm mẫu; **chủ sở hữu phải** cấu hình thông tin doanh nghiệp thật (GMC + env/website), đảm bảo giá/phí/policy/fulfillment khớp, rồi mới kháng nghị.

## P1 (tiếp theo, kỹ thuật)
- [ ] Contract test cho mọi locale route mua/khám phá trên `/product/:slug` và `/en/*`/`/<lang>/*` (khi có fixture đủ nhẹ). Khóa hành vi `?buy` handler client khi product không load kịp / không tồn tại (toast/fallback an toàn, không form sai).
- [ ] Audit nội dung blog mới: CTA mua phải dùng `data-buy`/`btn-buy`; PR/review checklist.
- [ ] Kiểm tra `public/related.js` (client fallback “other products”) dùng link mua hay discovery — phải khớp invariant discovery.

## P2 (governance / rủi ro)
- [ ] **Permissions-Policy warnings** (`attribution-reporting`, `private-aggregation`, `join-ad-interest-group`, `run-ad-auction`, `browsing-topics`): app chỉ set policy tối thiểu; kiểm tra **Cloudflare/edge Transform Rules/Response Headers**. Chỉ sửa app nếu chủ đích chính sách thay đổi.
- [x] **`ERR_BLOCKED_BY_CLIENT` cho `cloudflareinsights.com` beacon**: *đã xử lý 2026-11-10 — **bỏ hẳn beacon**.* Nó là 10 KB JavaScript bên thứ ba có polyfill `Array.prototype.at/findLast/includes` (Lighthouse: "Legacy JavaScript") và cache TTL 1 ngày ("Use efficient cache lifetimes"). RUM của chính shop (`public/quality.js` → `/api/quality`, `navigator.sendBeacon`) đếm lượt xem trên **cùng origin**, chống được proxy/VPN và trình chặn tracker. Muốn đưa lại: thêm tag vào `analyticsMeta()` (`src/pages.js`) + mở lại `static.cloudflareinsights.com` trong CSP (`src/app.js`) + `CF_WEB_ANALYTICS_TOKEN` trong env. Giá: hai cảnh báo Lighthouse quay lại.
- [x] **Cả hai script analytics tải sau sự kiện `load`**: `public/ga.js` (GA4) được khởi động sau `load` nên không còn tranh chấp với lần vẽ đầu tiên và không bị hủy khi khách rời trang sớm (nguyên nhân phổ biến nhất của mã **499** — "client đã đóng request"). Có test khoá hành vi (`test/analytics-defer.test.js`).
- [x] **`499` từ `www.googletagmanager.com/gtag/js`**: 499 là mã "client đã đóng request" (nginx/Cloudflare dùng mã này khi trình duyệt ngắt kết nối). Nguyên nhân: request analytics được phát **trong lúc trang còn đang tải**, nên khi khách bấm sang trang khác trước khi script tải xong thì request bị hủy và hiện thành dòng đỏ trong Network. Đã sửa bằng cách khởi động GA4 sau `load`; có test khoá hành vi (`test/analytics-defer.test.js`). Nếu vẫn thấy 499 do trình chặn tracker của trình duyệt thì đó là chủ ý của trình chặn, không phải lỗi.
- [ ] **Hardcode governance**: tập trung endpoint/CSP allowlist/brand defaults vào config có schema/contract test; giữ hardcode không thể dynamic an toàn. Thêm gate phát hiện secret-like/domain bypass mới khi có thiết kế rõ.
- [ ] **Orphan/dead-code (evidence-based)**: trước khi xóa, cần 3 tín hiệu — không có import/runtime path, không có contract build/test/public asset, có xác nhận owner. Ứng viên cần rà soát thêm (không xóa trong đợt này): log/build-report artifacts ngoài gitignore, script ít dùng, nhánh tương thích cũ. *Không có orphan “chắc chắn chết” được xác nhận an toàn ở đợt hiện tại.*

## P3 (L4/L5, tổ chức/quy trình)
- [ ] **Đa nền tảng toolchain**: `_Build/_Tests/_Sync` thiên PowerShell/Windows; bổ sung CI/harness tương đương Linux/macOS nếu mục tiêu enterprise đa nền tảng.
- [ ] **Đo lường L4**: baseline KPI (lead time, change failure rate, escaped defects, MTTR, flaky test rate, gate/build pass rate), lưu lịch sử có kiểm soát, ngưỡng cảnh báo.
- [ ] **Nền L5**: causal analysis sau defect escape, SPC/control limits cho quy trình chọn lọc, defect prevention actions có owner/date/evidence, tối ưu hóa dựa dữ liệu. Cần bằng chứng cấp tổ chức, không chỉ repo.

## Console errors (đã phân tích)
- Extension `cai-dotnet-sdk-khong-admin` connection error: ngoài app, không ảnh hưởng nghiệp vụ; chỉ noise debug.
- Permissions-Policy unrecognized features: warning, khả năng từ edge; không ảnh hưởng mua hàng/render.
- `cloudflareinsights` beacon `ERR_BLOCKED_BY_CLIENT`: chỉ mất analytics trên client chặn; không ảnh hưởng mua hàng.
