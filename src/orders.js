import { env } from "./config.js";
import { getOrder, listExpiringOrders, updateOrder } from "./store.js";
import { notifyOrder } from "./notify.js";

// A store has to answer two questions the raw status column cannot: when does an
// unpaid order stop being payable, and who is allowed to grant the download
// after the money actually arrives. Both live here so the checkout, the admin
// panel, the PayPal webhook and the background sweep all agree on one answer.
const UNPAID = new Set(["pending", "pending_transfer"]);
const HOUR = 60 * 60 * 1000;

/** Money that left the account back towards the buyer. */
export const refunds = (order) => Number(order?.refundedAmount || 0) + Number(order?.refundedProviderAmount || 0);

const windowMs = () => Math.max(1, Number(env.orders.paymentWindowHours) || 24) * HOUR;
const warnMs = () => Math.max(0, Number(env.orders.expiringWarnHours) || 0) * HOUR;

export const isUnpaid = (order) => Boolean(order) && UNPAID.has(order.status);

/** True once the file has been handed over, so the order is closed for good. */
export const isClosed = (order) => Boolean(order?.deliveredAt);

/**
 * When the buyer stops being able to pay. Stored on the order at creation so a
 * later change to the env var never silently moves a deadline under a buyer who
 * is already looking at a countdown; older rows fall back to their creation
 * time plus the current window.
 */
export function paymentDeadline(order) {
  const stored = order?.expiresAt ? new Date(order.expiresAt).getTime() : NaN;
  if (Number.isFinite(stored)) return stored;
  const created = new Date(order?.createdAt || "").getTime();
  return Number.isFinite(created) ? created + windowMs() : null;
}

export const isExpired = (order, now = Date.now()) => {
  if (!isUnpaid(order) || isClosed(order)) return false;
  const deadline = paymentDeadline(order);
  return deadline !== null && now >= deadline;
};

const inWarningWindow = (order, now) => {
  if (!warnMs() || !isUnpaid(order) || isClosed(order) || Number(order.paidCount || 0) > 0) return false;
  const deadline = paymentDeadline(order);
  return deadline !== null && now >= deadline - warnMs() && now < deadline;
};

/**
 * Grants the download once a payment is proven.
 *
 * Idempotent, and deliberately not restricted to a single starting state: a
 * payment that lands after the sweep already cancelled the order has still
 * reached the wallet, so the order goes back to paid and the buyer is emailed
 * rather than being asked to pay a second time.
 */
export async function markOrderPaid(order, { source = "manual", providerAmount = 0, providerCurrency = null } = {}) {
  if (!order || order.status === "paid") return order;
  const now = new Date().toISOString();
  const paidCount = Number(order.paidCount || 0) + 1;
  const update = {
    status: "paid",
    paidAt: now,
    paidCount,
    paidAmount: Number(order.paidAmount || 0) + Number(order.amount || 0),
    cancelledAt: null,
    cancelReason: null,
    updatedAt: now,
  };
  // The captured amount is what actually reaches the account, which for a PayPal
  // order is USD and not the VND shelf price. Revenue reporting needs it, and
  // only the provider knows it.
  if (providerAmount > 0) {
    update.paidProviderAmount = Number(order.paidProviderAmount || 0) + Number(providerAmount);
    update.paidProviderCurrency = providerCurrency || order.paidProviderCurrency || null;
  }
  const updated = await updateOrder(order.id, update);
  // Keyed by payment number so a second confirmed payment mails again, while a
  // retry of the same one does not.
  await notifyOrder(updated, "paid", `paid:${paidCount}`);
  console.log(`[orders] ${order.id} paid via ${source}`);
  return updated;
}

/**
 * Closes the order after the release has been handed over, returning it to the
 * state a brand new order starts in. The revenue is not lost: paidCount and
 * paidAmount stay on the row and deliveredAt records when the file left.
 */
export async function markOrderDelivered(order) {
  if (!order || order.status !== "paid") return order;
  const now = new Date().toISOString();
  return updateOrder(order.id, { status: "pending", paidAt: null, deliveredAt: now, updatedAt: now });
}

/**
 * Records money going back to the buyer: a refund, a PayPal chargeback, or an
 * order confirmed by mistake.
 *
 * It does not subtract from paidAmount. A report that quietly shrinks a sale
 * looks like a bug the next time the owner compares it with a bank statement,
 * so the refund is recorded as its own number and the report shows collected,
 * refunded and net side by side.
 */
export async function voidPayment(order, { reason = "refunded", source = "admin" } = {}) {
  if (!order || order.status !== "paid") return null;
  const now = new Date().toISOString();
  const update = {
    status: "refunded",
    refundedAt: now,
    refundReason: String(reason).slice(0, 200),
    refundedCount: Number(order.refundedCount || 0) + 1,
    refundedAmount: Number(order.refundedAmount || 0) + Number(order.paidAmount || order.amount || 0),
    deliveredAt: null,
    updatedAt: now,
  };
  if (Number(order.paidProviderAmount || 0) > 0) update.refundedProviderAmount = Number(order.refundedProviderAmount || 0) + Number(order.paidProviderAmount);
  const updated = await updateOrder(order.id, update);
  await notifyOrder(updated, "refunded", `refunded:${update.refundedCount}`);
  console.log(`[orders] ${order.id} refunded via ${source}: ${update.refundReason}`);
  return updated;
}

async function cancelOrder(order, reason) {
  // Re-read before writing: the webhook or an admin click can land between the
  // sweep's read and its write, and a paid order must never be cancelled.
  const latest = await getOrder(order.id);
  if (!latest || !isUnpaid(latest) || isClosed(latest) || Number(latest.paidCount || 0) > 0) return null;
  const now = new Date().toISOString();
  const updated = await updateOrder(latest.id, { status: "cancelled", cancelledAt: now, cancelReason: reason, updatedAt: now });
  await notifyOrder(updated, "cancelled");
  return updated;
}

/**
 * One pass of the expiry sweep: warn the buyers close to the deadline, then
 * cancel what nobody paid for. Returns the ids it touched so the caller can log
 * and so tests can assert on them.
 */
export async function sweepOrders(now = Date.now()) {
  // Only the orders that can still change are read. Everything past the warning
  // window can never be warned about or cancelled, so fetching it would be
  // fetching history to throw it away, once a minute, for ever.
  const horizon = now + warnMs();
  const orders = await listExpiringOrders({ before: new Date(horizon).toISOString() });
  const result = { expired: [], warned: [] };
  for (const order of orders) {
    if (isExpired(order, now)) {
      const cancelled = await cancelOrder(order, "expired");
      if (cancelled) result.expired.push(cancelled.id);
      continue;
    }
    if (inWarningWindow(order, now)) {
      const note = await notifyOrder(order, "expiring");
      if (note.sent) result.warned.push(order.id);
    }
  }
  if (result.expired.length) console.log(`[orders] auto-cancelled ${result.expired.length} unpaid order(s): ${result.expired.join(", ")}`);
  return result;
}

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try { await sweepOrders(); } catch (error) { console.error(`[orders] sweep failed: ${error.message}`); } finally { running = false; }
}

/**
 * Starts the background sweep. It also runs once immediately so a server that
 * was down over a deadline catches up on boot instead of waiting a full tick.
 */
export function startSweeper() {
  if (timer) return timer;
  tick();
  timer = setInterval(tick, Math.max(5000, Number(env.orders.sweepIntervalMs) || 60000));
  // Never hold the process open for it; serverless and test hosts should exit.
  timer.unref?.();
  return timer;
}

export function stopSweeper() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
