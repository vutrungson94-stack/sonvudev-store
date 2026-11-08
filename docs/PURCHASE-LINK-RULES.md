# Quy luật link & luồng mua hàng (BẮT BUỘC)

Tài liệu này là **quy luật bắt buộc** cho mọi thay đổi (con người hoặc AI). Mục tiêu: **không bao giờ làm vỡ link/nút mua** và luôn mở **form mua hàng** đúng cách.

## Hành vi bắt buộc (đã chốt)
1. **Trang bán hàng (store/index):** bấm vào **sản phẩm** (card/tên/nút mua) → **mở thẳng form mua hàng** (checkout modal). Không điều hướng sang trang khác làm hành động mua chính.
2. **Trang blog (nội bộ hoặc bên ngoài) bấm nút “Mua hàng”:** → **mở thẳng form mua hàng** (cùng cơ chế).
3. **Trang chi tiết sản phẩm `/product/:slug` (nếu dùng):** nút mua → mở form mua hàng qua cơ chế chuẩn.

## Cơ chế DUY NHẤT (phải dùng)
- **Điểm vào mua hàng chuẩn:** `/?buy=<PRODUCT_ID>`
  - `<PRODUCT_ID>` là `product.id` (ổn định). **Không** dùng slug làm định danh cho `?buy`.
  - Ví dụ: `https://sonvudev.com/?buy=ramcleaner-earlybird` (thay bằng id thật trong catalogue).
- **Handler client (chuẩn):** `public/app.js` xử lý `URLSearchParams(...).get('buy')` sau khi `loadProducts()` và gọi **`openPurchaseForm(id)`** để mở **form mua hàng trực tiếp**.
  - **CẤM** đổi `?buy` thành chỉ mở modal chi tiết (`openProduct`) trừ khi có quyết định sản phẩm mới **và** cập nhật tài liệu + mọi nút/blog/CTA.

## PHẢI / CẤM (cho AI và người sửa)

| PHẢI | CẤM |
|---|---|
| Mọi nút/link “Mua hàng” (store, blog, CTA, trang product, nguồn ngoài) dùng `/?buy=<PRODUCT_ID>` hoặc gọi `openPurchaseForm` (client). | Dùng `<a href="/product/{slug}">` (hoặc điều hướng tương tự) làm **hành động mua chính** trên store/grid/blog nếu làm mất form/nhảy sai. |
| Giữ route SEO/truy cập trực tiếp: `/`, `/product/:slug`, `/en/product/:slug`, `/api/checkout`, `/api/products` hoạt động. | Làm 404 route hiện có khi chỉnh UI/link mua. |
| Giữ `openPurchaseForm(id)` là entrypoint mua (tìm product theo `id`, mở `openCheckout(localized(...))`). | Nhân bản nhiều luồng checkout rời rạc gây lệch hành vi. |
| Khi sửa server-render (`src/pages.js` `renderIndexGrid` / template): affordance mua trỏ `/?buy=<id>`. | Thêm link mua mới trỏ URL tùy tiện/hardcode dễ gãy. |
| Khi thêm **blog nội bộ**: nút mua dùng `/?buy=<PRODUCT_ID>` (ưu tiên URL tuyệt đối theo `APP_URL`/domain thật). | Gắn JS mua riêng cho blog mà bỏ qua `/?buy`/`openPurchaseForm`. |
| **Blog ngoài**: dùng link `https://<domain>/?buy=<PRODUCT_ID>`. | Đoán slug/URL product page làm link mua. |
| Kiểm tra trước commit/push: (1) click sản phẩm store → form mua, (2) `/?buy=<id>` → form mua, (3) nút mua `/product/:slug` → form mua, (4) route product/index không 404. | Commit thay đổi link/flow với message mơ hồ khi không kèm kiểm tra. |

## Nguyên nhân hay gặp khi “nâng cấp lên lại lỗi link” (phải tránh)
- Trộn điều hướng trang (`/product/...`, `<a href>` gây reload/nhảy) với hành vi modal/form.
- `?buy` chỉ mở chi tiết thay vì mở form.
- `APP_URL`/env/proxy/Render cấu hình sai sau deploy → absolute URL/canonical lệch (kiểm tra live sau deploy).
- Đổi `product.id` hoặc format `?buy` mà không cập nhật CTA/blog.

## File liên quan (tham chiếu khi sửa)
- `public/app.js` — `openPurchaseForm`, render card onclick, handler `?buy`.
- `src/pages.js` — `renderIndexGrid` (store SSR grid), trang product nút `/?buy=...`.
- `src/app.js` — route `/`, `/product/:slug`, `/en/product/:slug` (giữ nguyên).
- Tài liệu này: `docs/PURCHASE-LINK-RULES.md`.

*Khi nghi ngờ, ưu tiên hành vi: **mở form mua hàng** qua `/?buy=<PRODUCT_ID>`, không tạo link điều hướng mới cho hành động mua.*
