// SonVuDev i18n - Vietnamese / English only.
//
// Every customer-facing string on the storefront lives here. Admin stays
// Vietnamese on purpose: the owner is the only person who reads it.
//
// Markup:  <span data-i18n="hero.title"></span>
// JS:      I18N.t('products.count')
//
const DICT = {
  vi: {
    'lang.switch': 'EN',
    'lang.switchAria': 'Chuyển sang tiếng Anh',
    'brand.tagline': 'Phần mềm tốt cho công việc tốt.',
    'brand.rights': '© 2026 SonVuDev.com · Đồng sở hữu',
    'announce.text': 'SonVuDev đang mở cửa cho các bản phát hành mới',
    'announce.cta': 'Khám phá ngay',
    'nav.products': 'Sản phẩm',
    'nav.why': 'Vì sao chọn SonVuDev',
    'nav.faq': 'FAQ',
    'nav.buy': 'Mua ngay',
    'nav.store': 'Cửa hàng',
    'nav.terms': 'Điều khoản',
    'nav.privacy': 'Bảo mật',
    'nav.refund': 'Hoàn tiền',
    'nav.lookup': 'Tra cứu đơn',
    'nav.contact': 'Liên hệ',
    'hero.eyebrow': 'Phần mềm được xây dựng có tâm',
    'hero.title1': 'Công cụ tốt.',
    'hero.title2': 'Cuộc sống',
    'hero.title3': 'gọn hơn.',
    'hero.text': 'Những chương trình SonVuDev tự viết cho người dùng Việt — dễ cài đặt, minh bạch và luôn được cập nhật.',
    'hero.cta1': 'Xem sản phẩm',
    'hero.cta2': 'Tại sao SonVuDev?',
    'hero.trust1': 'Bảo mật',
    'hero.trust2': 'Hỗ trợ tận tâm',
    'hero.trust3': 'Cập nhật dài hạn',
    'stats.1': 'Sản phẩm đang phát triển',
    'stats.2': 'Tiêu chuẩn chất lượng SonVuDev',
    'stats.3': 'Tự xây dựng & kiểm soát',
    'stats.note': 'Mỗi sản phẩm đều được làm ra để giải quyết một vấn đề thật.',
    'products.eyebrow': 'Kho phần mềm',
    'products.title1': 'Chọn công cụ',
    'products.title2': 'phù hợp với bạn.',
    'products.intro1': 'Từ công cụ miễn phí đến bộ giải pháp chuyên nghiệp.',
    'products.intro2': 'Mọi thứ đều dễ bắt đầu.',
    'products.all': 'Tất cả',
    'products.loading': 'Đang tải...',
    'products.count': 'sản phẩm',
    'products.emptyTitle': 'Chưa có sản phẩm',
    'products.emptyText': 'Hãy thử bộ lọc khác.',
    'products.loadError': 'Chưa thể tải sản phẩm',
    'products.loadErrorText': 'Lỗi tải dữ liệu',
    'products.new': 'Mới',
    'products.buyAria': 'Mua',
    'why.eyebrow': 'Đằng sau SonVuDev',
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
    'order.thanks': 'Cảm ơn bạn, đơn hàng đã ghi nhận.',
    'order.code': 'Mã tra cứu đơn hàng của bạn',
    'order.codeHint': 'Lưu mã này lại. Nếu đóng tab, bạn có thể lấy lại bằng trang tra cứu đơn hàng.',
    'order.save': 'Lưu mã này',
    'order.copied': 'Đã sao chép mã tra cứu.',
    'order.pending': 'Đang chờ thanh toán',
    'order.pendingHint': 'Bạn đã đặt đơn nhưng chưa thanh toán. Chuyển khoản rồi báo chúng tôi để được duyệt nhanh.',
    'order.paid': 'Đã thanh toán',
    'order.failed': 'Thanh toán thất bại',
    'order.cancelled': 'Đơn hàng đã hủy',
    'order.amount': 'Số tiền',
    'order.method': 'Phương thức',
    'order.email': 'Email',
    'order.download': 'Tải sản phẩm',
    'order.downloading': 'Đang chuẩn bị link tải…',
    'order.expired': 'Link tải đã hết hạn. Vui lòng tải lại.',
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
    'cart.title': 'Thanh toán',
    'cart.email': 'Email nhận sản phẩm',
    'cart.emailHint': 'Mã tra cứu đơn sẽ được gửi tới địa chỉ này.',
    'cart.name': 'Họ tên',
    'cart.nameHint': 'Không bắt buộc, giúp chúng tôi giao hàng dễ hơn.',
    'cart.pay': 'Thanh toán',
    'cart.paying': 'Đang xử lý…',
    'cart.summary': 'Tóm tắt đơn hàng',
    'cart.total': 'Tổng cộng',
    'cart.note': 'Bạn chỉ bị tính phí khi thanh toán thành công.',
    'legal.back': 'Về cửa hàng',
    'legal.updated': 'Cập nhật lần cuối',
    'pay.bank': 'Chuyển khoản / Quét mã QR',
    'pay.bankHint': 'Quét mã VietQR trong app ngân hàng',
    'pay.paypalHint': 'Thanh toán quốc tế bằng ví PayPal',
    'pay.accountLabel': 'Số tài khoản / ví',
    'pay.amountLabel': 'Số tiền',
    'pay.transferNote': 'Nội dung chuyển khoản (ghi đúng để đối soát)',
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
    'order.recorded': 'Đơn hàng đã được ghi nhận. Lưu mã tra cứu để kiểm tra trạng thái và tải sản phẩm.',
    'order.copy': 'Sao chép mã',
    'order.check': 'Kiểm tra đơn hàng',
    'order.errStatus': 'Không kiểm tra được trạng thái đơn hàng',
    'order.errDownload': 'Chưa thể tải sản phẩm lúc này',
    'order.paidHint': 'Thanh toán đã được xác nhận. Bạn có thể tải sản phẩm ngay.',
    'order.statusHint': 'Trạng thái hiện tại của đơn hàng.',
    'cart.agree': 'Tôi đồng ý với điều khoản sử dụng và chính sách bảo mật.',
    'cart.countryNote': 'Bạn đang ở {country}. {method}',
    'product.close': 'Đóng',
    'product.details': 'Chi tiết',
    'product.requirements': 'Yêu cầu hệ thống',
    'product.version': 'Phiên bản',
    'product.platform': 'Nền tảng',
    'product.category': 'Danh mục',
    'product.buyNow': 'Mua ngay',
    'product.notFound': 'Không tìm thấy sản phẩm',
  },
  en: {
    'lang.switch': 'VI',
    'lang.switchAria': 'Switch to Vietnamese',
    'brand.tagline': 'Good software for good work.',
    'brand.rights': '© 2026 SonVuDev.com · All rights reserved',
    'announce.text': 'SonVuDev is opening up to new releases',
    'announce.cta': 'Explore now',
    'nav.products': 'Products',
    'nav.why': 'Why SonVuDev',
    'nav.faq': 'FAQ',
    'nav.buy': 'Buy now',
    'nav.store': 'Store',
    'nav.terms': 'Terms',
    'nav.privacy': 'Privacy',
    'nav.refund': 'Refund',
    'nav.lookup': 'Order lookup',
    'nav.contact': 'Contact',
    'hero.eyebrow': 'Software built with care',
    'hero.title1': 'Good tools.',
    'hero.title2': 'A simpler',
    'hero.title3': 'daily life.',
    'hero.text': 'Programs SonVuDev writes from scratch for everyday users — easy to install, transparent, and always updated.',
    'hero.cta1': 'View products',
    'hero.cta2': 'Why SonVuDev?',
    'hero.trust1': 'Secure',
    'hero.trust2': 'Real support',
    'hero.trust3': 'Long-term updates',
    'stats.1': 'Products in development',
    'stats.2': 'SonVuDev quality standard',
    'stats.3': 'Built & controlled in-house',
    'stats.note': 'Every product is made to solve a problem that is actually real.',
    'products.eyebrow': 'Software store',
    'products.title1': 'Pick the tool',
    'products.title2': 'that fits you.',
    'products.intro1': 'From free tools to professional solutions.',
    'products.intro2': 'Everything is easy to start.',
    'products.all': 'All',
    'products.loading': 'Loading...',
    'products.count': 'products',
    'products.emptyTitle': 'No products yet',
    'products.emptyText': 'Try a different filter.',
    'products.loadError': 'Could not load products',
    'products.loadErrorText': 'Failed to load data',
    'products.new': 'New',
    'products.buyAria': 'Buy',
    'why.eyebrow': 'Behind SonVuDev',
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
    'order.thanks': 'Thank you, your order is recorded.',
    'order.code': 'Your order lookup code',
    'order.codeHint': 'Save this code. If you close the tab you can get it back on the order lookup page.',
    'order.save': 'Save this code',
    'order.copied': 'Lookup code copied.',
    'order.pending': 'Awaiting payment',
    'order.pendingHint': 'Your order is placed but not paid yet. Transfer the amount and tell us so we can confirm quickly.',
    'order.paid': 'Paid',
    'order.failed': 'Payment failed',
    'order.cancelled': 'Order cancelled',
    'order.amount': 'Amount',
    'order.method': 'Method',
    'order.email': 'Email',
    'order.download': 'Download product',
    'order.downloading': 'Preparing your download link…',
    'order.expired': 'The download link has expired. Please download again.',
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
    'cart.title': 'Checkout',
    'cart.email': 'Email to receive the product',
    'cart.emailHint': 'Your order lookup code will be sent to this address.',
    'cart.name': 'Full name',
    'cart.nameHint': 'Optional, helps us deliver more easily.',
    'cart.pay': 'Pay now',
    'cart.paying': 'Processing…',
    'cart.summary': 'Order summary',
    'cart.total': 'Total',
    'cart.note': 'You are only charged when the payment succeeds.',
    'cart.agree': 'I agree to the Terms of Use and the Privacy Policy.',
    'cart.countryNote': 'You appear to be in {country}. {method}',
    'product.close': 'Close',
    'product.details': 'Details',
    'product.requirements': 'System requirements',
    'product.version': 'Version',
    'product.platform': 'Platform',
    'product.category': 'Category',
    'product.buyNow': 'Buy now',
    'product.notFound': 'Product not found',
    'legal.back': 'Back to store',
    'legal.updated': 'Last updated',
    'pay.bank': 'Bank transfer / QR scan',
    'pay.bankHint': 'Scan the VietQR code in your banking app',
    'pay.paypalHint': 'International payment with a PayPal wallet',
    'pay.accountLabel': 'Account / wallet number',
    'pay.amountLabel': 'Amount',
    'pay.transferNote': 'Transfer content (write it exactly so we can match it)',
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
    'order.recorded': 'Your order has been recorded. Keep the lookup code to check its status and download the product.',
    'order.copy': 'Copy code',
    'order.check': 'Check order status',
    'order.errStatus': 'Could not check the order status',
    'order.errDownload': 'The product is not available for download right now',
    'order.paidHint': 'Payment confirmed. You can download the product now.',
    'order.statusHint': 'Current status of your order.',
  },
};

// ---------------------------------------------------------------------------
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
  t(key, fallback) {
    const table = DICT[current] || DICT.vi;
    if (table[key] !== undefined) return table[key];
    // Never render an empty box for a missing key: fall back to Vietnamese,
    // then to whatever the caller passed, so the gap stays visible.
    if (DICT.vi[key] !== undefined) return DICT.vi[key];
    return fallback !== undefined ? fallback : key;
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

