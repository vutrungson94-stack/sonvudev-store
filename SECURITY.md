# Security Policy

## Nguuyên tắc

- **Không bao giờ** nhận secret, token, mã CVC hay dữ liệu thanh toán qua chat,
  email hay trong một issue. Báo cáo bảo mật phải đi qua kênh riêng.
- Mọi thay đổi đường thanh toán, CORS, chữ ký, hoặc cấu hình secret phải có
  review của chủ sở hữu (xem `.github/CODEOWNERS`).
- Phụ thuộc bên thứ ba được kiểm tra bằng `npm audit --audit-level=high` trong CI.

## Báo cáo lỗ hởng

Gửi email cho `hello@sonvudev.com` với tiêu đề `[security]`. Kèm theo:
- Mô tả lỗ hởng và các bước tái hiện (không cần thông tin nhạy cảm).
- Tài khoản/URL mẫu bị ảnh hưởng (nếu có).

Chúng tôi xác nhận trong vòng 3 ngày làm việc. Không công bố public trước khi có
bản sửa.

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
| --- | --- |
| Storefront `sonvudev.com` và API công khai | Lỗi của nhà cung cấp (PayPal, Supabase, Cloudflare, Resend) |
| Mã nguồn trong repo này | Tấn công mạng (DDoS, DNS) — báo nhà cung cấp |
| Cấu hình deploy/render | Nội dung do người dùng tải lên |

## Cam kết

- Không thu thập dữ liệu khách hàng ngoài thứ cần để xử lý đơn hàng.
- Không chạy script bên thứ ba ngoài origin của chính shop.
- Mọi secret đều đọc từ biến môi trường; không có secret nào trong mã nguồn.
