import { env, isConfigured } from "./config.js";

const sanitizeQrText = (value) => String(value || "").replace(/[^\w\s\-/]/g, " ").trim().slice(0, 50);

/**
 * Builds the VietQR image URL for a bank transfer order.
 * Bank BIN + account number come from config so the storefront never hard-codes them.
 */
export function vietQrUrl({ amount, transferNote }) {
  if (!isConfigured.bank) return null;
  const bin = String(env.bank.bin || "").replace(/\D/g, "");
  const account = String(env.bank.accountNumber || "").replace(/\D/g, "");
  if (!bin || !account) return null;
  const params = new URLSearchParams();
  params.set("amount", String(Math.max(0, Math.round(Number(amount) || 0))));
  params.set("addInfo", sanitizeQrText(transferNote));
  params.set("accountName", sanitizeQrText(env.bank.accountName));
  return `https://img.vietqr.io/image/${bin}-${account}-compact2.png?${params.toString()}`;
}

/**
 * Builds the list of payment channels shown to the buyer.
 *
 * The bank channel carries a generated VietQR image with the amount and transfer
 * note already filled in. Wallet channels use uploaded QR images when present and
 * fall back to showing the wallet number, because a static wallet QR cannot carry
 * the order amount.
 */
export function paymentChannels(order) {
  const transferNote = `${env.bank.notePrefix} ${order.id}`.trim();
  const amount = Number(order.amount) || 0;
  const currency = order.currency || "VND";
  const channels = [];

  if (isConfigured.bank) {
    channels.push({
      id: "bank",
      label: `${env.bank.name} · ${env.bank.accountNumber}`,
      hint: "Quét trong app ngân hàng, số tiền và nội dung đã điền sẵn",
      qrUrl: vietQrUrl({ amount, transferNote }),
      account: env.bank.accountNumber,
      accountName: env.bank.accountName,
      amount,
      currency,
      transferNote,
    });
  }

  if (env.bank.momo) {
    channels.push({
      id: "momo",
      label: "MoMo",
      hint: "Quét mã MoMo, tự nhập số tiền nếu mã không hiện sẵn",
      qrImage: env.bank.momoQrAmount || env.bank.momoQr || null,
      qrHint: env.bank.momoQrAmount ? null : "Mã MoMo dùng chung, khách phải tự nhập số tiền",
      account: env.bank.momo,
      deepLink: env.bank.momoDeepLink || null,
      amount,
      currency,
      transferNote,
    });
  }

  if (env.bank.zalopay) {
    channels.push({
      id: "zalopay",
      label: "ZaloPay",
      hint: "Chuyển qua số điện thoại ZaloPay",
      qrImage: env.bank.zalopayQr || null,
      account: env.bank.zalopay,
      amount,
      currency,
      transferNote,
    });
  }

  return channels;
}

/**
 * Builds the checkout options for a visitor, given their resolved country.
 *
 * Nothing is ever hidden. A domestic buyer can still pick PayPal and an
 * overseas buyer can still pick a bank transfer; the country only changes the
 * order and the explanation next to each option, so nobody is ever shown a
 * method that has silently disappeared.
 */
export function paymentOptions(country, { bank, momo, zalopay, paypal } = {}) {
  // An unknown country must stay permissive, so the domestic hint is used and
  // every rail stays selectable: not knowing must never cost someone a way to
  // pay. This also drives which rail is listed first.
  const domestic = !country || isVietnam(country);
  const options = [];

  if (bank) {
    options.push({
      id: "bank_transfer",
      label: "Chuyển khoản ngân hàng / Quét mã QR",
      // VietQR, MoMo and ZaloPay are domestic rails, so for a buyer outside
      // Vietnam they are worth flagging rather than burying.
      hint: domestic
        ? (momo || zalopay ? "Hỗ trợ MoMo, ZaloPay và quét mã VietQR" : "Quét mã VietQR trong app ngân hàng")
        : "Cần tài khoản ngân hàng Việt Nam. Phù hợp hơn nếu bạn đang ở trong nước.",
      available: domestic,
    });
  }

  if (paypal) {
    options.push({
      id: "paypal",
      label: "PayPal",
      hint: domestic
        ? "Thanh toán quốc tế bằng ví PayPal, trừ thẻ và tài khoản quốc tế"
        : "Thanh toán bằng thẻ quốc tế hoặc tài khoản PayPal. Nên dùng nhất nếu bạn ở nước ngoài.",
      available: true,
    });
  }

  // Put the recommended rail first without removing anything. An unknown country
  // keeps the domestic default, since that is what the majority of visitors are.
  const preferred = domestic ? "bank_transfer" : "paypal";
  return options.sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : 0));
}

const isVietnam = (country) => String(country || "").toUpperCase() === "VN";

/**
 * Payment instructions returned to the storefront after checkout.
 * Only channels that are actually configured are exposed.
 */
export function paymentInstructions(order) {
  if (!isConfigured.bank) return null;
  const transferNote = `${env.bank.notePrefix} ${order.id}`.trim();
  return {
    bankName: env.bank.name,
    accountName: env.bank.accountName,
    accountNumber: env.bank.accountNumber,
    transferNote,
    amount: Number(order.amount) || 0,
    currency: order.currency || "VND",
    qrUrl: vietQrUrl({ amount: order.amount, transferNote }),
    channels: paymentChannels(order),
    paypalEmail: isConfigured.paypal ? env.paypal.accountEmail : null,
  };
}