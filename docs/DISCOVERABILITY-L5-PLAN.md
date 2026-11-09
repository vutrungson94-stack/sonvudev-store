# Discoverability & CMMI L5 (Optimizing) — đo được, không giả định

Tài liệu này mô tả **những gì có thể làm trong codebase** và **những gì bắt buộc do chủ sở hữu/hạ tầng/tài khoản thực hiện** để cải thiện khả năng khách hàng tìm thấy sản phẩm (on-site + Google/Bing) và tiến tới mức vận hành tối ưu hóa (CMMI L5). **Không bịa đặt thứ hạng, traffic, index status, hay kết quả GMC.**

## 0) “Live ranking cá nhân hóa” — giới hạn trung thực
Mình/agent trong repo **không thể** cung cấp live ranking cá nhân hóa thật vì không có: dữ liệu GSC/Bing Webmaster Tools của bạn, SERP theo vị trí/lịch sử/thiết bị/tài khoản, và trạng thái index/crawl hiện tại từ góc nhìn Google. 
**Cách lấy dữ liệu thật (bạn tự làm):**
- **Google Search Console**: Performance (queries/pages/countries/devices), Page indexing, Sitemaps, URL Inspection, Merchant/Enhancements. Xuất CSV theo 28 ngày/3 tháng để đo trước-sau.
- **Bing Webmaster Tools**: Search performance, URL Inspection, sitemap, index coverage.
- **Kiểm tra thủ công có kiểm soát**: tab ẩn danh, tắt cá nhân hóa tối đa, chọn locale/vị trí mục tiêu; ghi lại truy vấn, vị trí quan sát, URL, ngày, thiết bị. Đây là mẫu quan sát, không phải “ranking cá nhân hóa hệ thống”.
- **On-site**: dùng event `sonvudev:search` (CustomEvent + `dataLayer` `site_search` nếu có) để đo từ khóa tìm trong site, filter, số kết quả, zero-result.

## 1) Đã cải thiện trong codebase (cần deploy + đo)
- **Homepage SEO/intent alignment** (`public/index.html`, `public/i18n.js`): title/meta/OG/Twitter/alt phản ánh **toàn bộ catalog** (dọn RAM/PC, Excel/VBA, kiểm tra USB/thẻ nhớ, .NET SDK portable, đa nền tảng) thay vì chỉ 2 sản phẩm — giảm lệch intent, cải thiện CTR tiềm năng khi URL xuất hiện.
- **On-site search L5 hooks** (`public/app.js`, `public/i18n.js`): trạng thái zero-result rõ ràng khi đang tìm/lọc + nút xoá tìm kiếm; phát `CustomEvent('sonvudev:search')` và `dataLayer` event `site_search` `{term, filter, results, lang}` để kết nối analytics/ghi nhận truy vấn không ra kết quả. Không gửi PII ngoài search intent do người dùng nhập.
- **Nền tảng có sẵn**: SSR/localized routes, `hreflang`/canonical, sitemap động, robots (có AI crawlers có chủ đích), JSON-LD merchant/organization (không tự phát `AggregateRating`), `/?buy=<id>` purchase flow, absolute `/styles.css`.

## 2) Việc chủ sở hữu phải làm (không thể tự động hóa từ code)
- Cấu hình/xác minh **Google Search Console + Bing Webmaster Tools**, gửi sitemap, theo dõi index/lỗi/cải thiện.
- Khắc phục **Merchant Center misrepresentation/methods/pricing** (xem `docs/MERCHANT-CENTER-MISREPRESENTATION-REMEDIATION.md`), chỉ dùng thông tin doanh nghiệp **thật, nhất quán, có thể xác minh**.
- Tạo nội dung trung thực theo intent (how-to/so sánh an toàn/hạn chế/case dùng đúng), lịch xuất bản, internal link tới trang sản phẩm phù hợp (khám phá → trang sản phẩm; mua rõ ràng → `/?buy=<id>`).
- Backlink/brand mentions thật (không spam/link scheme). Uy tín domain cần thời gian và bằng chứng.
- Hỗ trợ khách hàng thực tế, hoàn tiền đúng policy, giá/phí/fulfillment khớp website-schema-feed-checkout.

## 3) Ưu tiên L5 (Optimizing) — vòng lặp đo được
| Ưu tiên | Hành động | Số liệu | Ghi chú |
|---|---|---|---|
| P0 | GSC/Bing verified + sitemap/index health | trang index hợp lệ, lỗi coverage, enhancements | Nền cho mọi tối ưu |
| P0 | Merchant/GMC minh bạch & khớp dữ liệu | trạng thái GMC, disapprovals, appeal evidence | Ảnh hưởng trust/distribution |
| P1 | Gắn analytics vào `site_search` + conversion | CTR tìm on-site, zero-result rate, add-to-purchase funnel | Dùng dataLayer/GA4/Matomo tùy chọn |
| P1 | Landing/SEO cho từng intent sản phẩm | impressions/clicks/CTR/query/page (GSC) | Tiêu đề/mô tả/trung thực, không nhồi nhét |
| P1 | Cụm nội dung blog/use-case + internal links | page entry, assisted discovery, index | Nội dung phải thật, có chuyên môn |
| P2 | Cải tiến ranking/taxonomy/filter/search gợi ý | zero-result giảm, time-to-product, conversion | A/B hoặc before-after có kiểm soát |
| P2 | Thử nghiệm có giả thuyết & rollback | delta có ý nghĩa, không regression gate | Ghi lại trong change plan/PR |
| P3 | Quan trắc chất lượng (Core Web Vitals, uptime, lỗi JS) | CWV/INP/LCP, error rate | Phối hợp hosting/CDN |

## 4) Bất biến khi thay đổi discoverability
- Không claim giả, không urgency/scarcity/discount sai, không `AggregateRating` tự bịa.
- `/?buy=<id>` cho hành động mua rõ ràng; discovery/related → trang sản phẩm (`docs/PURCHASE-LINK-RULES.md`).
- Absolute `/styles.css`, locale/prefix/canonical/hreflang đúng, gates/build/sync xanh.
- Mọi thay đổi: baseline → implement → fix-until-green → verify → build/sync.
