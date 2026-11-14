# Lộ trình CMMI L4 → L5 — SonVuDev Store

Tài liệu này thay thế phần "nâng cấp mức trưởng thành" trong `docs/QUALITY-L4-L5-BACKLOG.md`.
Nó được viết theo bằng chứng trong repo, không theo tuyên bố trong tài liệu: mỗi bước
đều kèm **tiêu chí nghiệm thu đo được**, và tiêu chí đó phải kiểm chứng được bởi
người khác chứ không phải bởi người viết báo cáo.

---

## 0. Mức hiện tại, nói thẳng

| Mức | Yêu cầu của CMMI | Bằng chứng trong repo | Trạng thái |
| --- | --- | --- | --- |
| L2 Managed | Quy trình cho từng dự án, theo dõi được | Gate chạy được, checklist, log | Đạt |
| L3 Defined | Quy trình tổ chức hoá, dùng chung cho mọi thay đổi | `PROCESS.md`, `WORKFLOW.md`, `OPS.md`, `AGENTS.md`; `scripts/*.mjs` dùng chung; 601 test / 85 file; audit 33 nhóm | **Đạt vững** |
| L4 Quantitatively Managed | Số liệu ổn định, baseline, control chart, dùng số liệu để quyết định | `scripts/slo-monitor.mjs`, `dora-metrics.mjs`, `defect-escape.mjs`, `spc-control-chart.mjs`, `metrics-trends.json`; coverage gate (lines 70 / branches 60 / functions 70; đo được 89,3 / 73,2 / 81,5) | **Có hình thức, dữ liệu một phần** |
| L5 Optimizing | Cải tiến liên tục dựa trên nguyên nhân gốc; quy trình được đo và tối ưu | Đã có `docs/ADR/` (3 ADR), `docs/rca/` (1 RCA), `CODEOWNERS`, `SECURITY.md`, PR template. Chưa có control limit thật (SPC n=5), chưa có defect-prevention action đo được | **Nền đã dựng, chưa có chu kỳ đo được** |

Vì sao L4 chưa đạt, bằng chứng cụ thể:

- `git tag` rỗng dù có 330 commit từ 2026-09-26 → `metrics-dora.json` là
  `totalChanges: 0`, deployment frequency 0, lead time 0. DORA đang đo sự vắng mặt
  của dữ liệu, không đo hiệu năng.
- `metrics-slo.json` ghi `buildSuccessRate: 100`, `deploySuccessRate: 100`;
  `scripts/slo-monitor.mjs:150-160` trả `null` cho build/deploy;
  `scripts/sla-monitor.mjs:68-75` lặp lại logic SLO và **điền 100 tay**.
  Đây đúng là loại metric tự chứng nhận mà `AGENTS.md` cấm.
- `scripts/defect-escape.mjs` suy ra escape rate từ tiền tố commit `fix:`/`test:`
  — ai viết commit message cũng đổi được số liệu.
- `metrics-postmortem.json` báo có 1 postmortem, `postmortems/` chỉ có `README.md`.
- `scripts/spc-control-chart.mjs` chạy trên 6 snapshot `metrics-trends.json` — quá ít
  để lập control limit có ý nghĩa.
- Mục tiêu SLO lệch tài liệu: `docs/SLO.md` ghi availability ≥ 99,5% và p95 API
  ≤ 400 ms; monitor dùng 99,9% và `latencyP95` target 500 với `measure: 'seconds'`.

---

## 1. Nguyên tắc nâng cấp

1. **Một bước = một nguyên nhân đo được.** Không nâng cấp "để có giấy chứng nhận".
2. **Số liệu phải truy được về nguồn.** Không có số điền tay trong file trạng thái.
   Số điền tay là một loại metric tự chứng nhận: nó luôn xanh, nên nó không đo gì.
3. **Sửa gate chỉ khi gate sai, và phải chứng minh gate sai.** Không hạ ngưỡng để
   xanh.
4. **Tiêu chí nghiệm thu phải chạy được bằng một lệnh.** Không "đã review rồi" —
   phải có `npm run …` hoặc CI job mà người khác chạy lại được.

---

## 2. Giai đoạn 0 — Hiệu năng & tính toàn vẹn asset (ĐÃ XONG, 2026-11-10)

Không phải yêu cầu CMMI, nhưng là tiền đề: một sản phẩm mà khách vẫn thấy bản
cũ sau khi deploy thì mọi số liệu về "chất lượng" đều đo trên một sản phẩm không
xác định.

| Việc | Kết quả |
| --- | --- |
| Font tự host (`public/fonts/*.woff2`), bỏ `fonts.googleapis.com` | Bỏ 2 request ra domain thứ hai + 2 bắt tay DNS/TLS, ~260 ms; CSP `font-src 'self'` |
| `display=optional` thống nhất (trang sản phẩm dùng `swap`) | Đúng no-regress list |
| Preload đúng 2 file font dùng trên màn hình đầu | Bỏ chuỗi HTML → CSS → woff2 |
| Beacon Cloudflare tải **sau** sự kiện `load` (`public/cf-beacon.js`) | Nhánh dài nhất của network tree (573 ms) không còn trên critical path |
| Version asset theo **hash nội dung** (`asset-manifest.json` + `src/lib/assets.mjs`) | `Cache-Control: public, max-age=31536000, immutable` cho URL có `?v=`; trước đó cache 1 năm mà không có gì để vô hiệu hoá |
| Minify JS bằng esbuild trong build | `app.js` 45.662 → 26.970 byte; `i18n.js` 118.087 → 109.479 byte (phần lớn là dữ liệu từ điển, không co lắm được) |

**Còn lại (không làm, có lý do):** inline critical CSS + defer phần CSS còn lại.
`WORKFLOW.md §7.5` ghi rõ preload+defer từng gây CLS ~0.5. Muốn làm thì phải có
critical CSS **đầy đủ** cho above-the-fold và Lighthouse CI đo CLS trước/sau; nếu
không, đừng đụng.

---

## 3. Giai đoạn 1 — Đo lường đáng tin (2 tuần) → mở khoá L4

### 3.0 Đã xong trong đợt 2026-11-10

- [x] **Một nguồn sự thật cho SLO** (`scripts/lib/slo.mjs`): hai bản sao đã bị
      gộp, đơn vị `seconds` → **milliseconds**, mục tiêu khớp `docs/SLO.md`
      (99,5% availability, p95 API 400 ms), mỗi giá trị mang `sampleSize` và
      `source`. `availability` không còn lấy từ một lần probe sức khoẻ.
- [x] **Số không đo được thì `null`, không phải 0 hay 100.** `metrics-dora.json`
      có `sampleSize: 0` và các giá trị `null`; `--check` không so 0 mẫu với 2 mẫu.
- [x] **DORA đọc được**: `git for-each-ref` thay cho `git tag --creatordate`
      (bản cũ **im lặng** bỏ hết tag trên git cũ, nên báo cáo nói "0 deploy" —
      đo sai chứ không phải đo thiếu).
- [x] **CI gắn tag sau khi deploy** (job `release-tag`, chạy sau `deployed-site`):
      một tag = "đã deploy", không phải "đã commit".
- [x] **Lighthouse thành gate**: `npm run lighthouse:check` — headless, **tắt
      extension**, và chỉ fail trên những thứ của site: điểm performance ≥ 0,85,
      a11y/SEO/best-practices ≥ 0,90, LCP ≤ 2500 ms, CLS ≤ 0,1, cache 1 năm cho
      mọi asset của site, không script nào chưa minify. Byte của bên thứ ba được
      **báo, không bị fail**.
- [x] **RUM phủ kín**: `public/quality.js` giờ nạp trên trang chủ, trang sản phẩm
      và blog (trước đó thiếu đúng ba trang quan trọng nhất). Công thức TTFB đổi
      sang Navigation Timing Level 2 vì cách cũ bỏ sót redirect/DNS/TLS.
- [x] **Font tiếng Việt**: DM Sans không có subset tiếng Việt → mọi chữ có dấu rơi
      về Arial. Đổi sang **Be Vietnam Pro** (46 KB cho 3 subset, so với 143 KB của
      Inter). Audit giờ kiểm tra `unicode-range` có chứa `U+1EA0` — font không có
      tiếng Việt thì fail, không rơi âm thầm.

### 3.1 Còn lại trong giai đoạn 1

- [ ] **Dữ liệu 30 ngày cho availability/errorRate/latencyP95**: cần script đọc
      access log của edge và ghi `logs/last-availability.json` /
      `logs/last-error-report.json` / `logs/last-latency.json`. Hiện ba chỉ số này
      là **unknown** — đã nói thẳng thay vì bịa số.
- [ ] **Cảnh báo burn-rate**: `docs/SLO.md` đã có ngân sách lỗi; cần một job đọc
      `metrics-slo.json` và phát tín hiệu khi đốt > 50% ngân sách trong 7 ngày.
- [ ] **Ngưỡng Lighthouse siết dần**: hiện đang ở mức "không hồi quy"; đo được
      vài tuần thì nâng performance ≥ 0,95 và CLS ≤ 0,05.
- [ ] **Ghi `logs/last-deploy.json`** sau khi deploy thành công để
      `deploySuccessRate` thôi là "unknown".

### 3.2 Bài học từ đợt này (đáng ghi lại)

- **Gate Lighthouse bắt được một lỗi mà mắt thường không thấy**: font được preload
  bằng `?v=…` nhưng `@font-face` trong CSS trỏ tới URL **không có** `?v=…`. Trình
  duyệt tải font **hai lần**, dùng bản tải muộn, áp font sau first paint →
  **CLS 0,272** trên trang chủ. Sửa bằng cách cho build ghi `?v=<hash>` vào
  *bên trong* CSS sao cho preload và `@font-face` trỏ cùng một URL. Đây là lý do
  "đo" quan trọng hơn "tin vào mình đã làm đúng".
- **Công cụ cũng cần được duyệt license.** Thêm `lighthouse` vào
  `devDependencies` kéo theo MPL-2.0, FSL-1.1 và BlueOak-1.0.0 — gate license
  chặn đúng, vì chưa ai trong dự án đọc những license đó. Kết luận: Lighthouse
  **không** trở thành dependency, mà được gọi qua `npx` ở phiên bản ghim. Bề mặt
  dependency của storefront không đổi, và gate license giữ nguyên giá trị.

### 3.3 Việc còn mở (P1) — tách `app.js`

`npm run lighthouse:check` báo: **21.493 byte trong 26.970 byte của `public/app.js`
không chạy lúc tải trang**. Đó là luồng mua hàng, modal chi tiết sản phẩm, tìm
kiếm gợi ý và dựng thẻ bài viết — những phần chỉ chạy khi khách tương tác.

Tách ra (`dynamic import` khi khách bấm) tiết kiệm ~7 KB gzip mỗi lượt xem, nhưng nó
**đụng vào luồng mua** — đường đi quan trọng nhất của cửa hàng — nên cần một đợt
riêng: tách theo ranh giới hành vi, giữ nguyên hợp đồng `/?buy=`, và có test cho
đường mua trước và sau. Không làm trong một đợt sửa hiệu năng.

**Tiêu chí nghiệm thu:** `unused-javascript` của first-party = 0 KB,
`test/purchase-link-contract.test.js` và toàn bộ test vẫn xanh, và luồng mua được
kiểm thử tay trên staging trước khi đưa lên `main`.

### 3.4 Đã xong trong đợt 2026-11-12

- [x] **Coverage thành gate** (`npm run coverage`): lines ≥ 70%, branches ≥ 60%,
      functions ≥ 70%. Đo thật trước khi chốt: 89,3% / 73,2% / 81,5%. CI chạy
      `coverage` ngay sau `test`.
- [x] **Bỏ metric tự chứng nhận**: `defect-escape.mjs` không còn suy ra escape rate
      từ tiền tố commit. Giờ báo `status: unknown`, `escapeRate: null`, kèm một
      proxy được ghi rõ là proxy. `metrics.mjs` không còn đưa `null` về `0` —
      một metric chưa đo không được hiển thị như mức tốt nhất.
- [x] **Hạ tầng quản trị L5**: `.github/CODEOWNERS`, `.github/pull_request_template.md`,
      `SECURITY.md`.
- [x] **ADR**: `docs/ADR/` với 3 quyết định đã đi qua (canonical URL, không analytics
      bên thứ ba, merchant schema không rating tự thu thập).
- [x] **RCA**: `docs/rca/` với template và một RCA thật cho lỗi GSC trùng lặp.
- [x] **Sửa GSC trùng lặp**: `rel="nofollow"` cho `/?buy=`, 308 chuẩn hoá trailing
      slash; xem `docs/ADR/0001` và `docs/rca/2026-11-12-gsc-duplicate-urls.md`.

---

## 4. Giai đoạn 2 — Chặn lỗi sớm & an toàn (4 tuần)

| # | Việc | File/đường dẫn | Nghiệm thu |
| --- | --- | --- | --- |
| 2.1 | Coverage threshold (Node `--experimental-test-coverage`) | `scripts/run-tests.mjs`, `scripts/metrics.mjs` | coverage ≥ ngưỡng do chọn (đề xuất 70% dòng, đo thật trước rồi chốt), giảm ⇒ CI đỏ |
| 2.2 | E2E smoke: tải trang chủ, đổi ngôn ngữ, mở form mua, tra cứu đơn | `test/e2e/` + Playwright | 4 kịch bản chạy trên CI mỗi lần đổi `src/` |
| 2.3 | Accessibility gate (axe) trên 3 trang mẫu | CI | 0 lỗi axe critical/serious |
| 2.4 | Secret scanning + CodeQL + Dependabot | `.github/workflows/checks.yml`, `.github/dependabot.yml` | PR có secret bị chặn; alert CodeQL không còn mở |
| 2.5 | SBOM ký theo artifact (đã có `scripts/provenance.mjs` — cần ký số và kiểm tra lại khi deploy) | `scripts/provenance.mjs` | artifact có SBOM + hash; CI xác minh khớp |
| 2.6 | Governance: `CODEOWNERS`, PR template, `SECURITY.md`, branch protection `main` | `.github/`, `SECURITY.md` | không merge được nếu thiếu review hoặc check bắt buộc |
| 2.7 | Traceability matrix: yêu cầu → test → release | `docs/TRACEABILITY.md` | mỗi yêu cầu trong backlog có test hoặc lý do không có |

---

## 5. Giai đoạn 3 — Quản lý định lượng (8 tuần) → L4 thật

1. **SPC trên dữ liệu thật.** `scripts/spc-control-chart.mjs` cần ≥ 25 điểm dữ liệu
   liên tục trước khi vẽ control limit; đếm được là `gatePassRate` theo ngày.
2. **Defect từ nguồn thật.** Escape rate lấy từ issue tracker (nhãn `escaped`),
   không từ tiền tố commit. Metric dễ "chỉnh bằng tay" không phải metric.
3. **Thư viện RCA.** `docs/rca/YYYY-MM-DD-<slug>.md` bắt buộc cho: sự cố sản xuất,
   regression chạm baseline, test flaky (chạy 3 lần), lỗi audit lọt qua CI.
4. **Dự báo.** `leadTime` dự báo bằng hồi quy trên `metrics-trends.json`; cảnh báo
   khi deploy dự kiến trượt ngưỡng SLO.
5. **Đo độ tin cậy của chính bộ đo.** Một metric phải có "độ chính xác" đo được
   (ví dụ: tỉ lệ lần đo lại cho ra khác giá trị cũ). Đây là phần L4 bị bỏ qua
   nhiều nhất và cũng là phần L5 dựa vào.

---

## 6. Giai đoạn 4 — Tối ưu hoá (6 tháng) → L5

1. **Phân tích nguyên nhân ở cấp tổ chức:** Pareto trên lỗi escape → 3 nguyên nhân
   gốc lớn nhất → mỗi nguyên nhân có một hành động phòng ngừa (owner, hạn, bằng
   chứng) — đây là "defect prevention" của CMMI, chưa có gì trong repo.
2. **Thử nghiệm quy trình:** mỗi thay đổi quy trình phải có giả thuyết ("giảm thời
   gian CI từ 80s xuống 40s bằng cách chạy test theo nhóm"), đo trước/sau, giữ
   hoặc rollback theo kết quả — có `docs/EXPERIMENT-ROLLOUT-PLAYBOOK.md` sẵn, thiếu
   phần **kết quả thực nghiệm**.
3. **Innovation:** gate dự báo (dự đoán test nào sẽ fail trước khi CI chạy),
   canary tự động + rollback tự động khi canary đỏ.
4. **Institutionalization:** onboarding checklist, ma trận năng lực, ADR
   (architecture decision records) cho các quyết định kiến trúc đã đi qua.

---

## 7. Còn thiếu — đề xuất thêm (chưa có trong backlog cũ)

| Hạng mục | Vì sao | Ưu tiên | Nơi thực hiện |
| --- | --- | --- | --- |
| **Deterministic build** ✅ 2026-11-14 | Build cùng một source cho cùng hash artifact: `public/build-report.json` dùng `builtAt` = commit date (không còn wall-clock) và bị loại khỏi `filesSha256` (self-reference); hai build liên tiếp cùng source cho cùng `tree-sha256` | P1 | `scripts/build-web.mjs`, `scripts/provenance.mjs` |
| **Backup restore drill** ✅ 2026-11-14 | `scripts/backup-drill.mjs`: backup hằng tháng, kiểm tra file JSON parse được, Supabase `products`/`orders` khớp số dòng live (read-only), restore mô phỏng byte-identical; run bằng `npm run backup:drill` | P1 | `scripts/backup-drill.mjs`, `docs/RUNBOOK.md §8`, `PROCESS.md §10` |
| **Third-party SLA/incident watch** | PayPal, Resend, Supabase, Cloudflare là phụ thuộc lớn; không có giám sát nào phát hiện sự cố phía họ | P1 | `scripts/health-check.mjs`, `docs/SLO.md` |
| **Feature flag / canary tự động** | Có `X-Deployment-Channel` nhưng quyết định promote vẫn là thủ công | P2 | `deploy/`, `src/app.js` |
| **Cost per deploy / per order** | CMMI L4 cần "cost of quality" để so sánh phương án cải tiến | P2 | `scripts/metrics.mjs` |
| **Data retention & privacy matrix** | Có `privacy.html` nhưng chưa có bảng: dữ liệu nào, giữ bao lâu, xoá thế nào | P2 | `docs/`, `src/store.js` |
| **Định nghĩa "done" cho từng loại việc** | AGENTS có §7 nhưng chưa phân loại (feature/bug/security/docs) | P2 | `AGENTS.md` |
| **SLO cho chính quy trình** ✅ 2026-11-14 | CI wall time, flaky test rate, gate/build pass rate, restore drill, MTTR, deploy success — đặt ngưỡng và nguồn trong `docs/PROCESS-SLO.md` | P1 | `docs/PROCESS-SLO.md` |
| **Chuẩn hoá lỗi tiếng Việt trong log** | Log hiện có cả tiếng Việt có dấu lẫn không dấu (đã thấy trong output PowerShell) — khó grep, khó tổng hợp | P2 | `src/app.js`, `scripts/` |

---

## 8. Bảng KPI vận hành

| Chỉ số | Nguồn | Cách tính | Hiện tại | Ngưỡng L4 | Ngưỡng L5 |
| --- | --- | --- | --- | --- | --- |
| Deployment frequency | CI tags | số deploy / tuần | **2,72/tuần** (35 deploys / 90 ngày, đo 2026-11-14) | ≥ 1/tuần | ≥ 1/ngày |
| Lead time for change | git + CI | commit đầu → deploy | **0,01 ngày** (theo git tag) | ≤ 3 ngày | ≤ 1 ngày |
| Change failure rate | deploy + incident | deploy phải rollback / tổng deploy | **11,4%** (đo 2026-11-14; mục tiêu ≤ 15%) | ≤ 15% | ≤ 5% |
| Escaped defect rate | issue tracker | lỗi lọt / tổng lỗi | **unknown** (defect tracker chưa có; commit-proxy đã ngừng dùng) | ≤ 10% | ≤ 5% |
| Gate pass rate | CI | lần chạy xanh / tổng lần chạy | chưa đo | ≥ 90% | ≥ 95% |
| Flaky test rate | test runner | test fail rồi pass / tổng | chưa đo | ≤ 2% | 0 |
| MTTR | incident records | tổng downtime / số sự cố | chưa đo | ≤ 4 giờ | ≤ 1 giờ |
| SLO breach count | `metrics-slo.json` | số lần vi phạm | **unknown** (5/7 SLO unknown — chưa có dữ liệu edge log) | 0 | 0 |
| Coverage | test runner | % dòng phủ | **89,3 / 73,2 / 81,5** (lines/branches/functions, 2026-11-12) | ≥ 70% | ≥ 85% |
| Lighthouse performance | Lighthouse CI | median 5 lần chạy | ~0.8 (trước đợt này) | ≥ 0.95 | ≥ 0.98 |

---

## 9. Nhịp review

| Nhịp | Việc | Đầu ra |
| --- | --- | --- |
| Hằng tuần | `npm run metrics` + đọc trend | một dòng: metric nào lùi, gate nào đỏ |
| Hằng tuần | backlog P1/P2 | mục đã đóng / mục mới, kèm owner |
| Hằng tháng | review SLO + incident | ngân sách lỗi còn bao nhiêu, đối chiếu mục tiêu trong `docs/SLO.md` |
| Hằng quý | RCA review | 3 nguyên nhân gốc lớn nhất, hành động phòng ngừa tương ứng |
| Hằng quý | đánh giá lại mức CMMI | bảng ở mục 0 cập nhật bằng bằng chứng mới |

---

## 10. Rủi ro của chính lộ trình này

- **Biến tài liệu thành nghi lễ.** Mỗi mục ở trên phải có một lệnh kiểm chứng; mục
  nào không có thì xoá, đừng để làm đẹp danh sách.
- **Đo sai thứ không quan trọng.** Chỉ số nào không dùng để quyết định thì bỏ.
- **Tối ưu cục bộ.** DORA cao nhưng lỗi escape cao cũng là thất bại; hai nhóm phải
  được đọc cùng nhau, không riêng lẻ.
- **Bằng chứng tổ chức, không chỉ từ repo.** CMMI L5 đòi bằng chứng ở cấp tổ chức
  (nhiều người, nhiều dự án, quy trình dùng lại). Một repo duy nhất, một người
  duy nhất, dù làm rất tốt, cũng chỉ là bằng chứng L4 mạnh — đó là lý do mục 4 ở
  trên nói rõ điều đó.
