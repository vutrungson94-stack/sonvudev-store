# RCA — SPC báo 6 metric "OUT OF CONTROL" ngày 18/11/2026

**Trạng thái:** đã khắc phục trong commit `7bbd922` (18/11 2026 19:15 ICT). RCA này được viết lại ngày 20/11 để đóng mục 3 và mục 7 của `BAN-GIAO-19-11-2026.md` bằng bằng chứng git, không phải suy đoán.

## Triệu chứng

`metrics-trends` (GitHub Actions) đỏ ở step 6 `npm run spc:check` hai ngày 17–18/11:

```
OUT OF CONTROL: escCopies, moneyCopies, initialsCopies, sizeCopies,
productPageLocales, productPageRenderers
```

Chạy local cùng một lệnh lại báo control. Không có token hay deploy nào liên quan.

## Nguyên nhân gốc

Sáu metric trên là **hằng số** trong mọi snapshot: `escCopies=2`, `moneyCopies=2`, `initialsCopies=2`, `sizeCopies=2`, `productPageLocales=2`, `productPageRenderers=1` (xem `metrics-trends.json`). Với dãy hằng, `mean = mọi điểm`, `stdev = 0`, `ucl = lcl = giá trị`.

Rule "8 điểm cùng một phía mean" trong `scripts/spc-control-chart.mjs` (bản cũ) dùng:

```js
if (v >= meanValue) run++;   // đúng bằng mean vẫn tính là "trên mean"
if (v <= meanValue) run++;   // và cũng tính là "dưới mean"
```

Ở snapshot thứ 8, chuỗi đạt ngưỡng 8 và báo tín hiệu đặc biệt **dù không có nguyên nhân đặc biệt nào** — đây là lỗi của bộ đo, không phải thay đổi quy trình. Western Electric rule yêu cầu điểm nằm **nghiêm ngặt** một phía; điểm nằm đúng trên đường mean không tính và phải reset chuỗi. Việc so sánh `>=/<=` cũng làm hai rule "trên" và "dưới" cùng đúng cho cùng một dãy.

## Cách sửa (đã commit)

`7bbd922`:

- đổi `>=/<=` thành `>/<` trong rule 8 điểm;
- tách 4 rule thuần toán học vào `scripts/lib/spc.mjs` để gate và test dùng **cùng một nguồn** thay vì hai bản copy;
- thêm 5 test negative-control: dãy hằng 8+ điểm **không** được báo;

- **không** hạ ngưỡng 3-sigma, `MIN_SAMPLE = 25`, hay rule 7 điểm;
- kèm sửa 2 test rotation dùng mốc thời gian cố định đã quá hạn.

## Bằng chứng sau sửa

- `metrics-spc.json` (commit lúc 18/11 19:15): 6 metric trên có `inControl: true`, `signals: []`.
- `scripts/lib/spc.mjs:11-16` ghi rõ lý do strict comparison.
- `npm run spc:check` chạy lại ngày 20/11 → exit 0 (xem bảng verified trong change plan).

## Hạn chế còn lại

Mọi metric vẫn có `n = 8`, `sufficient: false` (`MIN_SAMPLE = 25`). Control limit ở thời điểm này **chưa đủ ổn định để ra quyết định** — job `metrics-trends.yml` chạy daily nên cần tới ~25 ngày snapshot liên tục. Đây là lý do chính để chờ đủ mẫu trước khi tin vào bất kỳ tín hiệu SPC nào, và không phải lý do để hạ ngưỡng.

## Bài học

Một gate đo lường cũng cần negative control. Rule phát hiện "quá ổn định" mà lại coi điểm nằm đúng trên mean là "lệch" sẽ báo động chính sự ổn định — đúng dạng self-certifying mà `AGENTS.md §4.1` cấm, chỉ khác chiều.
