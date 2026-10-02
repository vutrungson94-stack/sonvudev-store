import crypto from "node:crypto";
import { hasPayment } from "./orders.js";
import { getOrder, isOrderOwner, listFulfilledOrderReviews, updateOrder } from "./store.js";

// Customer reviews, deliberately without a star rating.
//
// The reasoning is worth keeping, because "add ratings so Google ranks us higher"
// is the wrong goal and would cost more than it returns:
//
//  - Google has never used a rating or a review count as a ranking signal, and
//    self-collected AggregateRating markup is not eligible for a rich result on a
//    normal website. The stars would earn nothing.
//  - A paid product with public stars invites refund abuse, and this shop refunds
//    on request. A one-star reviewer with a refund is a bad review and a payout.
//  - What an answer engine actually quotes is prose: a sentence from someone who
//    had the same problem. So the review is the text, and the text is the point.
//
// The gate is narrow on purpose: only someone who actually paid and was actually
// given the file can write one, so every review is attached to a real transaction
// the shop can look up. Reviews live on the order they belong to rather than in a
// table of their own, because that is the only place the proof of purchase already
// exists and the only thing a review is really a claim about.

const MIN_LENGTH = 20;
const MAX_LENGTH = 1200;

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

/**
 * Whether this order really did hand the buyer a file, for money.
 *
 * Both halves matter, and neither can be read off the status column alone: a
 * delivered order has had its status reset to pending on purpose, so a review
 * gate that asked for status === "paid" would refuse every genuine review. The
 * payment half is hasPayment's answer rather than a second copy of it.
 *
 * The reverse also has to hold. An order delivered without money is a bug, and a
 * bug is not something to build a public page on.
 */
const wasFulfilled = (order) => Boolean(order && order.deliveredAt && hasPayment(order));

/** A refunded order's words are no longer a description of the product. */
const isVouched = (order) => order && order.status !== "refunded";

/** Only the fields a product page shows. The order id and the email stay private. */
const publicReview = (review) => ({
  body: review.body,
  // Empty for an anonymous review, and the page substitutes the dictionary's own
  // word for it. Returning a Vietnamese literal here put it under an English page.
  authorName: review.anonymous ? "" : review.authorName,
  createdAt: review.createdAt,
});

/**
 * A refusal, as a translation key the reader can render rather than a sentence
 * they cannot.
 *
 * The order page renders this straight into the form's status line, and it used
 * to render a Vietnamese sentence written here — so a buyer who switched the site
 * to English and then sent a review too short to publish was told why in a
 * language they had chosen not to read.
 *
 * The key is the whole one, not a suffix. `refuse("review.err.notFound", …)` and a client
 * that assembled `review.err.${code}` worked, but then no key name appears in any
 * file: the audit could not see them used, reported eleven working keys as dead,
 * and the cheapest way to satisfy it would have been to delete the translations.
 * Spelled out, the server and the dictionary are visibly connected.
 *
 * `error` stays for anything reading the API as a human — curl, a log line, the
 * audit. The browser uses `code`.
 */
const refuse = (key, error, status) => ({ code: key, error, status });

/**
 * The reviews a product page prints.
 *
 * Prose in a buyer's own words is the only part worth exposing. Newest first,
 * because the most recent buyer is the one whose problem matches the reader.
 *
 * A read failure returns nothing rather than throwing. Reviews are decoration on
 * top of a sales page: if the column is missing because a migration has not been
 * run yet, the page still has to sell the product. Throwing here put a 500 on
 * every product page in the shop over a feature that is not part of the purchase.
 */
export async function listReviewsForProduct(productId) {
  let orders = [];
  try {
    orders = await listFulfilledOrderReviews();
  } catch (error) {
    console.warn(`[reviews] could not read reviews for ${productId}: ${error.message}`);
    return [];
  }
  return orders
    // A refunded order's review comes down with the refund: the buyer did not get
    // what they paid for, so their words are no longer a description of the
    // product and leaving them up would put a complaint on a sales page.
    .filter(isVouched)
    .filter((order) => (order.items || []).some((item) => item.productId === productId))
    .flatMap((order) => (order.reviews || [])
      .filter((review) => review.productId === productId)
      .map(publicReview))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Records a review from the person who bought the product.
 *
 * The order is fetched by id and the caller's access token is checked against it,
 * so a review can only ever be attached to an order whose download the caller was
 * actually able to open. The product then has to be one that order contains:
 * otherwise a real buyer could paste a review of something they never bought.
 *
 * One review per product per order, so a retried request cannot leave two copies
 * of the same words on the page.
 */
export async function createReview({ orderId, accessToken, productId, body, authorName }) {
  const order = await getOrder(orderId);
  // The same message as a missing order, so a wrong token cannot be used to find
  // out which order ids exist.
  if (!isOrderOwner(order, accessToken)) return refuse("review.err.notFound", "Không tìm thấy đơn hàng này.", 404);
  if (!wasFulfilled(order)) return refuse("review.err.notFulfilled", "Chỉ đơn đã nhận được file mới viết đánh giá được.", 409);
  if (!isVouched(order)) return refuse("review.err.refunded", "Đơn này đã được hoàn tiền nên không viết đánh giá được.", 409);

  const item = (order.items || []).find((entry) => entry.productId === productId);
  if (!item) return refuse("review.err.wrongProduct", "Sản phẩm này không nằm trong đơn hàng.", 400);

  const text = clean(body);
  if (text.length < MIN_LENGTH) return refuse("review.err.tooShort", `Viết thêm một chút để người khác tin được, tối thiểu ${MIN_LENGTH} ký tự.`, 400);
  if (text.length > MAX_LENGTH) return refuse("review.err.tooLong", `Tối đa ${MAX_LENGTH} ký tự.`, 400);

  const existing = (order.reviews || []).filter((review) => review.productId === productId);
  // Already written, so the box is gone entirely (see reviewForm) and this is the
  // race where two tabs both saw it empty. It reuses the existing key rather than
  // introducing a second sentence that says the same thing.
  if (existing.length) return refuse("review.already", "Bạn đã viết đánh giá cho sản phẩm này rồi.", 409);

  const review = {
    id: `rev_${crypto.randomUUID()}`,
    productId,
    body: text,
    // Left empty when the buyer chose to stay anonymous. The product page decides
    // what to print from `anonymous`, and a name written here would win over the
    // dictionary — which is how an English product page ended up with "Khách hàng"
    // under a review.
    authorName: clean(authorName).slice(0, 60),
    // The buyer is not named in public unless they chose to be. Keeping the email
    // off the record entirely means a leaked order row still says nothing about
    // who reviewed what.
    anonymous: !clean(authorName),
    // Reviews start visible. One fulfilled purchase is already a real check, and a
    // moderation queue is a process this shop does not have; holding real reviews
    // behind an inbox nobody opens every morning loses more than it protects.
    published: true,
    createdAt: new Date().toISOString(),
  };
  // A review is decoration on top of a purchase that has already happened. If it
  // cannot be stored the buyer has already paid and already downloaded, so
  // surfacing a failure here would turn a lost sentence into a broken checkout.
  try {
    await updateOrder(order.id, { reviews: [...(order.reviews || []), review] });
  } catch (error) {
    console.warn(`[reviews] could not store a review on ${order.id}: ${error.message}`);
    return refuse("review.err.storeFailed", "Chưa lưu được đánh giá. Cứ bỏ qua — phần còn lại của đơn hàng vẫn bình thường.", 503);
  }

  return { review: publicReview(review) };
}

export const reviewLimits = { minLength: MIN_LENGTH, maxLength: MAX_LENGTH };
