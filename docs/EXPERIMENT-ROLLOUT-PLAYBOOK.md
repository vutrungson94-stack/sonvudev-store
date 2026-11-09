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

## 6. Ghi lại

Mọi experiment phải có dấu vết trong commit message (theo AGENTS.md §7: *why* besides *what*) hoặc trong `docs/`. Nếu không có hypothesis và metric, thay đổi đó **không được deploy** — bỏ lại trong local cho đến khi có số liệu.
