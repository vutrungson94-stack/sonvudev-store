# Google Merchant Center: khắc phục “Trình bày sai” / “Các phương thức kinh doanh không được chấp nhận”

Tài liệu này tổng hợp **hành động trong codebase/website** và **hành động bắt buộc do chủ sở hữu/Merchant Center thực hiện**. Mục tiêu là minh bạch, trung thực, nhất quán giữa website, dữ liệu sản phẩm, structured data và Merchant Center. **Không bịa đặt** thông tin pháp nhân, địa chỉ, điện thoại, chứng nhận, đánh giá, huy hiệu hay cam kết không thể chứng minh.

> Lưu ý: Quyết định phê duyệt/tạm ngưng thuộc về Google. Kháng nghị chỉ nên gửi sau khi mọi thông tin đã chính xác, nhất quán và có bằng chứng.

## 1) Đã xử lý trong codebase (cần deploy)

- **Xóa thông tin liên hệ hardcode có rủi ro sai lệch**: `public/about.html` không còn địa chỉ/điện thoại hardcode; hiển thị qua `{{businessContactHtml}}` chỉ khi được cấu hình.
- **Schema `Organization` chỉ phát dữ liệu đã cấu hình/xác minh**: `src/pages.js` không còn hardcode `telephone`/`address`. Chỉ xuất `telephone`, `PostalAddress`, `contactPoint` (email hỗ trợ) khi có giá trị từ cấu hình.
- **Cấu hình minh bạch (không mặc định giả)**: `src/config.js`, `.env.example` hỗ trợ `BRAND_LEGAL_ENTITY`, `BRAND_ADDRESS`, `BRAND_PHONE` (tùy chọn, chỉ dùng khi đúng và nhất quán với GMC/cửa hàng/pháp lý).
- **Làm sạch claim quảng cáo/khan hiếm không kiểm chứng** trong `data/products.json` (ví dụ SEO title “Giảm giá đặc biệt”, “chỉ 100 bản/100 khách đầu tiên”) cho `ramcleaner-earlybird`; thay bằng mô tả trung thực theo trang sản phẩm. **(Đợt 2026-11-14: mở rộng quét toàn bộ sản phẩm — PC Cleanup “tăng tốc”, MouseWheel “duy nhất”/“21/21 PASS”, Personal “tăng tốc”, Early Bird; seed trong `src/store.js`; `src/blog-posts/ramcleaner-earlybird.json`; locales vi/en/de/es/fr/ja/zh-CN; `products.onlyOne` → `products.noRelated`.)**
- **Merchant listing structured data** (`Product`/`Offer`): `hasMerchantReturnPolicy` (`applicableCountry`, `returnFees`, `merchantReturnDays=14`; **không** `returnMethod` cho sản phẩm số) và `shippingDetails` với `shippingRate: 0 VND` + **`deliveryTime` 0 ngày** (GMC “deliveryTime bị thiếu (nằm trong offers.shippingDetails)” — 6 mục). **Một Offer duy nhất** (`Product`); `SoftwareApplication` không còn mang `offers` (tránh trùng/hai Offer lệch). **Không** thêm `AggregateRating`/review sao tự thu thập.
- **Luồng mua/khám phá**: CTA mua dùng `/?buy=<id>` + form mua; liên kết khám phá/sản phẩm liên quan đi tới trang sản phẩm. Tránh điều hướng gây hiểu nhầm.
- **Checkout hiển thị giá trước khi cam kết** (`openCheckout`, `public/app.js`): tên SP, giá/currency (`priceFor`), ghi chú quy đổi PayPal VND→USD, cách nhận sản phẩm số và cửa sổ hoàn tiền 14 ngày — trước nút thanh toán. Test khóa: `test/merchant-policy.test.js` (mục 6).
- **Danh tính doanh nghiệp**: `.env` đã đặt `BRAND_LEGAL_ENTITY=Vũ Trung Sơn` (owner cần đặt giống trên Render), trang About/Contact nêu rõ “Doanh nghiệp cá nhân”/“sole-proprietor business” thay vì “Không công ty”.

## 1.5) Phát hiện live↔repo ngày 2026-11-14 (nguyên nhân thật)

GMC flag **8/8 sản phẩm (100%)** — “Trình bày sai” — và chặn xác minh doanh nghiệp ở `/product/pc-cleanup`, `/product/mousewheel-vba`, `/product/ramcleaner-business`. Nguyên nhân:

- Live `GET /api/products` (Supabase) vẫn trả `shortDescription: "Ưu đãi sớm - chỉ 199.000đ (giảm 33%) cho 100 khách đầu tiên"`, `badge: "Ưu đãi sớm"` cho Early Bird và `badge: "Safe Edition v4.3"` cho Excel (version 4.4) — trong khi repo đã sạch. **Bước `npm run ops:catalog:apply` chưa từng được chạy.**
- Gate cũ chỉ quét `public/locales/*.json`; không gate nào quét `data/products.json`, `src/store.js`, `src/blog-posts` hay đối chiếu repo↔live.
- Checkout không hiển thị giá trước khi cam kết; danh tính lệch (email live là Gmail, repo env là email domain; `BRAND_LEGAL_ENTITY` rỗng).

Chi tiết: `docs/rca/2026-11-14-gmc-misrepresentation.md`, `postmortems/2026-11-14-gmc-misrepresentation.json`, change-plan `docs/CHANGE-PLAN-2026-11-14-GMC-TRUST.md`.

**Hành động bắt buộc sau khi deploy code:**

1. `npm run ops:catalog` (dry-run, đọc diff) rồi `npm run ops:catalog:apply`.
2. Đối chiếu live: `GET /api/products` khớp `data/products.json` từng field (badge, shortDescription, seoDescription, features, version, price); kiểm tra `/merchant-feed.tsv` và trang sản phẩm live.
3. GSC: Inspect URL + “Validate fix” cho 3 URL bị flag; chạy lại xác minh doanh nghiệp (`answer/17123828`). Chỉ kháng nghị khi các bước 1–3 xanh.
4. Render env (ngoài repo, không đổi trong file gitignored): `SUPPORT_EMAIL=hello@sonvudev.com` phải khớp contact/schema/FAQ; `BRAND_LEGAL_ENTITY`, `BRAND_ADDRESS`, `BRAND_PHONE` khớp giấy tờ.

## 2) Việc chủ sở hữu PHẢI làm (ngoài code)

### A. Danh tính doanh nghiệp & minh bạch (rất quan trọng)
- [ ] **Merchant Center > Cài đặt thông tin doanh nghiệp**: điền chính xác tên doanh nghiệp/cá nhân kinh doanh, địa chỉ, điện thoại, email, website, thông tin xác minh theo yêu cầu GMC. Thông tin phải **khớp** với website, chính sách, tài khoản thanh toán và giấy tờ thực tế.
- [ ] Trên website (qua env/config hoặc nội dung đã xác minh): công bố **đơn vị/pháp nhân** (`BRAND_LEGAL_ENTITY`), **địa chỉ** (`BRAND_ADDRESS`), **điện thoại** (`BRAND_PHONE`) chỉ khi là thông tin thật, đang hoạt động, và nhất quán. Không dùng địa chỉ ảo/giả.
- [ ] Đảm bảo trang **About/Terms/Privacy/Refund** có thông tin liên hệ và điều khoản rõ ràng, dễ tìm từ footer/nav.
- [ ] Cung cấp kênh hỗ trợ thực sự (email `SUPPORT_EMAIL` phải hoạt động; phản hồi trong thời gian hợp lý).

### B. Giá, phí, thanh toán, giao hàng/hoàn tiền
- [ ] Giá hiển thị trên website phải **khớp** giá/tiền tệ trong GMC feed/structured data và tại checkout.
- [ ] Công bố rõ **trước khi cam kết mua**: tổng giá, thuế/phí (nếu có), phương thức thanh toán, cách nhận sản phẩm số (link tải/đơn hàng), thời gian xử lý/xác nhận, điều kiện hoàn tiền/hủy.
- [ ] Với **sản phẩm phần mềm số**: ghi rõ là giao hàng số/tải xuống; không ngụ ý vận chuyển vật lý. `shippingDetails`/return policy phải phản ánh đúng thực tế.
- [ ] **Chính sách hoàn tiền**: thực hiện đúng như đã công bố (14 ngày theo policy hiện tại). Không từ chối hoàn tiền trái policy đã cam kết.
- [ ] Không dùng mồi nhử, giá gây hiểu lầm, urgency/scarcity giả (“chỉ còn X”, “giảm giá đặc biệt”, “chỉ hôm nay”) trừ khi có bằng chứng và cơ chế thực thi minh bạch.

### C. Sản phẩm & nội dung
- [ ] Không đăng sản phẩm bạn không có quyền bán/phân phối/hỗ trợ.
- [ ] Mô tả sản phẩm phải chính xác, không phóng đại (“thần kỳ”, “chữa bách bệnh”, “100%” không chứng minh).
- [ ] Ảnh/logo/brand không mạo danh bên thứ ba. `sameAs`, `founder`, tên thương hiệu chỉ dùng khi đúng.
- [ ] Feed Merchant Center, sitemap, canonical, structured data, landing page phải **cùng mô tả cùng sản phẩm/giá/trạng thái**.

### D. Kỹ thuật & uy tín
- [ ] SSL/HTTPS hoạt động trên toàn bộ domain (hosting/CDN).
- [ ] Domain, xác minh Search Console/GMC, robots, sitemap gửi đúng.
- [ ] Thiết kế chuyên nghiệp, không lỗi nghiêm trọng, không popup/deceptive UI, không yêu cầu thông tin nhạy cảm ngoài luồng thanh toán hợp lệ.
- [ ] Chỉ hiển thị review/badge/chứng nhận nếu **thật và có thể xác minh**. (Codebase hiện không phát `AggregateRating` tự thu thập — đúng hướng.)

### E. Trước khi kháng nghị GMC
- [ ] Rà toàn bộ website + GMC + feed + landing pages theo checklist trên.
- [ ] Lưu bằng chứng: ảnh chụp trang liên hệ/chính sách, cấu hình GMC, hóa đơn/pháp lý (nếu phù hợp), mô tả thay đổi.
- [ ] Kháng nghị trung thực, cụ thể: nêu nguyên nhân có thể gây hiểu nhầm, thay đổi đã thực hiện, URL/bằng chứng, và cam kết tuân thủ.
- [ ] Sau khi deploy code, dùng GSC “Validate fix”/kiểm tra URL và đợi GMC crawl lại.

## 3) Kiểm tra nhanh sau deploy
- [ ] `GET /`, `/about`, `/terms`, `/privacy`, `/refund`, `/product/:slug` hiển thị đúng, không placeholder nhạy cảm.
- [ ] View-source/structured data: `Organization` chỉ có contact info đã cấu hình; `Product`/`Offer` có giá/currency/policy/shipping đúng.
- [ ] `npm test`, `npm run audit`, `npm run lint`, `npm run case`, `npm run workflow` xanh; `_Tests`/`_Build` pass.

## 4) Giới hạn
- Tôi không xem được ảnh GSC/GMC bạn đính kèm trong chat này; hãy đối chiếu mục “Cần khắc phục” cụ thể trong GMC với checklist trên.
- Việc khôi phục tài khoản phụ thuộc vào Google và mức độ chính xác/đầy đủ của thông tin doanh nghiệp thực tế.
