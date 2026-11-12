# RCA — Root Cause Analysis

Mỗi lần một lỗi **lọt qua gates** và đến tay người dùng, hoặc một gate đỏ vì lý
do không hiển nhiên, phải có một RCA. Mục đích không phải đổ lỗi mà là lấy ra
**nguyên nhân gốc** và **hành động phòng ngừa** để gates lần sau bắt được nó.

## Khi nào viết RCA

- Lỗi production, hoặc regression chạm baseline.
- Test flaky (chạy 3 lần cùng một commit mà kết quả khác nhau).
- Một lỗi audit lọt qua CI.
- Một quyết định bị đảo ngược sau khi đã ship (xem `docs/ADR/`).

## Đặt tên

`YYYY-MM-DD-<slug>.md`. Một RCA một file, không gộp.

## Template

```markdown
# RCA: <tiêu đề ngắn>

- Ngày: YYYY-MM-DD
- Loại: production / regression / flaky / audit-escape
- Mức: low / medium / high
- Owner: <người phụ trách hành động phòng ngừa>

## Hiện tượng
Cái gì bị, ai báo, lúc nào. Ghi log/ảnh chụp nếu có.

## Nguyên nhân gốc
Tại sao lỗi xảy ra, và **tại sao gates không bắt được**.

## Hành động khắc phục
Cái đã sửa ngay để hết lỗi.

## Phòng ngừa
Gate/test nào được thêm để lần sau bắt được. Nếu không thêm được, ghi rõ vì sao.

## Bài học
Một câu: điều gì sẽ làm khác đi nếu biết trước.
```

## Danh sách

| Ngày | Tiêu đề | Loại |
| --- | --- | --- |
| [2026-11-12](2026-11-12-gsc-duplicate-urls.md) | GSC trang trùng lặp: `/?buy=` và trailing slash | audit-escape |
