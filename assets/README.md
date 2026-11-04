# Organizational Process Asset Library — Tài sản quy trình tổ chức

Thư viện này chứa các tài sản quy trình được dùng chung trên mọi nhóm phát triển, vận hành và hỗ trợ của SonVuDev. Mọi thay đổi phải được duyệt bởi platform-team trước khi áp dụng.

## Cấu trúc thư mục

| Thư mục | Mục đích |
|---------|----------|
| `templates/` | Mẫu tài liệu: postmortem, incident, change request, design doc |
| `checklists/` | Danh sách kiểm tra: deployment, release, security, accessibility |
| `policies/` | Chính sách: bảo mật, quản trị thay đổi, quản trị dịch vụ |
| `runbooks/` | Sổ tay vận hành: incident response, deploy, rollback, backup |
| `metrics/` | Định nghĩa chỉ số: DORA, SLO, SPC, defect escape |

## Quy trình sử dụng

1. Triage: Nhóm cần tài sản → tìm trong thư mục phù hợp.
2. Tùy chỉnh: Copy mẫu vào kho dự án, điền thông tin cụ thể.
3. Đánh giá: Gửi pull request nếu phát hiện sai sót hoặc cần cải tiến mẫu chung.
4. Phê duyệt: platform-team đánh giá và merge vào thư viện chung.

## Tài sản hiện tại

| Tài sản | Đường dẫn | Mô tả |
|---------|-----------|-------|
| Mẫu postmortem | `postmortems/2026-11-04-example-incident.json` | Mẫu báo cáo sự cố sản xuất |
| Checklist build | `scripts/golden-path.mjs` | Kiểm tra 10 điều kiện trước khi triển khai |
| SLA | `SLA.md` | Cam kết cấp độ dịch vụ |
| Runbook deploy | `deploy/deploy.sh`, `deploy/bootstrap-ubuntu.sh` | Triển khai trên Ubuntu VPS |
| Cảnh báo | `src/otel.js` | Giám sát OTLP tracing |

---
*Tài sản quy trình tổ chức — SonVuDev — Phiên bản 1.0*
