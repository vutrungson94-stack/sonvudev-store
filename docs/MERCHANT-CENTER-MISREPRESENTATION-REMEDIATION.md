# Google Merchant Center: khắc phục “Trình bày sai” / “Các phương thức kinh doanh không được chấp nhận”

Tài liệu này tổng hợp **hành động trong codebase/website** và **hành động bắt buộc do chủ sở hữu/Merchant Center thực hiện**. Mục tiêu là minh bạch, trung thực, nhất quán giữa website, dữ liệu sản phẩm, structured data và Merchant Center. **Không bịa đặt** thông tin pháp nhân, địa chỉ, điện thoại, chứng nhận, đánh giá, huy hiệu hay cam kết không thể chứng minh.

> Lưu ý: Quyết định phê duyệt/tạm ngưng thuộc về Google. Kháng nghị chỉ nên gửi sau khi mọi thông tin đã chính xác, nhất quán và có bằng chứng.

## 1) Đã xử lý trong codebase (cần deploy)

- **Xóa thông tin liên hệ hardcode có rủi ro sai lệch**: `public/about.html` không còn địa chỉ/điện thoại hardcode; hiển thị qua `{{businessContactHtml}}` chỉ khi được cấu hình.
- **Schema `Organization` chỉ phát dữ liệu đã cấu hình/xác minh**: `src/pages.js` không còn hardcode `telephone`/`address`. Chỉ xuất `telephone`, `PostalAddress`, `contactPoint` (email hỗ trợ) khi có giá trị từ cấu hình.
- **Cấu hình minh bạch (không mặc định giả)**: `src/config.js`, `.env.example` hỗ trợ `BRAND_LEGAL_ENTITY`, `BRAND_ADDRESS`, `BRAND_PHONE` (tùy chọn, chỉ dùng khi đúng và nhất quán với GMC/cửa hàng/pháp lý).
- **Làm sạch claim quảng cáo/khan hiếm không kiểm chứng** trong `data/products.json` (ví dụ SEO title “Giảm giá đặc biệt”, “chỉ 100 bản/100 khách đầu tiên”) cho `ramcleaner-earlybird`; thay bằng mô tả trung thực theo trang sản phẩm.
- **Merchant listing structured data** (`Product`/`Offer`): đã có `hasMerchantReturnPolicy` với `applicableCountry`, `returnMethod`, `returnFees`, `merchantReturnDays` và `shippingDetails` (phí 0 cho sản phẩm số). **Không** thêm `AggregateRating`/review sao tự thu thập.
- **Luồng mua/khám phá**: CTA mua dùng `/?buy=<id>` + form mua; liên kết khám phá/sản phẩm liên quan đi tới trang sản phẩm. Tránh điều hướng gây hiểu nhầm.

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
