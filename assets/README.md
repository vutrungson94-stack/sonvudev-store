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
| Mẫu postmortem | `templates/postmortem-template.json` | Mẫu báo cáo sự cố sản xuất |
| Checklist deployment | `checklists/deployment-checklist.json` | 10 điều kiện trước khi triển khai |
| Checklist bảo mật | `checklists/security-checklist.json` | 10 điều kiện rà soát bảo mật |
| Chính sách triển khai | `policies/deployment-policy.md` | Quy tắc kiểm soát thay đổi production |
| Chính sách bảo mật | `policies/security-policy.md` | Nguyên tắc bảo mật bắt buộc |
| Runbook deploy | `runbooks/deploy-runbook.md` | Triển khai + rollback trên VPS/Render |
| Runbook sự cố | `runbooks/incident-runbook.md` | Ứng phó P1–P4 và quy trình hậu kiểm |

## Liên quan

| Tài sản | Đường dẫn | Mô tả |
|---------|-----------|-------|
| SLA | `SLA.md` | Cam kết cấp độ dịch vụ |
| Service catalog | `services/sonvudev-store.json` | Danh mục dịch vụ + SLO (kiểm bởi `npm run catalog:check`) |
| Golden path | `scripts/golden-path.mjs` | 10 điều kiện nền tảng Level 5 |

---
*Tài sản quy trình tổ chức — SonVuDev — Phiên bản 1.0*
