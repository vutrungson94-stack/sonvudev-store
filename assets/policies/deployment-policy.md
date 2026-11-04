# Chính sách Triển khai — Deployment Policy

**Áp dụng cho:** Toàn bộ nhóm triển khai và vận hành của SonVuDev Store.
**Phê duyệt bởi:** platform-team + engineering-team.
**Phiên bản:** 1.0 — 2026-11-04

## 1. Mục đích

Đảm bảo mọi triển khai vào môi trường production đều **kiểm soát được**, **tái khởi tạo được** và **có thể rollback hoàn toàn**. Chính sách này là lớp bảo vệ cấp tổ chức cho mọi pipeline CI/CD và script deploy.

## 2. Phạm vi

- Ứng dụng chính: `src/server.js` (Node.js/Express)
- Các script triển khai: `deploy/deploy.sh`, `deploy/bootstrap-ubuntu.sh`
- Cấu hình hạ tầng: `render.yaml`, `Dockerfile`, `deploy/`
- Các workflow CI: `.github/workflows/`

## 3. Quy tắc bắt buộc

1. **Không deploy thẳng lên production** khi `npm test`, `npm run build` hoặc `npm run metrics` chưa pass.
2. **Mọi thay đổi cấu hình hạ tầng** phải được review bởi platform-team trước khi áp dụng.
3. **Mọi triển khai** phải có **kế hoạch rollback** kèm theo (phiên bản trước, cách khôi phục DB).
4. **Không deploy trong khung giờ cao điểm** (19:00–23:00 giờ VN) trừ khi xử lý sự cố P1.
5. **Sao lưu trước khi migrate**: DB backup phải được xác nhận thành công trước khi áp DML/DDL.
6. **Postmortem bắt buộc** cho mọi sự cố P1/P2; triển khai gây sự cố phải được xem xét lại theo SLA (`SLA.md`).
7. **Thông báo trước** cho khách hàng và nhóm vận hành ít nhất 24h đối với bảo trì có tác động.
8. **Blue/green hoặc canary** bắt buộc với thay đổi lớn; tắt khi metrics SLO vượt ngưỡng.

## 4. Quy trình kiểm soát thay đổi

1. Developer tạo branch và pull request.
2. CI chạy: lint → test → build → metrics → SAST → audit.
3. Ít nhất 1 reviewer phê duyệt, CI xanh mới được merge.
4. Deploy qua `deploy/deploy.sh` hoặc Render auto-deploy từ `main`.
5. Sau deploy: kiểm tra `/api/health`, theo dõi SLO trong 30 phút.
6. Nếu lỗi: kích hoạt rollback trong vòng 15 phút.

## 5. Đo lường tuân thủ

- Triển khai thành công: theo dõi qua `scripts/dora-metrics.mjs` (changeFailureRate).
- Guardrail tự động: `scripts/golden-path.mjs`, `scripts/slo-monitor.mjs`.
- Vi phạm chính sách phải ghi thành sự cố và chạy postmortem.

---
*SonVuDev Store — Deployment Policy v1.0 — 2026-11-04*
