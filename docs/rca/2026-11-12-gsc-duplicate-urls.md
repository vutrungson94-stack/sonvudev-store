# RCA: GSC trang trùng lặp — `/?buy=` và trailing slash

- **Ngày:** 2026-11-12
- **Loại:** audit-escape
- **Mức:** medium
- **Owner:** chủ sở hữu repo

## Hiện tượng

Google Search Console báo "Trang trùng lặp — Google đã chọn một trang chính tắc
khác với lựa chọn của người dùng" (bắt đầu 12/11/2026) và "Trang có lệnh chuyển
hướng" (xác thực thất bại 13/10–17/10). Cùng thời điểm, GSC liệt kê 4 URL "không
thành công" gồm `https://sonvudev.com/?buy=<id>` và `https://www.sonvudev.com/`.

## Nguyên nhân gốc

Ba thứ cùng lúc, tất cả đều là **hệ quả của một thiết kế URL không có chuẩn
canonical duy nhất**:

1. `/?buy=<id>` được dùng làm điểm vào mua hàng. Server trả về **đúng byte của
   `/`** kèm query string. Không có `rel="nofollow"`, nên Google crawl nó như một
   trang thứ hai của homepage.
2. Mọi page có hai địa chỉ `/x` và `/x/`, cả hai 200 với nội dung giống hệt
   (Express `strict routing` mặc định coi hai cái là một route).
3. `www.sonvudev.com/*` 301 về non-www — đúng, nhưng GSC vẫn báo vì nó chưa
   re-crawl.

**Vì sao gates không bắt được:** `npm test`, `npm run audit` và `npm run seo:check`
đều đo trên **live site đã deploy** hoặc trên một số trang mẫu. Không có test nào
kiểm "mọi link trên homepage có `rel=nofollow` nếu trỏ `/?buy=`" hay "`/x/` không
trả 200". Canonical tag đúng nên `seo:check` xanh — nó không đo trùng lặp do
server trả 200 hai địa chỉ.

## Hành động khắc phục

- `src/pages.js`: `rel="nofollow"` cho link mua ở store grid và product page.
- `src/blog.js`: `rel="nofollow"` cho CTA mua trong nội dung blog.
- `src/app.js`: middleware 308 chuẩn hoá trailing slash `/x/` → `/x`, miễn locale
  root `/en`, `/en/`.
- Commit `a41e6cd`.

## Phòng ngừa

- `test/trailing-slash.test.js` — 7 ca: `/x/` → 308, `/en` & `/en/` → 200, query
  string giữ nguyên, link mua có `rel=nofollow`.
- `test/purchase-link-contract.test.js` — mở rộng để khóa `rel=nofollow`.
- `docs/ADR/0001-canonical-url-strategy.md` — ghi lại quyết định để không bị đảo
  ngược vô tình.

## Bài học

**Canonical tag là gợi ý; 308 mới là sự thật.** Một gate chỉ đọc canonical sẽ
không bao giờ thấy trùng lặp — phải đo cả status code của từng biến thể URL.
