# SLO của chính quy trình — process SLOs

Tài liệu này đặt ngưỡng cho **quy trình**, không phải cho dịch vụ (mục SLA nằm ở
`docs/SLO.md`, `SLA.md`). Một quy trình không đo được thì không có cách nào
phân biệt "tốt hơn" với "vẫn vậy, chỉ rộn ràng". Mỗi chỉ số: mục tiêu, nguồn,
người chịu trách nhiệm, hành động khi vi phạm. Nếu một chỉ số chưa có nguồn đo
thực tế, nó được ghi rõ là `unknown` — không gán 0 hay 100.

| Chỉ số | Mục tiêu | Nguồn | Trạng thái hiện tại | Hành động khi vi phạm |
| --- | --- | --- | --- | --- |
| CI wall time (push → checks xanh) | ≤ 10 phút | GitHub Actions duration (`gh run list`) | unknown | chia nhóm test, cache NPM |
| Local build wall time (gbuild) | ≤ 180 s, không có trend > 2,0 s/mẫu với R² > 0,4 | `build-reports/telemetry.jsonl` + anomaly detector của gbuild | 121,1 s (17/11); bước nhảy 97→146 s ngày 12/11 do thêm coverage gate, không phải regression | đọc scope timings, chia gate; không hạ ngưỡng anomaly để xanh |
| Flaky test rate | ≤ 2% | 3 lần chạy cùng commit, fail-rồi-pass | unknown | fix hoặc cô lập test; ghi RCA |
| Gate/build pass rate (CI) | ≥ 95% | lịch sử `.github/workflows/checks.yml` | unknown | RCA + phòng ngừa |
| Coverage gate | ≥ 70/60/70 (lines/branches/functions) | `npm run coverage` | 86,43 / 72,50 / 79,55 (2026-11-17) | không được phép giảm; CI đỏ |
| Restore drill (backup) | hằng tháng, ≤ 60 phút, trên máy sạch | `npm run backup:drill` + tick trong `docs/RUNBOOK.md §8` | **đã có drill, chưa chạy lần khôi phục thật trong điều kiện mới** | drill fail → khóa `main`, mở RCA |
| MTTR sự cố production | ≤ 4 giờ | `postmortems/` | chưa đo (0 postmortem ghi nhận downtime) | RCA bắt buộc sau mỗi sự cố |
| Deploy success rate | 100% trên CI | `logs/last-deploy.json` (chưa được ghi) | unknown | rollback + postmortem |
| PR merge sạch (không revert trong 7 ngày) | ≥ 95% | `git log` theo tuần | unknown | RCA + lặp lại gate |
| Time-to-review | ≤ 1 ngày làm việc | lịch sử PR | unknown | nhắc reviewer; nếu do một người → phân quyền |
| Edge cache HIT rate | ≥ 80% trên `/`, `/en/`, static, trang sản phẩm sau khi rule có hiệu lực | `metrics-cache-hit.json` (`npm run cache:check`, chạy daily) | 0% (17/11: `DYNAMIC` trên mọi path dù Cache Rule `cache=true`/`respect_origin`, `cache_level=basic`, Dev Mode off, Bot Fight Mode off, Page Rules=0; Rule simulator & Request Trace API đều trả "hostname does not belong to your account"). **Probe 17/11 (quyết định):** thêm tạm Cache Rule `override_origin` 60 s cho một path riêng → vẫn `DYNAMIC` (rule đã gỡ, chỉ còn "Storefront edge cache"); `/styles.min.css` + `/og.png` (đuôi mặc định được cache) cũng `DYNAMIC`; site Cloudflare đối chứng trả `HIT` cho favicon trong cùng môi trường → cache không bật ở tầng zone/account, không phải biểu thức rule. Tracking: đã đăng bài Cloudflare Community category CDN ngày 17/11 — **1 post pending moderator approval** (link sẽ bổ sung khi duyệt). CF-RAY: `a5bc62f78c220fe0-HKG`, `a5bc7a01f84b84e5-HKG`. | chờ câu trả lời Community/Support; gửi Support 3 probe trên (override_origin vẫn DYNAMIC, static DYNAMIC, site đối chứng HIT); origin cache vẫn là lớp chịu tải chính |

## Nhịp kiểm

- **Hằng tuần**: GH Actions duration + 3 lần chạy test ngẫu nhiên để bắt flaky.
- **Hằng tháng**: `npm run backup:drill` (xem `docs/RUNBOOK.md §8`) và cập nhật
  bảng ở trên với số liệu thật.
- **Sau khi edge HIT ổn định**: đổi Browser Cache TTL toàn zone từ 4h xuống 1h
  (HTML), giữ `max-age=31536000, immutable` cho asset đã hash; cân bằng tốc độ
  với độ trễ nhìn thấy sau deploy.
- **Hằng quý**: đánh giá lại ngưỡng; di chuyển chỉ số nào đạt đều vào gate cứng.

## Nguyên tắc

- Một chỉ số không quyết định được điều gì thì không nằm trong bảng này.
- Không có mục tiêu "100 cho vui": mỗi ngưỡng gắn với một hệ quả thật.
- `unknown` không phải lỗi — nó là lời nhắc phải đo. Gate không fail trên
  `unknown`; gate fail trên vi phạm có dữ liệu.
