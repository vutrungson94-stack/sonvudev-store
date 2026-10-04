import { env } from "./config.js";
import { getOrder, isClosed, isUnpaid, listExpiringOrders, paymentDeadline, updateOrder } from "./store.js";
import { notifyOrder } from "./notify.js";

// A store has to answer two questions the raw status column cannot: when does an
// unpaid order stop being payable, and who is allowed to grant the download
// after the money actually arrives. Both are answered here so the checkout, the
// admin panel, the PayPal webhook and the background sweep all agree on one
// answer. The primitives they are built from — the unpaid status list, the
// tests for "can it still be paid" and "is it closed", and the deadline rule —
// live in store.js beside the status list they read, because this module
// imports that one and the other way round is a cycle. They are re-exported so
// the routes, the webhook and the tests keep importing them from the module
// that owns order behavior.
export { isUnpaid, isClosed, paymentDeadline };

const HOUR = 60 * 60 * 1000;

// Already clamped to at least an hour in config.js, so this reads the one
// resolved number rather than re-deriving a fallback.
const warnMs = () => env.orders.expiringWarnHours * HOUR;

/**
 * Whether money ever reached the shop for this order.
 *
 * Not the same question as "is the status paid", and the difference matters.
 * markOrderDelivered deliberately resets the status to pending and clears paidAt so
 * that a buyer who downloads a second time gets a working order rather than a
 * closed one — which means a delivered order, the single most common thing to need
 * a refund, is no longer "paid" by the only test anyone was using.
 *
 * So this reads the payment columns instead of the status, and it lives here
 * because four separate questions depend on it: can it be downloaded, can it be
 * refunded, may the buyer review it, and is it counted as revenue. Four private
 * copies of that test is how a delivered order ends up unrefundable.
 */
export const hasPayment = (order) => Boolean(order) && (
  order.status === "paid"
  || order.paidAt
  || Number(order.paidCount || 0) > 0
  || Number(order.paidAmount || 0) > 0
);

/**
 * Past the point where the buyer can still pay.
 *
 * Exported because the deadline rule is worth testing on its own: the test drives
 * the clock directly rather than waiting for real hours to pass, which is the only
 * way to check the boundary rather than roughly around it.
 */
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
  if (!order || !hasPayment(order)) return order;
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
  // Reads the payment columns rather than the status, so an order whose file was
  // already handed over can still be refunded. That is the common case: the buyer
  // downloaded, the file was broken, and the refund is what they asked for.
  if (!hasPayment(order)) return null;
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

/**
 * Whether the sweep is actually running in this process.
 *
 * The health endpoint used to answer this from an environment variable it never
 * consulted: it read ORDER_SWEEP_DISABLED, which only two test files ever set and
 * which startSweeper() does not look at. So the answer was a restatement of a config
 * flag, not a statement about the server — and it was wrong in the direction that
 * matters. A host that really had the sweeper turned off would still report
 * sweeper:false while unpaid orders piled past their deadline, and a host with it
 * running fine would report true whether or not it had started.
 *
 * /api/health is what the 30-minute monitor and UptimeRobot both read, so this field
 * is the only place a stopped sweeper could ever have been noticed. It now reports
 * the timer.
 */
export const sweeperRunning = () => Boolean(timer);

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
  // A shop whose orders are swept by something else — a cron job, a second instance
  // — does not want a second sweeper racing it. The interval came straight from
  // config.js, which already applied its default and its floor, so re-guarding it
  // here could only ever agree with it.
  if (env.orders.sweepDisabled) return null;
  tick();
  timer = setInterval(tick, env.orders.sweepIntervalMs);
  // Never hold the process open for it; serverless and test hosts should exit.
  timer.unref?.();
  return timer;
}

export function stopSweeper() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
