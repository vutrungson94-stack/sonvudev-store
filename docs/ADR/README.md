# Architecture Decision Records (ADR)

Mỗi ADR ghi lại **một quyết định kiến trúc đã đi qua**, kèm lý do và hệ quả. Mục
đích không phải là tài liệu thiết kế, mà là để người đến sau (hoặc chính bạn sau
một năm) hiểu **vì sao** hệ thống lại thế, thay vì phải đoán từ code.

## Khi nào cần ADR

- Quyết định thay đổi hình dạng URL, cấu trúc dữ liệu, hoặc ranh giới giữa các
  module.
- Quyết định **không** làm một thứ (bỏ analytics bên thứ ba, không phát
  `AggregateRating`) — những quyết định "không" là thứ dễ bị đảo ngược vô tình.
- Quyết định có thể đảo ngược nhưng đảo ngược thì đắt.

## Đánh số

`NNNN-slug.md`, tăng dần, không thu hồi số. Một ADR bị thay thế thì giữ lại và
đánh dấu `Status: Superseded by NNNN`, không xoá.

## Danh sách

| Số | Quyết định | Trạng thái |
| --- | --- | --- |
| [0001](0001-canonical-url-strategy.md) | Canonical URL: gốc tiếng Việt, locale prefix, trailing slash chuẩn hoá | Accepted |
| [0002](0002-no-third-party-analytics.md) | Không analytics bên thứ ba; đo bằng RUM cùng origin | Accepted |
| [0003](0003-merchant-schema-without-ratings.md) | Merchant schema đầy đủ, cố ý không phát rating tự thu thập | Accepted |
