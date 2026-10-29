// SonVuDev i18n - Vietnamese / English only.
//
// Every customer-facing string on the storefront lives here. Admin stays
// Vietnamese on purpose: the owner is the only person who reads it.
//
// Markup:  <span data-i18n="hero.title"></span>
// JS:      I18N.t('products.count')
//
// The copyright year is read from the clock rather than written in. It used to be
// the literal 2026 in the dictionary and in five other files, so every 1 January
// the whole shop quietly claimed to be a year old.
//
// So is the host name and the support address. All three used to be typed in
// here, which meant the audit could only ever compare the files against a
// hardcoded value it was itself reading from the hardcoded file — the check
// reported itself healthy precisely when it was not configured. Both now come
// from what the server already substituted into the page.
//
// The catalogue repair maps live below the dictionary, and that position is
// load-bearing: the audit and two tests find the two language tables by taking
// the first Vietnamese table and the first English table in this file and
// everything between them. A second pair of tables declared above DICT makes
// those slices read the repair map instead of the dictionary, and every key then
// looks as if it exists in only one language.
const YEAR = new Date().getFullYear();
// The brand, as the server injected it. It was a literal here for a while, and then
// briefly the part of SUPPORT_EMAIL after the "@" — which printed the bare domain
// in the footer, and would have printed "gmail.com" the moment the support address
// moved to a webmail provider. Neither is the brand, and the name belongs to
// configuration, so it arrives as a meta tag from src/pages.js.
const host = () => document.querySelector('meta[name="x-brand"]')?.content || 'SonVuDev';
const supportAddress = () => document.body?.dataset?.support || '';

const DICT = {
  vi: {
    // Địa chỉ hỗ trợ do máy chủ đưa vào data-support, không ghi tay ở đây.
    'brand.supportEmail': supportAddress(),
    'brand.tagline': 'Phần mềm tốt cho công việc tốt.',
    'brand.rights': `© ${YEAR} ${host()} · Đồng sở hữu`,
    'announce.text': '{brand} đang mở cửa cho các bản phát hành mới',
    'announce.cta': 'Khám phá ngay',
    'nav.products': 'Sản phẩm',
    'nav.home': 'Về trang chủ',

    // The tab title of every page. A language switch that leaves the browser tab
    // in Vietnamese is a switch that only half happened — the tab is the first
    // thing a reader sees of a page and the last thing they look at when they
    // come back to it. apply() walks the whole document, [data-i18n] on <title>
    // included, so these keys were the only thing missing; the pages each carried
    // a hardcoded Vietnamese string and no way to change it.
    'title.home': 'Bật macro Excel & kiểm tra dung lượng USB | {brand}',
    'title.about': 'Về chúng tôi — ai làm ra {brand} và vì sao',
    'title.terms': 'Điều khoản sử dụng — {brand}',
    'title.privacy': 'Chính sách bảo mật — {brand}',
    'title.refund': 'Chính sách hoàn tiền — {brand}',
    'title.lookup': 'Tra cứu đơn hàng — {brand}',
    'title.order': 'Đơn hàng — {brand}',
    'title.paypalReturn': 'Đang xác nhận thanh toán — {brand}',
    'title.notfound': 'Không tìm thấy trang — {brand}',

    // Every refusal the API makes. The server sends the key and the Vietnamese
    // sentence together (src/refuse.js); the browser uses the key, so a visitor who
    // switched the shop to English is told what went wrong in English.
    // 46 keys, one per refusal — before this they were Vietnamese sentences chosen by
    // whichever route happened to fail, and the browser preferred them over its own
    // dictionary, so a failed checkout explained itself in the wrong language.
    'api.err.unauthorized': 'Không có quyền.',
    'api.err.forbidden': 'Vai trò viewer chỉ được đọc.',
    'api.err.catalogLoad': 'Không thể tải danh mục',
    'api.err.productNotFound': 'Không tìm thấy sản phẩm',
    'api.err.productLoad': 'Không thể tải sản phẩm',
    'api.err.methodsLoad': 'Không tải được phương thức thanh toán',
    'api.err.invalidEmail': 'Email không hợp lệ',
    'api.err.orderNotFound': 'Không tìm thấy đơn hàng',
    'api.err.lookupMismatch': 'Không tìm thấy đơn hàng với mã và email này',
    'api.err.invalidOrderRef': 'Mã đơn hoặc email không hợp lệ',
    'api.err.lookupFailed': 'Không thể tra cứu đơn hàng',
    'api.err.orderLoad': 'Không thể tải đơn hàng',
    'api.err.orderUpdate': 'Không thể cập nhật đơn hàng',
    'api.err.orderCreate': 'Không thể tạo đơn hàng',
    'api.err.productNotSellable': 'Sản phẩm chưa sẵn sàng để nhận thanh toán',
    'api.err.productUnavailable': 'Sản phẩm không khả dụng',
    'api.err.orderNotClosed': 'Đơn này chưa đóng',
    'api.err.orderAlreadyDelivered': 'Đơn hàng đã được giao, không thể tải lại',
    'api.err.orderUnpaid': 'Đơn hàng chưa được thanh toán',
    'api.err.paypalConfirm': 'Không thể xác nhận thanh toán PayPal',
    'api.err.paypalMismatch': 'PayPal chưa xác nhận đúng đơn hàng hoặc số tiền',
    'api.err.notPaypalOrder': 'Đơn hàng không dùng PayPal',
    'api.err.paypalUnconfigured': 'PayPal chưa được cấu hình. Hãy chọn chuyển khoản hoặc cấu hình PayPal trên server.',
    'api.err.translateUnconfigured': 'Dịch vụ dịch chưa được cấu hình (DEEPL_API_KEY)',
    'api.err.translateInputMissing': 'Thiếu text hoặc target ngôn ngữ',
    'api.err.translateTargetMissing': 'Thiếu target ngôn ngữ',
    'api.err.translateUnavailable': 'Dịch vụ dịch không khả dụng',
    'api.err.translateBatchFailed': 'Dịch batch thất bại',
    'api.err.rateLimited': 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
    'api.err.rateLimitedCreate': 'Bạn đã tạo quá nhiều đơn hàng. Vui lòng thử lại sau 15 phút.',
    'api.err.rateLimitedLookup': 'Bạn đã tra cứu quá nhiều lần. Vui lòng thử lại sau 15 phút.',
    'api.err.invalidProductInput': 'Tên hoặc giá sản phẩm không hợp lệ',
    'api.err.missingFileRef': 'Thiếu productRef, version hoặc fileName',
    'api.err.unsupportedFileType': 'Chỉ hỗ trợ file .zip, .exe, .msi hoặc .7z',
    'api.err.r2Unconfigured': 'R2 chưa được cấu hình',
    'api.err.downloadLink': 'Không thể tạo link tải',
    'api.err.uploadLink': 'Không thể tạo link upload',
    'api.err.refundNotPaid': 'Chỉ hoàn tiền được đơn đã nhận tiền',
    'api.err.refundReasonRequired': 'Cần ghi lý do hoàn tiền',
    'api.err.refundCategoryRequired': 'Cần chọn loại lý do hoàn tiền',
    'api.err.refundPartialAmountRequired': 'Hoàn kiểu “khách đổi ý” phải ghi số tiền lớn hơn 0 và nhỏ hơn số đã thu',
    'api.err.policyNotAccepted': 'Bạn cần đồng ý với điều khoản và chính sách hoàn tiền trước khi thanh toán',
    'api.err.invalidStatus': 'Trạng thái không hợp lệ',
    'api.err.transferUnconfigured': 'Phương thức chuyển khoản chưa được cấu hình',
    'api.err.noReleaseFile': 'Sản phẩm chưa có file phát hành',
    'api.err.productCreate': 'Không thể tạo sản phẩm',
    'api.err.productDelete': 'Không thể xoá sản phẩm',
    'api.err.productHasOrders': 'Sản phẩm này đã có {sold} đơn hàng. Hãy lưu trữ thay vì xoá để giữ lịch sử bán hàng.',
    'api.err.productUpdate': 'Không thể cập nhật sản phẩm',
    'api.err.slugRequired': 'Tên sản phẩm không tạo được đường dẫn. Hãy nhập slug.',
    'api.err.slugTaken': 'Đường dẫn này đã có sản phẩm khác dùng rồi.',
    'api.err.invalidPrice': 'Giá không hợp lệ',
    'api.err.reviewSave': 'Không thể lưu đánh giá',
    'api.err.revenue': 'Không tổng hợp được doanh thu',
    'api.err.orderCheck': 'Không kiểm tra được đơn hàng',
    'api.err.notFound': 'Không tìm thấy',
    'api.err.internal': 'Lỗi máy chủ',
    'api.err.webhookRejected': 'Webhook bị từ chối',
    'api.err.webhookSignature': 'Chữ ký webhook không hợp lệ',
    // 404.html links home with this key twice, and it did not exist: the page fell
    // through to the element's own Vietnamese text, so both "back to home"
    // buttons stayed Vietnamese on an English 404 — the page a visitor lands on
    // after a bad link. No gate caught it because the audit only looks for keys
    // nothing uses, never for keys a page uses and the dictionary is missing.
    // nav.why and nav.store are gone, and so are about.nav.* below: the header and
    // the footer are rendered by src/pages.js from one list of links (headerNav /
    // footerLinks), so no page carries its own navigation any more. What the
    // dictionary no longer names, the pages no longer print, and leaving the four
    // here would be exactly the dead copy the audit is built to catch.
    'nav.faq': 'FAQ',
    'nav.buy': 'Mua ngay',
    'nav.terms': 'Điều khoản',
    'nav.privacy': 'Bảo mật',
    'nav.refund': 'Hoàn tiền',
    'nav.about': 'Về chúng tôi',
    'nav.lookup': 'Tra cứu đơn',
    'nav.contact': 'Liên hệ',
    'hero.eyebrow': 'Phần mềm được xây dựng có tâm',
    'hero.title1': 'Công cụ tốt.',
    'hero.title2': 'Cuộc sống',
    'hero.title3': 'gọn hơn.',
    // Replaced Vietnam-only phrasing with global wording so the same copy works
    // for every locale. Next pass: review hero.trust2 and any other marketing
    // strings that still assume a Vietnamese-only audience.
    'hero.text': 'Những chương trình {brand} tự viết cho mọi người — dễ cài đặt, minh bạch và luôn được cập nhật.',
    'hero.cta1': 'Xem sản phẩm',
    'hero.cta2': 'Tại sao {brand}?',
    'hero.trust1': 'Bảo mật',
    'hero.trust2': 'Hỗ trợ tận tâm',
    'hero.trust3': 'Cập nhật dài hạn',
    'art.window': '{brand} / workspace',
    'art.verified': 'Đã xác nhận',
    'art.safe': 'Giao dịch an toàn',
    'art.new': 'v1.0.0 · mới',
    'art.caption': 'Made for better work.',
    // Each label says what the number next to it counts. They used to describe a
    // promise ("a quality standard of ours", "built and controlled 100%") while
    // the numbers beside them were not measurements of anything.
    'stats.1': 'Sản phẩm đang bán',
    'stats.2': 'Nền tảng được hỗ trợ',
    'stats.3': 'Bản phát hành đã xuất bản',
    'stats.note': 'Mỗi sản phẩm đều được làm ra để giải quyết một vấn đề thật.',
    'products.eyebrow': 'Kho phần mềm',
    'products.title1': 'Chọn công cụ',
    'products.title2': 'phù hợp với bạn.',
    'products.intro1': 'Từ công cụ miễn phí đến bộ giải pháp chuyên nghiệp.',
    'products.intro2': 'Mọi thứ đều dễ bắt đầu.',
    'products.all': 'Tất cả',
    // Ô tìm kiếm. Lọc phía client trên catalogue đã nạp, nên không có endpoint nào
    // để dịch — chỉ nhãn cho người đọc màn hình và gợi ý trong ô.
    'products.searchLabel': 'Tìm sản phẩm',
    'products.searchPlaceholder': 'Tìm theo tên hoặc tính năng…',
    'products.count': 'sản phẩm',
    // Chỉ còn một sản phẩm trong danh mục: dải "sản phẩm khác" ở cuối trang sản phẩm
    // và danh sách ở trang 404 rỗng. Trước đây câu này nằm trong một bảng hai
    // ngôn ngữ riêng trong public/related.js, bên cạnh chính từ điển đã có mặt
    // trên đúng những trang đó — nên thêm một ngôn ngữ thứ ba cũng không tới được
    // nó, và mọi bản dịch phải sửa ở hai chỗ.
    'products.onlyOne': 'Đây là sản phẩm duy nhất hiện tại.',
    // Một trạng thái rỗng cho cả hai nguyên nhân: catalogue rỗng, và từ khoá tìm
    // không khớp. Trước đây có hai cặp khoá — "Chưa có sản phẩm" cho catalogue rỗng
    // và một câu khác khi lọc — nhưng render() chỉ có một chỗ gọi ra, nên câu dành
    // cho lọc không bao giờ xuất hiện, và khoá thừa thì chỉ tồn tại trong từ điển.
    // Một câu nói cả hai là ít phần nhất đúng.
    'products.emptyTitle': 'Không có sản phẩm nào khớp',
    'products.emptyText': 'Hãy thử từ khoá khác, hoặc bỏ bộ lọc đang chọn.',
    'products.loadError': 'Chưa thể tải sản phẩm',
    'products.loadErrorText': 'Lỗi tải dữ liệu',
    'products.new': 'Mới',
    'products.buyAria': 'Mua',
    'why.eyebrow': 'Đằng sau {brand}',
    'why.title1': 'Ít hào mòn.',
    'why.title2': 'Nhiều hiệu quả.',
    'why.text': 'Chúng tôi tin rằng phần mềm tốt không cần phải phức tạp. Mỗi tính năng đều có một lý do để tồn tại.',
    'why.more': 'Tìm hiểu thêm',
    'why.h1': 'Đơn giản từ đầu',
    'why.h1d': 'Cài đặt nhanh, giao diện rõ ràng, không cần hướng dẫn dài.',
    'why.h2': 'Được cập nhật thật',
    'why.h2d': 'Phiên bản mới, sửa lỗi và hỗ trợ khi bạn cần — không phí ẩn.',
    'why.h3': 'Hỗ trợ bằng con người',
    'why.h3d': 'Gửi email khi bạn cần. Không phải chatbot, không phải ticket vô hồn.',
    'faq.eyebrow': 'Câu hỏi thường gặp',
    'faq.title': 'Trước khi bắt đầu.',
    'faq.q1': 'Tôi mua sản phẩm như thế nào?',
    'faq.a1': 'Chọn sản phẩm, điền email và phương thức thanh toán. Sau khi thanh toán thành công, bạn sẽ nhận mã tra cứu đơn để tải bản phát hành.',
    'faq.q2': 'Link tải có bị mất không?',
    'faq.a2': 'Link tải được tạo trực tiếp từ kho lưu trữ riêng tư và có thời hạn ngắn. Bạn có thể tạo link mới bất cứ lúc nào bằng mã tra cứu đơn.',
    'faq.q3': 'Tôi đóng tab mất mã tra cứu, làm sao?',
    'faq.a3': 'Vào trang Tra cứu đơn hàng và nhập mã đơn cùng email bạn đã dùng khi thanh toán. Chúng tôi cấp lại mã mới ngay, không cần mua lại.',
    'faq.q4': 'Điều khoản và hoàn tiền ở đâu?',
    'faq.a4': 'Xem điều khoản sử dụng, chính sách bảo mật và chính sách hoàn tiền. Chúng tôi hoàn tiền nếu phần mềm không chạy được như mô tả.',
    'faq.q5': 'Tôi có được hỗ trợ sau khi mua không?',
    'faq.a5': 'Có. Mỗi sản phẩm đều có thông tin hỗ trợ rõ ràng. Hãy liên hệ bằng email đã cung cấp khi thanh toán.',
    'lookup.eyebrow': 'Hỗ trợ',
    'lookup.title': 'Tra cứu đơn hàng',
    'lookup.lead': 'Nhập mã đơn và email bạn đã dùng khi thanh toán. Chúng tôi sẽ đưa bạn thẳng tới trang tải sản phẩm.',
    'lookup.orderLabel': 'Mã đơn hàng',
    'lookup.emailLabel': 'Email đã thanh toán',
    'lookup.submit': 'Tra cứu đơn hàng',
    'lookup.back': 'Về cửa hàng',
    'lookup.errNotFound': 'Không tìm thấy đơn này. Kiểm tra lại mã đơn và email đã dùng khi thanh toán.',
    'lookup.errFields': 'Vui lòng nhập đủ mã đơn và email.',
    'lookup.errRate': 'Bạn thử quá nhiều lần. Vui lòng chờ vài phút rồi thử lại.',
    'lookup.working': 'Đang tra cứu…',
    'order.eyebrow': 'Đơn hàng',
    'order.loading': 'Đang tải…',
    'order.code': 'Mã tra cứu đơn hàng của bạn',
    'order.keepCode': 'Lưu lại mã này. Nếu đóng tab, mất mạng hoặc máy tắt, bạn vẫn lấy lại được đơn bằng mã tra cứu cùng email đã dùng.',
    'order.openLookup': 'Mở trang tra cứu',
    'order.copied': 'Đã sao chép mã tra cứu.',
    'order.copyFailed': 'Không sao chép được — hãy chép mã tra cứu ở phía trên bằng tay.',
    'order.paid': 'Đã thanh toán',
    'order.download': 'Tải sản phẩm',
    'order.notFound': 'Không tìm thấy đơn hàng.',
    'paypal.eyebrow': 'PayPal',
    'paypal.pending': 'Đang xác nhận thanh toán…',
    'paypal.wait': 'Vui lòng không đóng trang này.',
    'paypal.success': 'Thanh toán thành công!',
    'paypal.successHint': 'Cảm ơn bạn. Mã tra cứu đơn đã được gửi tới email của bạn.',
    'paypal.cancelled': 'Thanh toán đã bị hủy',
    'paypal.cancelledHint': 'Bạn chưa bị tính phí. Có thể thanh toán lại bất cứ lúc nào.',
    'paypal.back': 'Về cửa hàng',
    'paypal.myOrders': 'Xem đơn của tôi',
    'paypal.err': 'Không xác nhận được thanh toán. Vui lòng thử lại hoặc liên hệ hỗ trợ.',
    'paypal.errHint': 'PayPal chưa báo thành công. Nếu bạn đã bị trừ tiền, hãy thử lại sau ít phút hoặc liên hệ {support} kèm mã đơn {id}.',
    'paypal.noSession': 'Mã đơn hàng không có trong phiên trình duyệt này. Nếu bạn mở trang này ở thiết bị khác, hãy tra cứu lại bằng mã đơn và email.',
    'cart.email': 'Email nhận sản phẩm',
    'cart.namePlaceholder': 'Nguyễn Văn A',
    'cart.emailPlaceholder': 'ban@example.com',
    'cart.name': 'Họ tên',
    'cart.paying': 'Đang xử lý…',
    'cart.note': 'Bạn chỉ bị tính phí khi thanh toán thành công.',
    'pay.accountLabel': 'Số tài khoản / ví',
    'pay.amountLabel': 'Số tiền',
    'pay.transferNote': 'Nội dung chuyển khoản (ghi đúng để đối soát)',
    // Nhãn và gợi ý của các phương thức và kênh thanh toán.
    //
    // Máy chủ không gửi chữ, chỉ gửi khoá. Trước đây nó gửi cả hai: một nhãn
    // tiếng Việt viết thẳng trong src/payments.js, và từ điển chỉ được dùng làm
    // dự phòng khi cuộc gọi /api/checkout/options thất bại. Nên khách ở nước
    // ngoài đọc "Chuyển khoản ngân hàng / Quét mã QR" ngay trên form thanh
    // toán — đúng trang tiền. Kênh nào máy chủ sinh ra, người đọc phải tự quyết
    // định bằng ngôn ngữ họ đang dùng.
    'pay.option.bank': 'Chuyển khoản ngân hàng / Quét mã QR',
    'pay.option.bank.vi': 'Quét mã VietQR trong app ngân hàng',
    'pay.option.bank.vi.wallets': 'Hỗ trợ MoMo, ZaloPay và quét mã VietQR',
    'pay.option.bank.intl': 'Cần tài khoản ngân hàng Việt Nam. Phù hợp hơn nếu bạn đang ở trong nước.',
    'pay.option.paypal': 'PayPal',
    'pay.option.paypal.vi': 'Thanh toán quốc tế bằng ví PayPal, trừ thẻ và tài khoản quốc tế',
    'pay.option.paypal.intl': 'Thanh toán bằng thẻ quốc tế hoặc tài khoản PayPal. Nên dùng nhất nếu bạn ở nước ngoài.',
    'pay.channel.bank': 'Quét trong app ngân hàng, số tiền và nội dung đã điền sẵn',
    'pay.channel.momo': 'Quét mã MoMo, tự nhập số tiền nếu mã không hiện sẵn',
    'pay.channel.momo.shared': 'Mã MoMo dùng chung, khách phải tự nhập số tiền',
    'pay.channel.zalopay': 'Chuyển qua số điện thoại ZaloPay',
    'geo.outside': 'Bạn đang ở {country}. PayPal được đặt lên đầu vì cách này phù hợp với khách quốc tế — bạn vẫn có thể chọn chuyển khoản nếu muốn.',
    'geo.domestic': 'Bạn đang ở Việt Nam. Chuyển khoản nội địa là nhanh nhất; bạn vẫn có thể chọn PayPal nếu thích.',
    'product.priceOnce': 'Giá một lần',
    'product.seeGuide': 'Xem hướng dẫn kèm theo',
    // Chỉ hiện ở giao diện tiếng Anh khi sản phẩm chưa có bản dịch yêu cầu hệ
    // thống: nói thật với người đọc thay vì để câu tiếng Việt đè lên nhãn Anh.
    'product.requirementsViOnly': 'Yêu cầu hệ thống được ghi trong hướng dẫn kèm theo (hướng dẫn viết bằng tiếng Việt).',
    'cart.back': 'Quay lại',
    'cart.secureTitle': 'Thanh toán an toàn',
    'cart.buyTitle': 'Mua',
    'cart.methodLabel': 'Phương thức thanh toán',
    'cart.continue': 'Tiếp tục thanh toán',
    'cart.errCreate': 'Không tạo được đơn hàng',
    'cart.lostCode': 'Đã mua nhưng mất mã tra cứu?',
    'order.created': 'Đơn hàng đã tạo',
    'order.thanksShort': 'Cảm ơn bạn!',
    'cart.expiry': 'Đơn chưa thanh toán sẽ tự động bị hủy sau {hours} giờ. Chúng tôi gửi email xác nhận đơn và email nhắc trước khi hết hạn.',
    'cart.safety': 'Mất mạng hoặc máy tắt giữa chừng không sao: đơn vẫn được giữ, và mã tra cứu sẽ gửi tới chính email này.',
    'cart.errNetwork': 'Không kết nối được tới máy chủ. Đơn có thể đã được tạo — hãy kiểm tra email hoặc thử lại, lần sau sẽ trả về đúng đơn cũ thay vì tạo đơn mới.',
    'order.expiresIn': 'Còn {time} để thanh toán',
    'order.deadlineOver': 'Đơn hàng đã hết hạn',
    'order.completed': 'Đã hoàn tất',
    'order.justPaid': 'Thanh toán đã được xác nhận — nút tải đã mở.',
    'order.errOffline': 'Mất kết nối. Trang sẽ tự kiểm tra lại khi bạn có mạng.',
    'order.recorded': 'Đơn hàng đã được ghi nhận. Lưu mã tra cứu để kiểm tra trạng thái và tải sản phẩm.',
    'order.copy': 'Sao chép mã',
    'order.check': 'Kiểm tra đơn hàng',
    'order.errStatus': 'Không kiểm tra được trạng thái đơn hàng',
    'order.errDownload': 'Chưa thể tải sản phẩm lúc này',
    'cart.agree': 'Tôi đã đọc Điều khoản, Chính sách bảo mật và Chính sách hoàn tiền, và hiểu phần mềm điện tử không được hoàn tiền sau khi đã tải.',
    'product.requirements': 'Yêu cầu hệ thống',
    'product.version': 'Phiên bản',
    'product.buyNow': 'Mua ngay',
    // Trang đơn hàng. Trước đây copy ở đây nằm thẳng trong order.js nên khách
    // nước ngoài đọc tiếng Việt sau khi đã trả tiền, và cùng một trạng thái lại
    // hiện hai chữ khác nhau ở popup thanh toán với ở trang đơn. Nhãn trạng thái
    // đơn bây giờ nằm ở format.js (SVDFormat.STATUS_LABELS) và đọc qua
    // I18N.status() — admin.html không nạp file từ điển này nên bảng đó phải ở
    // chỗ mà cả hai cùng tải được.
    'order.title': 'Đơn {id}',
    'order.row.product': 'Sản phẩm',
    'order.row.amount': 'Số tiền',
    'order.row.status': 'Trạng thái',
    'order.row.created': 'Thời điểm',
    'order.channel.account': 'Số tài khoản',
    'order.channel.amount': 'Số tiền',
    'order.channel.note': 'Nội dung',
    'order.channel.qr': 'Mã QR {label}',
    'order.unlock': 'Thanh toán thành công để mở nút tải',
    'order.refresh': 'Kiểm tra trạng thái',
    'order.help.need': 'Cần trợ giúp?',
    'order.help.or': 'hoặc xem',
    'order.help.refundPolicy': 'chính sách hoàn tiền',
    // Trang 404. Không có nút đổi ngôn ngữ thật sự — người đọc tới đây bằng một
    // đường dẫn hỏng, không mang theo ngôn ngữ — nên trang đọc ngôn ngữ trình duyệt
    // và bám theo. Đây là trang duy nhất buộc phải tự nói hai thứ tiếng.
    'notfound.eyebrow': 'Lỗi 404',
    'notfound.title': 'Không tìm thấy trang này',
    'notfound.text': 'Có thể đường dẫn bị sai chính tả, hoặc sản phẩm bạn tìm đã ngừng bán. Danh sách dưới đây là những gì đang có.',
    'notfound.loading': 'Đang tải sản phẩm…',
    'order.noSession.title': 'Chưa tìm thấy phiên đơn hàng',
    'order.noSession.hint': 'Vì lý do bảo mật, mã tra cứu chỉ được giữ trong trình duyệt này. Nếu bạn mở trang này ở thiết bị khác, hãy tra cứu lại bằng mã đơn và email.',
    'order.noSession.cta': 'Tra cứu đơn hàng',
    'order.recover.hint': 'Mất mạng, đóng máy hoặc chuyển thiết bị? Đơn {id} vẫn còn. Mở lại bằng mã đơn này và email bạn đã dùng để thanh toán.',
    'order.recover.cta': 'Tra cứu đơn hàng',
    'order.errDownloadOffline': 'Mất kết nối khi tải. Bạn có thể thử lại, đơn vẫn còn hiệu lực.',
    'order.hint.refunded': 'Chúng tôi đã hoàn lại tiền cho đơn này. Lý do: {reason}. Quyền tải sản phẩm đã được thu hồi. Nếu bạn cho là nhầm lẫn, hãy liên hệ {support} kèm mã đơn.',
    'order.hint.paid': 'Thanh toán đã được xác nhận. Bạn có thể tải sản phẩm ngay. Nếu tải bị gián đoạn, bấm tải lại là được, đơn vẫn còn hiệu lực.',
    'order.hint.delivered': 'Bạn đã tải sản phẩm và đơn đã hoàn tất. Nếu tệp tải về bị hỏng hoặc thiếu, gửi email cho chúng tôi kèm mã đơn, chúng tôi mở lại đơn ngay.',
    'order.hint.expiredPaid': 'Đơn này đã hết hạn nhưng tiền đã vào tài khoản của chúng tôi, nên đơn đã được mở lại. Nếu bạn vẫn không thấy nút tải, hãy liên hệ kèm mã đơn.',
    'order.hint.expiredPaypal': 'Đơn hàng quá thời gian thanh toán nên đã bị hủy, và PayPal không ghi nhận khoản nào nên bạn chưa bị trừ tiền. Bạn có thể đặt đơn mới.',
    'order.hint.expiredBank': 'Đơn hàng quá thời gian nên đã bị hủy. Chúng tôi chưa ghi nhận được khoản chuyển khoản này — nếu bạn đã chuyển, hãy gửi ảnh biên lai kèm mã đơn, chúng tôi sẽ mở lại đơn hoặc hoàn lại. Nếu chưa chuyển, bạn có thể đặt đơn mới.',
    'order.hint.paymentFailed': 'Thanh toán không thành công nên bạn chưa bị trừ tiền. Bạn có thể thử lại, đơn vẫn giữ nguyên.',
    'review.heading': 'Cảm nhận của bạn?',
    'review.hint': 'Một câu về điều bạn đã làm được với phần mềm này là đủ rồi. Chúng tôi không xin điểm số, chỉ cần lời của người thật.',
    'review.placeholder': 'Ví dụ: file cài đặt chạy được luôn, không phải tự cấu hình gì thêm.',
    'review.namePlaceholder': 'Tên hiển thị (bỏ trống nếu ẩn danh)',
    'review.send': 'Gửi cảm nhận',
    'review.sending': 'Đang gửi…',
    'review.sent': 'Cảm ơn bạn, đã ghi lại.',
    'review.already': 'Bạn đã gửi cảm nhận cho sản phẩm này rồi. Cảm ơn bạn!',
    'review.failed': 'Chưa gửi được. Thử lại sau ít phút.',
    // Máy chủ trả về một mã lỗi, không phải câu để hiển thị. Trước đây nó trả
    // cả câu tiếng Việt và trang đơn in thẳng vào ô trạng thái, nên khách nói
    // tiếng Anh đọc phải tiếng Việt đúng lúc họ vừa trả tiền xong.
    'review.err.notFound': 'Không tìm thấy đơn này.',
    'review.err.notFulfilled': 'Chỉ đơn đã nhận được file mới viết đánh giá được.',
    'review.err.refunded': 'Đơn này đã được hoàn tiền nên không viết đánh giá được.',
    'review.err.wrongProduct': 'Sản phẩm này không nằm trong đơn hàng.',
    'review.err.tooShort': 'Viết thêm một chút để người khác tin được, tối thiểu {min} ký tự.',
    'review.err.tooLong': 'Tối đa {max} ký tự.',
    'review.err.storeFailed': 'Chưa lưu được đánh giá. Cứ bỏ qua — phần còn lại của đơn hàng vẫn bình thường.',
    'order.hint.deadlinePassed': 'Đơn hàng đã hết thời gian thanh toán và sắp bị hủy. Nếu bạn đã chuyển khoản, hãy liên hệ để chúng tôi đối soát, chúng tôi sẽ mở lại đơn cho bạn.',
    'order.hint.pendingTransfer': 'Bạn đang thanh toán bằng chuyển khoản, nên thao tác nằm trong app ngân hàng chứ không ở trang này. Nếu app ngân hàng bị treo hoặc máy tắt giữa chừng, hãy mở lại app để kiểm tra giao dịch đã thực hiện hay chưa. Đơn này được giữ nguyên, còn thời gian và chúng tôi sẽ báo ngay khi bạn bấm nút bên dưới.',
    'order.hint.paypalUnconfirmed': 'Nếu bạn đã bấm thanh toán ở PayPal nhưng trang này chưa xác nhận được, đừng thanh toán lại lần nữa. Hãy tải lại trang hoặc bấm nút bên dưới: hệ thống sẽ hỏi lại PayPal và mở nút tải nếu tiền đã vào. Nếu PayPal chưa ghi nhận khoản nào, bạn chưa bị trừ tiền và có thể thanh toán lại bình thường.',
    'order.hint.refundUnknown': 'không rõ',
    'order.hint.processing': 'Đơn hàng đang được xử lý. Bạn có thể tải ngay khi trạng thái chuyển sang đã thanh toán, trang này sẽ tự cập nhật.',

    // ---- legal pages ----
    //
    // about/terms/privacy/refund used to be Vietnamese-only, so a buyer outside
    // Vietnam read the terms deciding whether to pay, and the refund conditions
    // they would be judged by, in a language they did not choose. Nothing on
    // those pages was in here at all: no key, no toggle, no dictionary.
    //
    // Five things are deliberately not keys. {{brandName}}, {{site}},
    // {{support}}, {{year}} and {{paymentWindowHours}} are configuration, so a
    // sentence carrying one is filled from it rather than translated.
    //
    // They still have to work after a language switch, which the dictionary
    // alone cannot do: I18N.t() returns this text verbatim, so the placeholder
    // would come back with it. The server fills them into the HTML it renders
    // *and* ships them in <meta name="sv-tokens">, and t() substitutes them from
    // there on the way out. That is why a sentence here keeps its
    // {{paymentWindowHours}} rather than a hard-coded "24": the window is set in
    // configuration and read by checkout, so a third copy in a dictionary would
    // be a number that can drift.
    //
    // A <code> file name, an em dash and the vendor names in the privacy list
    // are not language either.
    //
    // Where a sentence carries a bold or italic phrase, the markup is kept and
    // the text around it is split into keys, so a reader switching to English
    // sees the same emphasis rather than a paragraph that lost it.
    'legal.eyebrow': 'Pháp lý',
    'legal.updated': 'Cập nhật: {{policyUpdatedDisplay}} · Áp dụng cho mọi giao dịch tại',

    // ---- about ----
    // The homepage header links say "Vì sao chọn {brand}" and "FAQ"; this page
    // says "Vì sao" and "Câu hỏi", so the two keys there would have changed the
    // wording of a link that already had a translation. These are the ones the
    // page actually prints.
    // The h1 is two pieces because the brand name is a token the server
    // substitutes and <em> styles: the Vietnamese sentence is a span the switch
    // can reach, the brand is markup it must not touch.
    'about.h1': 'Ai đứng sau',
    'about.lede': 'Một người viết phần mềm dùng cho công việc thật, rồi bán đúng những gì mình đã dùng. Không công ty, không nhà đầu tư, không đội quảng cáo.',
    'about.h2': 'Chúng tôi làm gì',
    'about.p1': 'Tiện ích và công cụ cho Windows, viết để giải quyết một việc cụ thể trong công việc văn phòng hoặc kỹ thuật. Mỗi sản phẩm trả lời đúng một câu hỏi: "vấn đề này thì làm sao?". Sản phẩm nào không trả lời được câu hỏi nào thì không lên cửa hàng.',
    'about.p2': 'Bán một lần, không thuê bao. Bạn tải file ngay sau khi thanh toán và không cần chờ ai duyệt. Mỗi đơn đều có mã tra cứu gửi qua email để bạn tạo lại link tải bất cứ lúc nào, không giới hạn số lần.',
    'about.h3': 'Cam kết',
    'about.p3': 'Không xóa gì trên máy bạn mà không nói trước. Sản phẩm nào có cài đặt đều có script hoàn tác. Sản phẩm nào chạy nền đều nói rõ nó tự khởi động cùng Windows và tự tắt thế nào.',
    'about.p4': 'File lỗi thì gửi lại hoặc hoàn tiền, không cần lý do. Một sản phẩm không làm việc thì bạn không nên trả tiền để dùng nó.',
    'about.h4': 'Hỏi chúng tôi',
    // The ask-us paragraph is split around the mailto link: the address itself is
    // a token from configuration, so the sentence is keyed on both sides of it
    // rather than as a whole. It was the one paragraph on this page written
    // straight into the HTML, and it is the paragraph a buyer with a question
    // reads.
    'about.ask': 'Mọi câu hỏi, kể cả "cái này có phù hợp với máy tôi không", đều trả lời được:',
    'about.ask2': '. Chúng tôi không có chatbot, nên câu trả lời đến từ đúng người đã viết phần mềm.',
    'about.p5': 'Đơn hàng của bạn cũng tra cứu được tại',
    'about.p6': 'bằng mã đơn và email đã dùng khi mua.',

    // ---- terms ----
    'legal.terms.h1': 'Điều khoản sử dụng',
    'legal.terms.h2': '1. Ai được sử dụng',
    'legal.terms.p1a': 'Giấy phép bạn mua là',
    'legal.terms.p1b': 'giấy phép sử dụng cá nhân, không chuyển nhượng',
    'legal.terms.p1c': ', dành cho một máy tính của một người dùng. Bạn không được bán lại, chia sẻ, cho thuê, quay trội lại hoặc phát tán lại bản quyền, mã nguồn hay tệp phát hành dưới bất kỳ hình thức nào, kể cả khi đã chỉnh sửa mã nguồn.',
    'legal.terms.p2': 'Có thể dùng cho mục đích thương mại nội bộ của doanh nghiệp, nhưng phần mềm chỉ chạy trên máy tính của tổ chức đó, không triển khai lại thành dịch vụ. Quyền sử dụng cho cả nhóm nhiều người hoặc nhiều máy cần gói riêng, vui lòng liên hệ trước khi mua.',
    'legal.terms.h3': '2. Hình thức thanh toán',
    'legal.terms.p3': 'Chúng tôi nhận thanh toán qua PayPal (quy đổi từ VND sang USD theo tỷ giá tại thời điểm tạo đơn) và chuyển khoản ngân hàng, MoMo, ZaloPay. Giá niêm yết là số tiền bạn phải trả; phí đi kèm do bên thứ ba thu không nằm trong giá niêm yết.',
    'legal.terms.p4': 'Với PayPal, tỷ giá quy đổi được ghi nhận vào đơn hàng ngay lúc khởi tạo và không thay đổi sau đó. Với chuyển khoản, vui lòng giữ nguyên số tiền và nội dung chuyển khoản đã điền sẵn để chúng tôi đối soát.',
    'legal.terms.h4': '3. Thời hạn thanh toán và hủy đơn',
    'legal.terms.p5a': 'Đơn hàng chuyển khoản được xác nhận trong thời gian làm việc, thông thường dưới 24 giờ. Trong thời gian chờ, trạng thái đơn là',
    // Its own key rather than order.status.pendingTransfer: that one is a status
    // label and starts with a capital, which would have rewritten the Vietnamese
    // of this page the first time the dictionary touched it.
    'legal.terms.p5b': 'đang chờ chuyển khoản',
    'legal.terms.p5c': 'và chưa thể tải.',
    'legal.terms.h5': '4. Cấp phát và tải phần mềm',
    'legal.terms.p6': 'Trước khi hết hạn, chúng tôi gửi email nhắc. Nếu tiền đã vào tài khoản của chúng tôi sau khi đơn bị hủy — chẳng hạn PayPal báo thành công muộn — đơn sẽ được mở lại và bạn vẫn tải được sản phẩm. Nếu bạn đã chuyển khoản ngân hàng nhưng đơn đã hết hạn, hãy gửi ảnh biên lai, chúng tôi sẽ đối soát hoặc hoàn lại.',
    'legal.terms.p7a': 'Sau khi đơn chuyển khoản được xác nhận',
    'legal.terms.p7b': 'hoặc',
    'legal.terms.p7c': 'PayPal báo thành công, bạn nhận mã tra cứu đơn hàng. Mã này là thông tin truy cập duy nhất vào file phát hành, hãy lưu lại cẩn thận. Chúng tôi cũng gửi mã này qua email kèm thời hạn thanh toán.',
    'legal.terms.p8': 'Mỗi lần tải tạo một liên kết có thời hạn ngắn, và bạn có thể tạo liên kết mới bất cứ lúc nào bằng mã tra cứu. Liên kết tải dùng cho một lần và có thể bị thu hồi vì lý do bảo mật.',
    'legal.terms.p9': 'Đơn hàng được xem là hoàn tất ngay khi bạn bắt đầu tải sản phẩm, và nút tải sẽ khóa lại. Điều này bảo đảm mỗi đơn chỉ phát hành đúng một lần. Nếu bạn tải lỗi do mạng hoặc file hỏng, hãy liên hệ, chúng tôi sẽ mở lại đơn cho bạn.',
    'legal.terms.p10a': 'Tên tệp tải xuống được giữ nguyên theo bản phát hành (ví dụ',
    'legal.terms.p10b': '). Một số trình diệt virus hoặc trình duyệt có thể cảnh báo với tệp thực thi chưa ký số; đây là hành vi thông thường của phần mềm tải trực tiếp từ Internet, không phải dấu hiệu phần mềm độc.',
    'legal.terms.h6': '5. Giấy phép vĩnh viễn, không phí định kỳ',
    'legal.terms.p11': 'Mức giá bạn trả là trọn đời cho phiên bản đã mua. Chúng tôi không thu phí thuê bao, phí duy trì hay phí cấp phép lại. Các bản cập nhật trong tương lai của cùng dòng sản phẩm được phát hành miễn phí khi có.',
    'legal.terms.h7': '6. Bảo hành và hỗ trợ',
    'legal.terms.p12': 'Chúng tôi bảo đảm phần mềm chạy đúng mô tả trong điều kiện hệ thống đã nêu. Nếu phần mềm lỗi, bạn được hoàn lại tiền hoặc nhận bản sửa lỗi tương đương; bạn chọn phương án nào. Hỗ trợ kỹ thuật qua email trong vòng 2 ngày làm việc.',
    'legal.terms.p13': 'Chúng tôi không bảo đảm phần mềm tương thích với mọi cấu hình hệ thống, mọi phiên bản Windows, hoặc với phần mềm diệt virus đang chặn tệp thực thi. Bạn chịu trách nhiệm sao lưu dữ liệu trước khi cài đặt bất kỳ công cụ nào lên máy.',
    'legal.terms.h8': '7. Hoàn tiền',
    'legal.terms.p14a': 'Quyền hoàn tiền và điều kiện áp dụng được nêu tại',
    // The link between them is order.help.refundPolicy.
    'legal.terms.p14b': '. Rút gọn: bạn được hoàn tiền nếu phần mềm không chạy được như mô tả, và không được hoàn nếu đã bắt đầu sử dụng bình thường sau khi tải.',
    'legal.terms.h9': '8. Giới hạn trách nhiệm',
    'legal.terms.p15a': 'Trong phạm vi tối đa được phép luật, trách nhiệm của chúng tôi đối với bất kỳ khiếu nại nào giới hạn ở',
    'legal.terms.p15b': 'tổng số tiền bạn đã trả cho đơn hàng đó',
    'legal.terms.p15c': '. Chúng tôi không chịu trách nhiệm về thiệt hại gián tiếp, mất dữ liệu hoặc mất lợi nhuận phát sinh gián tiếp từ việc sử dụng hoặc không sử dụng phần mềm.',
    'legal.terms.h10': '9. Đình chỉ giấy phép',
    'legal.terms.p16': 'Giấy phép sẽ bị vô hiệu nếu bạn vi phạm điều khoản, đặc biệt là chia sẻ, phát tán hoặc bán lại phần mềm. Trong trường hợp này, chúng tôi có thể từ chối cấp lại liên kết tải cho các đơn hàng dưới giấy phép đó. Chúng tôi cũng có quyền ngừng cấp dịch vụ nếu bạn dùng dịch vụ để gây thiệt hại cho người khác hoặc vi phạm pháp luật.',
    'legal.terms.h11': '10. Thay đổi điều khoản',
    'legal.terms.p17': 'Chúng tôi có thể cập nhật các điều khoản này. Bản cập nhật có hiệu lực từ thời điểm đăng trên trang này và không áp dụng hồi tố cho các đơn hàng đã đặt trước đó, mỗi đơn chịu điều khoản tại thời điểm bạn mua.',
    'legal.terms.h12': '11. Luật áp dụng và giải quyết tranh chấp',
    'legal.terms.intro': 'Bạn đang đọc các điều khoản áp dụng khi mua và sử dụng phần mềm do <strong>{{brandName}}</strong> phát triển. Mua hàng nghĩa là bạn chấp nhận các điều khoản dưới đây. Nếu không đồng ý, vui lòng không thực hiện giao dịch.',
    'legal.terms.p5d': 'Đơn hàng chưa được thanh toán sẽ tự động bị hủy sau <strong>{{paymentWindowHours}} giờ</strong> kể từ thời điểm bạn nhấn nút đặt hàng, áp dụng cho mọi phương thức thanh toán. Thời hạn này được hiển thị ngay trên biểu mẫu thanh toán và trên trang đơn hàng của bạn.',
    'legal.terms.p18': 'Các điều khoản này được hiểu và thực hiện theo pháp luật Việt Nam. Tranh chấp sẽ được giải quyết bằng thương lượng thiện chí trước; nếu không thống nhất được, bất kỳ bên nào cũng có quyền yêu cầu tòa án có thẩm quyền tại nơi {{brandName}} đặt trụ sở xử lý.',

    // ---- privacy ----
    'legal.privacy.h1': 'Chính sách bảo mật',
    'legal.privacy.p1': 'Chúng tôi tôn trọng dữ liệu của bạn. Trang này giải thích cụ thể những gì được thu thập khi bạn mua hàng, mục đích của từng loại dữ liệu và biện pháp bảo vệ đi kèm.',
    'legal.privacy.h2': '1. Dữ liệu chúng tôi thu thập',
    'legal.privacy.p2a': 'Thông tin bạn cung cấp khi thanh toán:',
    'legal.privacy.p2b': 'tên, địa chỉ email và tên sản phẩm bạn mua. Chúng tôi dùng email này để xác nhận đơn hàng, gửi mã tra cứu khi có yêu cầu và hỗ trợ bạn sau bán.',
    'legal.privacy.p3a': 'Dữ liệu giao dịch:',
    'legal.privacy.p3b': 'mã đơn, số tiền, phương thức thanh toán, trạng thái thanh toán và thời điểm thực hiện. Với PayPal, chúng tôi nhận mã giao dịch và trạng thái từ PayPal, không lưu số thẻ hay thông tin tài khoản ngân hàng của bạn.',
    'legal.privacy.p4a': 'Email giao dịch:',
    'legal.privacy.p4b': 'chúng tôi tự động gửi tới địa chỉ bạn cung cấp các thông báo về đơn hàng của bạn: xác nhận đơn kèm thời hạn thanh toán, nhắc trước khi đơn hết hạn, thông báo đơn bị hủy, và thông báo thanh toán thành công. Loại email này là giao dịch, không phải quảng cáo, và không thể tắt khi bạn vẫn muốn nhận thông tin về đơn của mình.',
    'legal.privacy.p5a': 'Dữ liệu kỹ thuật:',
    'legal.privacy.p5b': 'địa chỉ IP và loại trình duyệt được ghi trong nhật ký máy chủ ở mức cần thiết để vận hành và bảo mật dịch vụ.',
    'legal.privacy.h3': '2. Chúng tôi không thu thập',
    'legal.privacy.h4': '3. Mục đích sử dụng',
    'legal.privacy.p6': 'Dữ liệu chỉ được dùng cho các mục đích sau: cung cấp phần mềm bạn đã mua, xác minh và đối soát thanh toán, hỗ trợ kỹ thuật, và tuân thủ nghĩa vụ pháp lý của nhà cung cấp dịch vụ. Chúng tôi không bán, không trao đổi dữ liệu của bạn cho bên thứ ba vì mục đích quảng cáo.',
    'legal.privacy.h5': '4. Mã tra cứu đơn hàng',
    'legal.privacy.p7a': 'Sau khi thanh toán, hệ thống tạo một mã tra cứu ngẫu nhiên và chỉ lưu',
    'legal.privacy.p7b': 'dạng băm',
    'legal.privacy.p7c': 'của mã đó, không lưu bản gốc. Chỉ khi bạn cung cấp đúng mã, hệ thống mới cấp liên kết tải. Đây là lớp bảo vệ đầu tiên bên cạnh việc kiểm tra email.',
    'legal.privacy.p8': 'Chúng tôi không lưu trong cơ sở dữ liệu liên kết tải có hiệu lực; mỗi liên kết được tạo mới theo yêu cầu và tự hết hạn sau thời gian ngắn.',
    'legal.privacy.h6': '5. Chia sẻ với bên thứ ba',
    'legal.privacy.p9': 'Chúng tôi chỉ chia sẻ dữ liệu tối thiểu cần thiết với các đối tác sau, mỗi bên theo phạm vi việc riêng. Danh sách này có thể thay đổi; bản hiện hành luôn nằm trên trang này.',
    // The vendor name itself stays in the markup: it is a proper noun, and
    // translating it would put a name nobody can search for into the sentence.
    'legal.privacy.v1': '— lưu trữ tệp phát hành và phân phối liên kết tải. Tệp của bạn nằm trong bucket riêng tư, không công khai.',
    'legal.privacy.v2': '— cơ sở dữ liệu lưu đơn hàng và danh mục sản phẩm.',
    'legal.privacy.v3a': 'PayPal, ngân hàng, MoMo, ZaloPay',
    'legal.privacy.v3b': '— xử lý thanh toán theo đúng lịch trình của từng nhà cung cấp.',
    'legal.privacy.v4': '— gửi email giao dịch về đơn hàng của bạn. Nó chỉ nhận địa chỉ email, tên và nội dung thư; chúng tôi không gửi danh sách khách hàng cho bên khác.',
    'legal.privacy.v5': '— nền tảng vận hành máy chủ.',
    'legal.privacy.p10': 'Chúng tôi cũng có thể phải cung cấp thông tin khi có yêu cầu hợp pháp từ cơ quan nhà nước có thẩm quyền.',
    'legal.privacy.h7': '6. Lưu giữ dữ liệu',
    'legal.privacy.p11': 'Dữ liệu giao dịch được giữ để đối soát kế toán và xử lý khiếu nại trong thời hạn bắt buộc theo quy định pháp luật Việt Nam, tối thiểu 12 tháng. Dữ liệu kỹ thuật trong nhật ký máy chủ được lưu ngắn hạn và tự động xoá theo tuần hoàn.',
    'legal.privacy.h8': '7. Bảo mật kỹ thuật',
    'legal.privacy.p12': 'Toàn bộ kết nối đi qua HTTPS. Khu vực quản trị yêu cầu mã xác thực, mã đơn hàng lưu dạng băm, và mọi biến bí mật nằm ngoài mã nguồn trong biến môi trường. Chúng tôi giới hạn truy cập vào dữ liệu chỉ ở những người cần thiết cho công việc.',
    'legal.privacy.h9': '8. Quyền của bạn',
    'legal.privacy.h10': '9. Bảo mật phần mềm',
    'legal.privacy.p13': 'Phần mềm bạn mua không thu thập, gửi hay tải lên bất kỳ máy chủ nào của chúng tôi. Phần mềm chạy hoàn toàn cục bộ trên máy tính của bạn và không cần kết nối Internet sau khi cài đặt. Nếu bạn phát hiện phần mềm gửi dữ liệu đi, vui lòng báo cho chúng tôi, vì đó sẽ là hành vi không đúng cam kết.',
    'legal.privacy.h11': '10. Thay đổi chính sách',
    'legal.privacy.p14': 'Chúng tôi có thể cập nhật chính sách này. Bản cập nhật có hiệu lực khi đăng tại trang này; các giao dịch đã hoàn tất chịu chính sách tại thời điểm phát sinh.',
    'legal.privacy.p5': 'Chúng tôi không yêu cầu và không lưu số thẻ tín dụng, mã PIN, mật khẩu ngân hàng, hay ảnh chụp màn hình. Việc thanh toán được xử lý hoàn toàn trên hệ thống của PayPal, ngân hàng, MoMo hoặc ZaloPay, nên thông tin bí mật đó không đi qua máy chủ của {{brandName}}.',
    'legal.privacy.p15': 'Bạn có quyền xem, chỉnh sửa hoặc yêu cầu xoá thông tin cá nhân của mình. Với dữ liệu giao dịch, chúng tôi có thể ẩn danh thông tin nhận diện trong khi vẫn giữ nghĩa vụ kế toán, hoặc xoá hẳn nếu pháp luật cho phép. Gửi yêu cầu tới <a href="mailto:{{support}}">{{support}}</a> và chúng tôi sẽ phản hồi trong 5 ngày làm việc.',

    // ---- refund ----
    'legal.refund.h1': 'Chính sách hoàn tiền',
    'legal.refund.p1': 'Chúng tôi muốn bạn mua một cách tự tin. Chính sách này nêu rõ trong trường hợp nào bạn được hoàn tiền, trong trường hợp nào không, và quy trình xử lý cụ thể.',
    'legal.refund.p2': 'Các điều khoản này là một phần của',
    // Not legal.terms.h1: that is a heading, capitalised, and reusing it here
    // would have changed the Vietnamese this page prints today.
    'legal.refund.termsLink': 'điều khoản sử dụng',
    'legal.refund.h2': '1. Bạn được hoàn tiền khi nào',
    'legal.refund.p3': 'Chúng tôi hoàn toàn tiền cho các trường hợp sau, kể cả khi bạn đã bắt đầu sử dụng:',
    'legal.refund.w1a': 'Phần mềm',
    'legal.refund.w1b': 'không chạy được',
    'legal.refund.w1c': 'trên hệ thống đã nêu trong mục yêu cầu hệ thống của sản phẩm, và chúng tôi không thể khắc phục trong 7 ngày.',
    'legal.refund.w2a': 'Sản phẩm bạn nhận',
    'legal.refund.w2b': 'không đúng với mô tả',
    'legal.refund.w2c': 'trên trang sản phẩm, không thể chấp nhận được.',
    'legal.refund.w3a': 'Bạn bị tính tiền',
    'legal.refund.w3b': 'hai lần',
    'legal.refund.w3c': 'cho cùng một đơn hàng, hoặc số tiền bị trừ sai so với giá niêm yết.',
    'legal.refund.w4a': 'Bạn đã thanh toán nhưng',
    'legal.refund.w4b': 'không nhận được mã tra cứu',
    'legal.refund.w4c': 'và chúng tôi không thể cấp lại trong 7 ngày.',
    'legal.refund.w5': 'Giao dịch bị hoàn tiền tự động, hoặc bạn bị tính nhầm do lỗi hệ thống của chúng tôi.',
    'legal.refund.h3': '2. Thời hạn yêu cầu',
    'legal.refund.h4': '3. Quy trình xử lý',
    'legal.refund.p4a': 'Bước 1 — Gửi yêu cầu.',
    'legal.refund.p4b': 'Email về địa chỉ trên, kèm mã đơn hàng và mô tả vấn đề. Nên kèm ảnh chụp màn hình lỗi nếu có; điều này giúp xử lý nhanh hơn nhiều.',
    'legal.refund.p5a': 'Bước 2 — Chúng tôi kiểm tra.',
    'legal.refund.p5b': 'Thời gian phản hồi trong vòng 2 ngày làm việc. Nếu lỗi rõ ràng, chúng tôi chủ động tạo bản sửa và gửi bạn; bạn có thể chọn nhận bản sửa thay vì hoàn tiền.',
    'legal.refund.p6a': 'Bước 3 — Hoàn tiền.',
    'legal.refund.p6b': 'Sau khi xác nhận, tiền được hoàn về đúng phương thức bạn đã thanh toán, thường mất 1 đến 10 ngày làm việc tùy ngân hàng hoặc nhà cung cấp.',
    'legal.refund.h5': '4. Chúng tôi không hoàn tiền khi nào',
    'legal.refund.p7': 'Để công bằng với những khách hàng khác, chúng tôi không hoàn tiền trong các trường hợp sau:',
    'legal.refund.n1a': 'Bạn đã',
    'legal.refund.n1b': 'tải và sử dụng',
    'legal.refund.n1c': 'phần mềm trong luồng công việc bình thường, và yêu cầu chỉ vì không thích giao diện, màu sắc hoặc thay đổi ý định.',
    'legal.refund.n2': 'Bạn mua nhầm phiên bản, mua nhầm sản phẩm, hoặc mua số lượng lớn rồi không dùng hết.',
    'legal.refund.n3a': 'Bạn',
    'legal.refund.n3b': 'vi phạm điều khoản',
    'legal.refund.n3c': ', ví dụ chia sẻ, bán lại hoặc phát tán phần mềm.',
    'legal.refund.n4': 'Phần mềm không chạy vì thiếu yêu cầu hệ thống bạn đã được cảnh báo trước, hoặc vì phần mềm diệt virus của bạn chủ động xoá tệp đã tải.',
    'legal.refund.n5a': 'Mua nhầm hàng, mua nhiều hơn nhu cầu, hoặc thay đổi ý định sau khi đã tải',
    'legal.refund.n5b': 'quá một lần',
    'legal.refund.n6': 'Yêu cầu được gửi sau 14 ngày mà không có lý do kỹ thuật hợp lý.',
    'legal.refund.h6': '5. Hoàn một phần',
    'legal.refund.p8': 'Trong trường hợp đặc biệt, ví dụ bạn đã tải nhưng gặp lỗi kỹ thuật tạm thời không thể dùng ngay, chúng tôi có thể đề xuất hoàn một phần thay vì trọn số tiền. Quyết định này do hai bên thống nhất và không áp dụng bắt buộc.',
    'legal.refund.p2b': 'Bạn có thể gửi yêu cầu hoàn tiền trong <strong>14 ngày</strong> kể từ ngày thanh toán, bằng email tới <a href="mailto:{{support}}">{{support}}</a>. Sau thời điểm này, trường hợp mục 1 và 2 vẫn được xem xét nếu lỗi được phát hiện muộn do hoàn cảnh khách quan, nhưng việc hoàn tiền sẽ do hai bên thỏa thuận.',
    'legal.refund.h7': '6. Hủy đơn chưa thanh toán',
    'legal.refund.p9': 'Đơn hàng chưa thanh toán bị tự động hủy sau {{paymentWindowHours}} giờ kể từ thời điểm đặt hàng. Đơn đã hủy không bị tính phí, vì vậy không có gì để hoàn. Nếu bạn đã chuyển khoản nhưng đơn chưa được xác nhận, hãy gửi ảnh chụp biên lai — chúng tôi sẽ đối soát và hoàn lại nếu có sai sót.',
    'legal.refund.h8': '7. Liên hệ',
    'legal.refund.p10': 'Mọi yêu cầu hoàn tiền gửi tới <a href="mailto:{{support}}">{{support}}</a>. Vui lòng nêu mã đơn hàng để chúng tôi tra cứu nhanh. Chúng tôi không giải quyết khiếu nại qua mạng xã hội, vì không thể xác minh danh tính người gửi trên các kênh đó.',
  },
  en: {
    // The configured default. The server substitutes the live SUPPORT_EMAIL.
    'brand.supportEmail': supportAddress(),
    'brand.tagline': 'Good software for good work.',
    'brand.rights': `© ${YEAR} ${host()} · All rights reserved`,
    'announce.text': '{brand} is opening up to new releases',
    'announce.cta': 'Explore now',
    'nav.products': 'Products',
    'nav.home': 'Back to home',

    // Tab titles, English side. Kept in the same order as the Vietnamese half so
    // the two tables can be read against each other line by line — which is what
    // the key-parity gate compares them with.
    'title.home': 'Excel macros and USB capacity, sorted | {brand}',
    'title.about': 'About us — who makes {brand} and why',
    'title.terms': 'Terms of use — {brand}',
    'title.privacy': 'Privacy policy — {brand}',
    'title.refund': 'Refund policy — {brand}',
    'title.lookup': 'Order lookup — {brand}',
    'title.order': 'Your order — {brand}',
    'title.paypalReturn': 'Confirming your payment — {brand}',
    'title.notfound': 'Page not found — {brand}',

    'api.err.unauthorized': 'Not authorised.',
    'api.err.forbidden': 'The viewer role is read-only.',
    'api.err.catalogLoad': 'Could not load the catalogue',
    'api.err.productNotFound': 'Product not found',
    'api.err.productLoad': 'Could not load the product',
    'api.err.methodsLoad': 'Could not load the payment methods',
    'api.err.invalidEmail': 'That email address is not valid',
    'api.err.orderNotFound': 'Order not found',
    'api.err.lookupMismatch': 'No order matches that code and email',
    'api.err.invalidOrderRef': 'That order code or email is not valid',
    'api.err.lookupFailed': 'Could not look up the order',
    'api.err.orderLoad': 'Could not load the order',
    'api.err.orderUpdate': 'Could not update the order',
    'api.err.orderCreate': 'Could not create the order',
    'api.err.productNotSellable': 'This product is not on sale',
    'api.err.productUnavailable': 'This product is not available',
    'api.err.orderNotClosed': 'This order is not closed yet',
    'api.err.orderAlreadyDelivered': 'This order was already delivered and cannot be downloaded again',
    'api.err.orderUnpaid': 'This order has not been paid',
    'api.err.paypalConfirm': 'Could not confirm the PayPal payment',
    'api.err.paypalMismatch': 'PayPal did not confirm this order or amount',
    'api.err.notPaypalOrder': 'This order was not paid with PayPal',
    'api.err.paypalUnconfigured': 'PayPal is not configured. Choose bank transfer, or configure PayPal on the server.',
    'api.err.translateUnconfigured': 'Translation service is not configured (DEEPL_API_KEY)',
    'api.err.translateInputMissing': 'Missing text or target language',
    'api.err.translateTargetMissing': 'Missing target language',
    'api.err.translateUnavailable': 'Translation service is unavailable',
    'api.err.translateBatchFailed': 'Translation batch failed',
    'api.err.rateLimited': 'Too many requests. Please try again shortly.',
    'api.err.rateLimitedCreate': 'Too many orders placed. Please try again in 15 minutes.',
    'api.err.rateLimitedLookup': 'Too many lookups. Please try again in 15 minutes.',
    'api.err.invalidProductInput': 'That product name or price is not valid',
    'api.err.missingFileRef': 'productRef, version or fileName is missing',
    'api.err.unsupportedFileType': 'Only .zip, .exe, .msi and .7z files are supported',
    'api.err.r2Unconfigured': 'R2 is not configured',
    'api.err.downloadLink': 'Could not create the download link',
    'api.err.uploadLink': 'Could not create the upload link',
    'api.err.refundNotPaid': 'Only a paid order can be refunded',
    'api.err.refundReasonRequired': 'A reason is required to refund',
    'api.err.refundCategoryRequired': 'A refund reason category is required',
    'api.err.refundPartialAmountRequired': 'A good-will refund must be for an amount between zero and what was actually paid',
    'api.err.policyNotAccepted': 'You need to accept the terms and the refund policy before paying',
    'api.err.invalidStatus': 'That status is not valid',
    'api.err.transferUnconfigured': 'Bank transfer is not configured',
    'api.err.noReleaseFile': 'This product has no release file yet',
    'api.err.productCreate': 'Could not create the product',
    'api.err.productDelete': 'Could not delete the product',
    'api.err.productHasOrders': 'This product has {sold} orders behind it. Archive it rather than delete it, to keep the sales history.',
    'api.err.productUpdate': 'Could not update the product',
    'api.err.slugRequired': 'That product name does not make a valid path. Enter a slug.',
    'api.err.slugTaken': 'That path already belongs to another product.',
    'api.err.invalidPrice': 'That price is not a valid amount',
    'api.err.reviewSave': 'Could not save the review',
    'api.err.revenue': 'Could not total the revenue',
    'api.err.orderCheck': 'Could not verify the order',
    'api.err.notFound': 'Not found',
    'api.err.internal': 'Something went wrong on our side',
    'api.err.webhookRejected': 'Webhook rejected',
    'api.err.webhookSignature': 'Webhook signature is not valid',
    'nav.faq': 'FAQ',
    'nav.buy': 'Buy now',
    'nav.terms': 'Terms',
    'nav.privacy': 'Privacy',
    'nav.about': 'About us',
    'nav.refund': 'Refund',
    'nav.lookup': 'Order lookup',
    'nav.contact': 'Contact',
    'hero.eyebrow': 'Software built with care',
    'hero.title1': 'Good tools.',
    'hero.title2': 'A simpler',
    'hero.title3': 'daily life.',
    'hero.text': 'Programs {brand} writes from scratch for everyday users — easy to install, transparent, and always updated.',
    'hero.cta1': 'View products',
    'hero.cta2': 'Why {brand}?',
    'hero.trust1': 'Secure',
    'hero.trust2': 'Real support',
    'hero.trust3': 'Long-term updates',
    'art.window': '{brand} / workspace',
    'art.verified': 'Verified',
    'art.safe': 'Secure checkout',
    'art.new': 'v1.0.0 · new',
    'art.caption': 'Made for better work.',
    'stats.1': 'Products on sale',
    'stats.2': 'Platforms supported',
    'stats.3': 'Releases published',
    'stats.note': 'Every product is made to solve a problem that is actually real.',
    'products.eyebrow': 'Software store',
    'products.title1': 'Pick the tool',
    'products.title2': 'that fits you.',
    'products.intro1': 'From free tools to professional solutions.',
    'products.intro2': 'Everything is easy to start.',
    'products.all': 'All',
    'products.searchLabel': 'Search products',
    'products.searchPlaceholder': 'Search by name or feature…',
    'products.count': 'products',
    'products.onlyOne': 'This is the only product right now.',
    'products.emptyTitle': 'No product matches',
    'products.emptyText': 'Try a different word, or clear the filter you picked.',
    'products.loadError': 'Could not load products',
    'products.loadErrorText': 'Failed to load data',
    'products.new': 'New',
    'products.buyAria': 'Buy',
    'why.eyebrow': 'Behind {brand}',
    'why.title1': 'Less friction.',
    'why.title2': 'More results.',
    'why.text': 'We believe good software does not have to be complicated. Every feature exists for a reason.',
    'why.more': 'Learn more',
    'why.h1': 'Simple from the start',
    'why.h1d': 'Fast to install, clear interface, no long manual needed.',
    'why.h2': 'Genuinely updated',
    'why.h2d': 'New versions, bug fixes and support when you need them — no hidden fees.',
    'why.h3': 'Support from a real person',
    'why.h3d': 'You get an email reply. Not a chatbot, not a soulless ticket.',
    'faq.eyebrow': 'Common questions',
    'faq.title': 'Before you start.',
    'faq.q1': 'How do I buy a product?',
    'faq.a1': 'Choose a product, enter your email and pick a payment method. Once payment succeeds you receive an order code to download the release.',
    'faq.q2': 'Does the download link expire?',
    'faq.a2': 'Download links are generated straight from private storage and are short-lived. You can generate a new one at any time with your order code.',
    'faq.q3': 'I closed the tab and lost my code. What now?',
    'faq.a3': 'Go to Order lookup and enter your order number together with the email used at checkout. We issue a fresh code immediately — no need to buy again.',
    'faq.q4': 'Where are the terms and refund policy?',
    'faq.a4': 'See the Terms of Use, Privacy Policy and Refund Policy. We refund if the software does not work as described.',
    'faq.q5': 'Do I get support after buying?',
    'faq.a5': 'Yes. Every product lists clear support details. Reach us using the email you provided at checkout.',
    'lookup.eyebrow': 'Support',
    'lookup.title': 'Order lookup',
    'lookup.lead': 'Enter your order code and the email you used at checkout. We will take you straight to the download page.',
    'lookup.orderLabel': 'Order code',
    'lookup.emailLabel': 'Email used at checkout',
    'lookup.submit': 'Look up my order',
    'lookup.back': 'Back to store',
    'lookup.errNotFound': 'We could not find that order. Check the order code and the email you used at checkout.',
    'lookup.errFields': 'Please enter both the order code and your email.',
    'lookup.errRate': 'Too many attempts. Please wait a few minutes and try again.',
    'lookup.working': 'Looking up…',
    'order.eyebrow': 'Order',
    'order.loading': 'Loading…',
    'order.code': 'Your order lookup code',
    'order.keepCode': 'Save this code. If you close the tab, lose your connection or your device powers off, you can still get the order back with this code and the email you paid with.',
    'order.openLookup': 'Open the lookup page',
    'order.copied': 'Lookup code copied.',
    'order.copyFailed': 'Could not copy — please copy the lookup code above by hand.',
    'order.paid': 'Paid',
    'order.download': 'Download product',
    'order.notFound': 'Order not found.',
    'paypal.eyebrow': 'PayPal',
    'paypal.pending': 'Confirming your payment…',
    'paypal.wait': 'Please do not close this page.',
    'paypal.success': 'Payment successful!',
    'paypal.successHint': 'Thank you. Your order code has been sent to your email.',
    'paypal.cancelled': 'Payment was cancelled',
    'paypal.cancelledHint': 'You have not been charged. You can pay again at any time.',
    'paypal.back': 'Back to store',
    'paypal.myOrders': 'View my orders',
    'paypal.err': 'We could not confirm the payment. Please try again or contact support.',
    'paypal.errHint': 'PayPal has not reported success. If you were charged, try again in a few minutes or contact {support} with order {id}.',
    'paypal.noSession': 'This order is not in this browser session. If you opened the page on a different device, look it up again with your order id and email.',
    'cart.email': 'Email to receive the product',
    'cart.namePlaceholder': 'Jane Doe',
    'cart.emailPlaceholder': 'you@example.com',
    'cart.name': 'Full name',
    'cart.paying': 'Processing…',
    'cart.note': 'You are only charged when the payment succeeds.',
    'cart.agree': 'I have read the Terms of Use, the Privacy Policy and the Refund Policy, and understand that software is not refundable once it has been downloaded.',
    'product.requirements': 'System requirements',
    'product.version': 'Version',
    'product.buyNow': 'Buy now',
    'pay.accountLabel': 'Account / wallet number',
    'pay.amountLabel': 'Amount',
    'pay.transferNote': 'Transfer content (write it exactly so we can match it)',
    'pay.option.bank': 'Bank transfer / QR scan',
    'pay.option.bank.vi': 'Scan the VietQR code in your banking app',
    'pay.option.bank.vi.wallets': 'MoMo, ZaloPay and VietQR all supported',
    'pay.option.bank.intl': 'Needs a Vietnamese bank account. Better suited if you are inside Vietnam.',
    'pay.option.paypal': 'PayPal',
    'pay.option.paypal.vi': 'International payment with a PayPal wallet, cards and international accounts included',
    'pay.option.paypal.intl': 'Pay with an international card or a PayPal account. Best choice if you are outside Vietnam.',
    'pay.channel.bank': 'Scan it in your banking app — the amount and the transfer note are already filled in',
    'pay.channel.momo': 'Scan the MoMo code; type the amount yourself if it does not appear',
    'pay.channel.momo.shared': 'This MoMo code is shared, so you will need to type the amount yourself',
    'pay.channel.zalopay': 'Pay to the ZaloPay number',
    'geo.outside': 'You appear to be in {country}. PayPal is listed first because it suits international customers — you can still choose bank transfer if you prefer.',
    'geo.domestic': 'You are in Vietnam. A domestic bank transfer is the fastest option; you can still pick PayPal if you prefer.',
    'product.priceOnce': 'One-time price',
    'product.seeGuide': 'See the guide included',
    // Shown in the English UI for a product whose system-requirements text was
    // never translated: says what to do instead of leaving Vietnamese copy under
    // an English heading. The honest note beats a silent half-translation.
    'product.requirementsViOnly': 'Full system requirements are listed in the included guide (the guide is written in Vietnamese).',
    'cart.back': 'Go back',
    'cart.secureTitle': 'Secure checkout',
    'cart.buyTitle': 'Buy',
    'cart.methodLabel': 'Payment method',
    'cart.continue': 'Continue to payment',
    'cart.errCreate': 'Could not create the order',
    'cart.lostCode': 'Bought it but lost your code?',
    'order.created': 'Order created',
    'order.thanksShort': 'Thank you!',
    'cart.expiry': 'Unpaid orders are cancelled automatically after {hours} hours. We email you the order confirmation and a reminder before it expires.',
    'cart.safety': 'Losing your connection or your device powering off is not a problem: the order is kept, and the lookup code is emailed to this address.',
    'cart.errNetwork': 'Could not reach the server. The order may already exist — check your email or try again, and the next attempt returns that same order instead of creating a new one.',
    'order.expiresIn': '{time} left to pay',
    'order.deadlineOver': 'Payment window has closed',
    'order.completed': 'Completed',
    'order.justPaid': 'Payment confirmed — your download is unlocked.',
    'order.errOffline': 'Connection lost. This page will check again as soon as you are back online.',
    'order.recorded': 'Your order has been recorded. Keep the lookup code to check its status and download the product.',
    'order.copy': 'Copy code',
    'order.check': 'Check order status',
    'order.errStatus': 'Could not check the order status',
    'order.errDownload': 'The product is not available for download right now',
    // The English half of the order status table lives in format.js too, beside
    // the Vietnamese half, so the two cannot drift and the admin panel can read
    // the same six names.
    'order.title': 'Order {id}',
    'order.row.product': 'Product',
    'order.row.amount': 'Amount',
    'order.row.status': 'Status',
    'order.row.created': 'Created',
    'order.channel.account': 'Account number',
    'order.channel.amount': 'Amount',
    'order.channel.note': 'Transfer note',
    'order.channel.qr': '{label} QR code',
    'order.unlock': 'Pay to unlock the download',
    'order.refresh': 'Check status',
    'order.help.need': 'Need help?',
    'order.help.or': 'or see',
    'order.help.refundPolicy': 'refund policy',
    'notfound.eyebrow': '404',
    'notfound.title': 'We cannot find that page',
    'notfound.text': 'The address may be mistyped, or the product you were after is no longer sold. Below is everything that is.',
    'notfound.loading': 'Loading products…',
    'order.noSession.title': 'No order session found',
    'order.noSession.hint': 'For your security the lookup code is kept in this browser only. If you opened this page on a different device, look the order up again with its id and the email you paid with.',
    'order.noSession.cta': 'Look up the order',
    'order.recover.hint': 'Lost connection, closed the laptop or switched device? Order {id} is still here. Open it again with this order id and the email you paid with.',
    'order.recover.cta': 'Look up the order',
    'order.errDownloadOffline': 'Connection dropped during the download. You can try again, the order is still valid.',
    'order.hint.refunded': 'We have refunded this order. Reason: {reason}. The download right has been withdrawn. If you think this is a mistake, contact {support} with your order id.',
    'order.hint.paid': 'Payment confirmed. You can download the product now. If the download is interrupted, press download again — the order is still valid.',
    'order.hint.delivered': 'You have downloaded the product and the order is complete. If the file arrived damaged or incomplete, email us with the order id and we will reopen it.',
    'order.hint.expiredPaid': 'This order expired but the money did reach our account, so the order has been reopened. If you still do not see a download button, contact us with the order id.',
    'order.hint.expiredPaypal': 'This order passed its payment window and was cancelled, and PayPal recorded no payment, so you have not been charged. You can place a new order.',
    'order.hint.expiredBank': 'This order passed its payment window and was cancelled. We have not received this transfer — if you already sent it, send the receipt with your order id and we will reopen the order or refund you. If you did not, you can place a new one.',
    'order.hint.paymentFailed': 'The payment did not go through, so you have not been charged. You can try again, the order is unchanged.',
    'review.heading': 'How did it go?',
    'review.hint': 'One sentence about what you got done with it is plenty. We are not asking for a score, only for what a real person thought.',
    'review.placeholder': 'For example: the installer ran first time, nothing to configure.',
    'review.namePlaceholder': 'Name to show (leave blank to stay anonymous)',
    'review.send': 'Send it',
    'review.sending': 'Sending…',
    'review.sent': 'Thank you, that is saved.',
    'review.already': 'You have already reviewed this product. Thank you!',
    'review.failed': 'Could not send it. Try again in a minute.',
    'review.err.notFound': 'We could not find that order.',
    'review.err.notFulfilled': 'Only an order whose file was actually delivered can be reviewed.',
    'review.err.refunded': 'This order was refunded, so it cannot be reviewed.',
    'review.err.wrongProduct': 'That product is not part of this order.',
    'review.err.tooShort': 'Write a little more so others can believe it — at least {min} characters.',
    'review.err.tooLong': 'At most {max} characters.',
    'review.err.storeFailed': 'The review could not be saved. Skip it — the rest of your order is unaffected.',
    'order.hint.deadlinePassed': 'This order has passed its payment window and is about to be cancelled. If you already transferred the money, contact us so we can reconcile it and reopen the order.',
    'order.hint.pendingTransfer': 'You are paying by bank transfer, so that step happens in your banking app rather than on this page. If the app froze or the device switched off midway, reopen it to check whether the transfer went through. This order is unchanged, there is still time, and we will confirm the moment you press the button below.',
    'order.hint.paypalUnconfirmed': 'If you pressed pay at PayPal but this page cannot confirm it, do not pay again. Reload the page or press the button below: the system will ask PayPal again and unlock the download if the money arrived. If PayPal has recorded nothing, you have not been charged and can pay again as normal.',
    'order.hint.refundUnknown': 'not recorded',
    'order.hint.processing': 'Your order is being processed. You can download as soon as the status turns to paid — this page updates on its own.',

    // ---- legal pages ----
    // Written as shop copy rather than as a gloss of the Vietnamese above: a
    // buyer reads the licence grant and the refund conditions before paying, so
    // "a personal, non-transferable licence" and "we refund in full" have to
    // mean what the Vietnamese means, in the order an English reader expects.
    // A fragment key continues the sentence it sits in, which is why several of
    // them begin or end mid-clause.
    'legal.eyebrow': 'Legal',
    'legal.updated': 'Updated: {{policyUpdatedDisplayEn}} · Applies to every transaction at',

    // ---- about ----
    'about.h1': 'Who stands behind',
    'about.lede': 'One person writes software for real work, then sells exactly what they use themselves. No company, no investors, no ads team.',
    'about.h2': 'What we build',
    'about.p1': 'Utilities and tools for Windows, written to solve one specific job in office or technical work. Every product answers exactly one question: "how do I solve this?". A product that answers no question at all does not go on sale.',
    'about.p2': 'One-off price, no subscription. You download the file as soon as payment goes through, and nobody has to approve it first. Every order gets a lookup code by email, so you can create a fresh download link whenever you like, as many times as you like.',
    'about.h3': 'What we promise',
    'about.p3': 'We do not delete anything on your computer without telling you first. Anything that installs itself ships with an undo script. Anything that runs in the background tells you plainly that it starts with Windows, and how to switch it off.',
    'about.p4': 'If a file is broken we resend it or refund it, no reason needed. A product that does not do its job is not something you should be paying to use.',
    'about.h4': 'Ask us',
    'about.ask': 'Every question is answered, including "will this work on my machine":',
    'about.ask2': '. There is no chatbot here, so the answer comes from the person who wrote the software.',
    'about.p5': 'You can also look up your order at',
    'about.p6': 'with the order code and the email you paid with.',

    // ---- terms ----
    'legal.terms.h1': 'Terms of Use',
    'legal.terms.h2': '1. Who may use it',
    'legal.terms.p1a': 'The licence you buy is',
    'legal.terms.p1b': 'a personal, non-transferable licence',
    'legal.terms.p1c': ', for one computer belonging to one user. You may not resell, share, rent, sublet or redistribute the copyright, the source code or the release file in any form, even if you have edited the source code.',
    'legal.terms.p2': 'You may use it for internal business purposes, but the software runs only on computers owned by that organisation and may not be redeployed as a service. Licences for a whole team, or for several machines, need a separate package, so please contact us before you buy.',
    'legal.terms.h3': '2. Payment methods',
    'legal.terms.p3': 'We take payment through PayPal (VND converted to USD at the rate that applies when the order is created) and by bank transfer, MoMo or ZaloPay. The listed price is the amount you pay; any fee charged by a third party is not part of it.',
    'legal.terms.p4': 'With PayPal, the exchange rate is recorded on the order the moment it is created and does not change afterwards. With a bank transfer, please leave the amount and the transfer note exactly as we filled them in, so that we can match the payment.',
    'legal.terms.h4': '3. Payment window and cancellation',
    'legal.terms.p5a': 'Bank transfer orders are confirmed during business hours, usually within 24 hours. Until then the order status is',
    'legal.terms.p5b': 'awaiting bank transfer',
    'legal.terms.p5c': 'and the file cannot be downloaded yet.',
    'legal.terms.h5': '4. Delivery and download',
    'legal.terms.p6': 'We send a reminder email before the window closes. If the money reaches our account after an order has already been cancelled — because PayPal reported success late, say — the order is reopened and you can still download the product. If you paid by bank transfer after the window had closed, send us the receipt and we will match it or hand the money back.',
    'legal.terms.p7a': 'Once your bank transfer order is confirmed',
    'legal.terms.p7b': 'or',
    'legal.terms.p7c': 'PayPal reports success, you receive your order lookup code. That code is the only way into the release file, so keep it somewhere safe. We also email it to you together with the payment window.',
    'legal.terms.p8': 'Every download creates a short-lived link, and you can create a new one at any time with your lookup code. A download link works once and may be withdrawn for security reasons.',
    'legal.terms.p9': 'An order counts as finished as soon as you start the download, and the download button locks again. That way each order releases the file exactly once. If the download fails because of the network, or the file arrives damaged, get in touch and we will reopen the order for you.',
    'legal.terms.p10a': 'The downloaded file keeps the name of the release (for example',
    'legal.terms.p10b': '). Some antivirus programs or browsers may warn about an unsigned executable; that is normal behaviour for software downloaded straight from the internet, and not a sign of malware.',
    'legal.terms.h6': '5. A permanent licence, no recurring fee',
    'legal.terms.p11': 'The price you pay is for the version you bought, for good. There is no subscription fee, no maintenance fee and no charge to renew the licence. Future updates in the same product line are released free whenever there are any.',
    'legal.terms.h7': '6. Warranty and support',
    'legal.terms.p12': 'We warrant that the software runs as described on the system requirements we state. If it does not, you get your money back or an equivalent fixed release; you choose which one. Technical support is answered by email within 2 business days.',
    'legal.terms.p13': 'We do not warrant that the software works on every system configuration, on every version of Windows, or with antivirus software that blocks executables. You are responsible for backing up your data before installing any tool.',
    'legal.terms.h8': '7. Refunds',
    'legal.terms.p14a': 'Your right to a refund, and the conditions that apply, are set out in the',
    'legal.terms.p14b': '. In short: you get a refund if the software does not work as described, and you do not if you have already put it to normal use after downloading it.',
    'legal.terms.h9': '8. Limitation of liability',
    'legal.terms.p15a': 'To the fullest extent the law allows, our liability for any claim is limited to',
    'legal.terms.p15b': 'the total amount you paid for that order',
    'legal.terms.p15c': '. We are not liable for indirect damage, for lost data, or for lost profit arising indirectly from the use or non-use of the software.',
    'legal.terms.h10': '9. Suspension of the licence',
    'legal.terms.p16': 'The licence is void if you break these terms, and sharing, redistributing or reselling the software counts as breaking them. In that case we may refuse to issue download links for the orders under that licence. We may also stop providing the service if you use it to harm other people or to break the law.',
    'legal.terms.h11': '10. Changes to these terms',
    'legal.terms.p17': 'We may update these terms. An update takes effect from the moment it is published on this page and does not apply retroactively to orders already placed: each order is governed by the terms in force at the moment you bought.',
    'legal.terms.h12': '11. Governing law and disputes',
    'legal.terms.intro': 'You are reading the terms that apply when you buy and use software developed by <strong>{{brandName}}</strong>. Placing an order means you accept the terms below. If you do not agree, please do not proceed with the transaction.',
    'legal.terms.p5d': 'Unpaid orders are automatically cancelled after <strong>{{paymentWindowHours}} hours</strong> from the moment you place the order, applying to all payment methods. This deadline is shown on the checkout form and on your order page.',
    'legal.terms.p18': 'These terms are governed by and construed in accordance with the laws of Vietnam. Disputes will be resolved through good-faith negotiation first; if no agreement is reached, either party may refer the matter to the competent court where {{brandName}} is based.',

    // ---- privacy ----
    'legal.privacy.h1': 'Privacy Policy',
    'legal.privacy.p1': 'We respect your data. This page sets out exactly what is collected when you buy from us, what each piece of it is used for, and how it is protected.',
    'legal.privacy.h2': '1. What we collect',
    'legal.privacy.p2a': 'Information you give us at checkout:',
    'legal.privacy.p2b': 'your name, your email address and the name of the product you bought. We use that email to confirm the order, to send you a lookup code when you ask for one, and to support you after the sale.',
    'legal.privacy.p3a': 'Transaction data:',
    'legal.privacy.p3b': 'the order id, the amount, the payment method, the payment status and the time it happened. For PayPal we receive the transaction id and the status from PayPal; we never store your card number or your bank account details.',
    'legal.privacy.p4a': 'Transactional email:',
    'legal.privacy.p4b': 'we send notices about your order automatically to the address you gave us: the order confirmation with the payment window, a reminder before the window closes, a notice that an order has been cancelled, and a notice that payment went through. These messages are transactional rather than marketing, and they cannot be switched off while you still want to hear about your order.',
    'legal.privacy.p5a': 'Technical data:',
    'legal.privacy.p5b': 'your IP address and your browser type are written into the server log to the extent needed to run and protect the service.',
    'legal.privacy.h3': '2. What we do not collect',
    'legal.privacy.h4': '3. How it is used',
    'legal.privacy.p6': 'The data is used for these purposes only: delivering the software you bought, verifying and reconciling payments, technical support, and meeting the legal obligations of a service provider. We do not sell your data and we do not pass it to third parties for advertising.',
    'legal.privacy.h5': '4. The order lookup code',
    'legal.privacy.p7a': 'After payment the system generates a random lookup code and stores only the',
    'legal.privacy.p7b': 'hash',
    'legal.privacy.p7c': 'of it, never the original. A download link is issued only when you supply the correct code. That is the first layer of protection, next to the email check.',
    'legal.privacy.p8': 'Live download links are not kept in the database; each link is created when you ask for one and expires shortly afterwards.',
    'legal.privacy.h6': '5. Sharing with third parties',
    'legal.privacy.p9': 'We share only the minimum data needed with the partners below, each of them for its own part of the job. This list may change; the current version always lives on this page.',
    'legal.privacy.v1': '— hosts the release files and hands out the download links. Your files sit in a private bucket, not a public one.',
    'legal.privacy.v2': '— the database that stores orders and the product catalogue.',
    'legal.privacy.v3a': 'PayPal, banks, MoMo, ZaloPay',
    'legal.privacy.v3b': '— takes the payment on their own schedules.',
    'legal.privacy.v4': '— sends the transactional email about your order. It only receives the email address, the name and the content of the message; we never hand it a customer list.',
    'legal.privacy.v5': '— the platform the server runs on.',
    'legal.privacy.p10': 'We may also have to disclose information when a competent authority makes a lawful request.',
    'legal.privacy.h7': '6. How long we keep data',
    'legal.privacy.p11': 'Transaction data is kept for accounting and for handling complaints for as long as Vietnamese law requires, at least 12 months. Technical data in the server log is kept only briefly and is deleted automatically on a rolling cycle.',
    'legal.privacy.h8': '7. Technical security',
    'legal.privacy.p12': 'Every connection goes over HTTPS. The admin area requires a passcode, order ids are stored hashed, and every secret lives in an environment variable rather than in the source code. Access to the data is limited to the people who need it for their work.',
    'legal.privacy.h9': '8. Your rights',
    'legal.privacy.h10': '9. Software security',
    'legal.privacy.p13': 'The software you buy does not collect, send or upload anything to any server of ours. It runs entirely locally on your computer and needs no internet connection once it is installed. If you ever find that it does send data out, please tell us, because that would break the promise made here.',
    'legal.privacy.h11': '10. Changes to this policy',
    'legal.privacy.p14': 'We may update this policy. An update takes effect as soon as it is published here; completed transactions stay governed by the policy in force when they happened.',
    'legal.privacy.p5': 'We do not ask for and do not store credit card numbers, PINs, bank passwords, or screenshots. Payment is processed entirely on the systems of PayPal, banks, MoMo or ZaloPay, so that sensitive information never passes through {{brandName}}\'s servers.',
    'legal.privacy.p15': 'You have the right to view, edit or request deletion of your personal information. For transaction data, we may anonymise identifying information while retaining accounting obligations, or delete it entirely if the law permits. Send requests to <a href="mailto:{{support}}">{{support}}</a> and we will respond within 5 business days.',

    // ---- refund ----
    'legal.refund.h1': 'Refund Policy',
    'legal.refund.p1': 'We want you to buy with confidence. This policy sets out exactly when you get a refund, when you do not, and how each case is handled.',
    'legal.refund.p2': 'These terms form part of the',
    'legal.refund.termsLink': 'Terms of Use',
    'legal.refund.h2': '1. When you get a refund',
    'legal.refund.p3': 'We refund in full in the following cases, even if you have already started using the software:',
    'legal.refund.w1a': 'The software',
    'legal.refund.w1b': 'does not run',
    'legal.refund.w1c': 'on the system requirements listed for the product, and we cannot fix it within 7 days.',
    'legal.refund.w2a': 'The product you receive',
    'legal.refund.w2b': 'is not what is described',
    'legal.refund.w2c': 'on the product page, and cannot be accepted.',
    'legal.refund.w3a': 'You are charged',
    'legal.refund.w3b': 'twice',
    'legal.refund.w3c': 'for the same order, or the amount taken does not match the listed price.',
    'legal.refund.w4a': 'You have paid but',
    'legal.refund.w4b': 'never received your lookup code',
    'legal.refund.w4c': 'and we cannot issue one again within 7 days.',
    'legal.refund.w5': 'The payment was refunded automatically, or you were charged by mistake because of a fault on our side.',
    'legal.refund.h3': '2. How long you have to ask',
    'legal.refund.h4': '3. How a refund is processed',
    'legal.refund.p4a': 'Step 1 — Send the request.',
    'legal.refund.p4b': 'Email the address above with your order code and a description of the problem. A screenshot of the error helps a great deal if you have one.',
    'legal.refund.p5a': 'Step 2 — We look into it.',
    'legal.refund.p5b': 'We reply within 2 business days. If the fault is clear, we build the fixed release and send it to you first; you can take that instead of a refund.',
    'legal.refund.p6a': 'Step 3 — The refund.',
    'legal.refund.p6b': 'Once it is approved the money goes back the way you paid, which usually takes 1 to 10 business days depending on the bank or provider.',
    'legal.refund.h5': '4. When we do not refund',
    'legal.refund.p7': 'To be fair to other customers, we do not refund in these cases:',
    'legal.refund.n1a': 'You have',
    'legal.refund.n1b': 'downloaded and used',
    'legal.refund.n1c': 'the software in normal working fashion and are asking because you dislike the interface, the colours or have changed your mind.',
    'legal.refund.n2': 'You bought the wrong version or the wrong product, or bought in bulk and did not use it all.',
    'legal.refund.n3a': 'You',
    'legal.refund.n3b': 'broke the terms',
    'legal.refund.n3c': ', for example by sharing, reselling or redistributing the software.',
    'legal.refund.n4': 'The software does not run because a system requirement you were warned about is missing, or because your antivirus software removed the downloaded file.',
    'legal.refund.n5a': 'You bought by mistake, bought more than you needed, or changed your mind after downloading',
    'legal.refund.n5b': 'more than once',
    'legal.refund.n6': 'The request arrives after 14 days with no valid technical reason behind it.',
    'legal.refund.h6': '5. Partial refunds',
    'legal.refund.p8': 'In special cases, for example when you have downloaded the product but hit a temporary technical fault that made it unusable right away, we may offer a partial refund instead of the full amount. That decision is agreed between the two of us and is never binding on either side.',
    'legal.refund.p2b': 'You can request a refund within <strong>14 days</strong> of payment by emailing <a href="mailto:{{support}}">{{support}}</a>. After that, cases under section 1 and 2 will still be considered if the issue was discovered late due to circumstances beyond your control, but the refund will be by mutual agreement.',
    'legal.refund.h7': '6. Cancelling an unpaid order',
    'legal.refund.p9': 'Unpaid orders are automatically cancelled after {{paymentWindowHours}} hours from when they were placed. A cancelled order incurs no fee, so there is nothing to refund. If you have transferred money but the order has not been confirmed, send a screenshot of the receipt — we will reconcile and refund if there was an error.',
    'legal.refund.h8': '7. Contact',
    'legal.refund.p10': 'Send all refund requests to <a href="mailto:{{support}}">{{support}}</a>. Please include the order id so we can look it up quickly. We do not handle complaints via social media, because we cannot verify the identity of the sender on those channels.',
  },
};

// ---------------------------------------------------------------------------
// Repair maps for inconsistent catalogue data.
//
// Category and badge are free-text columns in the catalogue, not enums, so a row
// can arrive as "cong cu", "Cong cu" or "Công cụ" and all three mean the same
// shelf. The Vietnamese half repairs an unaccented row to its proper spelling; the
// English half maps a value already in Vietnamese to the English label used to
// derive a translation key. They sit below DICT on purpose — see the note at the
// top of the file about which `vi:` block the audit reads.
// ---------------------------------------------------------------------------
const REPAIR_MAPS = {
  category: {
    vi: { 'cong cu': 'Công cụ', 'tien ich': 'Tiện ích', 'phan mem': 'Phần mềm', 'khac': 'Khác' },
    en: { 'Công cụ': 'Tools', 'Tiện ích': 'Utilities', 'Phần mềm': 'Software', 'Khác': 'Other' }
  },
  badge: {
    vi: { 'moi': 'Mới', 'ban chay': 'Bán chạy', 'cap nhat': 'Cập nhật', 'phat hanh': 'Phát hành', 'pho bien': 'Phổ biến', 'chuyen nghiep': 'Chuyên nghiệp', 'tiet kiem': 'Tiết kiệm', 'doanh nghiep': 'Doanh nghiệp', 'uu dai som': 'Ưu đãi sớm' },
    en: { 'Mới': 'New', 'Bán chạy': 'Best seller', 'Cập nhật': 'Updated', 'Phát hành': 'Release', 'Phổ biến': 'Popular', 'Chuyên nghiệp': 'Professional', 'Tiết kiệm': 'Value', 'Doanh nghiệp': 'Enterprise', 'Ưu đãi sớm': 'Early Bird', 'Safe Edition v4.3': 'Safe Edition v4.3', 'Phát hành 1.4.0': 'Release 1.4.0' }
  }
};

// ---------------------------------------------------------------------------
// The order status table is not here. It lives in format.js, which every page
// loads before this file, and the admin panel — which does not load this file
// at all — reads the same table. It used to be a mapping here plus a Vietnamese
// object in admin.js, and three of the six statuses had drifted between them:
// the owner and the buyer were shown two different names for the same order.
//
// So there are no order.status.* keys left to resolve, and adding one back
// here is the mistake to watch for.

// The language a label table is asked for. Label tables exist as vi/en pairs;
// other locales (ja, zh-CN) read the English table rather than dropping back to
// Vietnamese, because an English fallback is readable to those readers and
// Vietnamese is not.
const langOf = (lang) => {
  if (String(lang) === 'vi') return 'vi';
  if (DICT && DICT[lang]) return lang;
  return 'en';
};

// Locales whose dictionary is fetched on demand from /locales/<code>.json.
// Vietnamese and English stay bundled because they are the source language and
// the fallback language; a third language is an asset, not a code change.
// Bundled languages are those included in the DICT object inside this file.
// Others are loaded from /public/locales/*.json.
const BUNDLED = ['vi', 'en'];
const EXTRA_LOCALES = ['de', 'es', 'fr', 'ja', 'zh-CN']; 
const SUPPORTED = (Array.isArray(window.SVD_LOCALES) && window.SVD_LOCALES.length)
  ? [...window.SVD_LOCALES]
  : [...BUNDLED, ...EXTRA_LOCALES];
const LANG_LABELS = { vi: 'Tiếng Việt', en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', ja: '日本語', 'zh-CN': '中文' };
const LOCALE_TAGS = { vi: 'vi-VN', en: 'en-US', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', ja: 'ja-JP', 'zh-CN': 'zh-CN' };
const FLAG_EMOJI = { vi: '🇻🇳', en: '🇺🇸', de: '🇩🇪', es: '🇪🇸', fr: '🇫🇷', ja: '🇯🇵', 'zh-CN': '🇨🇳' };
const STORAGE_KEY = 'sonvudev_lang';
const listeners = new Set();
const loadedLocales = new Set(BUNDLED);
const loadingLocales = new Map();

/**
 * Fetches a locale dictionary once and merges it into the tables.
 *
 * A missing or malformed asset is not an error the reader should see: the page
 * keeps rendering with the English fallback and the button still works. That is
 * the difference between a translation gap and a broken storefront.
 */
function loadLocale(lang) {
  if (loadedLocales.has(lang)) return Promise.resolve();
  if (loadingLocales.has(lang)) return loadingLocales.get(lang);
  if (typeof fetch !== 'function') return Promise.resolve();
  const request = fetch(`/locales/${encodeURIComponent(lang)}.json`, { headers: { accept: 'application/json' } })
    .then((response) => (response && response.ok ? response.json() : Promise.reject(new Error('locale missing'))))
    .then((dict) => {
      if (dict && typeof dict === 'object' && !Array.isArray(dict)) {
        DICT[lang] = Object.assign({}, DICT[lang] || {}, dict);
        loadedLocales.add(lang);
      }
    })
    .catch(() => { /* fallback chain stays in place */ })
    .finally(() => { loadingLocales.delete(lang); });
  loadingLocales.set(lang, request);
  return request;
}

function readStored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch (_) { /* private mode: fall through to the browser default */ }
  const browser = String(navigator.language || '').toLowerCase();
  if (browser.startsWith('ja')) return 'ja';
  if (browser.startsWith('zh')) return 'zh-CN';
  return browser.startsWith('en') ? 'en' : 'vi';
}

let current = readStored();

// The configuration values the server ships in <meta name="sv-tokens">.
//
// legal.terms.p5d and its seven siblings carry {{brandName}},
// {{paymentWindowHours}} or {{support}} *inside the dictionary*. The server
// fills those into the HTML it renders, and that is the only copy it can
// reach — when a reader switches language this function returns the dictionary
// copy, and the placeholder comes back with it. The sentence then reads
// "cancelled after {{paymentWindowHours}} hours" on a page that was correct a
// second earlier, in both languages.
//
// Reading them from a meta tag rather than re-deriving them here is the point:
// the payment window is configuration, and a second copy of it in the browser
// is a number that can drift from the one checkout enforces. The tag carries
// JSON so no separator of our own is invented, and the one escape helper in
// public/format.js stays the only one there is.
const TOKENS = (() => {
  const values = {};
  const meta = document.querySelector('meta[name="sv-tokens"]');
  if (!meta || !meta.content) return values;
  try {
    const parsed = JSON.parse(meta.content);
    for (const [name, value] of Object.entries(parsed || {})) {
      if (value !== undefined && value !== null) values[name] = String(value);
    }
  } catch (error) {
    // A malformed tag is logged, not thrown. One bad value must not take the
    // language switch down with it, and the placeholder then stays visible —
    // which is the honest outcome.
    console.error('[i18n] meta sv-tokens is not valid JSON:', error.message);
  }
  return values;
})();

const I18N = {
  get lang() { return current; },
  t(key, fallback, vars) {
    const fill = (text) => String(text)
      .replace(/\{\{(\w+)\}\}/g, (match, name) => {
        if (vars && vars[name] !== undefined) return vars[name];
        if (name === "brand") return host();
        if (TOKENS[name] !== undefined) return TOKENS[name];
        return match;
      })
      .replace(/\{(\w+)\}/g, (match, name) => {
        if (vars && vars[name] !== undefined) return vars[name];
        if (name === "brand") return host();
        return match;
      });
    // Current language first, then English, then Vietnamese. An untranslated key
    // in Japanese used to fall straight to Vietnamese; English is the better
    // fallback for a reader who chose neither source language.
    const chain = current === 'vi' ? ['vi'] : current === 'en' ? ['en', 'vi'] : [current, 'en', 'vi'];
    for (const code of chain) {
      const table = DICT[code];
      if (table && table[key] !== undefined) return fill(table[key]);
    }
    return fill(fallback !== undefined ? fallback : key);
  },
  // Product copy for languages the catalogue has no columns for.
  //
  // The `products` table stores Vietnamese plus one English pair, so a shopper
  // who switched to Japanese or Chinese used to get English (or Vietnamese)
  // product text under a fully translated heading - the "for sale" section read
  // as half-translated. The per-locale asset now carries that copy as
  // `product.copy.<slug>.<field>`; these helpers expose it without changing the
  // catalogue schema. Only the fields the asset actually has are returned, so
  // every caller keeps its own per-field fallback chain.
  productSlug(product) {
    const raw = product && (product.slug || product.id);
    return String(raw || '').trim();
  },
  productCopy(product) {
    // Vietnamese is the catalogue's source language: its rows are already the
    // copy we want, so an overlay could only make them stale.
    if (current === 'vi') return null;
    const table = DICT[current];
    const slug = this.productSlug(product);
    if (!table || !slug) return null;
    const read = (field) => {
      const value = table[`product.copy.${slug}.${field}`];
      return value === undefined || value === null || value === '' ? undefined : value;
    };
    const copy = {
      name: read('name'),
      shortDescription: read('shortDescription'),
      description: read('description'),
      requirements: read('requirements'),
      features: read('features'),
    };
    return Object.values(copy).some((value) => value !== undefined) ? copy : null;
  },
  // Category and badge are free-text catalogue columns, so they cannot be looked
  // up by a fixed key. The label key is derived from the value itself
  // ("Release 1.4.0" -> product.label.badge.release-1.4.0) after folding
  // diacritics and case, which also matches rows typed without accents.
  // Returns null when no translation exists, so the caller can fall back instead
  // of printing an untranslated label it cannot detect.
  productLabel(kind, value) {
    const raw = String(value || '').trim();
    if (!raw) return raw;
    
    const folded = this.labelSlug(raw);
    
    // 1. Vietnamese Repair (Enterprise Level 5: Data Sanitization)
    if (current === 'vi') {
      const repair = REPAIR_MAPS[kind]?.vi?.[folded];
      return repair || raw;
    }
    
    // 2. Translation Pass
    const table = DICT[current] || {};
    const key = `product.label.${kind}.${folded}`;
    const translated = table[key];
    if (translated !== undefined && translated !== '') return translated;
    
    // 3. English Fallback
    if (current !== 'en') {
      const enTable = DICT['en'] || {};
      const enTranslated = enTable[key];
      if (enTranslated !== undefined && enTranslated !== '') return enTranslated;
    }
    
    // 4. Mapping Fallback (for English/Other when translation is missing)
    const mapped = REPAIR_MAPS[kind]?.en?.[raw] || REPAIR_MAPS[kind]?.en?.[folded];
    if (mapped) return mapped;

    // Nothing matched. null rather than the raw value, so a caller can tell "there
    // is no translation" apart from "the translation happens to be the Vietnamese
    // word" and fall back to the catalogue value itself. Returning `raw` here made
    // every unknown label look translated, which is why the Japanese page could
    // print a Vietnamese category under a Japanese heading and nothing noticed.
    return null;
  },
  labelSlug(value) {
    return String(value || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
      .trim().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
  },
  set(lang) {
    if (!SUPPORTED.includes(lang)) return;
    if (lang === current) return;
    current = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) { /* ignore */ }
    apply();
    markActiveLanguage();
    listeners.forEach((fn) => { try { fn(lang); } catch (e) { console.error(e); } });
    // A locale asset arrives after the switch, so the UI is usable immediately
    // with the English fallback and upgrades in place when the dictionary lands.
    if (!loadedLocales.has(lang)) {
      loadLocale(lang).then(() => {
        if (current !== lang) return; // switched again while the request was in flight
        apply();
        markActiveLanguage();
        listeners.forEach((fn) => { try { fn(lang); } catch (e) { console.error(e); } });
        // Languages without a shipped asset (de, es, fr, ...) rely on the
        // server-side translator to fill the gaps; trigger it on every switch so
        // the page actually becomes that language instead of staying English.
        ensureTranslations();
      });
    } else {
      ensureTranslations();
    }
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  ensureTranslations() { return ensureTranslations(); },
  register(locale, dict) {
    if (!locale) return this;
    DICT[locale] = Object.assign({}, DICT[locale] || {}, dict || {});
    loadedLocales.add(locale);
    if (!SUPPORTED.includes(locale)) SUPPORTED.push(locale);
    return this;
  },
  get supported() { return [...SUPPORTED]; },
  get locale() { return LOCALE_TAGS[current] || LOCALE_TAGS.en; },
  esc(value) {
    return window.SVDFormat.esc(value);
  },
  money(value, currency = 'VND') {
    return window.SVDFormat.money(value, currency);
  },
  date(value) {
    const at = value ? new Date(value) : new Date(NaN);
    return Number.isFinite(at.getTime()) ? at.toLocaleString(I18N.locale) : '';
  },
  status(status) {
    // The one table, read through the page's language. Falling back to the raw
    // value keeps this readable on a page that somehow loaded without
    // format.js, rather than rendering an empty cell where a status should be.
    const F = window.SVDFormat;
    return F ? F.statusLabel(status, langOf(current)) : String(status || '');
  },
  apiError(payload, fallbackKey) {
    const code = payload && payload.code;
    if (code) return I18N.t(code, payload.error || I18N.t(fallbackKey, ''));
    return payload && payload.error ? payload.error : I18N.t(fallbackKey, '');
  },
  clock(deadline, serverTime) {
    const at = deadline ? new Date(deadline).getTime() : null;
    const skew = serverTime ? new Date(serverTime).getTime() - Date.now() : 0;
    return {
      at,
      remaining: at === null ? null : at - (Date.now() + skew),
      text() {
        const left = this.remaining;
        if (left === null) return '';
        if (left <= 0) return I18N.t('order.deadlineOver');
        const total = Math.floor(left / 1000);
        const pad = (n) => String(n).padStart(2, '0');
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const time = hours > 0 ? `${hours}:${pad(minutes)}:${pad(total % 60)}` : `${pad(minutes)}:${pad(total % 60)}`;
        return I18N.t('order.expiresIn', undefined, { time });
      },
    };
  },
  orderHint(order, options) {
    const deadlineAt = options && options.expiresAt ? new Date(options.expiresAt).getTime() : null;
    const serverSkew = options && options.serverTime ? new Date(options.serverTime).getTime() - Date.now() : 0;
    const left = deadlineAt === null ? null : deadlineAt - (Date.now() + serverSkew);
    const paid = order.status === 'paid' || Number(order.paidCount || 0) > 0 || Boolean(order.paidAt);
    const delivered = Boolean(order.deliveredAt) && order.status !== 'paid';
    const provider = order.paymentProvider || 'bank_transfer';

    if (order.status === 'refunded') return I18N.t('order.hint.refunded', { reason: order.refundReason || I18N.t('order.hint.refundUnknown'), support: options.support || '' });
    if (order.status === 'cancelled') {
      // Already swept. Which of three sentences depends entirely on whether money
      // actually moved, and only PayPal can prove it did not: for a bank transfer
      // we simply do not know, so telling a buyer who did pay that they were not
      // charged is the single worst thing this function can say.
      if (order.paidProviderAmount || order.paidCount) return I18N.t('order.hint.expiredPaid');
      if (provider === 'paypal') return I18N.t('order.hint.expiredPaypal');
      return I18N.t('order.hint.expiredBank');
    }
    if (order.status === 'payment_failed') return I18N.t('order.hint.paymentFailed');
    if (paid) return I18N.t('order.hint.paid');
    if (delivered) return I18N.t('order.hint.delivered');

    // The clock has run out but the sweep has not fired yet. That is a different
    // situation from the three above and needs a different sentence: there is
    // still something to save if the buyer moved the money after all.
    if (left !== null && left <= 0) return I18N.t('order.hint.deadlinePassed');

    if (order.status === 'pending_transfer') return I18N.t('order.hint.pendingTransfer');
    if (provider === 'paypal' && order.providerOrderId) return I18N.t('order.hint.paypalUnconfirmed');
    return I18N.t('order.hint.processing');
  },
};

// Walks the document swapping text, placeholders and attributes.
function apply(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = I18N.t(el.dataset.i18n, el.textContent);
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = I18N.t(el.dataset.i18nHtml, el.innerHTML);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    // Format: "placeholder:lookup.order,aria-label:nav.buy"
    el.dataset.i18nAttr.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, I18N.t(key, el.getAttribute(attr)));
    });
  });
  // Legacy data-vi/data-en fallback: Only apply for VI or EN.
  // For other languages, we let the dynamic translation below handle it.
  if (current === 'vi' || current === 'en') {
    root.querySelectorAll('[data-vi],[data-en]').forEach((el) => {
      const vi = el.dataset.vi;
      const en = el.dataset.en;
      if (!vi && !en) return;
      if (current === 'vi') {
        if (vi && el.textContent !== vi) el.textContent = vi;
      } else {
        if (en && el.textContent !== en) el.textContent = en;
      }
    });
  }
  // Enterprise Level 5: Dynamic Filter Translation (must come AFTER legacy fallback)
  root.querySelectorAll('.filter').forEach((btn) => {
    const filter = btn.dataset.filter;
    if (!filter) return;
    if (filter === 'all') {
      btn.textContent = I18N.t('products.all', btn.textContent);
    } else {
      const translated = I18N.productLabel('category', filter) 
                       || I18N.productLabel('platform', filter) 
                       || filter;
      btn.textContent = translated;
    }
  });
  document.documentElement.lang = current;
}

// Marks which of the two buttons is the language being read.
//
// A segmented control showing "VI | EN" has to say which half is active, or it is two
// labels and no control. aria-pressed is the accessible half of that — a screen
// reader announces the pressed state, and the CSS reads the same attribute to paint
// the filled pill — so one attribute answers both and the two cannot disagree.
//
// It is read from `current` rather than set once at boot, because the switch has to
// survive a language change made anywhere: the storefront's own toggle, a
// programmatically-set language, or the browser's stored choice being restored.
function markActiveLanguage() {
  document.querySelectorAll('[data-lang-switch]').forEach((combobox) => {
    const flag = combobox.querySelector('[data-lang-flag]');
    if (flag) flag.textContent = FLAG_EMOJI[current] || codeToEmoji(current);
    const label = combobox.closest('.lang-combobox-wrap')?.querySelector('[data-lang-label]');
    if (label) label.textContent = LANG_LABELS[current] || current.toUpperCase();
  });
}

// Adds a button for every supported locale the markup does not already have, so
// enabling a language is a dictionary asset plus one entry in SVD_LOCALES - not
// an HTML edit. The bundled VI/EN buttons keep their order and their labels.
// Translate keys still missing for the current language through the server's
// /api/translate endpoint (DeepL Free + local file cache). Results are written
// into DICT[current] so the next apply() shows them. Each missing key is fetched
// at most once per page load. If the API is not configured or unreachable, the
// English fallback stays visible — the storefront is never broken by a missing key.
let translating = false;
async function ensureTranslations() {
  if (translating) return;
  translating = true;
  try {
    const collect = (attr) => {
      const out = [];
      document.querySelectorAll(`[${attr}]`).forEach((el) => {
        const key = el.getAttribute(attr);
        const table = DICT[current];
        if (key && (!table || table[key] === undefined)) out.push(key);
      });
      return out;
    };
    const collectAttr = () => {
      const out = [];
      document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
        const value = el.getAttribute('data-i18n-attr') || '';
        value.split(',').forEach((pair) => {
          const parts = pair.split(':').map((s) => s.trim());
          const key = parts[1];
          const table = DICT[current];
          if (key && (!table || table[key] === undefined)) out.push(key);
        });
      });
      return out;
    };
    const keys = [...new Set([...collect('data-i18n'), ...collect('data-i18n-html'), ...collectAttr()])];
    for (const key of keys) {
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: DICT.vi?.[key] || key, target: current, source: 'vi' }),
        });
        if (res.ok) {
          const { translated } = await res.json();
          if (translated !== undefined && translated !== null && translated !== '') {
            if (!DICT[current]) DICT[current] = {};
            DICT[current][key] = translated;
          }
        }
      } catch (e) {
        // API not configured or network error: leave English fallback visible.
      }
    }
    if (keys.length) {
      apply();
      markActiveLanguage();
      listeners.forEach((fn) => { try { fn(current); } catch (e) { console.error(e); } });
    }
  } finally {
    translating = false;
  }
}

function renderLanguageCombobox() {
  document.querySelectorAll('[data-lang-switch]').forEach((combobox) => {
    const dropdown = combobox.querySelector('.lang-dropdown');
    if (!dropdown) return;
    dropdown.innerHTML = '';
    for (const code of SUPPORTED) {
      const li = document.createElement('li');
      li.role = 'option';
      li.dataset.langSet = code;
      li.setAttribute('aria-selected', code === current ? 'true' : 'false');
      const flagSpan = document.createElement('span');
      flagSpan.className = 'lang-flag';
      flagSpan.textContent = FLAG_EMOJI[code] || codeToEmoji(code);
      const textSpan = document.createElement('span');
      textSpan.textContent = LANG_LABELS[code] || code.toUpperCase();
      li.appendChild(flagSpan);
      li.appendChild(textSpan);
      li.addEventListener('click', () => {
        I18N.set(code);
        closeCombobox(combobox);
      });
      dropdown.appendChild(li);
    }
    const trigger = combobox.querySelector('.lang-trigger');
    const flag = combobox.querySelector('[data-lang-flag]');
    if (flag) flag.textContent = FLAG_EMOJI[current] || codeToEmoji(current);
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    combobox.setAttribute('aria-expanded', 'false');
    if (dropdown) dropdown.setAttribute('aria-hidden', 'true');
  });
}

function codeToEmoji(code) {
  // Fallback: regional indicator symbols for unknown codes.
  const offset = 0x1F1E6 - 65;
  return code.toUpperCase().split('').map(c => String.fromCodePoint(c.charCodeAt(0) + offset)).join('');
}

function openCombobox(combobox) {
  const dropdown = combobox.querySelector('.lang-dropdown');
  const trigger = combobox.querySelector('.lang-trigger');
  if (dropdown) { dropdown.setAttribute('aria-hidden', 'false'); }
  if (trigger) { trigger.setAttribute('aria-expanded', 'true'); }
  combobox.setAttribute('aria-expanded', 'true');
}

function closeCombobox(combobox) {
  const dropdown = combobox.querySelector('.lang-dropdown');
  const trigger = combobox.querySelector('.lang-trigger');
  const label = combobox.closest('.lang-combobox-wrap')?.querySelector('[data-lang-label]');
  if (dropdown) { dropdown.setAttribute('aria-hidden', 'true'); }
  if (trigger) { trigger.setAttribute('aria-expanded', 'false'); }
  combobox.setAttribute('aria-expanded', 'false');
  if (label) label.textContent = LANG_LABELS[current] || current.toUpperCase();
  const flag = combobox.querySelector('[data-lang-flag]');
  if (flag) flag.textContent = FLAG_EMOJI[current] || codeToEmoji(current);
}

function boot() {
  apply();
  renderLanguageCombobox();
  // Language switch combobox - client-side toggle only (no navigation)
  document.querySelectorAll('[data-lang-switch]').forEach((combobox) => {
    const trigger = combobox.querySelector('.lang-trigger');
    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = combobox.getAttribute('aria-expanded') === 'true';
        if (expanded) {
          closeCombobox(combobox);
        } else {
          // Close other comboboxes first
          document.querySelectorAll('[data-lang-switch]').forEach((cb) => closeCombobox(cb));
          openCombobox(combobox);
        }
      });
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-lang-switch]')) {
      document.querySelectorAll('[data-lang-switch]').forEach((combobox) => closeCombobox(combobox));
    }
  });
  markActiveLanguage();
  // Translate any keys still missing for the current language (JA, zh-CN, ...).
  // The page shows the English fallback first, then upgrades in place.
  // Only run once the locale asset has landed for a non-bundled language, so the
  // in-memory dictionary is not overwritten by the late-arriving partial file.
  if (loadedLocales.has(current)) {
    ensureTranslations();
  }
  // A stored third language boots before its asset exists; swap it in as soon as
  // it arrives, and tell app.js to repaint the catalogue and any open modal.
  if (!loadedLocales.has(current)) {
    loadLocale(current).then(() => {
      apply();
      markActiveLanguage();
      ensureTranslations();
      window.dispatchEvent(new CustomEvent('i18n:ready', { detail: { lang: current } }));
    });
  }
  // On window, not document: app.js listens on window to repaint an open modal
  // when the language flips, and a CustomEvent dispatched on document without
  // `bubbles` stops at document. It was dispatched on document, so the listener
  // there could never fire — a repaint path that had never run and read as one
  // that worked.
  window.dispatchEvent(new CustomEvent('i18n:ready', { detail: { lang: current } }));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

window.I18N = I18N;


