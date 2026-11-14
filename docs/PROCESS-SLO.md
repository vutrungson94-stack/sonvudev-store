# SLO của chính quy trình — process SLOs

Tài liệu này đặt ngưỡng cho **quy trình**, không phải cho dịch vụ (mục SLA nằm ở
`docs/SLO.md`, `SLA.md`). Một quy trình không đo được thì không có cách nào
phân biệt "tốt hơn" với "vẫn vậy, chỉ rộn ràng". Mỗi chỉ số: mục tiêu, nguồn,
người chịu trách nhiệm, hành động khi vi phạm. Nếu một chỉ số chưa có nguồn đo
thực tế, nó được ghi rõ là `unknown` — không gán 0 hay 100.

| Chỉ số | Mục tiêu | Nguồn | Trạng thái hiện tại | Hành động khi vi phạm |
| --- | --- | --- | --- | --- |
| CI wall time (push → checks xanh) | ≤ 10 phút | GitHub Actions duration (`gh run list`) | unknown | chia nhóm test, cache NPM |
| Flaky test rate | ≤ 2% | 3 lần chạy cùng commit, fail-rồi-pass | unknown | fix hoặc cô lập test; ghi RCA |
| Gate/build pass rate (CI) | ≥ 95% | lịch sử `.github/workflows/checks.yml` | unknown | RCA + phòng ngừa |
| Coverage gate | ≥ 70/60/70 (lines/branches/functions) | `npm run coverage` | 89,3 / 73,2 / 81,5 (2026-11-12) | không được phép giảm; CI đỏ |
| Restore drill (backup) | hằng tháng, ≤ 60 phút, trên máy sạch | `npm run backup:drill` + tick trong `docs/RUNBOOK.md §8` | **đã có drill, chưa chạy lần khôi phục thật trong điều kiện mới** | drill fail → khóa `main`, mở RCA |
| MTTR sự cố production | ≤ 4 giờ | `postmortems/` | chưa đo (0 postmortem ghi nhận downtime) | RCA bắt buộc sau mỗi sự cố |
| Deploy success rate | 100% trên CI | `logs/last-deploy.json` (chưa được ghi) | unknown | rollback + postmortem |
| PR merge sạch (không revert trong 7 ngày) | ≥ 95% | `git log` theo tuần | unknown | RCA + lặp lại gate |
| Time-to-review | ≤ 1 ngày làm việc | lịch sử PR | unknown | nhắc reviewer; nếu do một người → phân quyền |

## Nhịp kiểm

- **Hằng tuần**: GH Actions duration + 3 lần chạy test ngẫu nhiên để bắt flaky.
- **Hằng tháng**: `npm run backup:drill` (xem `docs/RUNBOOK.md §8`) và cập nhật
  bảng ở trên với số liệu thật.
- **Hằng quý**: đánh giá lại ngưỡng; di chuyển chỉ số nào đạt đều vào gate cứng.

## Nguyên tắc

- Một chỉ số không quyết định được điều gì thì không nằm trong bảng này.
- Không có mục tiêu "100 cho vui": mỗi ngưỡng gắn với một hệ quả thật.
- `unknown` không phải lỗi — nó là lời nhắc phải đo. Gate không fail trên
  `unknown`; gate fail trên vi phạm có dữ liệu.
