# SonVuDev Store

Cửa hàng phần mềm SonVuDev: catalog, đơn hàng, PayPal/chuyển khoản và link tải Cloudflare R2 riêng tư có thời hạn.

Production dùng domain `https://sonvudev.com`. Toàn bộ cấu hình thật nằm trong `D:\SonVuDev-Upload\.env`; `.env.example` chỉ là mẫu và không chứa secret.

## Tài liệu vận hành

- `docs/RUNBOOK.md` — deploy, canary, rollback, log, sự cố thường gặp, sao lưu, checklist trực ca.
- `docs/SLO.md` — chỉ số, mục tiêu 30 ngày, ngân sách lỗi, cách đo bằng log và benchmark.
- `docs/INCIDENT-TEMPLATE.md` — mẫu incident/RCA, điền trong 48 giờ sau sự cố.
- `deploy/canary.sh` — canary trên VPS: `start`, `split`, `promote`, `rollback`, `status`.
- `public/locales/` — từ điển tiếng Nhật và tiếng Trung, tải theo yêu cầu; thêm ngôn ngữ
  mới chỉ cần thêm tệp JSON và một mục trong `window.SVD_LOCALES`.
- `npm run benchmark` — đo p50/p95/p99 trên một instance đang chạy và ghi baseline vào
  `build-reports/perf-baseline.json`.

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
npm run audit
npm run metrics
npm run check:production
npm run seo:check
```

Trên GitHub, `.github/workflows/checks.yml` chạy đúng các bước đó cho mọi lần push, và `seo:check` chạy trên chính domain production sau mỗi lần merge vào nhánh chính.

`metrics` là lớp đo lường mà repo này thiếu: mọi gate ở trên chỉ cho biết **lúc này** pass hay fail, không cho biết tuần này tốt hơn hay xấu hơn tuần trước. Lệnh này ghi lại số test, số route, số phụ thuộc, số bản sao của các hàm từng bị viết trùng, số khoá dịch và số trang cho phép index vào `metrics-baseline.json`, rồi so với lần chạy sau:

```powershell
npm run metrics          # FAIL nếu một chỉ số đi ngược
npm run metrics:update   # chấp nhận số hiện tại làm chuẩn mới
```

Các lệnh có cờ riêng dùng **tên script riêng**, không dùng `-- --cờ`. npm 11 nới rộng cờ:
`npm run render:sync -- --apply` bị npm nuốt mất `--apply` (`Expanding --update to
--update-notifier`) và lệnh chạy ở chế độ chỉ xem, in ra danh sách thay đổi như thể đã ghi.
Với biến thanh toán, kiểu hiểu nhầm đó để lại production chạy credential sandbox.

Hướng của từng chỉ số là cố ý: test, route, khoá dịch và trang index **không được giảm**; phụ thuộc và số bản sao hàm **không được tăng**. Nó không phải điểm chất lượng — nó là mức tối thiểu cần có để trả lời "thay đổi vừa rồi tốt hơn hay không".

`check:production` kiểm tra cấu hình, DNS và HTTPS mà không in secret ra nội dung log. Chạy lệnh này trước khi nhận đơn hàng thật.

Ngoài cấu hình local, lệnh còn gọi `/api/health` trên production và kiểm tra site thật sự bán được: `Store is sellable` (R2 đã nối, nếu không storefront ẩn toàn bộ sản phẩm), `Payments live` (PayPal và chuyển khoản) và `Database persistent` (`local-json` nghĩa là đơn hàng mất khi deploy lại).

`Order email` cũng là điều kiện bắt buộc. Không có `RESEND_API_KEY` thì bốn email giao dịch chỉ được ghi ra `data/outbox` chứ không tới tay khách, nên lệnh báo `FAIL` dù mọi thứ khác đều xanh.

`audit` đọc mã nguồn và báo những lỗi không làm hỏng trang nhưng làm mất tác dụng: link nội bộ trỏ tới file không có, route Express đăng ký hai lần, khoá dịch không ai dùng, tên miền và email gõ tay thay vì đọc từ `.env`. Mỗi kiểm tra đều có một test làm cho nó hỏng để chứng minh nó còn bắt được lỗi — xem `test/audit.test.js`.

`seo:check` đi vào **site đang chạy** như một con bọ tìm kiếm và báo những thứ Google thật sự nhìn thấy. Chạy sau mỗi lần deploy:

```powershell
npm run seo:check                              # dùng APP_URL trong .env
npm run seo:check -- https://sonvudev.com       # hoặc chỉ định host
```

Không có `APP_URL` thì lệnh dừng luôn thay vì tự đoán một domain — trước đây nó fallback về chính domain của cửa hàng, nên chạy trên máy chưa cấu hình vẫn ra kết quả trông như đã được yêu cầu.

Nó kiểm tra: trang chủ có đúng một `h1` và có chữ trong HTML, canonical có trùng `APP_URL`, thẻ xác minh Google và Bing, `robots.txt` có dòng `Sitemap` và có chặn `/admin`, `/api/`, `/order/`, `/lookup`; **mọi URL trong sitemap đều trả 200**, không trùng nhau, đúng domain và không nằm trong vùng bị chặn; `/llms.txt` và `/feed.json` có sống và đọc được; và `og:image` tải được **và đúng là PNG 1200×630** — đọc trực tiếp kích thước trong file chứ không tin header. Sau cùng từng trang sản phẩm có đúng một `title`, canonical khớp URL, `SoftwareApplication` với giá bằng giá thật, logo và `og:image` tải được.

## Để AI tìm ra sản phẩm

Phần này nói về cách sản phẩm được **trích dẫn** khi khách hỏi trợ lý, không phải cách lên top Google. Khác nhau ở chỗ: Google xếp hạng trang, còn trợ lý trích dẫn trang có câu trả lời cụ thể và một người thật đứng sau.

Bốn thứ đã làm, theo thứ tự lợi ích trên chi phí:

**1. `og:image` là PNG.** Đây là thay đổi đáng giá nhất và đã xong. Facebook, Zalo, Telegram, Slack, LinkedIn và phần lớn trợ lý **không render SVG** trong `og:image` và hiện ô trống. Giờ mọi link chia sẻ đều có ảnh. Ảnh nằm ở `public/og.png`, commit sẵn nên build và server không cần thư viện ảnh nào; sinh lại bằng `npm run assets:og` khi đổi màu thương hiệu.

**2. Hai ngôn ngữ, hai URL.** `descriptionEn`, `shortDescriptionEn` và `featuresEn` đã nằm trong database từ lâu và trình duyệt đã dùng, nhưng server chỉ render tiếng Việt — nên trợ lý hỏi bằng tiếng Anh tìm thấy trang rồi không trích được gì. Giờ có `/en/product/:slug`, hai bản trỏ qua lại bằng `hreflang` và `og:locale:alternate`, và cả hai xuất hiện trong sitemap.

**3. `sameAs` và một con người có tên.** `BRAND_SOCIAL_LINKS` và `BRAND_FOUNDER_NAME` đổ vào schema `Organization`. Đây là thứ nối cửa hàng với phần còn lại của web trong một knowledge graph; `sameAs` rỗng thì thương hiệu là một hòn đảo không gì xác nhận được.

**4. `/llms.txt` và `/feed.json`.** Mỗi cái một request, tiết kiệm cho trình thu thập việc phải đoán từ hero image. `/feed.json` là toàn bộ danh mục với giá, nền tảng, phiên bản và yêu cầu hệ thống — đúng thứ cần để trả lời "bán những tool Windows nào, giá bao nhiêu".

Ngoài ra: `/about` nói rõ ai làm ra cửa hàng, `FAQPage` sinh từ dữ liệu thật của từng sản phẩm (câu hỏi về nền tảng sẽ nói đúng tên nền tảng), và `robots.txt` ghi tên từng trình thu thập AI và cho phép — quyết định đó được viết ra thay vì để ngầm.

### Đánh giá của khách: có, nhưng không có sao

Có, `POST /api/reviews` và ô viết trên trang đơn hàng. **Không có sao, và không thêm `AggregateRating`.** Lý do:

- Google **chưa bao giờ** dùng điểm đánh giá hay số lượt đánh giá làm tín hiệu xếp hạng. `AggregateRating` tự thu thập trên website riêng **không đủ điều kiện** rich result trên web thường.
- Sản phẩm trả phí có sao công khai là mục tiêu của đường lạm dụng hoàn tiền: một người đánh giá 1 sao kèm hoàn tiền là review xấu **và** mất tiền.
- Cái trợ lý thực sự trích dẫn là **văn xuôi**: một câu từ người từng gặp đúng vấn đề đó.

Cổng chặn cứng: chỉ người **đã thanh toán và đã nhận file** mới viết được (`deliveredAt` cộng `hasPayment`), sản phẩm phải nằm trong đơn đó, và một đơn chỉ viết một lần cho mỗi sản phẩm. Đơn bị hoàn tiền thì đánh giá bị gỡ khỏi trang. Lưu trên chính dòng đơn (`orders.reviews`) vì đó là nơi bằng chứng đã mua tồn tại sẵn.

## Chính sách bảo mật nội dung và CSP

Server gửi `script-src 'self'` không `unsafe-inline` và không nonce. Điều đó có nghĩa là **không trang nào được có `<script>` chạy được nằm inline** — trước đây trang sản phẩm và trang 404 đều viết loader bằng script inline, trình duyệt từ chối âm thầm và phần "Sản phẩm khác" đứng nguyên ở chữ *Đang tải…* vĩnh viễn. `test/ai-discovery.test.js` kiểm tra đúng điều đó, kể cả thân trang 404 vì nó được phục vụ bằng `sendFile` nằm ngoài mọi kiểm tra khác.

Giờ cả hai dùng `public/related.js`. Nếu sau này cần script inline, phải thêm nonce — đừng nới CSP bằng `unsafe-inline`.

**Sau khi đổi code có đụng tới cột database, chạy lại `supabase/schema.sql` trong Supabase SQL editor trước khi deploy.** Thiếu cột làm server lỗi ngay khi tạo đơn, chứ không phải lỗi im lặng.

## Chạy lại schema.sql

`npm run db:check` báo chính xác cột nào còn thiếu, chỉ cần `SUPABASE_SERVICE_ROLE_KEY` nên chạy được ở bất cứ máy nào:

```powershell
npm run db:check
```

```
Thiếu 10 cột, chạy lại schema.sql:
  - orders.expires_at
  - orders.cancelled_at
  ...
```

Có hai đường để vá.

**Cách nhanh — dán vào SQL editor.** Mở https://supabase.com/dashboard/project/`<project-ref>`/sql, dán toàn bộ nội dung `supabase/schema.sql`, bấm Run. Toàn bộ câu lệnh đều là `create table if not exists` và `add column if not exists` nên chạy lại trên bảng cũ không ghi đè dữ liệu và không lỗi. Đây là cách an toàn nhất khi production đang có đơn hàng.

**Cách tự động — `npm run db:migrate`.** Cần thêm `SUPABASE_ACCESS_TOKEN` (personal access token tại https://supabase.com/dashboard/account/tokens, chỉ đặt trong `.env` ở máy bạn, **không** đẩy lên Render):

```powershell
npm run db:migrate              # in ra câu lệnh sẽ chạy, không ghi gì
npm run db:migrate:apply        # chạy thật qua Management API
npm run db:check                # xác nhận đã khớp
```

Script tự tách từng câu và gửi một câu một request. Nên xem trước khi `--apply`.

Cột mới nhất là `orders.reviews` (`jsonb`, mặc định `[]`), nơi lưu đánh giá của khách. Đặt
trên chính dòng đơn thay vì một bảng riêng là cố ý: đơn hàng là nơi bằng chứng đã mua
tồn tại sẵn, và một đánh giá về một sản phẩm chỉ có nghĩa là lời của người đã mua sản phẩm
đó. Thêm bảng riêng nghĩa là thêm một nơi phải chứng minh quan hệ đó, và một nơi nữa để
kiểm tra nó có đúng hay không.

## Khách mất nguồn sau khi thanh toán

Máy tắt đúng lúc đang thanh toán là chuyện hay xảy ra trên điện thoại, và mỗi kênh hành xử khác nhau.

**Chuyển khoản ngân hàng** — an toàn nhất. Tiền nằm ở tài khoản, đơn vẫn `pending_transfer` cho tới khi bạn bấm xác nhận trong admin. Mất session thì khách vào `/lookup` bằng mã đơn và email là vào lại được đơn cũ, không mất gì.

**PayPal** — có hai khoảnh thời gian nguy hiểm:

- *Mất nguồn ở trang PayPal, trước khi bấm Pay.* PayPal mới chỉ *authorize*, chưa trừ tiền. Đơn treo `pending` và hết hạn sau 24h, khách đặt đơn mới. Không mất tiền của ai.
- *Mất nguồn sau khi PayPal chạy, trước khi capture trả về.* Đây là ca nguy hiểm: tiền có thể đã trừ mà đơn vẫn `pending`. Ba lớp cứu:
  1. `paypal-return.js` retry 5 lần backoff rồi poll trạng thái 8 lần.
  2. Webhook `PAYMENT.CAPTURE.COMPLETED` tự tới và mở khoá đơn.
  3. Trang `/order/:id` tự gọi lại `capture` một lần mỗi lần mở. Gọi lại capture là an toàn: nó chỉ thành công khi PayPal đã có approval, và đơn đã capture rồi được đối soát chứ không bị thu phí hai lần.

Ngoài ra email `created` và `paid` đều chứa mã đơn và link tra cứu, nên ngay cả khi mất cả session lẫn lịch sử trình duyệt, khách vẫn tự vào lại được đơn của mình.

**Hướng dẫn nằm ở cả hai chỗ, vì chúng phủ hai thời điểm khác nhau.** Trước khi bấm thanh toán, khách còn ở trên trang của bạn nên dòng `cart.safety` và khối mã tra cứu chỉ việc đọc trên màn hình. Sau khi trả tiền mà máy tắt, trang đã mất và chỉ còn email là tới được.

Hành động quyết định khách lấy lại được đơn là lưu mã tra cứu, và họ chỉ làm được nếu biết điều đó quan trọng *trước* khi thanh toán — nên phần "lưu lại mã này" phải nằm ở trang mua, không chỉ ở email. Vì vậy link tra cứu mang sẵn mã đơn: `/lookup?order=SVD-...` điền sẵn ô nhập, thay vì bắt khách gõ tay mã từ ảnh chụp màn hình trên bàn phím điện thoại.

Lưu ý: nếu `RESEND_API_KEY` còn trống thì email chỉ nằm trong `data/outbox` và **không khách nào nhận được**. Kênh cứu trên trang vẫn chạy, nhưng kênh cứu sau khi mất máy thì không. Lấy key tại resend.com → API Keys, rồi `npm run render:sync:deploy`.

## Doanh thu trong admin

`GET /api/admin/revenue` và một panel trong `/admin.html`. Đặt trong admin chứ không tách trang riêng: cùng token, cùng bảng đơn hàng ngay bên dưới, và chủ cửa hàng chỉ mở một chỗ. Trang thứ hai nghĩa là thêm một chỗ phải bảo vệ và thêm một chỗ để cũ.

Báo cáo tính theo `paidCount` chứ không theo `status`, nên đơn đã tải xong và đã đóng vẫn còn trong doanh thu. Cột USD lấy từ `paidProviderAmount` — số tiền PayPal thực capture, chứ không phải giá niêm yết VND — để bạn đối chiếu với sao kê PayPal. VND và USD tách riêng, không cộng chung.

## Deploy lên Render

Production chạy trên Render, DNS do Cloudflare giữ. `.env` bị `.gitignore` loại nên không bao giờ lên Render — biến môi trường phải khai báo trên Dashboard (Service → Environment) hoặc đẩy bằng script:

```powershell
npm run render:sync            # kiểm tra, in ra danh sách thay đổi
npm run render:sync:deploy     # ghi len Render roi trigger deploy moi
npm run render:deploy          # chỉ deploy, không đổi biến
```

Mọi lệnh ghi (`:apply`, `:deploy`) đều chạy build (syntax, audit, metrics) và toàn
bộ test trước — đỏ ở đâu thì dừng ở đó, chưa ghi gì lên Render. Ghi biến môi
trường lên Render là restart service trên code hiện tại, nên dry-run (`render:sync`
không cờ) là lệnh duy nhất không bị chặn.

Cần `RENDER_API_KEY` trong `.env`, lấy ở [Account Settings](https://dashboard.render.com/) → API Keys. Token này quyền truy cập toàn bộ tài khoản Render, chỉ giữ ở máy.

Mặc định lệnh chỉ in ra diff. Thêm `--apply` mới ghi, và mỗi biến được ghi riêng qua `PUT /services/{id}/env-vars/{key}` nên không đụng vào `PORT` và các biến `RENDER_*` do Render tự sinh.

Script chỉ đẩy danh sách biến của ứng dụng (`ALLOWED`), không đẩy toàn bộ `process.env`. Nếu không giới hạn, trên Windows nó sẽ gửi cả `Path`, `USERNAME`, `ProgramFiles` và các biến khác của máy lên Render. `HOST` luôn được ép `0.0.0.0` vì `.env` cấu hình cho localhost. Biến trống trong `.env` được bỏ qua, giữ nguyên giá trị đang có trên Render.

## Kiến trúc

- src/server.js: khởi động HTTP server.
- `src/app.js`: API, SEO routes, tra cứu đơn, kiểm tra thanh toán/download.
- `src/orders.js`: vòng đời đơn hàng — hạn thanh toán, quét hủy đơn cũ, mở khoá khi có tiền, đóng đơn sau khi giao.
- `src/notify.js`: bốn email giao dịch (tạo đơn, sắp hết hạn, hủy, đã thanh toán), Resend hoặc ghi ra `data/outbox`.
- `src/store.js`: Supabase REST; local JSON chỉ là fallback cho phát triển.
- `src/r2.js`: presigned upload/download URL; bucket bắt buộc private.
- `src/paypal.js`: PayPal Orders v2, chuyển VND sang USD và xác minh webhook.
- `src/payments.js`: dựng hướng dẫn thanh toán trong nước (VietQR, MoMo, ZaloPay).
- `src/store.js`: các truy vấn đều giới hạn theo đúng mức cần — đơn còn mở cho quét hết hạn, đơn mới nhất cho badge quản trị, chỉ cột tiền cho báo cáo doanh thu, và có phân trang cho lịch sử. Không nơi nào đọc cả bảng đơn trong một vòng lặp.
- `src/rates.js`: tỷ giá VND/USD, cache và fallback.
- `src/indexnow.js`: báo URL đổi cho Bing/Yandex/Naver; bắn-thả, không bao giờ chặn lưu sản phẩm.
- `public/`: storefront responsive, không cần build frontend.
- `public/lookup.html` + `public/order.html`: tra cứu đơn và trang đơn hàng. Cả hai, cùng
  `paypal-return.html`, đọc chữ từ `i18n.js` như trang chủ — đây là ba trang khách
  nước ngoài dùng sau khi trả tiền bằng PayPal, nên chúng phải theo ngôn ngữ khách
  đang dùng chứ không phải tiếng Việt viết cứng.
- `src/reviews.js`: đánh giá của khách, lưu trên chính dòng đơn vì đó là nơi bằng chứng đã mua tồn tại sẵn.
- `public/related.js`: loader dùng chung cho trang sản phẩm và trang 404. Nằm ngoài file vì CSP cấm script inline.
- `public/og.png`: ảnh share raster, sinh một lần bởi `scripts/make-og-image.mjs`.
- `scripts/metrics.mjs`: so số đo với `metrics-baseline.json`.
- `supabase/schema.sql`: schema PostgreSQL.
- `cloudflare/r2-cors.json`: CORS cho upload trực tiếp từ trình duyệt.

## Quy trình phát hành sản phẩm

Cách nhanh nhất, một lệnh là xong — upload thẳng lên R2 rồi ghi `file_key` vào Supabase:

```powershell
node scripts/publish-product.mjs <duong-dan-file.exe> --dry-run   # xem ke hoach
node scripts/publish-product.mjs <duong-dan-file.exe>             # phát hành thật
npm run product:publish -- <duong-dan-file.exe>                   # tuong duong
```

Không cần truyền `--id`/`--slug`: script tự nhận diện sản phẩm đang có file phát hành. Nếu bảng có nhiều sản phẩm cùng có file, script in danh sách để bạn chọn bằng `--slug` hoặc `--id`.

Tùy chọn:

| Cờ | Tác dụng |
| :--- | :--- |
| `--dry-run` | Chỉ in kế hoạch, không ghi R2/Supabase |
| `--slug <slug>` / `--id <id>` | Chỉ định sản phẩm khi không tự nhận diện được |
| `--version <x.y.z>` | Đặt bản phát hành mới (mặc định giữ version hiện tại) |
| `--prune` | Xóa file cũ trên R2 sau khi gắn bản mới |

Script kiểm tra lại kích thước file trên R2 và đọc lại row Supabase sau khi ghi, nên nếu log in báo `R2 OK` và `Supabase OK` thế giới thật đã khớp.

Cách làm trong giao diện vẫn dùng được: `/admin.html` với `ADMIN_API_TOKEN`. Cả hai đường dùng chung `releaseKey()` trong `src/r2.js` nên key R2 luôn có cùng dạng.

1. Cấu hình đầy đủ Cloudflare R2 trong `.env`; health phải có `"r2": true`.
2. Mở `/admin.html`, đăng nhập bằng `ADMIN_API_TOKEN`.
3. Nhập tên, giá VND, mô tả, yêu cầu hệ thống và chọn file `.zip/.exe/.msi/.7z`.
4. Sản phẩm chỉ chuyển sang `active` sau khi upload R2 thành công.
5. Sản phẩm không có file R2 sẽ không xuất hiện trên storefront và không thể checkout.
6. Nếu phát hành bản mới, chạy `product:publish` hoặc chọn **Cập nhật file** trong admin.

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
- Bucket R2 phải private, và CORS phải khớp `APP_URL`. File này không được sửa tay: `npm run r2:cors` kiểm tra, `npm run r2:cors:write` sinh lại từ `APP_URL`, `npm run r2:cors:command` in ra lệnh `wrangler` để áp lên bucket. Đổi tên miền mà quên chạy lệnh này là mọi lần upload file phát hành từ trang quản trị bị chặn bằng lỗi CORS, trong khi build, `/api/health` và `check:production` vẫn xanh.
- Không thu tiền sản phẩm chưa có file phát hành.
- Admin dùng token dài; production nên đổi sang Supabase Auth + role admin.
- Cần chính sách bảo mật, điều khoản, hoàn tiền và thuế phù hợp trước khi vận hành lâu dài.

## Không bỏ sót đơn hàng

Đơn chuyển khoản không tự động thành công — phải có người bấm xác nhận. Trước đây đơn nằm im
trong bảng cho đến khi chủ cửa hàng tự mở `/admin.html`, nên khách đã chuyển tiền có thể phải
chờ cả buổi. Nay `/admin.html` tự hỏi server mỗi 30 giây:

```text
GET /api/admin/orders/pending   ->  { latest, pending, newest }
```

Khi có đơn mới, trang quản trị phản ứng bằng nhiều kênh cùng lúc:

- Thanh **màu cam nhấp nháy** ở đầu bảng, kèm nút *Xem đơn*
- **Âm báo** phát ra loa
- **Tiêu đề tab** đổi thành `(NEW) SonVuDev Admin` để thấy được khi đang ở tab khác
- **Thông báo desktop** của hệ điều hành nếu đã cấp quyền và tab đang ẩn

Endpoint này chỉ trả về số đơn đang chờ và mã đơn mới nhất, không kèm thông tin khách — nhẹ
hơn nhiều so với tải cả danh sách, nên poll thường xuyên không tốn đáng kể.

Cảnh báo tự tắt khi bạn bấm *Xem đơn* hoặc khi không còn đơn nào chờ. Polling dừng khi bấm
*Đăng xuất* và tạm dừng khi bạn chuyển sang tab khác, tự chạy lại khi quay lại.

Giới hạn cần biết: trình duyệt phải **đang mở** thì cảnh báo mới hoạt động. Muốn báo qua
email thì cần dịch vụ gửi mail trả phí — xem mục *Vận hành miễn phí*.

## Tra cứu đơn hàng

Mã tra cứu sinh ra lúc checkout chỉ nằm trong trình duyệt của người mua, nên nếu họ đóng tab
là mất quyền tải. Trang `/lookup` giải quyết việc này mà không cần dịch vụ gửi email:

```text
POST /api/orders/lookup   { "orderId": "SVD-...", "email": "..." }
```

Server đối chiếu mã đơn với email đã dùng lúc thanh toán, rồi **cấp lại một mã mới và vô hiệu
mã cũ**. Cách này miễn phí, không cần SMTP, nhưng lưu ý khi vận hành thật:

- Mã đơn ngắn nên không thể dò mã, vì vậy endpoint giới hạn 10 lượt / 15 phút / IP.
- Sai email và không tồn tại đơn trả về **cùng một thông báo**, để không lộ đơn nào có thật.
- Email là yếu tố xác thực duy nhất, nên chỉ dùng được khi đơn đã nhập đúng email của người mua.
- Khách cần email đó còn đọc được. Nếu giao dịch đi qua PayPal, email nhập ở checkout là
  email của khách, không phải email PayPal.

Sau khi tra cứu, người mua được chuyển tới `/order/:id` — trang này đọc mã từ
`sessionStorage`, nên mở bằng trình duyệt khác hoặc thiết bị khác sẽ phải tra cứu lại.

## Hạn thanh toán và thông báo tự động

Đơn chưa thanh toán bị hủy tự động. Thời hạn được ghi vào đơn ngay lúc tạo và hiển thị cả trên biểu mẫu thanh toán lẫn trang `/order/:id`, nên người mua luôn biết mình còn bao lâu.

```env
ORDER_PAYMENT_WINDOW_HOURS=24    # số giờ trước khi đơn chưa thanh toán bị hủy
ORDER_EXPIRY_WARN_HOURS=1        # gửi email nhắc trước khi hết hạn bao lâu
ORDER_SWEEP_INTERVAL_MS=60000    # chu kỳ quét đơn
```

`src/orders.js` giữ toàn bộ luật: `paymentDeadline()` tính hạn, `isExpired()` quyết định, `sweepOrders()` chạy mỗi tick và ngay lúc khởi động (nên server chết qua một hạn vẫn bắt kịp khi bật lại), `markOrderPaid()` mở nút tải, `markOrderDelivered()` đóng đơn. Bộ quét không giữ tiến trình sống (`unref`) và dừng sạch khi nhận SIGINT/SIGTERM.

Hai điều kiện mà người mua hay gặp, xử lý tại chỗ:

- **Tiền về muộn sau khi đơn đã hủy.** `markOrderPaid()` không giới hạn trạng thái đầu vào, nên webhook hoặc capture vẫn mở lại đơn đã hủy và gửi mail. Đã vào ví thì không được bắt mua hai lần.
- **Mất mạng giữa chừng.** `/api/checkout` nhận `idempotencyKey`; gửi lại cùng khoá sẽ trả về đúng đơn cũ kèm mã tra cứu mới thay vì tạo đơn thứ hai. Phía PayPal, `/api/paypal/capture` bắt lỗi capture rồi hỏi lại PayPal xem đơn đã `COMPLETED` chưa, vì capture thành công mà mất response là chuyện thường.

## Khách mất mạng hoặc mất nguồn

Ba thời điểm, mỗi thời điểm một hậu quả khác nhau. Bảng này là hợp đồng giữa code và những gì khách thực sự nhìn thấy.

### Trước khi thanh toán

| Tình huống | Đơn hàng | Khách được báo |
| :-- | :-- | :-- |
| Mất mạng khi gọi `/api/checkout`, request chưa tới server | Không có đơn | `cart.errNetwork`: đơn có thể đã tạo, kiểm tra email hoặc thử lại |
| Mất mạng, request đã tới server nhưng phản hồi mất | Có đơn | Thử lại với cùng `idempotencyKey` sẽ nhận lại **đúng đơn cũ** kèm mã tra cứu mới |
| Mất nguồn ở form, chưa bấm thanh toán | Không có đơn | Không mất gì, quay lại điền form |

### Trong khi thanh toán

| Tình huống | Đơn hàng | Khách được báo |
| :-- | :-- | :-- |
| Chuyển khoản, app ngân hàng treo hoặc máy tắt | `pending_transfer`, còn nguyên hạn | Thao tác nằm ở app ngân hàng; mở lại app kiểm tra giao dịch đã thực hiện chưa; đơn được giữ nguyên |
| PayPal, mất nguồn ở trang PayPal **chưa** bấm Pay | `pending`, PayPal mới authorize | **Chưa bị trừ tiền**, có thể thanh toán lại bình thường |

### Sau khi thanh toán

| Tình huống | Đơn hàng | Khách được báo |
| :-- | :-- | :-- |
| PayPal đã trừ tiền, capture chưa trả về | Webhook và `/order/:id` tự mở khoá | Nút tải mở, không cần làm gì |
| Mất mạng lúc gọi capture | `paypal-return.js` retry 5 lần, rồi poll 8 lần | "Đang xác nhận thanh toán", có nút thử lại |
| Mất nguồn sau khi PayPal chạy | Trang đơn tự gọi lại capture một lần | Không cần làm gì |
| Đã thanh toán, tải bị gián đoạn | Vẫn `paid` | Bấm tải lại được, đơn còn hiệu lực |
| Tải xong, máy tắt ngay sau đó | `pending` + `deliveredAt` | Đã hoàn tất; file hỏng thì liên hệ, mở lại đơn ngay |
| Tiền về muộn sau khi đơn đã hết hạn | Mở lại `paid` | Đơn đã được mở lại |
| Hết hạn, chưa có tiền | `cancelled` | **Chưa bị trừ tiền**, đặt đơn mới được |

Hai hàng cuối là lý do hai nhánh thông báo không được dùng chung: cùng một trạng thái `cancelled` nhưng một bên đã mất tiền, một bên thì không. Nói nhầm là nguyên nhân khiến lỗi kỹ thuật hoá thành khiếu nại hoàn tiền.

### Một giới hạn cần biết

Server **không nhìn thấy tệp tải về tới máy khách**, nên `POST /api/orders/:id/delivered` được gọi ngay khi nút tải được bấm chứ không phải khi tải xong. Một lần tải chết giữa chừng vẫn đóng đơn. Vì vậy admin có nút **"Mở lại đơn"** cho đơn đã giao, và trang đơn của khách nói rõ gửi email nếu file hỏng. `paidCount` và `paidAmount` được giữ nguyên qua lần đóng/mở nên doanh thu không bị ảnh hưởng.

### Email đơn hàng

Bốn thư tự động, mỗi thư mỗi đơn chỉ gửi đúng một lần (khoá lưu trên dòng đơn nên retry hay webhook chạy đua cũng không gửi trùng):

| Sự kiện | Nội dung |
| :--- | :--- |
| `created` | Mã đơn, số tiền, thời hạn thanh toán, đường dẫn tra cứu |
| `expiring` | Còn 1 giờ, kèm link tra cứu để thanh toán ngay |
| `cancelled` | Đơn đã bị hủy, kèm hướng dẫn gửi biên lai nếu đã chuyển khoản |
| `paid` | Đã nhận đủ tiền, nút tải mở khóa, link tra cứu |

```env
RESEND_API_KEY=
EMAIL_FROM=SonVuDev <no-reply@sonvudev.com>
SUPPORT_EMAIL=hello@sonvudev.com
```

Resend là REST API thuần nên không cần máy chủ SMTP và không thêm dependency. **Chưa có key vẫn chạy được**: mọi thư được ghi ra `data/outbox/*.html` và `*.txt` để kiểm tra toàn bộ luồng ngoại tuyến. `/api/health` báo `"email": "outbox"` cho tới khi có key. Một lần gửi lỗi được thử lại ở tick sau với độ trễ nới dần, tối đa 3 lần, rồi dừng để một địa chỉ hỏng không lặp vô hạn.

Thư viết song ngữ: biểu mẫu có chuyển ngôn ngữ nhưng dòng đơn không nhớ lựa chọn đó, và đoán sai trên thư thanh toán tệ hơn một đoạn tiếng Anh ngắn bên dưới.

### Đóng đơn sau khi tải

Server không nhìn thấy tệp tải về máy người mua, nên trình duyệt gọi `POST /api/orders/:id/delivered` ngay khi nút tải được bấm. `markOrderDelivered()` đưa đơn về `pending` như một đơn mới, nhưng `paidCount`, `paidAmount` và `deliveredAt` được giữ lại nên doanh thu không mất. Đơn đã giao không bị quét hủy và không bị tính vào cảnh báo đơn chờ của admin.

Cột mới trong Supabase nằm ở cuối `supabase/schema.sql`, đều là `add column if not exists` nên chạy lại không sao. Nếu chưa chạy migration mà server báo lỗi cột không tồn tại, chạy lại file là xong.

## Hoàn tiền

Đơn đã thu tiền rồi bị hoàn lại — vì khách đổi ý, vì chargeback, hoặc vì admin xác nhận nhầm — cần ghi vào sổ, nếu không báo cáo doanh thu sẽ khớp mãi với một đơn đã không còn tiền.

Admin bấm **Hoàn tiền** ở `/admin.html`, nhập lý do. Lý do đó bắt buộc vì nó được gửi thẳng cho khách trong email.

`voidPayment()` **không trừ khỏi `paidAmount`**. Báo cáo nói rõ chỗ nào số tiền đã gộp vào, chỗ nào đã hoàn, và còn lại bao nhiêu. Trừ thẳng thì lần sau đối chiếu với sao kê ngân hàng sẽ thấy thiếu mà không hiểu vì sao.

Đơn đã hoàn thì nút tải khoá lại, và quét hết hạn không đụng tới vì nó không phải đơn chờ. Nếu hoàn nhầm thì bấm **Mở lại đơn**; lịch sử hoàn vẫn còn nguyên trong báo cáo.

Cột mới trong Supabase, cần chạy lại `supabase/schema.sql` **trước khi deploy**:

```sql
alter table public.orders add column if not exists refunded_at timestamptz;
alter table public.orders add column if not exists refund_reason text;
alter table public.orders add column if not exists refunded_count integer not null default 0;
alter table public.orders add column if not exists refunded_amount numeric(12, 2) not null default 0;
alter table public.orders add column if not exists refunded_provider_amount numeric(12, 2) not null default 0;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('pending', 'pending_transfer', 'paid', 'payment_failed', 'cancelled', 'refunded'));
```

## Các trang pháp lý

`public/terms.html`, `public/privacy.html` và `public/refund.html` là file tĩnh. Thêm
link trong footer của `public/index.html` và trong câu pháp lý của checkout
(`public/app.js`).

Bốn trang mà máy tìm kiếm được phép đọc — `/`, `/terms`, `/privacy`, `/refund` — được
server dựng lại từ file trong `public/` thay vì phục vụ thẳng, vì ba thứ phải đến từ
cấu hình chứ không được viết vào file:

| Chỗ điền | Lấy từ đâu | Vì sao phải vậy |
| :--- | :--- | :--- |
| `{{site}}` | `APP_URL` | Mọi `canonical`, `og:url`, `og:image` và `@id` trong JSON-LD. Gõ tên miền vào file là cách chắc chắn nhất để `canonical` trỏ nhầm domain khác, mà `canonical` sai thì Google lập chỉ mục trang của domain khác. |
| `{{support}}` | `SUPPORT_EMAIL` | Địa chỉ liên hệ trong thân bài, template email và các trang JS. Giống nhau ở năm nơi thì một lần sửa là xong. |
| `{{year}}` | Đồng hồ | Năm bản quyền ghi cứng là mỗi 1 tháng 1 cả cửa hàng tự khai là đã một tuổi. |
| `{{paymentWindowHours}}` | `ORDER_PAYMENT_WINDOW_HOURS` | Số giờ hạn thanh toán từng ghi cứng là `24` ở ba file, nên đổi biến môi trường khiến điều khoản hứa một đằng, server làm một nẻo. |
| Danh mục sản phẩm | `isSellable()` trong `src/store.js` | Trang chủ từng chỉ có ba ô xám chờ tải: không tên sản phẩm, không giá, và không một đường dẫn nào tới trang sản phẩm — mà liên kết nội bộ mới là cách Google tìm ra phần còn lại của site. |
| Thẻ xác minh | `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` | Xoay token là sửa một dòng `.env`, không phải sửa file rồi deploy lại. |

Ngày "Cập nhật" trên trang điều khoản là ngoại lệ duy nhất còn ghi tay: đó là một sự thật về
tài liệu chứ không phải một thiết lập, và nó chỉ nên đổi khi chính điều khoản được viết lại.

Cache 60 giây chứ không phải vĩnh viễn: đổi giá trong admin phải tới được byte mà máy
tìm kiếm đọc, vì kết quả tìm kiếm hiện giá tuần trước tệ hơn là không hiện giá. Sửa xong thì
`invalidatePages()` xoá luôn cache của trang chủ, `/llms.txt` và `/feed.json` — trước đây
ba thứ đó có thể mô tả sản phẩm với giá không còn tồn tại.

`sitemap.xml` sinh tự động từ danh mục sống, và mỗi sản phẩm cho ra hai URL (`/product/…`
và `/en/product/…`) nối với nhau bằng `hreflang`. `/lookup` và `/admin.html` cố tình không có trong đó.

## Search Console

Đây là bước biến site từ "đã có" thành "được tìm thấy". Không có gì bên dưới đây làm
site chậm đi, và để trống cả ba biến thì site vẫn chạy y như cũ — nó chỉ đơn giản là
chưa được đăng ký với ai cả.

### 1. Google Search Console

1. Vào <https://search.google.com/search-console>, đăng nhập Google, **Add property**.
2. Chọn loại **Domain** và gõ `sonvudev.com`. Domain property bao gồm mọi giao thức
   và mọi subdomain, nên đây là lựa chọn đúng khi `www` trỏ cùng chỗ.
3. Google đưa ra một chuỗi khoá. Dán vào `.env`:

   ```env
   GOOGLE_SITE_VERIFICATION=a1b2c3d4e5f6...
   ```

4. Chọn cách xác minh. **Cả ba cách dùng đúng biến trên**, không cần sửa code:

   | Cách | Thứ server phục vụ | Khi nào chọn |
   | :--- | :--- | :--- |
   | DNS TXT | Bản ghi TXT `google-site-verification=...` cho tên miền ở Cloudflare | Tốt nhất. Sống lâu nhất, không phụ thuộc deploy, còn nguyên khi site đổi máy chủ. |
   | Thẻ HTML | `<meta name="google-site-verification" content="...">` trong `<head>` trang chủ | Nhanh nhất. Token nằm trong `.env` nên xoay được. |
   | File HTML | `/google<token>.html` | Google tải file từ gốc domain. Cũng không cần sửa code. |

   Nếu đã deploy xong mà Google vẫn báo lỗi, chạy `npm run seo:check` để xem thẻ có
   thật sự ra khỏi trang chủ trên production không. Thẻ nằm sai chỗ (sau `</head>`) thì
   Google không thấy, còn trang vẫn hiển thị bình thường nên không có gì để nhận ra.

5. Xác minh xong, vào **Sitemaps**, gõ `sitemap.xml`, bấm Submit. Chỉ làm một lần;
   sitemap tự đổi mỗi khi bạn lưu sản phẩm.

### 2. Bing Webmaster Tools

Lặp lại đúng như trên tại <https://www.bing.com/webmasters>.

**Cách dễ nhất: import từ Google Search Console.** Trang Add a site có nút *Import
from Google Search Console*. Bing nhận luôn chứng minh sở hữu từ Google, nên xong ngay
— nhưng đổi lại Bing **không cấp token nào**, và bấm *Verification code* chỉ ra đúng
một dòng giải thích rằng token là không cần thiết. Đừng tìm token.

Chỉ khi thêm site thủ công thì Bing mới cấp token: chọn site trong danh sách góc trên
bên trái, bấm **Verification code**, rồi copy chuỗi trong `content="..."` của thẻ
`msvalidate.01` (không có tiền tố `ms`) vào `BING_SITE_VERIFICATION`. Server sẽ tự
chèn thẻ vào `<head>` trang chủ.

Hai cách nữa mà server này **không** phục vụ, và không nên tự đoán: file
`BingSiteAuth.xml` ở thư mục gốc (nội dung do Bing sinh riêng cho từng site) và bản ghi
DNS. Dùng thẻ meta là đủ và là cách chắc chắn nhất.

Đừng bỏ qua chỉ vì đã có Google. Bing và IndexNow là con đường nhanh nhất tới khách
quốc tế, mà đó đúng là nhóm khách PayPal.

### 3. IndexNow — báo tin ngay khi có sản phẩm mới

Bình thường một sản phẩm mới phải chờ lần crawl tới mới được thấy, vài ngày là bình
thường. IndexNow là một POST miễn phí báo thẳng cho Bing, Yandex, Naver và vài
engine khác.

```env
INDEXNOW_KEY=<8-128 ký tự, chữ số và gạch ngang>
```

Sinh khoá bằng PowerShell:

```powershell
[Convert]::ToBase64String((1..16 | ForEach-Object { Get-Random -Maximum 256 })).TrimEnd('=')
```

Khi có khoá:

- Server phục vụ `/<khoá>.txt` trả về đúng khoá. Bing tải file này để chứng minh bạn
  thật sự sở hữu nó.
- Mỗi lần lưu hoặc sửa sản phẩm trong `/admin.html`, server tự ping IndexNow với
  URL trang chủ và trang sản phẩm vừa đổi.

Google **chưa** hỗ trợ IndexNow, nên nó bổ sung cho sitemap chứ không thay thế.

Cả ba cơ chế đều bắn-thả: ping hỏng, chậm, hay IndexNow không bật thì lưu sản phẩm vẫn
bình thường, chỉ mất một chu kỳ crawl. Nó không bao giờ được phép làm hỏng một thao
tác bán hàng.

### 4. Sau khi xác minh

```powershell
npm run seo:check
```

Mọi dòng phải `PASS`. Hai dòng còn `FAIL` là hai thứ Google sẽ không tha:

- `Xác minh Google` / `Xác minh Bing` — token chưa lên production, hoặc chưa chạy
  `npm run render:sync:deploy --deploy`.
- `Trang chủ có sản phẩm trong HTML` — trang chủ đang chỉ có khung tải.

Trong Search Console, **URL Inspection** với một URL bất kỳ của site cho biết Google
đang thấy gì. **Page Indexing → Test Live URL** dùng để xin thu thập ngay một trang cụ
thể thay vì chờ lần crawl tới.

## Phương thức thanh toán theo vị trí khách

Checkout gọi `GET /api/checkout/options`, server tra quốc gia của khách qua IP rồi sắp xếp
lại danh sách phương thức:

```json
{
  "country": "US",
  "inVietnam": false,
  "options": [
    { "id": "paypal",        "label": "PayPal", "hint": "...nên dùng nhất nếu bạn ở nước ngoài.", "available": true },
    { "id": "bank_transfer", "label": "Chuyển khoản ngân hàng / Quét mã QR", "hint": "Cần tài khoản ngân hàng Việt Nam...", "available": false }
  ]
}
```

**Nguyên tắc quan trọng: không bao giờ ẩn phương thức nào.** Quốc gia chỉ quyết định thứ tự
hiển thị và dòng ghi chú. Cả hai phương thức luôn hiện đủ:

- Khách ở nước ngoài → PayPal lên đầu, chuyển khoản vẫn hiện kèm ghi chú "cần tài khoản
  ngân hàng Việt Nam"
- Khách ở Việt Nam → chuyển khoản lên đầu, **PayPal vẫn hiện** kèm ghi chú nên dùng thẻ quốc tế

`available` chỉ là gợi ý cho giao diện. `/api/checkout` vẫn nhận mọi phương thức đã cấu
hình, nên khi tra cứu quốc gia sai hoặc không trả được, khách vẫn thanh toán bình thường.

Cơ chế an toàn khi tra cứu hỏng:

| Tình huống | Hành vi |
| :--- | :--- |
| Cả hai nhà cung cấp đều lỗi hoặc hết giờ (1,5 giây) | `country: null`, dùng bố cục nội địa, không hiện ghi chú |
| IP riêng / loopback / IPv6 nội bộ | Bỏ qua, không gọi ra ngoài |
| `GEO_LOOKUP=off` | Tắt hoàn toàn, luôn dùng bố cục nội địa |
| Kết quả được cache theo IP trong `GEO_CACHE_HOURS` giờ (mặc định 24) | Mỗi IP chỉ gọi ra ngoài một lần |

Render tự kết thúc TLS nên không có header `CF-IPCountry`; tra cứu phải gọi ra ngoài qua
Https tới `ipapi.co`, dự phòng `ipwho.is`. Cả hai không cần API key.

`test/geo.test.js` kiểm chứng đúng điều quan trọng nhất: với mọi giá trị quốc gia kể cả
`null`, danh sách phương thức không bao giờ bị rút bớt.

## Vận hành miễn phí

Toàn bộ stack hiện tại chạy trên gói miễn phí, không có khoản chi nào:

| Thành phần | Gói | Giới hạn cần biết |
| :--- | :--- | :--- |
| Render | Free | Ngủ sau ~15 phút không truy cập, cold start 30–50 giây; Render thu hồi service không hoạt động 90 ngày |
| Cloudflare R2 | Free | 10 GB lưu trữ, **không tính phí băng thông tải xuống** |
| Supabase | Free | 500 MB DB, project bị dừng nếu không hoạt động 1 tuần |
| Cloudflare DNS | Free | Không giới hạn |
| PayPal Business | Free | Chỉ mất phí giao dịch khi có khách, không có phí tháng |
| Cloudflare Email Routing | Free | Chuyển tiếp `hello@sonvudev.com` về một hộp thư đã có |

Hai việc cần làm khi vẫn ở gói free:

1. **MX cho email hỗ trợ.** `hello@sonvudev.com` xuất hiện ở footer nhưng không có bản ghi
   MX nên thư gửi tới đó sẽ thất lạc. Cloudflare Email Routing miễn phí, trỏ về một địa chỉ
   Gmail/Outlook bạn đang dùng.
2. **Sống sót qua đợt ngủ của Render.** Khách vào đúng lúc service đang ngủ sẽ chờ vài
   chục giây. Nâng lên gói `starter` khi đã có doanh thu; hiện tại chấp nhận để miễn phí.

Chưa làm vì cần chi phí hoặc tài khoản: gửi email tự động (SMTP), code signing cho tệp
`.exe`, nâng cấp Render. Ba việc này nên để lại cho khi có thu nhập.


<!-- ai-commit-test -->

<!-- ai-commit-test-2 -->
