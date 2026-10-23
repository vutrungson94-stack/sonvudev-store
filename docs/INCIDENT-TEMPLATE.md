# Mẫu incident và RCA

Sao chép tệp này thành `docs/incidents/YYYY-MM-DD-mo-ta-ngan.md` và điền trong vòng
48 giờ sau khi sự cố kết thúc. Mục đích không phải tìm người để đổ lỗi, mà để lần
sau hệ thống tự phát hiện và tự phục hồi sớm hơn.

## Thông tin cơ bản

- **Mã incident**: INC-YYYYMMDD-NN
- **Mức độ**: P1 / P2 / P3
- **Bắt đầu (UTC)**: 
- **Phát hiện (UTC)**: 
- **Khắc phục (UTC)**: 
- **Kéo dài**: ... phút
- **Người chỉ huy sự cố**: 
- **Người tham gia**: 
- **Kênh liên lạc**: 

## Ảnh hưởng

- Người mua bị ảnh hưởng: ... / tổng số phiên
- Đơn hàng bị ảnh hưởng: ... đơn, tổng giá trị ... VND
- Phương thức thanh toán bị ảnh hưởng: 
- Dữ liệu bị mất hoặc lộ: có / không (nếu có, mô tả)
- SLO bị đốt: ... phút / ... phút ngân sách tháng

## Dấu hiệu và phát hiện

- Cảnh báo nào báo trước? (uptime monitor, email người mua, log, canary)
- Thời gian từ lúc xảy ra tới lúc phát hiện: ... phút
- Nếu phát hiện muộn: vì sao? (thiếu cảnh báo, cảnh báo nhiễu, không ai trực)

## Dòng thời gian (UTC)

| Giờ | Sự kiện | Người thực hiện |
| --- | --- | --- |
|  |  |  |
|  |  |  |
|  |  |  |

Ghi cả những hành động không hiệu quả. Một giả thuyết sai và thời gian thử nó là
dữ liệu quý để cải thiện runbook.

## Nguyên nhân gốc

Mô tả **cơ chế** gây lỗi, không chỉ triệu chứng:

- Điều gì đã thay đổi? (deploy, cấu hình, dữ liệu, nhà cung cấp, lưu lượng)
- Vì sao thay đổi đó lọt qua test/audit/canary?
- Vì sao hệ thống không tự phục hồi?
- Vì sao người dùng nhận ra trước giám sát (nếu đúng)?

### Năm câu hỏi "vì sao"

1. Vì sao ...?
2. Vì sao ...?
3. Vì sao ...?
4. Vì sao ...?
5. Vì sao ...? (nguyên nhân có thể hành động được)

## Điều đã làm đúng

- Ví dụ: rollback trong 3 phút, canary chỉ 10% nên ảnh hưởng nhỏ, log có request id
  nên tìm ra nguyên nhân nhanh.
- Ghi lại để lần sau lặp lại.

## Hành động khắc phục

| Hành động | Loại | Người | Hạn | Trạng thái |
| --- | --- | --- | --- | --- |
| Thêm test hồi quy cho ... | Ngăn tái diễn |  |  |  |
| Sửa health probe ... | Phát hiện |  |  |  |
| Cập nhật runbook mục ... | Ứng phó |  |  |  |
| Thêm cảnh báo cho ... | Phát hiện |  |  |  |

Mỗi hành động phải có một người và một ngày. "Cải thiện giám sát" không phải hành
động; "thêm kiểm tra dung lượng đĩa vào cron lúc 07:00, cảnh báo khi < 15%" mới là.

## Bài học

- Điều gì sẽ làm sự cố này **không thể** xảy ra lần nữa?
- Điều gì sẽ làm nó **nhỏ hơn** nếu xảy ra lần nữa?
- Điều gì sẽ làm đội **phát hiện nhanh hơn**?

## Phụ lục

- Request id / trace id liên quan: 
- Release đang chạy: 
- `deploy/canary.sh status` tại thời điểm sự cố: 
- Đường dẫn log/ảnh chụp dashboard: 
