# Runbook Ứng phó Sự cố — Incident Runbook

**Dành cho:** on-call engineer, platform-team.
**Tham chiếu:** `SLA.md` (phân loại P1–P4), `assets/templates/postmortem-template.json`, `scripts/incident-postmortem.mjs`.

## 1. Phân loại sự cố

| Mức | Định nghĩa | Thời gian phản hồi | Thời gian khắc phục |
|-----|------------|-------------------|--------------------|
| P1 | Dịch vụ ngừng hoàn toàn / không thanh toán được | ≤ 15 phút | ≤ 1 giờ |
| P2 | Tính năng quan trọng bị giảm sút | ≤ 1 giờ | ≤ 4 giờ |
| P3 | Lỗi nhỏ, có giải pháp thay thế | ≤ 4 giờ | ≤ 1 ngày |
| P4 | Lỗi giao diện / văn bản | ≤ 1 ngày | ≤ 3 ngày |

## 2. Quy trình ứng phó chuẩn

### Bước 1 — Phát hiện & xác nhận
- Nguồn phát hiện: cảnh báo `/api/health`, error rate, log OTLP, khách hàng báo cáo.
- Xác nhận: truy cập `https://<host>/api/health`, kiểm tra log gần nhất (`src/server.js` → logs).
- Gán mức P1–P4 theo bảng trên.

### Bước 2 — Ứng cứu tạm thời (mitigation)
- P1/P2: ưu tiên khôi phục dịch vụ — rollback (xem `deploy-runbook.md` §3) hoặc bật feature flag tắt tính năng lỗi.
- Vô hiệu hoá thành phần gây lỗi nếu cô lập được (VD: tắt email, tắt recommendation) thay vì gỡ toàn bộ.
- Nếu lỗi do bên thứ ba (PayPal, Supabase, R2, Resend): thông báo khách hàng, chuyển sang chế độ degraded hợp lệ, theo dõi vendor status page.

### Bước 3 — Chẩn đoán gốc rễ
- Kiểm tra: log ứng dụng, metrics (DORA/SLO), release gần nhất, thay đổi DB gần nhất.
- Tái hiện trên staging nếu có thể.
- Dùng checklist bảo mật (`checklists/security-checklist.json`) nếu nghi ngờ bị tấn công.

### Bước 4 — Khắc phục & xác minh
- Áp dụng bản vá tối thiểu, chạy test, deploy theo `deploy-runbook.md`.
- Xác minh: `/api/health` ok, luồng thanh toán (sandbox) hoạt động, không tăng error rate.
- Theo dõi 30–60 phút sau khắc phục.

### Bước 5 — Ghi nhận & hậu kiểm
- Tạo incident record: `node scripts/incident-postmortem.mjs` hoặc thêm vào `metrics/incidents.json`.
- Hoàn thành postmortem trong **48h**: nguyên nhân gốc, mốc thời gian, hành động phòng ngừa.
- Cập nhật SLO/SLA nếu cần; báo cáo cho platform-team.
- Hành động phòng ngừa phải có người phụ trách và hạn hoàn thành.

## 3. Mẫu giao tiếp trong sự cố

```
[INCIDENT] <P1/P2> - <mô tả ngắn>
Trạng thái: Đang điều tra / Đã xác định nguyên nhân / Đang khắc phục / Đã khôi phục
Ảnh hưởng: <ai bị ảnh hưởng, chức năng nào>
Hành động tiếp theo: <bước kế tiếp, ETA>
```

## 4. Liên hệ khẩn

- platform-team (phụ trách hệ thống)
- vendor support: PayPal / Supabase / Cloudflare / Resend (theo hợp đồng)
- Báo cáo công khai (nếu khách hàng ảnh hưởng): trang trạng thái hoặc email theo mẫu ở §3.

## 5. Sau sự cố — Checklist đóng sự cố

- [ ] Postmortem đã ghi (`metrics/postmortem-report.json`)
- [ ] Hành động phòng ngừa đã tạo ticket, có owner + deadline
- [ ] SLO/SLA được cập nhật nếu mục tiêu không còn phù hợp
- [ ] Runbook này được cập nhật nếu phát hiện thiếu bước

---
*SonVuDev Store — Incident Runbook v1.0 — 2026-11-04*
