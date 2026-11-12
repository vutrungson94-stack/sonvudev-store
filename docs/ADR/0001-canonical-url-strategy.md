# ADR 0001 — Canonical URL: gốc tiếng Việt, locale prefix, trailing slash chuẩn hoá

- **Status:** Accepted
- **Ngày:** 2026-11-12
- **Liên quan:** `src/app.js`, `src/pages.js`, `src/blog.js`, `robots.txt`, `sitemap.xml`

## Bối cảnh

Google Search Console báo "Trang trùng lặp — Google đã chọn một trang chính tắc
khác" và "Trang có lệnh chuyển hướng". Đo trên site trực tiếp cho thấy ba nguồn
trùng:

1. `/?buy=<id>` trả về **byte-identical** với `/` (cùng md5) và được link 8 lần
   trên homepage.
2. Mọi trang có hai địa chỉ `/x` và `/x/`, cả hai đều 200 với nội dung giống hệt.
3. `www.sonvudev.com/*` → 301 `sonvudev.com/*`.

## Quyết định

- **Gốc tiếng Việt là `/`.** Không có prefix. `/en/`, `/de/`, ... là prefix riêng.
- **Locale root:** `/en` và `/en/` đều là route thật; canonical của cả hai là `/en/`.
  Không redirect một form sang form kia — canonical tag đã gộp.
- **Trailing slash:** mọi path khác, `/x/` → 308 `/x`. Chỉ locale root được miễn.
- **Link mua:** mọi `/?buy=<id>` đều mang `rel="nofollow"` — nó là bản sao của `/`
  nên không được đưa vào chỉ mục.
- **www:** 301 về non-www (Cloudflare xử lý trước, app có 308 dự phòng).

## Hệ quả

- Google chỉ thấy một canonical cho mỗi trang; không còn URL trùng tranh chỉ mục.
- `/?buy=<id>` vẫn mở form mua hàng cho người dùng, nhưng không tốn crawl budget.
- Rủi ro: nếu sau này thêm route mới phải tự chọn dạng canonical (có slash hay
  không) và thêm test. `test/trailing-slash.test.js` là chỗ giữ đúng điều đó.

## Thay thế

Không. Trước đây dùng "canonical tag là đủ"; đã bị GSC bác bỏ vì trùng lặp.
