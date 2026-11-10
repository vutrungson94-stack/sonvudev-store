# Thử nghiệm có giả thuyết & rollback — quy trình L5

Mục tiêu: mọi thay đổi UX/discoverability (search, filter, taxonomy, landing, v.v.)
được chạy như một **thử nghiệm có giả thuyết**, có số liệu trước-sau, và có cách
rollback tức thì nếu không đạt delta có ý nghĩa. Không buông tiêu "hy vọng tốt hơn"
vào production.

---

## 1. Bước trước khi đổi code

| Bước | Nội dung |
|---|---|
| **Hypothesis** | Viết câu giả thuyết rõ: "Nếu làm X, thì số liệu Y sẽ thay đổi Z, vì lý do W." Ví dụ: "Nếu thêm dropdown gợi ý khi tìm kiếm, thì zero-result rate sẽ giảm, vì khách không cần đoán chính xác tên sản phẩm." |
| **Metric & nguồn** | Xác định số liệu đo trước-sau và công cụ: `search` event từ GA4 (`results: 0` vs `>0`), page_view, funnel tới `/?buy=<id>`, zero-result rate trên Realtime/báo cáo 24–48h sau. |
| **Baseline** | Ghi số liệu hiện tại (trong GA4 Realtime / GSC) trước khi deploy, để so sánh. |
| **Thời gian quan sát** | Khung thời gian cố định (ví dụ 7–14 ngày) trước khi quyết định keep/iterate/rollback. Không kéo dài vô thời hạn. |

Chỉ viết code sau khi 4 ô trên đã có câu trả lời. Mọi thay đổi đi kèm change plan trong commit message (theo AGENTS.md §2 §3).

---

## 2. Khi deploy

- Mỗi thay đổi UX đi kèm test mới (hoặc test cũ mở rộng) để bảo vệ số liệu: ví dụ search suggestions có test "dropdown hiện khi gõ" và "không thêm request lên máy chủ".
- Chạy toàn bộ gates trước khi push: `npm test`, `lint`, `audit`, `case`, `workflow`, `_Tests/gtest.ps1`, `_Build/gbuild.ps1` (SAST findings=0).
- Push lên `main`, Render tự redeploy.

---

## 3. Quyết định sau kỳ quan sát

| Kết quả | Hành động |
|---|---|
| Delta có ý nghĩa (zero-result giảm rõ ràng, không regression) | Giữ tính năng, dokument kết quả vào docs/ hoặc commit message của lần deploy sau. |
| Không delta, hoặc regression | **Rollback ngay** (xem phần 4). Không giữ "vì có thể sau này sẽ tốt." |
| Dữ liệu chưa đủ sau thời gian quy định | Mọi r Fransa: mở rộng thời gian quan sát một lần, hoặc rollback nếu không có điềm nào. |

---

## 4. Rollback (khôngRegression gate)

Rollback không phải xóa code bằng tay trên server. Có hai cách, tuỳ mức độ:

### 4.1 Rollback nhẹ qua env (nếu tính năng có cờ)

Nếu tính năng được viết đọc env `FEATURE_<NAME>` (xem `src/feature-flags.js`, mặc định tắt), thì:
- Tắt: trong Render dashboard → Environment → xóa `FEATURE_<NAME>` hoặc đặt `FEATURE_<NAME>=0` → save → Render redeploy, tính năng tắt tức thì, không revert commit.
- Mở lại: đặt `FEATURE_<NAME>=1` → save → redeploy.

### 4.2 Rollback nghiêm qua revert commit (mặc định cho tính năng chưa có cờ)

Nếu tính năng chưa có cờ env (code đã chạy trực tiếp), rollback = quay lại commit trước:

```powershell
git revert <commit-cua-tinh-nang>
git push origin main
```

Render redeploy commit cũ, tính năng biến mất ngay. Không `git reset --hard` trên nhánh chung (xem AGENTS.md §6).

---

## 5. Ví dụ áp dụng: Search suggestions (P2.1)

- **Commit:** `f2a7feb feat: search suggestions + zero-result guidance`
- **Hypothesis:** Dropdown gợi ý sản phẩm khi gõ tìm kiếm sẽ giảm zero-result rate và tăng lượt mở form mua (`/?buy=<id>`), vì khách được gợi ý tên sản phẩm thật thay vì thấy ô trống.
- **Metric:** sự kiện GA4 `search` (tham số `results`, `search_term`), số lần click suggestion → `openPurchaseForm`, zero-result rate trong Realtime/báo cáo GA4.
- **Baseline:** trước khi deploy f2a7feb, zero-result rate trên Realtime / báo cáo GA4.
- **Thời gian quan sát:** 14 ngày sau deploy.
- **Rollback:** tính năng chưa có cờ env (render toàn client-side trong `public/app.js`), nên rollback theo **4.2**: `git revert f2a7feb && git push origin main`.

### Bất biến không được bỏ qua khi experiment

- Không `AggregateRating` / `ratingValue` / `reviewCount` tự bịa (review test cấm).
- Không urgency/scarcity/discount sai.
- `/?buy=<id>` vẫn mở form mua trực tiếp; discovery/related link → trang sản phẩm, không checkout.
- Absolute `/styles.css`, URL locale prefix wins, CSP không thêm `unsafe-inline`.

---

## 6. Quy tắc sửa lỗi accessibility (a11y) từ các báo cáo Insights

Áp dụng cho mọi lỗi báo từ Chrome DevTools / Lighthouse Accessibility:

| Lỗi | Nguyên nhân thường gặp | Cách sửa |
|---|---|---|
| Buttons do not have an accessible name | Nút `<button>` không có text, `aria-label`, `title`, hoặc chỉ chứa icon/emoji | Thêm `aria-label="..."` hoặc `aria-labelledby="..."` cho mỗi nút (ví dụ `aria-label="Đóng cửa sổ"` cho nút `×`). |
| Background and foreground colors do not have sufficient contrast ratio | Màu chữ `#9aa5a8`, `#8b979c`, `#5d6b72`, `#72808d` trên nền `#fff`/#`#f7f9f8` dưới ngưỡng 4.5:1 | Darken màu chữ thành `#5f6e79` hoặc tối hơn, kiểm tra contrast ratio ≥ 4.5:1. |
| Accessibility tree is not well-formed | Phần tử `aria-labelledby` trỏ tới ID không tồn tại, hoặc nút đóng modal không có aria-label | Thay `aria-labelledby="modal-title"` bằng `aria-label="Chi tiết sản phẩm"` khi không có element có id đó. |

Kiểm tra sau khi sửa: mở Chrome DevTools → Lighthouse → Accessibility, đảm bảo 0 lỗi critical.

---

## 7. Quy tắc sửa lỗi performance (Insights)

Áp dụng cho các báo cáo Lighthouse Performance:

| Lỗi | Nguyên nhân | Cách sửa |
|---|---|---|
| Use efficient cache lifetimes | Static assets (CSS, JS, hình ảnh) chỉ cache 5 phút (`maxAge: "5m"`) | Tăng `maxAge` lên `"1y"` trong `express.static()`, vì assets được version theo hash nội dung qua build: URL có `?v=<hash>`, deploy mới sinh hash mới nên cache cũ không còn dùng. |
| Render-blocking requests | CSS chặn render nhưng preload+defer (`css-ready.js`) gây CLS ~0.5 vì vẽ chưa style trước | Giữ **`<link rel="stylesheet" href="/styles.min.css">` trực tiếp** (chặn render, CLS≈0, đúng chuẩn). Chỉ defer `<script>`. Không dùng preload CSS. |
| Avoid chaining critical requests | Nhiều tài nguyên tải tuần tự thay vì songsex | Font **tự host** trong `/fonts` (không còn `fonts.googleapis.com`): bỏ hẳn 2 request ra domain thứ hai và 2 bắt tay DNS/TLS. Preload **4 file font** thực sự dùng (`be-vietnam-pro-latin`, `be-vietnam-pro-vietnamese`, `space-grotesk-latin`, `space-grotesk-vietnamese`) → font tải song song với CSS, không chờ CSS. Beacon analytics tải **sau sự kiện `load`**. |
| Legacy JavaScript / cache TTL 1 ngày | `beacon.min.js` của Cloudflare (10 KB, polyfill `Array.prototype.at/findLast/includes`) | **Đã bỏ beacon**: RUM của chính site (`/api/quality`, `navigator.sendBeacon`) đếm lượt xem trên cùng origin, chặn được bởi proxy/VPN/trình chặn tracker. |
| Reduce unused JavaScript 443 KB | Extension Google Translate trong máy người đo | False positive. Đo bằng Incognito hoặc PageSpeed Insights; CI (`npm run lighthouse:check`) chạy headless, tắt extension. |

### 7.1 Cách đã bỏ cảnh báo render-blocking (2026-11-10)

**Câu hỏi:** `/styles.min.css` chặn render (Lighthouse ước tính 70–150 ms).

**Cách đã thử 1 — critical CSS + preload:** sinh `public/critical.css` từ `public/styles.css` (~10 KB), nhúng vào `<head>`, tải stylesheet đầy đủ bằng `rel="preload"` + `public/css-ready.js` đổi thành stylesheet (CSP không có `unsafe-inline` nên không dùng `onload` inline được).

**Đo (Lighthouse mobile, cùng máy):** cảnh báo hết, nhưng **CLS dao động 0,02 – 0,22** giữa các lần đo.

**Cách đã thử 2 — nhúng toàn bộ stylesheet vào HTML:** `src/lib/inline-styles.mjs` đọc `public/styles.min.css` và thay thẻ `<link rel="stylesheet">` bằng chính CSS đó. Không còn request chặn render, không có CSS nào đến muộn.

**Đo:** cảnh báo hết; CLS **không đổi** so với cách 1 — và đó là mấu chốt của cả vòng đo: **cùng một con số 0,2179 xuất hiện ở mọi cấu hình** (CSS ngoài, critical CSS, nhúng, và cả khi **xoá hẳn font** khỏi máy chủ). Nghĩa là con số đó **không phải do cách giao CSS** mà do môi trường đo (localhost không nén, không có CDN, catalogue rỗng). Trên site đã deploy, cùng code đó, CLS = 0.

**Kết luận: dùng cách 2 (nhúng toàn bộ).** Cảnh báo render-blocking biến mất, không có CSS nào đến muộn nên không có chuyển layout do CSS. Cái giá: HTML phình thêm ~16 KB gzip và phải tải lại mỗi 5 phút (HTML `max-age=300`) thay vì cache CSS 1 năm — tức là vài chục KB mỗi 5 phút, đổi lấy một chuyến round trip ở mọi lần vẽ đầu.

**Bài học đo lường:** số liệu Lighthouse trên `localhost` là số liệu của *máy đang đo*, không phải của site. Chạy cùng một build trên site đã deploy trước khi kết luận.

---

## 8. Quality Monitoring (P3) — đã triển khai

`public/quality.js` đo CWV/INP/CLS/TTFB và error rate client-side:

- **Client:** `public/quality.js` — `PerformanceObserver` (LCP, CLS, FID/INP, TTFB), `window.onerror` + `unhandledrejection`; gửi `navigator.sendBeacon` đến `POST /api/quality` (cùng origin, không cần thêm CSP host).
- **Phạm vi gửi:** chỉ host production-like (không `localhost`/`127.0.0.1`/`::1`/`*.local`). Không gửi PII (chỉ metric số, pathname/url, error type+filename + errorCount; không ghi error message).
- **Server:** `POST /api/quality` trong `src/app.js` — trả `204 No Content`, log tóm tắt `[quality]` (JSON), không lưu PII.
- **Phân tích log:** `npm run quality:report` (đọc `[quality]` lines từ stdin hoặc file log) để xem count/avg/p75/max CWV và tổng lỗi JS.
- **GA4 conversion (liên quan đo lường):** storefront/order/paypal-return gửi các event GA4 an toàn (không PII) khi có `gtag` (`view_item`, `begin_checkout`, `add_payment_info`, `purchase`). Owner cần cấu hình GA4 conversions/đánh dấu sự kiện phù hợp trong GA4 UI.

---

## 9. Checklist trước khi push (tất cả thay đổi)

- [ ] `npm test` — toàn bộ xanh
- [ ] `npm run lint` — 178+ files xanh
- [ ] `npm run audit` — 32 nhóm, 0 vấn đề
- [ ] `npm run case` — case-sensitive imports xanh
- [ ] `npm run workflow` — workflows parse xanh
- [ ] `npm run build` — PASS (bao gồm `styles.min.css` được minify trước required gate)
- [ ] `WORKFLOW.md §7.5` — đã đọc & cập nhật no-regress list trong cùng commit nếu đụng vào stylesheet/contrast/fonts/cache/test-env
- [ ] `_Tests\gtest.ps1` — exit 0
- [ ] `_Build\gbuild.ps1` — exit 0, SAST findings=0
- [ ] Lighthouse Accessibility — 0 lỗi critical (nếu sửa a11y)
- [ ] Lighthouse Performance — CLS ≈0 với stylesheet trực tiếp (chỉ chấp nhận render-blocking, không chấp nhận preload CSS)
- [ ] `_Sync\gsync.ps1 -NonInteractive -Yes` — push thành công

---

## 10. Ghi lại

Mọi experiment phải có dấu vết trong commit message (theo AGENTS.md §7: *why* besides *what*) hoặc trong `docs/`. Nếu không có hypothesis và metric, thay đổi đó **không được deploy** — bỏ lại trong local cho đến khi có số liệu.
