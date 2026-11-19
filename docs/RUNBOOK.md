# Runbook vận hành SonVuDev Store

Tài liệu này dành cho người trực vận hành (on-call). Mục tiêu: từ một cảnh báo hoặc
một lời phàn nàn của người mua, đi tới câu trả lời "hệ thống đang thế nào, ai đang
bị ảnh hưởng, làm gì tiếp theo" trong vài phút, không phải vài giờ.

Mọi lệnh dưới đây chạy trên VPS Ubuntu đã bootstrap bằng
`deploy/bootstrap-ubuntu.sh`. Đường dẫn chuẩn:

| Thành phần | Đường dẫn |
| --- | --- |
| Bản ổn định | `/opt/sonvudev-store/current` (symlink) |
| Các bản đã phát hành | `/opt/sonvudev-store/releases/<id>` |
| Bản canary | `/opt/sonvudev-store/canary` (symlink) |
| Dữ liệu ghi được | `/opt/sonvudev-store/shared` |
| Cấu hình | `/etc/sonvudev-store.env` |
| Tỉ lệ canary | `/etc/sonvudev-store.canary` |
| Unit ổn định | `sonvudev-store.service` |
| Unit canary | `sonvudev-store-canary.service` |
| Proxy | Caddy, cấu hình `/etc/caddy/Caddyfile` |

## 1. Kiểm tra nhanh khi có cảnh báo

```bash
# Dịch vụ có đang chạy không?
systemctl status sonvudev-store --no-pager
systemctl status caddy --no-pager

# Ứng dụng tự báo trạng thái gì? 200 = mọi probe đều đạt, 503 = có probe hỏng.
curl -fsS http://127.0.0.1:3000/api/health

# Canary (nếu đang triển khai)
deploy/canary.sh status
```

`/api/health` trả 503 khi **bất kỳ** probe nào hỏng: kết nối Supabase, thư mục dữ
liệu không ghi được, bộ hẹn giờ quét đơn dừng, R2/PayPal thiếu cấu hình. Đọc phần
`checks` trong JSON trước khi đoán.

Ba header hữu ích trên mọi phản hồi:

- `X-Request-Id` — id của request, dùng để `grep` log.
- `X-Trace-Id` — trace id, khớp với span gửi tới OTLP collector.
- `X-Deployment-Channel` — `stable` hoặc `canary`, cho biết **instance nào** đã trả lời.
- `X-Canary-Assignment` — `stable`, `canary` hoặc `off`, cho biết lần chia traffic
  vừa rồi quyết định gì.

## 2. Bản đồ hệ thống

```
Người mua
   │ HTTPS
   ▼
Caddy (TLS, nén, log JSON)
   │  cookie svd_canary=1  ──────────────► canary 127.0.0.1:3001
   │  còn lại                            └► stable 127.0.0.1:3000
   ▼
Node/Express
   ├── Supabase (đơn hàng, sản phẩm, rate limit dùng chung)
   ├── Cloudflare R2 (file phát hành, link tải có hạn)
   ├── Resend (email xác nhận và link tải)
   ├── PayPal (thanh toán quốc tế, webhook)
   └── OTLP collector (tùy chọn, chỉ khi đặt OTEL_EXPORTER_OTLP_ENDPOINT)
```

Không có cơ sở dữ liệu riêng trên VPS khi Supabase đã cấu hình. `DATA_DIR` chỉ là
đường lui JSON khi Supabase vắng mặt; nó vẫn phải ghi được vì health probe kiểm tra
điều đó.

## 3. Deploy bản ổn định

Luôn qua pipeline, không copy tay:

```bash
cd /opt/sonvudev-store            # checkout dùng để build
npm ci
npm test                          # phải xanh
npm run build                     # audit, lint, metrics, provenance
npm run check:publish-output      # artifact khớp nguồn
sudo deploy/deploy.sh             # mặc định lấy publish-output/node
```

`deploy.sh` từ chối artifact chứa `.env`, `.git`, `data/`, `logs/` hoặc bản sao
secret; sau khi chuyển symlink `current` nó restart service, validate Caddyfile rồi
reload Caddy và **tự gọi `/api/health`**. Deploy chỉ thành công khi health trả 200.

Nếu deploy hỏng ở bước health: bản mới đã là `current` nhưng chưa phục vụ tốt.
Làm theo mục 6 (rollback bản ổn định), đừng sửa trực tiếp trên máy.

## 4. Canary rollout

Canary là **một instance thứ hai** chạy cùng mã nguồn, cùng file env, cùng
`DATA_DIR`, chỉ khác cổng và `DEPLOY_CHANNEL=canary`. Caddy định tuyến theo cookie
`svd_canary=1`; `src/canary.js` quyết định ai nhận cookie bằng hash IP và tỉ lệ
trong `/etc/sonvudev-store.canary`.

```bash
# 1. Đưa ứng viên lên, 10% người mới vào canary
sudo deploy/canary.sh start 10

# 2. Theo dõi vài phút, rồi mở rộng dần. Không cần restart.
sudo deploy/canary.sh split 25
sudo deploy/canary.sh split 50
sudo deploy/canary.sh split 100

# 3. Khi 100% đã ổn định đủ lâu: canary trở thành bản ổn định
sudo deploy/canary.sh promote

# Hoặc trả mọi người về bản ổn định ngay lập tức
sudo deploy/canary.sh rollback
```

Điểm cần nhớ:

- `start` **không** thay bản ổn định. Nó chỉ thêm instance và route cookie.
- Tỉ lệ được đọc lại mỗi 5 giây ở cả hai instance; `split` không restart gì cả.
- Người đã nhận cookie giữ nguyên kênh cho tới khi cookie hết hạn (1 giờ) hoặc bị
  xóa bởi `rollback`/`split 0`.
- `promote` là lệnh duy nhất đổi symlink `current` và restart bản ổn định. Nếu
  health sau promote hỏng, script tự trỏ `current` về bản cũ và báo động.
- Tiêu chí rollback: tỉ lệ lỗi 5xx của canary cao hơn stable rõ rệt, p95 chậm hơn
  > 30%, hoặc có lỗi thanh toán/tải file. Không chờ tới khi đủ 100%.

Kiểm tra canary đang nhận đúng traffic:

```bash
curl -sI https://<domain-của-bạn>/ | grep -i 'x-deployment-channel\|x-canary-assignment'
# Ép thử một request vào canary mà không cần đổi tỉ lệ:
curl -sI --cookie 'svd_canary=1' https://<domain-của-bạn>/ | grep -i x-deployment-channel
```

## 5. Log và điều tra

```bash
# Log ứng dụng (một dòng mỗi request, có request id và trace id)
journalctl -u sonvudev-store -n 100 --no-pager
tail -f /var/log/sonvudev-store.log

# Log canary
journalctl -u sonvudev-store-canary -n 100 --no-pager
tail -f /var/log/sonvudev-store-canary.log

# Log truy cập của Caddy (JSON, có thời gian, status, thời lượng)
tail -f /var/log/caddy/sonvudev-access.log
```

Tìm một request cụ thể:

```bash
# Lấy id từ phản hồi hoặc từ ảnh chụp màn hình của người mua
journalctl -u sonvudev-store --since '30 min ago' | grep '<request-id>'
```

Những log quan trọng:

- `[unhandledRejection]` / `[uncaughtException]` — lỗi lập trình; ghi lại rồi mở
  incident nếu lặp lại.
- `[rate-limit]` — cửa sổ 15 phút, cho biết IP và route bị chặn.
- `[geo]`, `[paypal]`, `[r2]` — lỗi từ nhà cung cấp bên ngoài.
- `Persistence: supabase` lúc khởi động — nếu thấy `json`, Supabase đang mất cấu
  hình và đơn hàng đang ghi ra đĩa cục bộ. Kiểm tra ngay.

Khi có OTLP collector, span có `http.target`, `http.status_code`; đối chiếu trace id
trong log với trace trong collector. Không có collector thì `exportSpan` là no-op,
không ảnh hưởng request.

## 6. Rollback bản ổn định

Canary đang bật: dùng `deploy/canary.sh rollback` trước, rồi làm tiếp nếu bản ổn
định cũng hỏng.

Bản ổn định vừa deploy hỏng:

```bash
ls -1 /opt/sonvudev-store/releases | tail -n 5
sudo ln -sfn /opt/sonvudev-store/releases/<id-tốt> /opt/sonvudev-store/current
sudo systemctl restart sonvudev-store
curl -fsS http://127.0.0.1:3000/api/health
```

Sau khi ổn định, ghi lại release id, thời điểm và triệu chứng vào incident. Không
xóa release hỏng cho tới khi có RCA.

## 7. Sự cố thường gặp

**Health trả 503, `checks.storage` false**
`DATA_DIR` không ghi được. Kiểm tra `ls -ld /opt/sonvudev-store/shared` (phải thuộc
`sonvudev`) và `df -h`. Unit chạy `ProtectSystem=strict`, chỉ shared là ghi được.

**Health trả 503, `checks.supabase` false**
Sai `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, hoặc Supabase đang bảo trì. Kiểm tra
`curl "$SUPABASE_URL/rest/v1/" -H "apikey: $KEY"`. Trong lúc chờ, cửa hàng vẫn
đọc được catalog cũ trong bộ nhớ nhưng checkout sẽ lỗi — thông báo rõ cho người mua.

**Thanh toán xong nhưng đơn vẫn pending**
PayPal webhook không tới hoặc thiếu `PAYPAL_WEBHOOK_ID`. Kiểm tra log `[paypal]`,
dashboard PayPal > Webhooks > Deliveries, rồi mở trang đơn của người mua để xác
nhận trạng thái. Không đánh dấu thủ công nếu chưa đối chiếu giao dịch.

**Người mua không nhận email**
Thiếu `RESEND_API_KEY` thì thư được ghi vào `DATA_DIR/outbox` thay vì gửi. Kiểm tra
`notifyMode()` trong log (`Persistence`/`Mail` lúc boot) và thư mục outbox.

**Tải file báo 403/404**
Link R2 có hạn (`R2_DOWNLOAD_URL_TTL_SECONDS`, mặc định 600 giây). Người mua mở lại
trang đơn để lấy link mới. Nếu mọi link đều hỏng: kiểm tra khóa R2 và CORS bucket.

**429 hàng loạt**
Rate limit dùng chung qua Supabase (`rate_limit_hits`). Kiểm tra bảng có tồn tại và
`RATE_LIMIT_STORE` không bị đặt `memory` ngoài ý muốn. Nếu một IP xấu đang quấy phá,
chặn ở Caddy/Cloudflare thay vì nâng hạn mức toàn hệ thống.

**Caddy không cấp được chứng chỉ**
`SITE_DOMAIN` chưa đúng trong môi trường của Caddy, hoặc DNS chưa trỏ về máy. Chạy
`caddy validate --config /etc/caddy/Caddyfile` và xem `journalctl -u caddy`.

**Đĩa đầy**
Log Caddy và log ứng dụng nằm ngoài `ReadWritePaths`, hãy kiểm tra `df -h` trước.
`npm run logs:prune` dọn log ứng dụng; logrotate của hệ thống lo phần còn lại.

## 8. Sao lưu và khôi phục

- **Supabase**: bật backup hàng ngày/PITR trong dashboard. Trước mọi migration lớn,
  chạy `npm run db:check` và chụp ảnh schema; migration áp dụng bằng
  `npm run db:migrate:apply`.
- **R2**: bật object versioning. File phát hành là tài sản bán được, không phải cache.
- **Dữ liệu JSON** (chỉ khi không dùng Supabase): `npm run backup` ghi bản sao vào
  `DATA_DIR/backups`; cất thêm một bản ngoài máy.
- **Khôi phục**: dựng bản mới từ release đã biết là tốt, trỏ `current`, khôi phục dữ
  liệu, rồi chạy lại health + một giao dịch thử ở chế độ sandbox.
- **Kiểm tra khả năng khôi phục (restore drill)**: `npm run backup:drill` — backup
  mới nhất phải: mọi file JSON parse được, `products`/`orders` của Supabase khớp số
  dòng với live (read-only), byte-identical khi restore mô phỏng. Chạy **hằng
  tháng** hoặc sau mỗi lần backup đổi format. Nếu drill FAIL: khóa thay đổi mới,
  mở RCA, backup lại ngay rồi chạy drill lại.

## 9. Bảo mật và xoay khóa

- `ADMIN_API_TOKEN` là **mối admin duy nhất**, không có hạn và không có 2FA: xoay
  ngay khi nghi lộ bằng `npm run rotate:admin-token:apply`. Không tạo token admin
  thứ hai — một credential không được xoay là một cửa sau vĩnh viễn.
- `SUPABASE_SERVICE_ROLE_KEY` bỏ qua RLS. Chỉ đặt trong env của máy chủ, không bao
  giờ trong biến `NEXT_PUBLIC`/`PUBLIC` hay file tĩnh.
- Sau khi xoay khóa: restart service, kiểm tra health, xác nhận log không còn dùng
  khóa cũ, rồi thu hồi khóa cũ ở nhà cung cấp.
- Không dán secret vào ticket/chat. Dùng trình quản lý bí mật của đội.
- **Xoay ADMIN_API_TOKEN tự động (hằng tháng, ngày 01 lúc 02:00 UTC)** — xem
  `scripts/rotate-admin-token.mjs` và workflow `.github/workflows/rotate-admin-token.yml`:
  1. Secrets cần có trên repo (Settings → Secrets and variables → Actions) — **cả 6 bắt buộc**:
     `RENDER_API_KEY`, `RENDER_SERVICE_ID`, `RESEND_API_KEY`, `APP_URL`,
     `SUPPORT_EMAIL`, `EMAIL_FROM`. **Không có fixture fallback**: thiếu biến nào thì
     script thoát mã 2 và liệt kê đúng tên trước khi gọi API.
     - `RENDER_API_KEY`: Render → Account Settings → API Keys → Create API Key.
       Đây là **GitHub secret**, không phải env var của service.
     - `RENDER_SERVICE_ID`: chạy `npm run render:service-id` (liệt kê `srv-...`
       theo tên) hoặc lấy từ URL dashboard Render (`.../web/srv-...`).
  2. Local safety: `npm run rotate:admin-token` không chạm vào gì — chỉ in kế hoạch;
     xoay thật: `npm run rotate:admin-token:apply`.
  3. Preflight: nếu không đọc được `ADMIN_API_TOKEN` cũ từ Render API, script **từ chối
     xoay** (không có rollback thì không được đổi). Chỉ khi chắc chắn chưa có token cũ
     mới dùng `node scripts/rotate-admin-token.mjs --apply --bootstrap` (tạo mới, không rollback).
  4. Script luôn: đọc token cũ → PUT duy nhất biến `ADMIN_API_TOKEN` → deploy → poll
     `/api/admin/products` với token mới tới khi 200 → **mới gửi email token mới
     cho SUPPORT_EMAIL** qua Resend. Lỗi ở bất kỳ bước nào trước email → tự rollback
     về token cũ + redeploy + email cảnh báo (email nói rõ rollback thành công hay thất bại).
  5. Sau email, cập nhật token trong admin panel / bookmark / script ở máy của bạn.
  6. Chạy thử trước khi tin cậy: Actions → `rotate-admin-token` → "Run workflow".
     Kiểm tra `gh secret list` trước: repo hiện chỉ có `APP_URL`, còn 5 biến kia phải thêm.

### SLO 30 ngày từ Cloudflare Analytics

- Render free plan trả `requests=0` trên metrics API và log app chỉ giữ vài giờ.
  Nguồn duy nhất cho cửa sổ 30 ngày thật là **Cloudflare GraphQL Analytics**:
  ```
  CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=<zone tag> npm run slo:ingest:cloudflare
  npm run slo:check
  ```
- Token cần **`Account → Account Analytics → Read`** (scope account) **và**
  `Zone → Analytics → Read` (scope zone `sonvudev.com`). `httpRequests*` là dataset
  cấp account: chỉ có quyền zone thì node trả **danh sách rỗng** (không báo lỗi),
  còn truy vấn `viewer.accounts` báo `not authorized for that account`. Đã kiểm
  17/11/2026: `settings { httpRequestsAdaptiveGroups { enabled notOlderThan } }`
  = `enabled: true`, giữ 31 ngày — nên 0 dòng là thiếu quyền, không phải zone cấu hình sai.
- Script **từ chối ghi evidence** khi Cloudflare trả 0 dòng (exit 2) để một lỗi
  quyền không xoá số đo thật; `--allow-empty` là opt-in cho cửa sổ thật sự không
  có request. Availability/errorRate lấy từ `httpRequestsAdaptiveGroups` nhóm theo
  `edgeResponseStatus` (5xx = unavailable); **latency vẫn unknown** vì adaptive groups
  không có dimension p95 — trung thực hơn là đoán.
- Các nguồn cũ vẫn giữ: `--render-logs` (sampled, ghi `sampled`/`coverageDays`),
  `--file=logs/access-30d.json` (export ngoài). Mỗi evidence file ghi rõ `source`.
- **Coverage là dữ liệu thật, không phải cửa sổ yêu cầu.** Script lấy bucket
  5 phút đầu/cuối trả về dữ liệu và ghi `observedFrom`/`observedTo`/`coverageDays`
  theo đó. Bật O2O giữa tháng thì bản ingest đầu tiên ghi `coverageDays≈0.014`;
  `metrics-slo.json` đánh dấu `partialWindow: true`. **Đủ 30 ngày liên tục là
  17/12/2026** — trước đó availability/errorRate là bằng chứng một phần.
- Workflow `metrics-trends` (daily 03:00 UTC) chạy `slo:ingest:cloudflare
  --days=30` → `slo:check` → commit `metrics-slo.json`. Cần secrets
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `APP_URL`.

### Xoay token Cloudflare (90 ngày)

- Token **không tự gia hạn**. Token hiện tại `expires_on=2027-02-15`. Workflow
  `metrics-trends` chạy `npm run cf:token:check:30`: verify
  `/user/tokens/verify` và đỏ khi còn <30 ngày.
- **Xoay 1 nhấn (đã triển khai).** Workflow `cf-token-reminder` chạy ngày 1 hằng
  tháng (`0 4 1 * *`): đọc token hiện tại từ Render, gửi qua Resend một link
  **đã ký HMAC-SHA256, hết hạn sau 72h** (`npm run cf:rotation:remind`). Link trỏ
  tới `GET /api/rotation/confirm` — chỉ hiển thị một form POST, nên trình xem
  link của mail client không thể tự xoay. `POST /api/rotation/execute` kiểm tra
  lại chữ ký (giới hạn 10 req/15 phút/IP) rồi mới đổi. Không có giá trị token
  nào được gửi qua email — chỉ có link đã ký.
- **Render là nguồn sự thật** của `CLOUDFLARE_API_TOKEN`. GitHub Actions đọc
  token từ Render lúc chạy (secrets `RENDER_API_KEY`, `RENDER_SERVICE_ID`), nên
  sau khi xoay **không cần sửa GitHub Secret** (Secret `CLOUDFLARE_API_TOKEN` cũ
  có thể xóa để tránh nhầm). Quy trình xoay theo thứ tự: đọc policy token cũ →
  tạo token thay thế (hạn +90 ngày, cùng permissions) → verify token mới →
  `PUT /env-vars/CLOUDFLARE_API_TOKEN` + deploy trên Render → gửi mail xác nhận →
  **cuối cùng mới revoke token cũ**. Nếu bước nào trước mail thất bại, token mới
  bị xóa và token cũ vẫn nguyên; nếu chỉ revoke cuối thất bại, mail báo token id
  cần thu hồi tay.
- **Secrets cần có:** trên Render — `CLOUDFLARE_API_TOKEN` (token đang dùng),
  `CLOUDFLARE_MASTER_TOKEN` (quyền **User: API Tokens: Read + Edit/Write** để
  tạo/xoá token con), `ROTATION_SIGNING_KEY` (chuỗi ngẫu nhiên ≥32 byte, cùng giá trị với
  GitHub); trên GitHub — `RENDER_API_KEY`, `RENDER_SERVICE_ID`,
  `ROTATION_SIGNING_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL`,
  `APP_URL`, `CLOUDFLARE_ZONE_ID`.
- **Nơi đặt từng token** (để không đặt nhầm chỗ):

  | Token | Đặt ở đâu | Dùng cho |
  |---|---|---|
  | `CLOUDFLARE_API_TOKEN` (CI) | **Render env** — nguồn sự thật; CI đọc lúc chạy | purge cache, analytics, SLO; rotation cập nhật chính nó |
  | `CLOUDFLARE_MASTER_TOKEN` | **Render env** | tạo/xoá token con trong rotation; không đưa cho CI |
  | `FLY_API_TOKEN` | **GitHub Actions secret** của repo | workflow auto-deploy Fly (`flyctl deploy`) |
  | `RENDER_API_KEY`, `RENDER_SERVICE_ID` | **GitHub Actions secret** | đọc env và trigger deploy Render |
  | Origin CA key | **không cần** | TLS do Cloudflare proxy tới `fly.dev`/`onrender.com`; origin không dùng chứng chỉ riêng |

  Không có token tên **"Origin Create Token"** trong kiến trúc hiện tại — đó không
  phải token thứ ba cần tạo. Nếu nguồn gốc của tên này là nút *Create Token*:
  - muốn tạo được **token Cloudflare mới khi rotation** → đó là
    `CLOUDFLARE_MASTER_TOKEN` (Render env);
  - muốn **deploy Fly** từ GitHub Actions → đó là `FLY_API_TOKEN` (secret
    của repo), tạo bằng `flyctl tokens create deploy -a sonvudev-store --name github-actions`.
  Render không bao giờ đọc `FLY_API_TOKEN`, nên đừng đặt nó bên Render env; ngược
  lại, đừng đặt Cloudflare token bên GitHub — GitHub secret
  `CLOUDFLARE_API_TOKEN` cũ có thể xoá vì CI đã đọc token từ Render.

- **Tạo 2 token Cloudflare** (dashboard → avatar → **My Profile → API Tokens → Create Token → Custom token**):
  1. `CLOUDFLARE_API_TOKEN` (token cho CI): quyền `Zone → Cache Purge → Purge`,
     `Zone → Zone → Read`, `Zone → Analytics → Read`, `Account → Account Analytics → Read`;
     *Zone Resources*: Include → Specific zone → `sonvudev.com`; *Account Resources*:
     Include → Specific account (tài khoản chứa `sonvudev.com`); TTL 90 ngày.
  2. `CLOUDFLARE_MASTER_TOKEN` (token cho rotation): quyền `User → API Tokens → Read`
     và `User → API Tokens → Edit` (dashboard một số bản ghi `Write`); không giới
     hạn zone/account vì phạm vi là user; TTL tuỳ ý (không đặt thời hạn hoặc 1 năm).
  3. Sau khi tạo, Cloudflare chỉ hiện giá trị **một lần** — copy ngay vào password
     manager, rồi dán vào đúng chỗ trong bảng trên. Kiểm tra cả hai bằng
     `curl -s -H "Authorization: Bearer <token>" https://api.cloudflare.com/client/v4/user/tokens/verify`
     (phải trả `status: active`).
- Token đang dùng đã lộ trong chat (id `40654ef8bb09066fa93bbf49af6ecda7`,
  hạn `2027-02-15`): **sau khi setup xong, bấm link xoay một lần rồi revoke token
  cũ**. Tách quyền tối thiểu: purge chỉ cần `Zone:Zone:Read` +
  `Zone:Cache Purge:Purge`; SLO chỉ cần `Account Analytics:Read` +
  `Zone Analytics:Read`. `CLOUDFLARE_MASTER_TOKEN` là token riêng, không chia sẻ
  với CI.

### Purge edge cache sau deploy

- `checks.yml` chạy `npm run cache:purge` **sau** khi `/api/health` báo đúng sha
  và **trước** `seo:check`. Token được đọc từ Render env qua
  `scripts/gha-read-cf-token.mjs`, nên không cần GitHub Secret
  `CLOUDFLARE_API_TOKEN` nữa (secret cũ có thể xoá). Quyền tối thiểu cho purge:
  `Zone:Zone:Read` + `Zone:Cache Purge:Purge`, scope đúng zone `sonvudev.com`;
  SLO ingest cần thêm `Account Analytics:Read` + `Zone Analytics:Read`.
- Khi Render env còn trống (hiện tại `CLOUDFLARE_API_TOKEN` và
  `CLOUDFLARE_MASTER_TOKEN` đang rỗng), bước purge **no-op xanh** (cố tình): thiếu
  token không được làm đỏ một deploy tốt. Origin cache + single-flight vẫn là lớp
  chịu tải chính.
- Kiểm tra: `gh secret list --repo vutrungson94-stack/sonvudev-store` phải thấy cả
  `CLOUDFLARE_API_TOKEN` và `APP_URL`.

### Edge failover khi origin suspend (18/11/2026)

- HTML công khai gửi `Cache-Control: public, max-age=86400,
  stale-while-revalidate=604800, stale-if-error=2592000`. Khi Render suspend
  (hết bandwidth/trả 503), Cloudflare **phục vụ HTML đã cache** thay vì trang
  "This service has been suspended" — cửa hàng vẫn đọc được (đọc, không đặt
  hàng). `/api/*` luôn `no-store`, nên checkout/lookup không bị cache.
- Đây là lý do TTL 1 ngày được chọn dù nonce CSP bị "đóng băng" trong thời gian
  cache: nonce vẫn khác nhau giữa các response do origin tạo, và Cloudflare JSD
  chèn script theo nonce của header được cache. Đổi TTL xuống 300 giây là đưa
  288 lần revalidation/ngày/trang trở lại — chính là nguyên nhân hết 5GB.
- Purge sau deploy (mục trên) là điều kiện bắt buộc để TTL dài không phục vụ bản
  cũ: `checks.yml` purge ngay sau khi sha khớp, trước `seo:check`.
- `cloudflare/keep-awake` ping mỗi **5 phút** (`*/5 * * * *`), vẫn dưới ngưỡng ngủ
  15 phút của Render nhưng cắt request origin từ 43.200 xuống 8.640/tháng.
- Xác nhận keeper còn sống: `npx wrangler tail sonvudev-keep-awake` phải in
  `[keep-awake] https://sonvudev.com -> ok (HTTP 200)` mỗi 5 phút. Không có dòng
  đó nghĩa là trigger hoặc secret `SHOP_URL` đã hỏng — im lặng không phải là khỏe.
- Giới hạn: đây là failover **chỉ đọc**. Muốn đặt hàng khi origin suspend cần
  origin thứ 2 (xem `docs/CHANGE-PLAN-2026-11-18-EDGE-FAILOVER.md`); Cloudflare
  Load Balancer (failover DNS thật) là tính phí, không dùng được trên free plan.

### Cân bằng tải giữa các host free — origin balancer (18/11/2026)

Worker `cloudflare/origin-balancer/worker.js` phân lượt truy cập đều qua nhiều
host free (Render + Fly/Koyeb...) và tự bỏ qua host đang suspend. Đây là phần
"đọc + ghi" mà failover cache ở trên không làm được.

**Chuẩn bị host thứ 2 (mỗi host có 5GB riêng):**

- **Fly.io** (khuyến nghị trước): đăng ký bằng GitHub tại `fly.io`, thêm thẻ
  (authorization hold, không charge). Cài CLI `iwr https://fly.io/install.ps1 -useb | iex`,
  rồi `fly auth login`. Trong repo: `fly launch --no-deploy --config cloudflare/origin-balancer/../Dockerfile`
  sẽ hỏi app name/region — hoặc tạo `fly.toml` với `[build] dockerfile = "Dockerfile"`
  và `[[services]] internal_port = 3000, http_check = "/api/health"`. Deploy:
  `fly deploy --build-arg GIT_COMMIT=$(git rev-parse HEAD)` (image không có
  `.git`, nên sha phải đi qua build arg để `/api/health` báo đúng commit cho
  gate `deployed-site`). Copy env vars từ Render sang: `fly secrets set APP_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ADMIN_API_TOKEN=... RESEND_API_KEY=... SUPPORT_EMAIL=... R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=... PAYPAL_ENVIRONMENT=... PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=...` (đúng giá trị với Render để đơn hàng/CSP/R2 nhất quán). Lấy URL `https://<app>.fly.dev`.
- **Koyeb** (nếu Fly không đăng ký được): đăng ký tại `koyeb.com` (không cần
  thẻ), New Service → GitHub repo → builder **Dockerfile** → port 3000 →
  health check `/api/health` → thêm cùng bộ env vars → deploy. URL dạng
  `https://<app>-<org>.koyeb.app`.

**Cấu hình balancer:**

```bash
# ORIGINS là secret — không gõ domain vào repo.
wrangler secret put ORIGINS --config cloudflare/origin-balancer/wrangler.jsonc
# dán: "https://sonvudev-store.fly.dev"
# thêm https://sonvudev-store.onrender.com khi Render hết suspend
wrangler deploy --config cloudflare/origin-balancer/wrangler.jsonc
```

Routes `sonvudev.com/*` và `www.sonvudev.com/*` nằm trong `wrangler.jsonc`
(`workers_dev:false`), nên `wrangler deploy` gắn trigger luôn — không thêm tay
trong dashboard.

**Hoạt động:** visitor được băm theo `cf-connecting-ip + path` vào một origin
còn sống → phân đều, cùng visitor giữ cùng host (ấm instance). Host trả 5xx hoặc
trang "suspended" bị bỏ qua 2 phút rồi thử lại. HTML cache theo URL gốc (không
nhân bản theo origin); nếu mọi host cùng chết, bản stale được trả kèm
`Warning: 110` (chỉ đọc). Header `X-SVD-Origin` cho biết host đã trả lời.

- `www.sonvudev.com/*` được Worker trả **308** về apex trước khi đổi Host sang
  origin. App chỉ thấy hostname của origin (fly.dev), nên tự nó không biết người
  mua đã gõ www.
- IP khách cho geo và rate-limit đọc từ `CF-Connecting-IP` (`src/client-ip.js`).
  Cloudflare bỏ `X-Forwarded-For`/`X-Real-IP` do Worker tự đặt khi ra origin, nên
  `req.ip` một mình sẽ là IP của Worker/edge. `TRUST_PROXY` giữ nguyên `1`.
- Keep-awake: `SHOP_URL` là **gốc domain** (`https://sonvudev.com`); worker tự
  thêm `/api/health`. Đặt cả `/api/health` sẽ thành `/api/health/api/health`.

**Verify sau deploy:** `curl -sI https://sonvudev.com/ | grep -i x-svd-origin`
và `curl -sI https://www.sonvudev.com/ | grep -i location` → 308 về apex;
`cf-cache-status` trên HTML vẫn HIT.

## 10. Checklist trực ca

Đầu ca:

- [ ] `/api/health` = 200, `persistence` đúng như mong đợi.
- [ ] Không có deploy/canary dở dang (`deploy/canary.sh status`).
- [ ] Dung lượng đĩa > 20%, chứng chỉ TLS còn hạn.
- [ ] Đơn chờ thanh toán không tăng bất thường.

Cuối ca:

- [ ] Ghi lại sự cố, thay đổi cấu hình, deploy đã thực hiện.
- [ ] Nếu có incident: điền `docs/INCIDENT-TEMPLATE.md` trong 48 giờ.
- [ ] Nếu SLO bị đốt quá 50% error budget: mở mục hành động trong `docs/SLO.md`.

## 11. Liên hệ leo thang

| Mức | Khi nào | Ai |
| --- | --- | --- |
| P1 | Không mua được, mất dữ liệu, lộ secret | Chủ cửa hàng + người trực, gọi ngay |
| P2 | Một phương thức thanh toán hỏng, email chậm | Người trực xử lý trong 4 giờ |
| P3 | Giao diện/SEO lỗi, không ảnh hưởng doanh thu | Ticket, xử lý trong 3 ngày |

Điền số điện thoại/kênh liên lạc thật của đội vào bảng này khi dựng máy — một
runbook không có người liên hệ chỉ là tài liệu tham khảo.

