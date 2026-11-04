# Chính sách Bảo mật — Security Policy

**Áp dụng cho:** Toàn bộ hệ thống SonVuDev Store (ứng dụng, API, hạ tầng, dữ liệu khách hàng).
**Phê duyệt bởi:** platform-team + security-officer.
**Phiên bản:** 1.0 — 2026-11-04

## 1. Mục đích

Bảo vệ dữ liệu khách hàng, tài sản trí tuệ của SonVuDev và tính toàn vẹn của hệ thống bán phần mềm. Chính sách này định nghĩa các nguyên tắc bắt buộc khi thiết kế, xây dựng, triển khai và vận hành.

## 2. Phạm vi

- Ứng dụng Node/Express: `src/`
- Tài sản tĩnh và script client: `public/`
- Dữ liệu và kết nối: Supabase, Cloudflare R2, PayPal, Resend
- Quyền truy cập: admin console, API keys, service accounts

## 3. Nguyên tắc bắt buộc

1. **Tối thiểu quyền hạn (least privilege)**: mọi tài khoản chỉ có đúng quyền cần thiết.
2. **Không secrets trong mã nguồn**: mọi API key/secret đọc từ biến môi trường (`src/config.js`); commit chứa secrets bị cấm tuyệt đối.
3. **Mã hóa khi truyền và khi lưu**: HTTPS bắt buộc; dữ liệu nhạy cảm lưu trong DB mã hoá hoặc vault, không lưu plaintext.
4. **Xác thực & ủy quyền**: mọi route `/api/*` phải có kiểm tra xác thực hoặc rate limit; admin route yêu cầu vai trò admin.
5. **Validated input**: mọi dữ liệu client gửi lên đều được xác thực (type, range, format) trước khi dùng.
6. **Security headers**: CSP, HSTS, X-Content-Type-Options, Referrer-Policy được cấu hình mặc định trong `src/server.js`.
7. **Phụ thuộc an toàn**: `npm audit --audit-level=high` là gate bắt buộc trong build; lỗ hổng nghiêm trọng phải vá hoặc có kế hoạch trong 7 ngày.
8. **Webhook/tích hợp bên thứ ba**: xác thực chữ ký PayPal; xác minh callback trước khi xử lý đơn hàng.
9. **Log sạch**: không ghi mật khẩu, token, số thẻ vào log; log production không in nội dung request chứa PII.
10. **Báo cáo lỗ hổng**: mọi lỗ hổng phải báo cáo trong 24h; lỗ hổng nghiêm trọng xử lý trong 72h.

## 4. Quản lý vòng đời sự cố bảo mật

1. Phát hiện → ghi vào incident tracker (`scripts/incident-postmortem.mjs`).
2. Phân loại mức độ P1–P4 theo `SLA.md`.
3. Khắc phục + xác minh → postmortem trong 48h.
4. Rút kinh nghiệm → cập nhật checklist (security-checklist.json) và policy này.

## 5. Đo lường tuân thủ

- Tự động: `npm run audit`, `scripts/golden-path.mjs` (SEC checks), SAST trong `npm run build`.
- Định kỳ: rà soát quyền truy cập và dependency hàng quý.
- Vi phạm phải ghi thành sự cố và báo cáo cho platform-team.

---
*SonVuDev Store — Security Policy v1.0 — 2026-11-04*
