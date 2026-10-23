# SLO và ngân sách lỗi

Mục đích: biến "cửa hàng chạy ổn không" thành những con số có thể tranh luận được.
Mỗi chỉ số dưới đây gắn với một nguồn dữ liệu thật trong repo này, không phải một
dashboard tưởng tượng.

## 1. Định nghĩa chỉ số (SLI)

| SLI | Nguồn | Cách tính |
| --- | --- | --- |
| Tính sẵn sàng | Caddy access log + `/api/health` | Tỉ lệ request không phải 5xx / tổng request, cửa sổ 30 ngày |
| Độ trễ trang | Caddy access log (`duration`) | p95 và p99 của request HTML (`/`, `/san-pham`, trang đơn) |
| Độ trễ API | Caddy access log | p95 của `/api/*` |
| Tỉ lệ đơn hoàn tất | Supabase (`orders`) + log thanh toán | đơn `paid` / đơn `created` trong 24 giờ |
| Tỉ lệ gửi email | Log `[notify]` / Resend | email gửi thành công / email cần gửi |
| Webhook đúng hạn | Log `[paypal]` | webhook xử lý < 60 giây sau khi PayPal gửi |

Không có hệ thống metric tập trung bắt buộc. Nếu chưa có, dùng log Caddy (JSON) và
script `npm run benchmark` bên dưới; khi có OTLP collector, dựng dashboard từ
`http.target`, `http.status_code` và thời lượng span.

## 2. Mục tiêu (SLO)

Giả định: một VPS, không HA, Supabase và các nhà cung cấp bên ngoài là phụ thuộc.
Đây là mục tiêu **cam kết nội bộ**, không phải SLA thương mại.

| Chỉ số | Mục tiêu 30 ngày | Ngưỡng cảnh báo sớm | Trang |
| --- | --- | --- | --- |
| Tính sẵn sàng | ≥ 99,5% | < 99,7% trong 24 giờ | P1 nếu < 99% |
| p95 trang HTML | ≤ 800 ms | > 1 200 ms trong 15 phút | P2 |
| p95 API | ≤ 400 ms | > 700 ms trong 15 phút | P2 |
| Tỉ lệ lỗi 5xx | ≤ 1% | > 2% trong 10 phút | P1 nếu > 5% |
| Đơn hoàn tất | ≥ 95% | < 90% trong 24 giờ | P1 |
| Webhook < 60 giây | ≥ 99% | 2 webhook liên tiếp quá hạn | P2 |

Mục tiêu 99,5% cho phép khoảng **3 giờ 39 phút** downtime mỗi 30 ngày. Đừng đặt
99,9% khi chỉ có một máy: con số đó chỉ tạo ra cảm giác an toàn giả.

## 3. Ngân sách lỗi

Với SLO 99,5%:

- 30 ngày ≈ 43 200 phút → ngân sách lỗi ≈ 216 phút (0,5%).
- Mỗi sự cố P1 tính theo thời gian thực tế người mua không dùng được.
- Canary/rollback không được tính là downtime nếu Caddy vẫn trả 200 từ instance
  còn lại; ghi rõ trong incident.

Quy tắc:

- Đốt **> 50%** ngân sách trong 7 ngày: dừng tính năng mới, dành một ngày sửa độ
  bền vững (flaky test, health check, giám sát).
- Đốt **100%**: mọi thay đổi phải qua canary 100% + 24 giờ trước khi promote.
- Sự cố lặp lại **hai lần** cùng nguyên nhân: mở action item trong
  `docs/INCIDENT-TEMPLATE.md`, có người và hạn chót.

## 4. Cách đo

### 4.1 Benchmark cục bộ

```bash
npm start &                       # hoặc trỏ vào môi trường thật
BASE_URL=http://127.0.0.1:3000 npm run benchmark
```

`scripts/benchmark.mjs` gọi lần lượt `/`, `/api/products`, `/api/health`, bỏ qua
request làm ấm, rồi in p50/p95/p99, tỉ lệ lỗi và ghi
`build-reports/perf-baseline.json`. Chạy trên máy chủ thật, cùng thời điểm trong
ngày, ít nhất 200 request mỗi route. Không chạy benchmark vào giờ cao điểm bán hàng.

Baseline được ghi lại trong issue/ticket của lần deploy đầu tiên; từ đó so sánh
tương đối. Con số tuyệt đối phụ thuộc máy, nên chỉ dùng để phát hiện hồi quy, không
dùng để so sánh với VPS khác.

### 4.2 Từ log Caddy

```bash
# 100 request gần nhất, thời lượng (giây) và status
tail -n 100 /var/log/caddy/sonvudev-access.log \
  | jq -r '[.ts, .status, .duration] | @tsv'

# Tỉ lệ 5xx trong 1 giờ
tail -n 20000 /var/log/caddy/sonvudev-access.log \
  | jq -r 'select(.ts > (now - 3600)) | .status' \
  | awk '{n++; if ($1 >= 500) bad++} END {printf "5xx: %.2f%% (%d/%d)\n", bad*100/n, bad, n}'
```

Nếu `jq` chưa có: `apt-get install -y jq`. Caddy ghi log JSON mỗi request ở
`/var/log/caddy/sonvudev-access.log` (xem `deploy/Caddyfile`).

### 4.3 Từ ứng dụng

`/api/health` trả JSON có `checks`, `persistence`, `mail`, `sweeper`. Script
`npm run health:check` dùng cho cron/uptime monitor ngoài. Không có alert manager
trong repo này: cấu hình uptime monitor (UptimeRobot/Better Stack/Cloudflare) trỏ
vào `/api/health` và một trang sản phẩm, cảnh báo qua kênh liên lạc của đội.

## 5. Đo canary

`X-Deployment-Channel` cho biết instance trả lời (`stable`/`canary`);
`X-Canary-Assignment` cho biết quyết định chia traffic. Trong log Caddy, thêm hai
header này vào bản ghi nếu cần phân tích:

```bash
grep '"x-deployment-channel":"canary"' /var/log/caddy/sonvudev-access.log | tail
```

Tiêu chí promote (đề xuất, ghi rõ trong ticket):

- 100% traffic canary ≥ 30 phút.
- p95 canary ≤ 110% p95 stable.
- 0 lỗi thanh toán, 0 lỗi tải file.
- Không có `[unhandledRejection]` mới.

## 6. Rà soát

- **Hàng tuần**: đọc error budget, xác nhận health check ngoài vẫn hoạt động, kiểm
  tra chứng chỉ TLS còn > 14 ngày.
- **Hàng tháng**: chạy benchmark, so với baseline, cập nhật bảng SLO nếu mục tiêu
  không còn phù hợp với thực tế.
- **Sau mỗi incident**: cập nhật runbook nếu bước xử lý đã thay đổi; thêm test hồi
  quy nếu lỗi có thể tái hiện.

Một SLO không được đo là một khẩu hiệu. Nếu không ai đọc bảng này trong một tháng,
hoặc xóa nó, hoặc biến nó thành một bước trong checklist trực ca.
