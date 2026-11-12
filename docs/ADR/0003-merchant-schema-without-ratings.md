# ADR 0003 — Merchant schema đầy đủ, cố ý không phát rating tự thu thập

- **Status:** Accepted
- **Ngày:** 2026-11-09
- **Liên quan:** `src/pages.js` (`merchantReturnPolicy`, `digitalShippingDetails`, `merchantProductSchema`), `test/purchase-link-contract.test.js`, `AGENTS.md §4`

## Bối cảnh

GSC "Cải thiện giao diện của mục" báo `Offer` thiếu `applicableCountry`,
`returnMethod`, `shippingDetails`; đồng thời báo thiếu `aggregateRating` và
`review`.

## Quyết định

- **Bổ sung đầy đủ** ba field merchant listing:
  - `hasMerchantReturnPolicy.applicableCountry: ["VN"]`
  - `hasMerchantReturnPolicy.returnMethod: "https://schema.org/ReturnByMail"`
  - `shippingDetails` với `shippingRate.value: 0` (sản phẩm số)
  Giá trị lấy từ chính sách thật đăng ở `/refund`: 14 ngày, miễn phí, pháp lý VN.
- **Không phát** `aggregateRating`/`ratingValue`/`reviewCount`/`bestRating`.
  Rating tự thu thập không đủ điều kiện rich result của Google, và nội dung tự
  bịa là vi phạm misrepresentation. Review giữ dạng prose.

## Hệ quả

- GSC hết cảnh báo merchant listing (cần bấm "Xác thực kết quả khắc phục" để
  Google quét lại).
- `aggregateRating`/`review` vẫn hiện trong GSC nhưng là **tùy chọn**; đó là
  lựa chọn có ý thức, không phải lỗi. Không được thêm vào sau này nếu chưa có
  nguồn review đủ điều kiện.

## Thay thế

Muốn hiển thị sao: cần nguồn review thật, không phải tự thu thập, và phải cập
nhật `AGENTS.md` + test trước.
