# SonVuDev Store

Cửa hàng phần mềm SonVuDev: catalog, đơn hàng, PayPal/chuyển khoản và link tải Cloudflare R2 riêng tư có thời hạn.

Production dùng domain `https://sonvudev.com`. Toàn bộ cấu hình thật nằm trong `D:\SonVuDev-Upload\.env`; `.env.example` chỉ là mẫu và không chứa secret.

## Chạy local

```powershell
cd D:\SonVuDev-Upload
npm install
npm start
```

- Cửa hàng: `http://localhost:3000`
- Quản trị: `http://localhost:3000/admin.html`
- Health: `http://localhost:3000/api/health`

## Build và kiểm tra

```powershell
npm run build
npm test
npm run check:production
```

`check:production` kiểm tra cấu hình, DNS và HTTPS mà không in secret ra nội dung log. Chạy lệnh này trước khi nhận đơn hàng thật.

Ngoài cấu hình local, lệnh còn gọi `/api/health` trên production và kiểm tra site thật sự bán được: `Store is sellable` (R2 đã nối, nếu không storefront ẩn toàn bộ sản phẩm), `Payments live` (PayPal và chuyển khoản) và `Database persistent` (`local-json` nghĩa là đơn hàng mất khi deploy lại).

## Deploy lên Render

Production chạy trên Render, DNS do Cloudflare giữ. `.env` bị `.gitignore` loại nên không bao giờ lên Render — biến môi trường phải khai báo trên Dashboard (Service → Environment) hoặc đẩy bằng script:

```powershell
npm run render:sync                    # kiem tra, in ra danh sach thay doi
npm run render:sync -- --apply         # ghi len Render
npm run render:sync -- --apply --deploy   # ghi xong trigger deploy moi
```

Cần `RENDER_API_KEY` trong `.env`, lấy ở [Account Settings](https://dashboard.render.com/) → API Keys. Token này quyền truy cập toàn bộ tài khoản Render, chỉ giữ ở máy.

Mặc định lệnh chỉ in ra diff. Thêm `--apply` mới ghi, và mỗi biến được ghi riêng qua `PUT /services/{id}/env-vars/{key}` nên không đụng vào `PORT` và các biến `RENDER_*` do Render tự sinh.

Script chỉ đẩy danh sách biến của ứng dụng (`ALLOWED`), không đẩy toàn bộ `process.env`. Nếu không giới hạn, trên Windows nó sẽ gửi cả `Path`, `USERNAME`, `ProgramFiles` và các biến khác của máy lên Render. `HOST` luôn được ép `0.0.0.0` vì `.env` cấu hình cho localhost. Biến trống trong `.env` được bỏ qua, giữ nguyên giá trị đang có trên Render.

## Kiến trúc

- `src/server.js`: khởi động HTTP server.
- `src/app.js`: API, SEO routes, kiểm tra thanh toán/download.
- `src/store.js`: Supabase REST; local JSON chỉ là fallback cho phát triển.
- `src/r2.js`: presigned upload/download URL; bucket bắt buộc private.
- `src/paypal.js`: PayPal Orders v2, chuyển VND sang USD và xác minh webhook.
- `src/payments.js`: dựng hướng dẫn thanh toán trong nước (VietQR, MoMo, ZaloPay).
- `src/rates.js`: tỷ giá VND/USD, cache và fallback.
- `public/`: storefront responsive, không cần build frontend.
- `supabase/schema.sql`: schema PostgreSQL.
- `cloudflare/r2-cors.json`: CORS cho upload trực tiếp từ trình duyệt.

## Quy trình phát hành sản phẩm

1. Cấu hình đầy đủ Cloudflare R2 trong `.env`; health phải có `"r2": true`.
2. Mở `/admin.html`, đăng nhập bằng `ADMIN_API_TOKEN`.
3. Nhập tên, giá VND, mô tả, yêu cầu hệ thống và chọn file `.zip/.exe/.msi/.7z`.
4. Sản phẩm chỉ chuyển sang `active` sau khi upload R2 thành công.
5. Sản phẩm không có file R2 sẽ không xuất hiện trên storefront và không thể checkout.
6. Nếu phát hành bản mới, mở danh sách sản phẩm và chọn **Cập nhật file**.

Tên file tải về được giữ theo tên file đã upload, ví dụ `SparkCapacityTester.exe` không bị đổi thành `.zip`.

## Thanh toán trong nước (VietQR, MoMo, ZaloPay)

Sau khi tạo đơn `bank_transfer`, storefront nhận `payment` từ API. Mỗi kênh thanh toán là một phần tử trong `payment.channels`:

```json
{
  "channels": [
    { "id": "bank", "qrUrl": "https://img.vietqr.io/image/970436-0XXXXXXXXXX-compact2.png?amount=...",
      "account": "0XXXXXXXXXX", "amount": 149000, "transferNote": "SonVuDev SVD-XXXXXX" },
    { "id": "momo", "qrImage": null, "account": "0XXXXXXXXXX" },
    { "id": "zalopay", "qrImage": null, "account": "0XXXXXXXXXX" }
  ]
}
```

Trên giao diện, các kênh hiển thị thành tab nên khách chọn kênh thanh toán thuận tiện nhất.

### Kênh ngân hàng

QR sinh tự động từ `src/payments.js`, **số tiền và nội dung chuyển khoản đã điền sẵn** trong mã. Đây là kênh nên ưu tiên vì khách không phải tự nhập gì.

```env
BANK_NAME=Vietcombank
BANK_ACCOUNT_NAME=VU TRUNG SON
BANK_ACCOUNT_NUMBER=0XXXXXXXXXX
BANK_BIN=970436            # BIN ngân hàng, Vietcombank = 970436
BANK_TRANSFER_NOTE_PREFIX=SonVuDev
```

### Kênh ví (MoMo, ZaloPay)

Mã QR ví là mã tĩnh nên **không mang theo số tiền của đơn**. Khách phải tự nhập số tiền khi quét. Muốn hiện cảnh báo này, hãy khai báo mã QR:

```env
MOMO_ACCOUNT_NUMBER=0XXXXXXXXXX
MOMO_QR_IMAGE=/img/momo-qr.png
MOMO_QR_AMOUNT_IMAGE=
MOMO_DEEP_LINK=
ZALOPAY_ACCOUNT_NUMBER=0XXXXXXXXXX
ZALOPAY_QR_IMAGE=
```

- Lưu file ảnh vào `public/img/`, rồi trỏ biến tới đường dẫn đó (tương đối so với thư mục `public`).
- `MOMO_QR_AMOUNT_IMAGE` dành cho mã QR có sẵn ô nhập số tiền, ví dụ loại có nút **Thêm số tiền**. Khi đặt biến này, cảnh báo "khách phải tự nhập số tiền" sẽ không hiện.
- Nếu không khai báo ảnh, kênh ví vẫn hiện với số tài khoản để khách chuyển tay.

Biến kiểm tra bởi `check:production`; giá trị thật chỉ nằm trong `.env`, không commit.

- `src/payments.js` dựng URL VietQR; storefront không hard-code số tài khoản.
- `BANK_BIN` phải là 6 chữ số; `check:production` sẽ báo `FAIL` nếu sai.
- Nội dung chuyển khoản luôn ghi kèm mã đơn để đối soát. Admin vẫn xác nhận `paid` thủ công trong `/admin.html`.
- Ảnh QR ngân hàng tải từ `img.vietqr.io`, nên CSP đã cho phép domain này trong `img-src`. Ảnh QR ví nằm trong `public/img/` và được phục vụ cùng origin nên không cần mở CSP.

## Cấu hình PayPal

PayPal không hỗ trợ VND. Giá VND trong sản phẩm được chuyển sang USD theo tỷ giá trong `.env`:

```env
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CURRENCY=USD
PAYPAL_VND_TO_USD_RATE=live
```

### Tỷ giá động

`PAYPAL_VND_TO_USD_RATE` nhận hai kiểu giá trị:

| Giá trị | Hành vi |
| :--- | :--- |
| Số, ví dụ `26000` | Ghim tỷ giá cố định, không gọi mạng |
| `live` (hoặc `auto`) | Lấy tỷ giá VND/USD ở thời điểm checkout |

Khi đặt `live`, `src/rates.js` hỏi lần lượt hai nguồn: `open.er-api.com` rồi `exchangerate-api.com`. Giá trị được cache trong `PAYPAL_RATE_TTL_SECONDS` giây (mặc định 3600) và các request đồng thời dùng chung một lần gọi.

Số tiền quy đổi được ghi cứng vào đơn hàng (`items[0].paypalAmount`, `items[0].paypalRate`) ngay lúc tạo đơn. `paymentMatchesOrder` đối chiếu với số tiền đã ghi, nên tỷ giá biến động sau đó không làm hỏng đơn đang chờ.

Khi cả hai nguồn đều lỗi, hệ thống rơi về `PAYPAL_VND_TO_USD_FALLBACK` rồi tới giá trị cache cũ nhất. Checkout không bao giờ bị chặn vì sự cố tỷ giá.

```env
PAYPAL_VND_TO_USD_FALLBACK=26000
PAYPAL_RATE_TTL_SECONDS=3600
PAYPAL_RATE_MARGIN_PERCENT=0
```

`PAYPAL_RATE_MARGIN_PERCENT` là biên đệm phần trăm, dùng để bù chênh lệch tỷ giá của PayPal. Đặt `0` nếu chấp nhận rủi ro tỷ giá.

`/api/health` trả về tỷ giá đang dùng để đối soát:

```json
"vndPerUsd": { "rate": 25952.11, "source": "cache", "live": true }
```

`source` có thể là `live`, `cache`, `stale-cache` hoặc `fallback`.

### Lấy credential API

`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` lấy từ https://developer.paypal.com/dashboard/applications. Cần tài khoản PayPal **Business** để chạy production. Email ví (`PAYPAL_ACCOUNT_EMAIL`) chỉ dùng để hiển thị thông tin liên hệ cho khách, không thay thế credential.

Sau khi điền `PAYPAL_CLIENT_ID` và `PAYPAL_CLIENT_SECRET` vào `.env`, chạy:

```powershell
npm run paypal:setup
```

Lệnh này xác thực credential, kiểm tra webhook đã tồn tại chưa và in ra `PAYPAL_WEBHOOK_ID` cần điền. Nếu chưa có webhook, nó tự tạo tại `{APP_URL}/api/paypal/webhook` với event `PAYMENT.CAPTURE.COMPLETED`. PayPal từ chối tạo webhook nếu URL chưa truy cập được, nên cần có DNS và HTTPS trước.

Webhook URL production:

```text
https://sonvudev.com/api/paypal/webhook
```

Webhook phải được xác minh và sự kiện phải khớp `custom_id`, currency và amount trước khi đơn chuyển `paid`.

Khi `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` còn trống, storefront tự ẩn lựa chọn PayPal và
`/api/health` trả `"paypal": false`. Cùng cơ chế này áp dụng cho `"bank"`, `"momo"`, `"zalopay"`.

## DNS và HTTPS

Tên miền đã có nameserver Vietnix, nhưng website chỉ hoạt động sau khi có bản ghi DNS trỏ tới server Node:

```text
sonvudev.com   A   <IP-VPS>
www           CNAME sonvudev.com
```

Sau đó cấu hình reverse proxy và chứng thư HTTPS cho `sonvudev.com` và `www.sonvudev.com`. Không dùng A record trỏ thẳng về cổng 3000; cổng 3000 chỉ nên listen nội bộ sau reverse proxy.

## Lưu ý production

- Không commit `.env`; secret Supabase, R2, PayPal và admin phải được giữ riêng.
- Bucket R2 phải private và CORS chỉ cho `https://sonvudev.com` (và `http://localhost:3000` khi phát triển).
- Không thu tiền sản phẩm chưa có file phát hành.
- Admin dùng token dài; production nên đổi sang Supabase Auth + role admin.
- Cần chính sách bảo mật, điều khoản, hoàn tiền và thuế phù hợp trước khi vận hành lâu dài.

