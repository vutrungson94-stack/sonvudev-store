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

## 9. Bảo mật và xoay khóa

- `ADMIN_API_TOKEN` không có hạn và không có 2FA: xoay ngay khi nghi lộ, và dùng
  `ADMIN_API_TOKENS` cho token có hạn/role khi cần.
- `SUPABASE_SERVICE_ROLE_KEY` bỏ qua RLS. Chỉ đặt trong env của máy chủ, không bao
  giờ trong biến `NEXT_PUBLIC`/`PUBLIC` hay file tĩnh.
- Sau khi xoay khóa: restart service, kiểm tra health, xác nhận log không còn dùng
  khóa cũ, rồi thu hồi khóa cũ ở nhà cung cấp.
- Không dán secret vào ticket/chat. Dùng trình quản lý bí mật của đội.

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

