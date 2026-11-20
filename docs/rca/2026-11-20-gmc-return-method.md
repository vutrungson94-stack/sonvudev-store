# RCA — GMC "returnMethod không hợp lệ" và GSC chặn xác thực (20/11/2026)

## Triệu chứng

- Search Console → "Cải thiện giao diện của mục": 7 mục,
  `'returnMethod' không hợp lệ nằm trong 'offers.hasMerchantReturnPolicy'`, trạng thái "Chưa bắt đầu".
- Search Console → "Không thể tiếp tục quy trình xác thực" cho 3 URL:
  `/product/dotnet-sdk-portable-updater`, `/product/excel-trusted-locations-setup`,
  `/product/spark-capacity-tester-pro`.

## Nguyên nhân gốc

`src/pages.js` phát `returnMethod: "https://schema.org/ReturnDownload"` cho mọi sản phẩm số.
`ReturnDownload` là term có thật của schema.org, **nhưng Google không hỗ trợ giá trị đó** trong
`MerchantReturnPolicy` ở cấp `Offer`. Tài liệu chính thức (Merchant listing và MerchantReturnPolicy,
đối chiếu 20/11/2026) chỉ liệt kê:

- `https://schema.org/ReturnAtKiosk`
- `https://schema.org/ReturnByMail`
- `https://schema.org/ReturnInStore`

Nguồn gốc của sai lầm: sau cảnh báo 31/10 "Trường returnMethod bị thiếu", một đợt sửa đã thêm
`returnMethod` nhưng chọn `ReturnDownload` vì cho rằng sản phẩm số "trả lại bằng đường tải".
`AGENTS.md §4` và `test/purchase-link-contract.test.js` cùng mã hoá giá trị sai đó, nên cả gate
lẫn tài liệu đều xanh trong khi dữ liệu gửi Google sai. ADR `0003` từ đầu đã dùng đúng
`ReturnByMail`; đợt này khôi phục về quyết định gốc.

## Bằng chứng

- Focused test chạy với production đã sửa nhưng **chưa sửa test**:
  `actual 'https://schema.org/ReturnByMail'` / `expected 'https://schema.org/ReturnDownload'`,
  exit 1 — chứng minh test cũ sai, không phải production sai.
- `grep ReturnDownload`: chỉ còn trong lịch sử docs/test; sau sửa không còn giá trị này ở code phát schema.

## Cách sửa

- `src/pages.js`: `merchantReturnPolicy()` luôn phát `ReturnByMail`, kèm comment nêu 3 giá trị
  Google hỗ trợ; bỏ tham số `isDigital` không còn dùng.
- `AGENTS.md §4`: thay invariant sai bằng danh sách giá trị hợp lệ + lý do.
- `docs/MERCHANT-CENTER-MISREPRESENTATION-REMEDIATION.md`, `docs/ADR/0003`: cập nhật/ghi nhận lại.
- `test/purchase-link-contract.test.js`: assertion đổi sang `ReturnByMail` và khẳng định
  `ReturnDownload` không được phát lại (sau khi đã chứng minh assertion cũ sai).

Không hạ ngưỡng, không bỏ `returnMethod`, không đổi chính sách hoàn tiền 14 ngày trên `/refund`.

## Sau khi deploy (chủ sở hữu)

1. Deploy commit đã sửa lên origin, chờ `/api/health` trả đúng sha.
2. Nếu dữ liệu catalog live lệch repo, chạy `npm run ops:catalog:apply` như quy trình repo↔live.
3. Kiểm tra một trang sản phẩm: JSON-LD `offers.hasMerchantReturnPolicy.returnMethod` phải là
   `https://schema.org/ReturnByMail`.
4. GSC → "Cải thiện giao diện của mục" → chạy lại xác thực; GMC → "Validate fix" nếu có.

## Vấn đề khác trong ảnh (ngoài repo)

DevTools báo `StorageType.persistent is deprecated`, nguồn `cdn-cgi/challenge-platform/.../main.js?stray=...`
và `main?stray=...` — đây là mã của **Cloudflare Managed Challenge / Bot Fight**, không có trong
repo (`grep StorageType|navigator.storage|persist\(` trên `src/`, `public/`, `scripts/` → 0 kết quả).
Không sửa được bằng mã nguồn: nếu không muốn challenge được phục vụ, chủ sở hữu cần kiểm tra
cài đặt Bot Fight / WAF trong Cloudflare dashboard. Cảnh báo tự biến mất khi Chrome bỏ tính năng
này và không ảnh hưởng thanh toán hay SEO.
