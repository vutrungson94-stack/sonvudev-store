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

## Kiến trúc

- `src/server.js`: khởi động HTTP server.
- `src/app.js`: API, SEO routes, kiểm tra thanh toán/download.
- `src/store.js`: Supabase REST; local JSON chỉ là fallback cho phát triển.
- `src/r2.js`: presigned upload/download URL; bucket bắt buộc private.
- `src/paypal.js`: PayPal Orders v2, chuyển VND sang USD và xác minh webhook.
- `src/payments.js`: dựng hướng dẫn thanh toán trong nước (VietQR, MoMo, ZaloPay).
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

Sau khi tạo đơn `bank_transfer`, storefront nhận `payment` từ API và hiển thị mã QR động:

```json
{
  "bankName": "Vietcombank",
  "accountName": "VU TRUNG SON",
  "accountNumber": "0XXXXXXXXXX",
  "transferNote": "SonVuDev SVD-XXXXXX",
  "amount": 149000,
  "currency": "VND",
  "qrUrl": "https://img.vietqr.io/image/970436-0XXXXXXXXXX-compact2.png?amount=...",
  "wallets": [{ "label": "MoMo", "value": "0XXXXXXXXXX" }],
  "paypalEmail": null
}
```

Cấu hình liên quan trong `.env` (giá trị thật chỉ nằm trong file `.env`, không commit):

```env
BANK_NAME=Vietcombank
BANK_ACCOUNT_NAME=VU TRUNG SON
BANK_ACCOUNT_NUMBER=0XXXXXXXXXX
BANK_BIN=970436            # BIN ngân hàng, Vietcombank = 970436
BANK_TRANSFER_NOTE_PREFIX=SonVuDev
MOMO_ACCOUNT_NUMBER=0XXXXXXXXXX
ZALOPAY_ACCOUNT_NUMBER=0XXXXXXXXXX
```

- `src/payments.js` dựng URL VietQR; storefront không hard-code số tài khoản.
- `BANK_BIN` phải là 6 chữ số; `check:production` sẽ báo `FAIL` nếu sai.
- Nội dung chuyển khoản luôn ghi kèm mã đơn để đối soát. Admin vẫn xác nhận `paid` thủ công trong `/admin.html`.
- Ảnh QR tải từ `img.vietqr.io`, nên CSP đã cho phép domain này trong `img-src`.

## Cấu hình PayPal

PayPal không hỗ trợ VND. Giá VND trong sản phẩm được chuyển sang USD theo:

```env
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CURRENCY=USD
PAYPAL_VND_TO_USD_RATE=26000
```

`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` lấy từ https://developer.paypal.com/dashboard/applications.
Email ví (`PAYPAL_ACCOUNT_EMAIL`) chỉ dùng để hiển thị thông tin liên hệ cho khách.

Cập nhật tỷ giá trước khi bán. Webhook URL production:

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

