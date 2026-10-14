import { env, isConfigured } from "./config.js";

const sanitizeQrText = (value) => String(value || "").replace(/[^\w\s\-/]/g, " ").trim().slice(0, 50);

/**
 * Builds the VietQR image URL for a bank transfer order.
 * Bank BIN + account number come from config so the storefront never hard-codes them.
 */
function vietQrUrl({ amount, transferNote }) {
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
 *
 * `label` stays a literal because it is the merchant's own name and account number
 * — data, not prose. Everything a person has to be told is a `hintKey`, resolved
 * by the reader's own dictionary: the server names the sentence, the browser picks
 * the language, and neither has to know what the other speaks.
 */
function paymentChannels(order) {
  const transferNote = `${env.bank.notePrefix} ${order.id}`.trim();
  const amount = Number(order.amount) || 0;
  const currency = order.currency || "VND";
  const channels = [];

  if (isConfigured.bank) {
    channels.push({
      id: "bank",
      label: `${env.bank.name} · ${env.bank.accountNumber}`,
      hintKey: "pay.channel.bank",
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
      hintKey: "pay.channel.momo",
      qrImage: env.bank.momoQrAmount || env.bank.momoQr || null,
      qrHintKey: env.bank.momoQrAmount ? null : "pay.channel.momo.shared",
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
      hintKey: "pay.channel.zalopay",
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
 *
 * Labels and hints are dictionary keys, not sentences. This endpoint is read by
 * the checkout form, which is the one page a buyer in another country is certain
 * to reach, and it used to answer in Vietnamese whatever language the page was in.
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
      labelKey: "pay.option.bank",
      // VietQR, MoMo and ZaloPay are domestic rails, so for a buyer outside
      // Vietnam they are worth flagging rather than burying.
      hintKey: domestic
        ? (momo || zalopay ? "pay.option.bank.vi.wallets" : "pay.option.bank.vi")
        : "pay.option.bank.intl",
      available: domestic,
    });
  }

  if (paypal) {
    options.push({
      id: "paypal",
      labelKey: "pay.option.paypal",
      hintKey: domestic ? "pay.option.paypal.vi" : "pay.option.paypal.intl",
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