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
 * Payment instructions returned to the storefront after checkout.
 * Only channels that are actually configured are exposed.
 */
export function paymentInstructions(order) {
  if (!isConfigured.bank) return null;
  const transferNote = `${env.bank.notePrefix} ${order.id}`.trim();
  const wallets = [
    env.bank.momo ? { label: "MoMo", value: env.bank.momo } : null,
    env.bank.zalopay ? { label: "ZaloPay", value: env.bank.zalopay } : null,
  ].filter(Boolean);
  return {
    bankName: env.bank.name,
    accountName: env.bank.accountName,
    accountNumber: env.bank.accountNumber,
    transferNote,
    amount: Number(order.amount) || 0,
    currency: order.currency || "VND",
    qrUrl: vietQrUrl({ amount: order.amount, transferNote }),
    wallets,
    paypalEmail: isConfigured.paypal ? env.paypal.accountEmail : null,
  };
}