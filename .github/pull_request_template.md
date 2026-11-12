# Pull request template

Một PR phải nói rõ **vì sao**, không chỉ **cái gì**. Bỏ qua phần nào thì phần
đó phải có lý do trong mô tả.

## Tóm tắt
<!-- Một đoạn: thay đổi này làm gì, vì sao. Không phải "update files". -->

## Bằng chứng / tá hiện
<!-- Log, ảnh chụp, hay câu lệnh chạy ra kết quả nào. Nếu là đo lường: số trước/sau. -->

## Invariants (AGENTS.md §4)
<!-- Invariant nào bị chạm và được giữ thế nào. Không có thì ghi "không chạm". -->

## Gates đã chạy
- [ ] `npm run lint`
- [ ] `npm run audit`
- [ ] `npm run case`
- [ ] `npm run workflow`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `_Tests/gtest.ps1` (nếu có harness đầy đủ)

## Rủi ro & cách bắt
<!-- Nếu thay đổi này sai thì triệu chứng gì, và ca nào trong gates bắt được. -->

## Ghi chú cho reviewer
<!-- Phần nào cần để ý nhất; phần nào là thay đổi thẳng thừng chưa tin lắm. -->
