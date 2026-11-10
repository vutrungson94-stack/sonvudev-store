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

## 7. Ai đo cái gì, và từ bằng chứng nào

Mục tiêu trong bảng ở mục 2 giờ có **một** nơi định nghĩa trong code:
`scripts/lib/slo.mjs`. Trước đó có hai bản sao — `scripts/slo-monitor.mjs` và
`scripts/sla-monitor.mjs` — và chúng **không đồng ý** với nhau: cùng một chỉ số
`buildSuccessRate` được một bên báo "unknown" (không có bằng chứng), bên kia báo
"100" (tệp báo cáo tồn tại). Hai câu trả lời cho cùng một câu hỏi, cả hai đều
được commit.

Hai script giờ chỉ còn là hai **người báo cáo**, dùng chung một danh sách mục tiêu,
chung một cách đo, chung một đơn vị:

| Chỉ số | Nguồn bằng chứng | Cơ sở | Trạng thái |
| --- | --- | --- | --- |
| `availability` | `logs/last-availability.json` — cửa sổ 30 ngày từ access log của edge | window | **unknown** (chưa có ai sinh file này) |
| `errorRate` | `logs/last-error-report.json` | window | **unknown** |
| `latencyP95` | `logs/last-latency.json` (`p95Seconds` → **ms**) | window | **unknown** |
| `testPassRate` | `test_output.log` | lần chạy gần nhất | đo được khi có log |
| `buildSuccessRate` | `build-reports/web-build.json` — kết quả build gần nhất, **không phải tỉ lệ** | lần chạy gần nhất | đo được |
| `deploySuccessRate` | `logs/last-deploy.json` — do bước deploy ghi sau khi xong | lần chạy gần nhất | **unknown** |
| `escapeRate` | `metrics-defect-escape.json` | window | **unknown** |

Nguyên tắc: **không có bằng chứng thì báo `unknown`, không báo 0 và không báo 100.**
0 là một phép đo; `null` là sự vắng mặt của phép đo. `sampleSize` đi kèm mỗi giá
trị để người đọc biết con số được làm từ bao nhiêu mẫu.

Hai lỗi đơn vị đã sửa:

- `latencyP95` trước đây có `target: 500` với `measure: 'seconds'` trong khi tài
  liệu nói 400 **ms** — cùng một con số, hai đơn vị. Giờ đo bằng ms, đúng như bảng
  ở mục 2.
- `availability` không còn lấy từ một lần probe sức khoẻ ("đang lên hay không" là
  câu hỏi khác với "99,5% trong 30 ngày"). Probe sức khoẻ là câu hỏi khác, và nó
  không được dùng để đứng ra một tuyên bố 99,9%.

## 8. Chất lượng trang, đo bằng Lighthouse và RUM

Hai gate mới, cùng nguyên tắc: **đo trang thật, bằng trình duyệt sạch, và fail
đúng chỗ**.

- `npm run lighthouse:check -- <url>` — chạy Lighthouse headless, **tắt extension**
  (chính extension Google Translate đã tạo ra cảnh báo "unused JavaScript 443 KB"
  cho trang này), và kiểm tra: performance ≥ 0,85, accessibility/SEO/best-practices
  ≥ 0,90, LCP ≤ 2500 ms, CLS ≤ 0,1, không tài nguyên nào của site bị cache ngắn
  hạn, không script nào của site bị chưa minify. Byte của bên thứ ba (beacon
  Cloudflare) **được báo, không bị fail** — không phải của site thì không sửa được.
  CI chạy job `lighthouse` sau khi `deployed-site` xác nhận host đang phục vụ đúng
  commit.
- `public/quality.js` (RUM) — đo LCP/CLS/TTFB/INP và lỗi JS trong trình duyệt
  thật rồi gửi về `/api/quality`. Nó **giờ được nạp trên mọi trang**, kể cả trang
  chủ, trang sản phẩm và blog — trước đó thiếu đúng ba trang quan trọng nhất, nên
  số liệu hiện trường vắng mặt ở nơi cần nhất. Công thức TTFB đổi sang Navigation
  Timing Level 2 (`responseStart - startTime`), vì cách cũ bỏ sót redirect, DNS và
  TLS: trên trang có redirect, đó gần như toàn bộ thời gian chờ.
- **Hai script analytics tải sau sự kiện `load`** (`public/ga.js`,
  `public/cf-beacon.js`): request ra bên thứ ba không được cạnh tranh với lần vẽ
  đầu tiên, và không bị hủy khi khách rời trang sớm. Dấu hiệu của việc "đã hủy" là
  mã **499** ("client đã đóng request") trong Network tab — không phải lỗi của site.
  Số liệu đáng tin của chính shop là RUM `/api/quality`, vì nó dùng
  `navigator.sendBeacon` nên an toàn khi trang kết thúc.

## 9. DORA: chỉ đo được khi có dấu vết của một lần deploy

`scripts/dora-metrics.mjs` đọc **git tag**. Trong repo này `git tag` rỗng, nên báo
cáo DORA từng nói "0 lần deploy, lead time 0 ngày" — nó không sai, nó đo sự vắng
mặt của dữ liệu.

CI giờ gắn **một tag cho mỗi lần deploy** (job `release-tag`, chạy sau
`deployed-site`, tức là sau khi host đã xác nhận phục vụ đúng commit). Một tag khi
đó có nghĩa là "đã deploy", không phải "đã commit".

Khi chưa có mẫu nào, các giá trị là `null` kèm `sampleSize: 0` — không phải 0.
Và `--check` không so một tỉ lệ 0 mẫu với một tỉ lệ 2 mẫu để tuyên bố hồi quy.

Lưu ý kỹ thuật: `git tag --creatordate` không chạy trên mọi phiên bản git, và lỗi
đó **im lặng** — mọi tag biến mất và báo cáo nói "không có deploy nào". Script giờ
dùng `git for-each-ref`, và `sampleSize` cho phép phân biệt "không có tag" với
"đọc sai cách".

