# Quy luật link & luồng mua hàng (BẮT BUỘC)

Tài liệu này là **quy luật bắt buộc** cho mọi thay đổi (con người hoặc AI). Mục tiêu: **không bao giờ làm vỡ link/nút mua** và luôn mở **form mua hàng** đúng cách.

## Hành vi bắt buộc (đã chốt)
1. **Trang bán hàng (store/index):** affordance **mua** (nút/icon mua, luồng mua chính) → **mở thẳng form mua hàng** (checkout modal) qua `/?buy=<PRODUCT_ID>`. Liên kết/tên sản phẩm dùng để **xem chi tiết/khám phá** → đi tới trang sản phẩm (`/product/:slug` hoặc biến thể locale), **không** mở checkout.
2. **Trang blog:** nút/CTA **“Mua hàng/Buy/Mua ngay” rõ ràng** → **mở thẳng form mua hàng** (`/?buy=<PRODUCT_ID>`). Liên kết **“Sản phẩm liên quan/Related product”** hoặc liên kết tham khảo/xem chi tiết trong nội dung → đi tới trang sản phẩm (discovery), **không** mở checkout.
3. **Trang chi tiết sản phẩm `/product/:slug`:** nút mua chính → mở form mua hàng qua cơ chế chuẩn. Danh sách sản phẩm khác/liên quan (discovery) → trang sản phẩm, trừ khi UI được đánh dấu là CTA mua rõ ràng.

## Cơ chế DUY NHẤT (phải dùng)
- **Điểm vào mua hàng chuẩn:** `/?buy=<PRODUCT_ID>`
  - `<PRODUCT_ID>` là `product.id` (ổn định). **Không** dùng slug làm định danh cho `?buy`.
  - Ví dụ: `https://sonvudev.com/?buy=ramcleaner-earlybird` (thay bằng id thật trong catalogue).
- **Handler client (chuẩn):** `public/app.js` xử lý `URLSearchParams(...).get('buy')` sau khi `loadProducts()` và gọi **`openPurchaseForm(id)`** để mở **form mua hàng trực tiếp**.
  - **CẤM** đổi `?buy` thành chỉ mở modal chi tiết (`openProduct`) trừ khi có quyết định sản phẩm mới **và** cập nhật tài liệu + mọi nút/blog/CTA.

## PHẢI / CẤM (cho AI và người sửa)

| PHẢI | CẤM |
|---|---|
| Mọi nút/link **“Mua hàng/Buy”** (store, blog, CTA, trang product, nguồn ngoài) dùng `/?buy=<PRODUCT_ID>` hoặc gọi `openPurchaseForm` (client). | Dùng `<a href="/product/{slug}">` làm **hành động mua chính** trên store/grid/blog nếu làm mất form/nhảy sai. |
| Liên kết **khám phá/xem chi tiết/sản phẩm liên quan** đi tới trang sản phẩm locale (`/product/:slug`, `/en/product/:slug`, `/<lang>/product/:slug`). | Biến liên kết “sản phẩm liên quan/xem chi tiết” thành `/?buy=` (gây nhảy thẳng vào form thanh toán). |
| Giữ route SEO/truy cập trực tiếp: `/`, `/product/:slug`, `/en/product/:slug`, `/api/checkout`, `/api/products` hoạt động. | Làm 404 route hiện có khi chỉnh UI/link mua. |
| Giữ `openPurchaseForm(id)` là entrypoint mua (tìm product theo `id`, mở `openCheckout(localized(...))`). | Nhân bản nhiều luồng checkout rời rạc gây lệch hành vi. |
| Khi sửa server-render (`src/pages.js` `renderIndexGrid` / template): affordance mua trỏ `/?buy=<id>`; link tên/khám phá trỏ trang sản phẩm. | Thêm link mua mới trỏ URL tùy tiện/hardcode dễ gãy. |
| **Blog nội bộ (`src/blog.js`):** liên kết `relatedProductSlug` = trang sản phẩm. Trong nội dung HTML, chỉ rewrite `/product/<slug>` thành `/?buy=<id>` khi anchor là **CTA mua rõ ràng** (vd. `btn-buy`, `data-buy`, “Mua ngay/Buy now/Checkout…”); còn lại rewrite sang trang sản phẩm locale. | Gắn JS mua riêng cho blog mà bỏ qua `/?buy`/`openPurchaseForm`; hoặc rewrite mọi link `/product/` trong bài viết thành checkout. |
| **Blog ngoài**: dùng `https://<domain>/?buy=<PRODUCT_ID>` cho CTA mua; dùng URL trang sản phẩm cho liên kết tham khảo. | Đoán slug/URL product page làm link mua. |
| Kiểm tra trước commit/push: (1) affordance mua store → form mua, (2) `/?buy=<id>` → form mua, (3) nút mua `/product/:slug` → form mua, (4) liên kết liên quan/khám phá → trang sản phẩm, (5) route product/index không 404. | Commit thay đổi link/flow với message mơ hồ khi không kèm kiểm tra. |

## Nguyên nhân hay gặp khi “nâng cấp lên lại lỗi link” (phải tránh)
- Trộn điều hướng trang (`/product/...`, `<a href>` gây reload/nhảy) với hành vi modal/form.
- `?buy` chỉ mở chi tiết thay vì mở form.
- `APP_URL`/env/proxy/Render cấu hình sai sau deploy → absolute URL/canonical lệch (kiểm tra live sau deploy).
- Đổi `product.id` hoặc format `?buy` mà không cập nhật CTA/blog.

## File liên quan (tham chiếu khi sửa)
- `public/app.js` — `openPurchaseForm`, render card onclick, handler `?buy`.
- `src/pages.js` — `renderIndexGrid` (store SSR grid, mua vs khám phá), trang product nút `/?buy=...`, discovery links.
- `src/blog.js` — liên kết sản phẩm liên quan (discovery) và rewrite `/product/` trong nội dung theo intent CTA.
- `src/app.js` — route `/`, `/product/:slug`, `/en/product/:slug` (giữ nguyên).
- Tài liệu này: `docs/PURCHASE-LINK-RULES.md`.

*Khi nghi ngờ: **CTA mua rõ ràng** → `/?buy=<PRODUCT_ID>` + form mua hàng; **liên kết khám phá/xem chi tiết/liên quan** → trang sản phẩm. Không tạo luồng điều hướng mơ hồ.*
