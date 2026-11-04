# Service Level Agreement (SLA) — SonVuDev Store

## 1. Mục đích

Tài liệu này định nghĩa các cam kết cấp độ dịch vụ (SLA) của hệ thống cửa hàng phần mềm SonVuDev. Nó là tài sản quy trình cấp tổ chức (organizational process asset) áp dụng cho mọi nhóm phát triển, vận hành và hỗ trợ.

## 2. Phạm vi

SLA áp dụng cho:
- Ứng dụng cửa hàng (Node.js/Express) tại `src/server.js`
- API công khai tại `/api/*`
- Trang web công khai tại `public/*`
- Các script triển khai và vận hành trong `scripts/` và `deploy/`

## 3. Các cam kết SLA

| Chỉ số | Mục tiêu | Cách đo | Chủ sở hữu |
|--------|----------|---------|------------|
| Sẵn sàng dịch vụ (availability) | ≥ 99.9% | `/api/health` kiểm tra mỗi 5 phút | Platform team |
| Thời gian phản hồi p95 (API) | ≤ 500ms | OTLP traces / access log | Backend team |
| Tỷ lệ lỗi API (error rate) | ≤ 1% | `/api/health` + access log | Backend team |
| Tiempo hồi phục sự cố (MTTR) | ≤ 60 phút | Postmortem ghi nhận | Platform team |
| Tỷ lệ test pass | 100% | `npm test` mỗi commit | Engineering team |
| Tỷ lệ build thành công | 100% | `npm run build` trên CI | Platform team |
| Tỷ lệ triển khai thành công | 100% | `deploy/deploy.sh` | Platform team |
| Lỗi thoát test (defect escape rate) | ≤ 5% | Lỗi production / tổng lỗi | Engineering team |

## 4. Đo lường và báo cáo

- Các chỉ số được thu thập tự động qua `scripts/slo-monitor.mjs`, `scripts/dora-metrics.mjs`, `scripts/defect-escape.mjs`.
- Kết quả được ghi vào `metrics-slo.json`, `metrics-dora.json`, `metrics-defect-escape.json`.
- Báo cáo hàng tuần được gửi đến `platform-team` và `engineering-team`.

## 5. Phản ứng sự cố

| Mức độ | Định nghĩa | Thời gian phản hồi | Thời gian khắc phục |
|--------|------------|-------------------|-------------------|
| P1 (Critical) | Dịch vụ không hoạt động, không thanh toán được | ≤ 15 phút | ≤ 1 giờ |
| P2 (High) | Tính năng quan trọng bị giảm su côté | ≤ 1 giờ | ≤ 4 giờ |
| P3 (Medium) | Lỗi nhỏ, giải pháp thay thế có sẵn | ≤ 4 giờ | ≤ 1 ngày |
| P4 (Low) | Lỗi giao diện, văn bản sai | ≤ 1 ngày | ≤ 3 ngày |

## 6. Credits và trừ từ

SLA không áp dụng trong trường hợp:
- Dịch vụ bên thứ ba bị nghẽn (Supabase, PayPal, Resend, R2, IndexNow).
- Khách hàng cấu hình sai biến môi trường.
- Bảo trì dự thảo đã thông báo trước ít nhất 24 giờ.

## 7. Cập nhật SLA

Tài liệu này được xem xét lại mỗi quý hoặc sau mỗi sự kiện P1/P2. Thay đổi phải được duyệt bởi platform-team và engineering-team trước khi có hiệu lực.

---
*SonVuDev Store — SLA v1.0 — Dernière mise à jour: 2026-11-04*
