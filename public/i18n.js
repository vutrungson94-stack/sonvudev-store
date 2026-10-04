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
    'lang.switch': 'EN',
    'lang.switchAria': 'Chuyển sang tiếng Anh',
    // Địa chỉ hỗ trợ do máy chủ đưa vào data-support, không ghi tay ở đây.
    'brand.supportEmail': supportAddress(),
    'brand.tagline': 'Phần mềm tốt cho công việc tốt.',
    'brand.rights': `© ${YEAR} ${host()} · Đồng sở hữu`,
    'announce.text': '{brand} đang mở cửa cho các bản phát hành mới',
    'announce.cta': 'Khám phá ngay',
    'nav.products': 'Sản phẩm',
    'nav.home': 'Về trang chủ',

    // Every refusal the API makes. The server sends the key and the Vietnamese
    // sentence together (src/refuse.js); the browser uses the key, so a visitor who
    // switched the shop to English is told what went wrong in English.
    // 45 keys, one per refusal — before this they were Vietnamese sentences chosen by
    // whichever route happened to fail, and the browser preferred them over its own
    // dictionary, so a failed checkout explained itself in the wrong language.
    'api.err.unauthorized': 'Không có quyền.',
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
    'api.err.invalidStatus': 'Trạng thái không hợp lệ',
    'api.err.transferUnconfigured': 'Phương thức chuyển khoản chưa được cấu hình',
    'api.err.noReleaseFile': 'Sản phẩm chưa có file phát hành',
    'api.err.productCreate': 'Không thể tạo sản phẩm',
    'api.err.productUpdate': 'Không thể cập nhật sản phẩm',
    'api.err.slugRequired': 'Tên sản phẩm không tạo được đường dẫn. Hãy nhập slug.',
    'api.err.slugTaken': 'Đường dẫn này đã có sản phẩm khác dùng rồi.',
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
    'nav.why': 'Vì sao chọn {brand}',
    'nav.faq': 'FAQ',
    'nav.buy': 'Mua ngay',
    'nav.store': 'Cửa hàng',
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
    'hero.text': 'Những chương trình {brand} tự viết cho người dùng Việt — dễ cài đặt, minh bạch và luôn được cập nhật.',
    'hero.cta1': 'Xem sản phẩm',
    'hero.cta2': 'Tại sao {brand}?',
    'hero.trust1': 'Bảo mật',
    'hero.trust2': 'Hỗ trợ tận tâm',
    'hero.trust3': 'Cập nhật dài hạn',
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
    'cart.agree': 'Tôi đồng ý với điều khoản sử dụng và chính sách bảo mật.',
    'product.requirements': 'Yêu cầu hệ thống',
    'product.version': 'Phiên bản',
    'product.buyNow': 'Mua ngay',
    // Trang đơn hàng. Trước đây copy ở đây nằm thẳng trong order.js nên khách
    // nước ngoài đọc tiếng Việt sau khi đã trả tiền, và cùng một trạng thái lại
    // hiện hai chữ khác nhau ở popup thanh toán với ở trang đơn.
    'order.status.pending': 'Đang chờ thanh toán',
    'order.status.pendingTransfer': 'Đang chờ chuyển khoản',
    'order.status.paid': 'Đã thanh toán',
    'order.status.failed': 'Thanh toán thất bại',
    'order.status.cancelled': 'Đã hủy',
    'order.status.refunded': 'Đã hoàn tiền',
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
  },
  en: {
    'lang.switch': 'VI',
    'lang.switchAria': 'Switch to Vietnamese',
    // The configured default. The server substitutes the live SUPPORT_EMAIL.
    'brand.supportEmail': supportAddress(),
    'brand.tagline': 'Good software for good work.',
    'brand.rights': `© ${YEAR} ${host()} · All rights reserved`,
    'announce.text': '{brand} is opening up to new releases',
    'announce.cta': 'Explore now',
    'nav.products': 'Products',
    'nav.home': 'Back to home',

    'api.err.unauthorized': 'Not authorised.',
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
    'api.err.invalidStatus': 'That status is not valid',
    'api.err.transferUnconfigured': 'Bank transfer is not configured',
    'api.err.noReleaseFile': 'This product has no release file yet',
    'api.err.productCreate': 'Could not create the product',
    'api.err.productUpdate': 'Could not update the product',
    'api.err.slugRequired': 'That product name does not make a valid path. Enter a slug.',
    'api.err.slugTaken': 'That path already belongs to another product.',
    'api.err.reviewSave': 'Could not save the review',
    'api.err.revenue': 'Could not total the revenue',
    'api.err.orderCheck': 'Could not verify the order',
    'api.err.notFound': 'Not found',
    'api.err.internal': 'Something went wrong on our side',
    'api.err.webhookRejected': 'Webhook rejected',
    'api.err.webhookSignature': 'Webhook signature is not valid',
    'nav.why': 'Why {brand}',
    'nav.faq': 'FAQ',
    'nav.buy': 'Buy now',
    'nav.store': 'Store',
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
    'cart.name': 'Full name',
    'cart.paying': 'Processing…',
    'cart.note': 'You are only charged when the payment succeeds.',
    'cart.agree': 'I agree to the Terms of Use and the Privacy Policy.',
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
    'order.status.pending': 'Awaiting payment',
    'order.status.pendingTransfer': 'Awaiting bank transfer',
    'order.status.paid': 'Paid',
    'order.status.failed': 'Payment failed',
    'order.status.cancelled': 'Cancelled',
    'order.status.refunded': 'Refunded',
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
  },
};

// ---------------------------------------------------------------------------
// One mapping from the status column to its key. The checkout modal and the order
// page used to carry separate copies, and a bank transfer read as "Đang chờ thanh toán"
// in one and "Đang chờ chuyển khoản" in the other.
const STATUS_KEYS = {
  pending: 'order.status.pending',
  pending_transfer: 'order.status.pendingTransfer',
  paid: 'order.status.paid',
  payment_failed: 'order.status.failed',
  cancelled: 'order.status.cancelled',
  refunded: 'order.status.refunded',
};

const SUPPORTED = ['vi', 'en'];
const STORAGE_KEY = 'sonvudev_lang';
const listeners = new Set();

function readStored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch (_) { /* private mode: fall through to the browser default */ }
  return (navigator.language || 'vi').toLowerCase().startsWith('en') ? 'en' : 'vi';
}

let current = readStored();

const I18N = {
  get lang() { return current; },
  t(key, fallback, vars) {
    const table = DICT[current] || DICT.vi;
    // Placeholders are filled here rather than by every caller. A sentence that
    // mentions an order id or a countdown reads as broken the moment one of them
    // is left as a literal brace.
    //
    // {brand} always resolves to the shop name from configuration, so copy never
    // hardcodes it: a rebrand edits BRAND_NAME, not eleven dictionary entries in
    // two languages. Explicit vars win over the default, and braces nobody knows
    // are left alone rather than blanked.
    const fill = (text) => String(text).replace(/\{(\w+)\}/g, (match, name) => {
      if (vars && vars[name] !== undefined) return vars[name];
      if (name === "brand") return host();
      return match;
    });
    if (table[key] !== undefined) return fill(table[key]);
    // Never render an empty box for a missing key: fall back to Vietnamese,
    // then to whatever the caller passed, so the gap stays visible.
    if (DICT.vi[key] !== undefined) return fill(DICT.vi[key]);
    return fill(fallback !== undefined ? fallback : key);
  },
  set(lang) {
    if (!SUPPORTED.includes(lang) || lang === current) return;
    current = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) { /* ignore */ }
    apply();
    const button = document.querySelector('[data-lang-toggle]');
    if (button) {
      button.textContent = I18N.t('lang.switch');
      button.setAttribute('aria-label', I18N.t('lang.switchAria'));
    }
    listeners.forEach((fn) => { try { fn(lang); } catch (e) { console.error(e); } });
  },
  toggle() { I18N.set(current === 'vi' ? 'en' : 'vi'); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  // Everything below is shared rather than retyped per page. The storefront, the
  // recovery form and the order page each had their own escape, money and status
  // helpers; two of those copies had already drifted apart, so one order showed a
  // different status word depending on which screen the buyer was looking at.
  //
  // The implementations live in public/format.js, loaded before this file on
  // every page: one escape and one money formatter for the whole browser side,
  // counted by scripts/metrics.mjs so a new copy fails the build.
  get locale() { return current === 'en' ? 'en-US' : 'vi-VN'; },
  esc(value) {
    return window.SVDFormat.esc(value);
  },
  money(value, currency = 'VND') {
    // The separator follows the currency, not the page language: VND keeps
    // its dot grouping and USD its dollar sign on every screen, which is
    // what public/format.js and the server both apply. A price on the page
    // and the price on the receipt have to be the same number written the
    // same way, or reconciling one against the other means converting by eye.
    return window.SVDFormat.money(value, currency);
  },
  date(value) {
    const at = value ? new Date(value) : new Date(NaN);
    return Number.isFinite(at.getTime()) ? at.toLocaleString(I18N.locale) : '';
  },
  statusKey(status) { return STATUS_KEYS[status] || 'order.status.pending'; },
  status(status) { return I18N.t(I18N.statusKey(status), status); },
  /**
   * Turns a failed API response into a sentence in the reader's language.
   *
   * Every refusal the server makes carries two fields: `code`, a key in this
   * dictionary, and `error`, a Vietnamese sentence for curl and for log lines
   * (src/refuse.js). The browser must use `code`.
   *
   * It did not, and the order of the two decided the language. Every call site
   * was `payload.error || T('some.fallback')` — the server's sentence won, because
   * it was first — so a visitor who had switched the shop to English and then got
   * a refusal was told, in Vietnamese, why. On the checkout form, at the moment
   * of paying, which is where a buyer is least able to tell a real problem from
   * one they caused.
   *
   * So the key is consulted first and the sentence is only reached for when there
   * is no code — an older server, a proxy in between, or a response that never
   * came from this one. `fallbackKey` is for the case where even that fails.
   *
   * @param {object|null} payload the parsed JSON body of a failed response
   * @param {string} fallbackKey a key to use when the body carries nothing usable
   * @returns {string} a sentence ready to put on screen
   */
  apiError(payload, fallbackKey) {
    const code = payload && payload.code;
    if (code) return I18N.t(code, payload.error || I18N.t(fallbackKey, ''));
    return payload && payload.error ? payload.error : I18N.t(fallbackKey, '');
  },
  /**
   * The countdown clock.
   *
   * The checkout modal and the order page each carried their own copy: the same
   * remaining-ms calculation, the same zero padding, the same HH:MM:SS formatting,
   * the same "is this order closed" test. Two copies of a clock is two chances to
   * show a buyer a different amount of time to pay on two screens, and a
   * discrepancy there reads as being charged by the shop.
   *
   * It is measured against the server's clock rather than the device's, so a phone
   * with the wrong time cannot invent extra hours. `deadline` is an ISO string and
   * `serverTime` is the server's own clock from the same response.
   */
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
  /**
   * The one sentence that explains what state an order is in.
   *
   * The checkout modal and the order page each used to have their own. They were
   * not two wordings of one rule: the modal knew five states and the page knew
   * ten, so a refunded order, a failed payment or an unconfirmed PayPal capture
   * read as a bland "đang chờ thanh toán" in one and as the truth in the other.
   * Two screens describing the same order differently is the single worst thing
   * a shop can do to a buyer who is worried about their money.
   *
   * The order here is the page's, because it is the complete one: what the buyer
   * needs to know is which world they are in, and that is decided by refund first,
   * then payment, then delivery, then the clock.
   */
  orderHint(order, options) {
    const deadlineAt = options && options.expiresAt ? new Date(options.expiresAt).getTime() : null;
    const serverSkew = options && options.serverTime ? new Date(options.serverTime).getTime() - Date.now() : 0;
    const left = deadlineAt === null ? null : deadlineAt - (Date.now() + serverSkew);
    const paid = order.status === 'paid' || Number(order.paidCount || 0) > 0 || Boolean(order.paidAt);
    // The order is closed once the file has been handed over, and closed means
    // "reopen it if it broke", which is a different sentence from "paid".
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
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    // Format: "placeholder:lookup.order,aria-label:nav.buy"
    el.dataset.i18nAttr.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, I18N.t(key, el.getAttribute(attr)));
    });
  });
  document.documentElement.lang = current;
}

function boot() {
  apply();
  const button = document.querySelector('[data-lang-toggle]');
  if (button) {
    button.textContent = I18N.t('lang.switch');
    button.setAttribute('aria-label', I18N.t('lang.switchAria'));
    button.addEventListener('click', () => I18N.toggle());
  }
  document.dispatchEvent(new CustomEvent('i18n:ready', { detail: { lang: current } }));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

window.I18N = I18N;

