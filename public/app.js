// Storefront renderer. Every user-facing string goes through I18N so the
// Vietnamese/English switch works without a reload.
const grid = document.getElementById('product-grid');
const count = document.getElementById('product-count');
const modal = document.getElementById('product-modal');
const modalContent = document.getElementById('modal-content');
const toast = document.getElementById('toast');

let products = [];
let activeFilter = 'all';
let payOptions = null;
let lastOrder = null;
let lastToken = null;
let currentOpenProduct = null;
// One key per checkout attempt, so a retry after a dropped connection returns
// the order that already exists instead of opening a second one for one
// purchase. Cleared once an order is safely in hand.
let checkoutKey = null;
// The deadline is counted against the server's clock, not the device's.
let deadlineState = { expiresAt: null, offset: 0, serverTime: null };
let countdownTimer = null;
let watchTimer = null;

// I18N.t is (key, fallback, vars). Three slots, always in that order, so a page
// that fills placeholders passes vars and a page that does not simply omits them.
// One signature across all four page scripts: a wrapper that took only (key, vars)
// is what put `{support}` on the PayPal failure screen as a literal brace.
const T = (key, fallback, vars) => window.I18N.t(key, fallback, vars);
// esc and money now live in i18n.js, which every page already loads. They were typed out
// here and again in order.js, and had already drifted: this copy formatted every amount in
// Vietnamese even for a buyer who had switched the site to English, which showed 249.000
// where 249,000 was meant.
const esc = (v) => window.I18N.esc(v);
const money = (v, c) => window.I18N.money(v, c);
// Product copy is authored with blank lines between paragraphs. HTML collapses
// every newline, so a plain esc() turned a wall of text into one solid block.
// Escaping first and then turning the newlines into <p> keeps the structure
// without letting any markup through.
const paragraphs = (text) => String(text || '')
  .split(/\n{2,}/)
  .map((block) => block.trim())
  .filter(Boolean)
  .map((block) => `<p>${esc(block).replace(/\n/g, '<br>')}</p>`)
  .join('');
// initials used to be written out here in full, next to the copy the server
// renders the catalogue cards with. Two copies of a two-line function are not
// wrong today, but the card on the server and the card in the browser are the
// same card, and a product whose initials split differently after a rename is
// a product that looks like two products. The shared implementation is loaded
// before this file (format.js, then i18n.js, then this).
const initials = (n) => window.SVDFormat.initials(n);

function toastMsg(message, isError = false) {
  toast.textContent = message;
  toast.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastMsg.timer);
  toastMsg.timer = setTimeout(() => { toast.className = 'toast'; }, 4200);
}

// Rendered from GET /api/checkout/options, which orders the rails for the
// visitor's country. Nothing is filtered out client side: if the request fails
// the fallback below lists every configured method in domestic-first order, so
// a blocked or slow lookup can never remove a way to pay.
//
// The server sends keys, not sentences — labelKey and hintKey. It used to send
// Vietnamese text and this page printed it as-is, so a buyer who had switched the
// site to English chose a payment method labelled in a language they had chosen
// not to read, on the one screen where the money is. The key is resolved here,
// against the dictionary the rest of the page already uses.
function paymentList() {
  return payOptions && payOptions.length ? payOptions : [
    { id: 'bank_transfer', labelKey: 'pay.option.bank', hintKey: 'pay.option.bank.vi' },
    { id: 'paypal', labelKey: 'pay.option.paypal', hintKey: 'pay.option.paypal.vi' },
  ];
}

function renderPaymentOptions() {
  return paymentList().map((o, i) => `<label class="payment-option">
    <input type="radio" name="paymentMethod" value="${esc(o.id)}"${i === 0 ? ' checked' : ''}>
    <span><b>${esc(T(o.labelKey))}</b><small>${esc(o.hintKey ? T(o.hintKey) : '')}</small></span>
    <em>${o.id === 'paypal' ? '◉' : '◎'}</em>
  </label>`).join('');
}

function geoNote() {
  const d = payOptions;
  if (!d || !d.country) return '';
  const outside = d.country !== 'VN';
  // Filled through vars rather than by hand. The dictionary's own substitution
  // pass is the only place placeholders are resolved, so a string that gains a
  // second {token} later works here without anyone remembering this line.
  const text = outside
    ? T('geo.outside', undefined, { country: d.country })
    : T('geo.domestic');
  return `<p class="geo-note">${esc(text)}</p>`;
}

// The form has to state the deadline before the buyer commits, not after: the
// whole point of cancelling a stale order is that the buyer was told it would
// happen. The number comes from the same env var the sweep enforces, read off
// /api/checkout/options.
//
// When that call has not answered, the note is omitted rather than filled with a
// guess. A hardcoded "24 hours" here was a fourth copy of a number the server
// owns: it would have kept promising the old window on exactly the screen where
// the request failed, to a buyer who could not reach us to ask.
function expiryNote() {
  const hours = Number(payOptions && payOptions.paymentWindowHours);
  if (!Number.isFinite(hours) || hours <= 0) return '';
  return `<p class="expiry-note">${esc(T('cart.expiry', undefined, { hours: String(hours) }))}</p>`;
}

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    if (!res.ok) throw Error(I18N.apiError(data, 'products.loadError'));
    products = data.products || [];
    render();
  } catch (error) {
    grid.innerHTML = `<div class="empty-state"><b>${esc(T('products.loadError'))}</b><p>${esc(error.message)}</p></div>`;
    count.textContent = T('products.loadErrorText');
  }
}

// Two ways to narrow the catalogue, and they compose.
//
// The filter row answers "what kind of thing"; the search box answers "which one".
// Both are here because the catalogue is meant to grow — the stats strip counts it,
// the admin panel publishes into it — and a name like "Excel Trusted Locations
// Setup" does not announce itself from a grid of cards.
//
// Client-side on purpose. The whole catalogue is already in the page and already in
// `products`, so this is a filter over an array: no endpoint, no index, no round
// trip, and nothing new to keep in step with the catalogue. A search endpoint would
// be the wrong shape for a list that fits in one screen, and it would be a second
// place for a product to be visible in or not.
//
// Vietnamese carries no word breaks between the parts of a name, so a prefix match
// is wrong for "bật macro": the words appear in any order and often not adjacent.
// Matching on the whole string, in the reader's own language, is what makes this
// usable — and searching the English copy while the page is in English, so a reader
// typing the name they were given finds it.
const searchInput = document.getElementById('product-search');
let searchTerm = '';

// Diacritics are folded so "trong tin cay" finds "Trong tin cây". A Vietnamese
// keyboard is easier with accents switched on, a Latin one is not, and a customer
// who cannot type the word they are looking for will not report that the search box
// is broken.
//
// Order matters, and it was wrong. The replacement for đ ran before toLowerCase(),
// and the pattern was lowercase-only — so "Đ" (U+0110) was missed by NFD, missed
// by the regex, and only became lowercase *after* the substitution it should have
// taken part in. Vietnamese product names very often start with Đ, so a search for
// "Đồ gỗ" folded to "đo gỗ" while the catalogue folded to "do go" from a name typed
// in lowercase: no match, no error, an empty result for a word that was right there.
// Lowercasing first makes the two sides of the comparison identical regardless of
// the case either was typed in.
const foldDiacritics = (value) => String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();

function matchesSearch(p) {
  if (!searchTerm) return true;
  const local = localized(p);
  // The localised copy is searched as well, so a Japanese visitor can find a
  // product by the Japanese name or description the card is actually showing,
  // instead of only by the Latin catalogue text.
  const haystack = [p.name, p.shortDescription, p.shortDescriptionEn, p.description, p.descriptionEn, p.category, p.platform,
    ...(p.features || []), ...(p.featuresEn || []),
    local.name, local.shortDescription, local.description, local.category, ...(local.features || [])];
  return foldDiacritics(haystack.filter(Boolean).join(' ')).includes(searchTerm);
}

function visibleProducts() {
  return products.filter((p) => (activeFilter === 'all' || p.category === activeFilter || p.platform === activeFilter) && matchesSearch(p));
}

// Products carry an optional English copy. When the visitor switches to English
// we prefer those fields but always fall back to the Vietnamese text, so a
// product that has not been translated yet never shows an empty description.
const CATEGORIES = { "Công cụ": "Tools", "Tiện ích": "Utilities", "Phần mềm": "Software", "Khác": "Other" };
const CATEGORIES_VI = Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [v, k]));
const BADGES = { "Mới": "New", "Bán chạy": "Best seller", "Cập nhật": "Updated", "Phát hành": "Release", "Phổ biến": "Popular", "Chuyên nghiệp": "Professional", "Tiết kiệm": "Value", "Doanh nghiệp": "Enterprise", "Ưu đãi sớm": "Early Bird", "Safe Edition v4.3": "Safe Edition v4.3", "Phát hành 1.4.0": "Release 1.4.0" };
const BADGES_VI = Object.fromEntries(Object.entries(BADGES).map(([k, v]) => [v, k]));
// A diacritic-tolerant map so a "con co" or "CON CO" in the catalogue still
// maps to Tools instead of leaking raw Vietnamese text on the English page.
const CATEGORIES_NORM = Object.fromEntries(
  Object.entries(CATEGORIES).map(([k, v]) => [foldDiacritics(k), v])
);
const CATEGORIES_VI_NORM = Object.fromEntries(
  Object.entries(CATEGORIES).map(([k, v]) => [foldDiacritics(v), k])
);
// Same treatment for badges, including badges that carry a trailing version
// such as "Phat hanh 1.4.0" so the map key is the badge alone.
const BADGES_NORM = Object.fromEntries(
  Object.entries(BADGES).map(([k, v]) => [foldDiacritics(k), v])
);
const BADGES_VI_NORM = Object.fromEntries(
  Object.entries(BADGES).map(([k, v]) => [foldDiacritics(v), k])
);
// Repairs a Vietnamese value that was typed without diacritics. "Phat hanh 1.4.0"
// stored in a catalogue row is the same label as "Phát hành 1.4.0"; without this
// the Vietnamese page printed the column text verbatim while the English page
// translated it, so the same badge read correctly in one language and as an
// unaccented typo in the other.
const BADGES_VI_FIX = Object.fromEntries(
  Object.entries(BADGES).map(([vi]) => [foldDiacritics(vi), vi])
);
const CATEGORIES_VI_FIX = Object.fromEntries(
  Object.entries(CATEGORIES).map(([vi]) => [foldDiacritics(vi), vi])
);
const mapValue = (exact, tolerant, raw) => {
  const value = String(raw || "").trim();
  if (!value) return value;
  return exact[value] || tolerant[foldDiacritics(value)] || value;
};
function localized(p) {
  // Only the Vietnamese page repairs/strips Vietnamese. Japanese and Chinese
  // readers get the English product copy (with the same safe requirements
  // fallback), never a Vietnamese body under a translated heading.
  if (window.I18N.lang === 'vi') {
    // Unaccented Vietnamese coming from the catalogue is repaired to the accented
    // form; an already-English value is translated back to its Vietnamese word.
    const cat = CATEGORIES_VI_FIX[foldDiacritics(p.category)]
      || mapValue(CATEGORIES_VI, CATEGORIES_VI_NORM, p.category);
    const badge = BADGES_VI_FIX[foldDiacritics(p.badge)]
      || mapValue(BADGES_VI, BADGES_VI_NORM, p.badge);
    if (cat === p.category && badge === p.badge) return p;
    return { ...p, category: cat, badge };
  }

  const lang = window.I18N.lang;
  // Per-locale product copy from the dictionary asset (JA/ZH). The catalogue has
  // no columns for those languages, so without this the grid fell back to the
  // English pair and the shop looked half-translated on a Japanese page. The
  // overlay is only consulted for a field the record itself cannot supply.
  const overlay = window.I18N.productCopy(p) || {};
  const hasText = (value) => value !== undefined && value !== null && String(value).trim() !== '';
  const hasList = (value) => Array.isArray(value) && value.length > 0;
  // Precedence: localised column (if one ever exists) -> dictionary overlay ->
  // English column -> Vietnamese source. English wins over the overlay for the
  // English page so a database edit is never masked by an older cache file.
  const pickText = (ja, zh, en, vi, field) => {
    const localised = lang === 'ja' ? ja : lang === 'zh-CN' ? zh : null;
    if (hasText(localised)) return localised;
    if (lang === 'en' && hasText(en)) return en;
    if (hasText(overlay[field])) return overlay[field];
    if (hasText(en)) return en;
    return vi;
  };
  const pickList = (ja, zh, en, vi, field) => {
    const localised = lang === 'ja' ? ja : lang === 'zh-CN' ? zh : null;
    if (hasList(localised)) return localised;
    if (lang === 'en' && hasList(en)) return en;
    if (hasList(overlay[field])) return overlay[field];
    if (hasList(en)) return en;
    return vi;
  };

  // Requirements are the one field whose Vietnamese text is deliberately not
  // shown: a translated notice pointing at the printed guide is honest, while a
  // Vietnamese paragraph under an English/Japanese heading is not.
  const reqSource = (p.requirementsEn && String(p.requirementsEn).trim())
    ? p.requirementsEn
    : String(p.requirements || '');
  const requirements = hasText(overlay.requirements)
    ? overlay.requirements
    : (/[^\x00-\x7F]/.test(reqSource) ? T('product.requirementsViOnly') : reqSource);

  return {
    ...p,
    // The catalogue stores Vietnamese; the English pair comes from the shared
    // table first, then the per-locale label asset (JA/ZH) overrides it.
    category: (() => {
      const categoryEn = mapValue(CATEGORIES, CATEGORIES_NORM, p.category);
      return window.I18N.productLabel('category', categoryEn) || categoryEn;
    })(),
    badge: (() => {
      const badgeEn = mapValue(BADGES, BADGES_NORM, p.badge);
      if (!badgeEn) return undefined;
      return window.I18N.productLabel('badge', badgeEn) || badgeEn;
    })(),
    name: pickText(p.nameJa, p.nameZh, p.nameEn, p.name, 'name'),
    shortDescription: pickText(p.shortDescriptionJa, p.shortDescriptionZh, p.shortDescriptionEn, p.shortDescription, 'shortDescription'),
    description: pickText(p.descriptionJa, p.descriptionZh, p.descriptionEn, p.description, 'description'),
    requirements,
    features: pickList(p.featuresJa, p.featuresZh, p.featuresEn, p.features, 'features'),
  };
}

function render() {
  const list = visibleProducts();
  // A count that only exists when something is hidden would move the row under the
  // reader's cursor while they type. It appears only once the search is doing
  // something, so the page looks the same at rest.
  count.textContent = `${list.length.toString().padStart(2, '0')} ${T('products.count')}`;
  grid.innerHTML = list.length
    ? list.map((p) => card(localized(p))).join('')
    : `<div class="empty-state"><b>${esc(T('products.emptyTitle'))}</b><p>${esc(T('products.emptyText'))}</p></div>`;
  grid.querySelectorAll('.product-card').forEach((c) => { c.onclick = () => openProduct(c.dataset.id); });
}

// The price on screen follows the language the reader chose, and only when the
// server also sent the USD figure it actually charges. priceUsd comes from the
// same conversion checkout uses, so an English page quotes the number PayPal
// takes rather than the shelf price divided by the raw rate — which is a sum
// nobody pays and shows up first as a buyer who was quoted low at the payment
// step. Without priceUsd the shelf price is shown: wrong for the language, but
// never a number the buyer is not charged.
function priceFor(p) {
  if (window.I18N && window.I18N.lang !== 'vi' && p.priceUsd !== undefined && p.priceUsd !== null) {
    return money(p.priceUsd, 'USD');
  }
  return money(p.price, p.currency);
}

function card(p) {
  const lp = localized(p);
  const art = esc(lp.category.toLowerCase().replace(/\s+/g, '-'));
  return `<article class="product-card" data-id="${esc(lp.id)}">
    <div class="product-art art-${art}">
      <span class="product-badge">${esc(lp.badge || T('products.new'))}</span>
      <div class="product-logo">${initials(lp.name)}</div>
      <div class="art-grid"></div>
      <span class="art-spark">✦</span>
    </div>
    <div class="product-info">
      <div class="product-meta"><span>${esc(lp.platform)} · v${esc(lp.version)}</span><span>${esc(lp.category)}</span></div>
      <h3>${esc(lp.name)}</h3>
      <p>${esc(lp.shortDescription || lp.description || '')}</p>
      <ul>${(lp.features || []).slice(0, 2).map((f) => `<li>✓ ${esc(f)}</li>`).join('')}</ul>
      <div class="product-buy">
        <strong>${priceFor(lp)}</strong>
        <button class="round-arrow" aria-label="${esc(T('products.buyAria'))} ${esc(lp.name)}">↗</button>
      </div>
    </div>
  </article>`;
}

function openProduct(id) {
  currentOpenProduct = id;
  const raw = products.find((x) => x.id === id);
  if (!raw) return;
  // Leaving the order view behind, so its background polling cannot repaint the
  // modal with an order nobody is looking at any more.
  stopWatch();
  stopCountdown();
  const p = localized(raw);
  modalContent.innerHTML = `      <div class="detail-art">
      <div class="product-logo large">${initials(p.name)}</div>
      <span>${esc(p.badge || T('products.new'))}</span>
    </div>
    <div class="detail-copy">
      <p class="eyebrow">${esc(p.platform)} · ${esc(T('product.version'))} ${esc(p.version)}</p>
      <h2 id="modal-title">${esc(p.name)}</h2>
    </div>
    <div class="detail-body">
      <div class="detail-description">${paragraphs(p.description || p.shortDescription)}</div>
      <ul class="feature-list">${(p.features || []).map((f) => `<li><span>✓</span>${esc(f)}</li>`).join('')}</ul>
      <div class="detail-requirements">
        <b>${esc(T('product.requirements'))}</b>
        <span>${esc(p.requirements || T('product.seeGuide'))}</span>
      </div>
    </div>
    <div class="detail-footer">
      <div><small>${esc(T('product.priceOnce'))}</small><strong>${priceFor(p)}</strong></div>
      <button class="button button-primary" id="buy-product">${esc(T('product.buyNow'))} <span>→</span></button>
    </div>`;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  document.getElementById('buy-product').onclick = () => openCheckout(p);
}

function closeModal() {
  currentOpenProduct = null;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  stopWatch();
  stopCountdown();
}

function openCheckout(p) {
  stopWatch();
  stopCountdown();
  modalContent.innerHTML = `<div class="checkout-head">
      <button class="back-button" id="back-product">← ${esc(T('cart.back'))}</button>
      <p class="eyebrow">${esc(T('cart.secureTitle'))}</p>
      <h2 id="modal-title">${esc(T('cart.buyTitle'))} ${esc(p.name)}</h2>
      <p class="checkout-note">${esc(T('cart.note'))}</p>
    </div>
    <form id="checkout-form" class="checkout-form">
      <label>${esc(T('cart.name'))}<input name="customerName" required maxlength="100" placeholder="${esc(T('cart.namePlaceholder'))}" autocomplete="name"></label>
      <label>${esc(T('cart.email'))}<input name="email" type="email" required placeholder="${esc(T('cart.emailPlaceholder'))}" autocomplete="email"></label>
      ${geoNote()}
      <fieldset><legend>${esc(T('cart.methodLabel'))}</legend>${renderPaymentOptions()}</fieldset>
      ${expiryNote()}
      <p class="safety-note">${esc(T('cart.safety'))}</p>
      <button class="button button-primary button-wide" type="submit">${esc(T('cart.continue'))} <span>→</span></button>
      <label class="policy-check"><input type="checkbox" name="acceptPolicy" required><span>${esc(T('cart.agree'))} <a href="/terms" target="_blank" rel="noopener">${esc(T('nav.terms'))}</a> · <a href="/privacy" target="_blank" rel="noopener">${esc(T('nav.privacy'))}</a> · <a href="/refund" target="_blank" rel="noopener">${esc(T('nav.refund'))}</a>.</span></label>
      <p class="legal-copy">${esc(T('cart.lostCode'))} <a href="/lookup">${esc(T('nav.lookup'))}</a></p>
    </form>`;
  document.getElementById('back-product').onclick = () => openProduct(p.id);
  document.getElementById('checkout-form').onsubmit = (e) => submitCheckout(e, p);
}

async function submitCheckout(event, p) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type=submit]');
  const data = Object.fromEntries(new FormData(form));
  checkoutKey = checkoutKey || window.crypto?.randomUUID?.() || `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  button.disabled = true;
  button.textContent = T('cart.paying');
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, productId: p.id, idempotencyKey: checkoutKey }),
    });
    // A network drop after the server already created the order leaves the
    // buyer with an error and an order they have never been told about. The
    // order mail carries both the id and the deadline, so say where to look.
    if (!res.ok && !res.status) throw Error(T('cart.errNetwork'));
    const json = await res.json();
    if (!res.ok) throw Error(I18N.apiError(json, 'cart.errCreate'));
    sessionStorage.setItem(window.OrderClient.storageKey, JSON.stringify({ id: json.order.id, token: json.accessToken }));
    checkoutKey = null;
    if (json.approvalUrl) {
      location.href = json.approvalUrl;
      return;
    }
    showOrder(json.order, json.accessToken, json.payment, json);
  } catch (error) {
    toastMsg(error.message, true);
    button.disabled = false;
    button.innerHTML = `${esc(T('cart.continue'))} <span>→</span>`;
  }
}

const channelCard = (c, first) => `<section class="pay-channel${first ? ' is-active' : ''}" data-channel="${esc(c.id)}">
  <header class="pay-channel-head"><b>${esc(c.label)}</b><span>${esc(c.hintKey ? T(c.hintKey) : '')}</span></header>
  ${c.qrUrl ? `<img class="payment-qr" src="${esc(c.qrUrl)}" alt="${esc(c.label)}" width="240" height="240" loading="lazy" referrerpolicy="no-referrer">` : ''}
  ${c.qrImage ? `<img class="payment-qr" src="${esc(c.qrImage)}" alt="${esc(c.label)}" loading="lazy" referrerpolicy="no-referrer">` : ''}
  ${c.qrHintKey ? `<small class="pay-warn">${esc(T(c.qrHintKey))}</small>` : ''}
  <span class="pay-account">${esc(T('pay.accountLabel'))}: <b>${esc(c.account)}</b></span>
  <span class="payment-amount">${esc(T('pay.amountLabel'))}: <b>${money(c.amount, c.currency)}</b></span>
  <div class="payment-note"><small>${esc(T('pay.transferNote'))}</small><code>${esc(c.transferNote)}</code></div>
</section>`;

// One countdown implementation, in i18n.js. The formatting, the zero padding and
// the clock-skew correction were each written out twice — once here and once in
// order.js — and two copies of a clock is two chances to tell a buyer two
// different amounts of time to pay on two screens.
const clock = () => window.I18N.clock(deadlineState.expiresAt, deadlineState.serverTime);
const remainingMs = () => clock().remaining;
// The deadline and the server's own clock, in the shape the shared orderHint
// expects. One object rather than three loose arguments, because the hint is
// asked for it as one thing.
const deadlineOptions = () => ({ expiresAt: deadlineState.expiresAt, serverTime: deadlineState.serverTime, support: window.I18N.t('brand.supportEmail') });
// An order is closed once its file has been handed over and no payment is
// expected. Delivering deliberately resets the status to pending so a second
// download is possible, so this cannot be read off `status` alone — the order page
// used to carry its own copy of this and the two were free to drift.
const closedOrder = (order) => window.OrderClient.isClosed(order);

function countdownText() {
  return clock().text();
}

function tickCountdown() {
  const node = document.getElementById('order-countdown');
  if (!node) return stopCountdown();
  const left = remainingMs();
  node.textContent = countdownText();
  node.classList.toggle('is-over', left !== null && left <= 0);
  if (left !== null && left <= 0) {
    // The countdown reaching zero locally is not proof the server cancelled
    // anything, so ask before the buyer is told it did.
    stopCountdown();
    if (lastOrder && lastToken && !closedOrder(lastOrder)) checkOrder(lastOrder.id, lastToken, true);
  }
}

function startCountdown() {
  stopCountdown();
  if (!deadlineState.expiresAt) return;
  countdownTimer = setTimeout(function step() {
    if (document.hidden) return void (countdownTimer = setTimeout(step, 1000));
    tickCountdown();
    if (countdownTimer) countdownTimer = setTimeout(step, 1000);
  }, 1000);
}

const stopCountdown = () => { if (countdownTimer) clearTimeout(countdownTimer); countdownTimer = null; };

// Nothing on this site can push a status change into an open tab, so an unpaid
// order watches itself. A ten second cadence is fine for a bank transfer and
// cheap enough to survive; every network change triggers an immediate recheck
// so a dropped connection costs the buyer a second rather than a support ticket.
function scheduleWatch(delay = 10000) {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = null;
  if (!lastOrder || !lastToken || lastOrder.status === 'paid' || closedOrder(lastOrder)) return;
  watchTimer = setTimeout(() => {
    watchTimer = null;
    if (document.hidden || navigator.onLine === false) return void scheduleWatch(10000);
    checkOrder(lastOrder.id, lastToken, true).finally(() => scheduleWatch(10000));
  }, delay);
}

const stopWatch = () => { if (watchTimer) clearTimeout(watchTimer); watchTimer = null; };

function showOrder(order, token, payment, meta) {
  lastOrder = order;
  lastToken = token;
  if (meta && meta.serverTime) deadlineState.offset = new Date(meta.serverTime).getTime() - Date.now();
  deadlineState.serverTime = (meta && meta.serverTime) || null;
  const expiresAt = (meta && meta.expiresAt) || order.expiresAt || null;
  deadlineState.expiresAt = expiresAt && order.status !== 'paid' && !closedOrder(order) ? expiresAt : null;
  const channels = (payment && payment.channels) || [];
  const tabs = channels.length > 1
    ? `<div class="pay-tabs">${channels.map((c, i) => `<button class="pay-tab${i === 0 ? ' is-active' : ''}" data-tab="${esc(c.id)}">${esc(c.label)}</button>`).join('')}</div>`
    : '';
  const box = payment
    ? `<div class="bank-box payment-box">${channels.map((c, i) => channelCard(c, i === 0)).join('')}${payment.paypalEmail ? `<div class="payment-alt"><span>PayPal: <b>${esc(payment.paypalEmail)}</b></span></div>` : ''}</div>`
    : '';
  const paid = order.status === 'paid';
  const closed = closedOrder(order);
  const countdown = deadlineState.expiresAt ? `<p class="order-deadline" id="order-countdown">${esc(countdownText())}</p>` : '';

  modalContent.innerHTML = `<div class="success-state">
    <div class="success-mark">${paid || closed ? '✓' : '⏳'}</div>
    <p class="eyebrow">${esc(T('order.created'))}</p>
    <h2 id="modal-title">${esc(paid ? T('order.paid') : closed ? T('order.completed') : T('order.thanksShort'))}</h2>
    <p>${esc(T('order.recorded'))} <b>${esc(order.id)}</b></p>
    <div class="token-box">
      <small>${esc(T('order.code'))}</small>
      <code>${esc(token)}</code>
      <button id="copy-token" class="text-link">${esc(T('order.copy'))} ↗</button>
      <p class="token-note">${esc(T('order.keepCode'))}</p>
      <a class="token-link" href="/lookup?order=${encodeURIComponent(order.id)}">${esc(T('order.openLookup'))} ↗</a>
    </div>
    ${tabs}${box}
    ${countdown}
    <p class="order-hint">${esc(window.I18N.orderHint(order, deadlineOptions()))}</p>
    <button id="download-order" class="button button-primary button-wide"${paid ? '' : ' disabled'}>${esc(T('order.download'))} <span>↓</span></button>
    <button id="check-order" class="button button-secondary button-wide">${esc(T('order.check'))} <span>↻</span></button>
  </div>`;

  document.querySelectorAll('.pay-tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.pay-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      document.querySelectorAll('.pay-channel').forEach((s) => s.classList.toggle('is-active', s.dataset.channel === tab.dataset.tab));
    };
  });
  // navigator.clipboard does not exist outside a secure context, and the optional
  // chain turned that into a silent no-op: the await resolved, the toast said
  // "copied", and nothing had been copied. A buyer who then read the code back
  // from somewhere else, typed it wrong and could not recover their download,
  // would have no way to know the button lied. So the success is only reported when
  // something was actually written, and the failure points at the code itself —
  // which is on screen, in a <code> element, precisely so it can be read by hand.
  document.getElementById('copy-token').onclick = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(token);
      toastMsg(T('order.copied'));
    } catch {
      toastMsg(T('order.copyFailed'), true);
    }
  };
  document.getElementById('check-order').onclick = () => checkOrder(order.id, token);
  // Always rendered and only ever disabled, so the buyer can see exactly what
  // unlocks the moment the payment lands. The server refuses a download either
  // way; this is the honest part of the interface.
  const dl = document.getElementById('download-order');
  dl.disabled = !paid;
  dl.onclick = () => { if (!dl.disabled) downloadOrder(order.id, token); };
  startCountdown();
  scheduleWatch();
}

// Silent when the caller is the background watcher: a failed poll on a phone in
// a lift must not turn into a stack of toasts, but a person who pressed the
// button deserves to know why nothing happened.
async function checkOrder(id, token, quiet = false) {
  const button = document.getElementById('check-order');
  if (button) button.disabled = true;
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, { headers: { 'x-order-token': token } });
    if (!res.ok && !res.status) throw Error(T('order.errOffline'));
    const data = await res.json();
    if (!res.ok) throw Error(I18N.apiError(data, 'order.errStatus'));
    const wasPaid = lastOrder && lastOrder.status === 'paid';
    lastOrder = data.order;
    // Tell the buyer the moment the button unlocks, rather than making them
    // wonder whether the payment went through.
    if (!wasPaid && data.order.status === 'paid' && !quiet) toastMsg(T('order.justPaid'));
    showOrder(data.order, token, null, data);
  } catch (error) {
    if (!quiet) toastMsg(error.message, true);
  } finally {
    const b = document.getElementById('check-order');
    if (b) b.disabled = false;
  }
}

async function downloadOrder(id, token) {
  const button = document.getElementById('download-order');
  if (button) button.disabled = true;
  // The two steps — send the browser to the file, then tell the server the file
  // was handed over — are shared with the order page and the PayPal return, in
  // order-client.js. They are not separable: doing only the first leaves an order
  // that can never be downloaded again, and doing only the second hands nothing
  // over.
  const result = await window.OrderClient.download(id, token);
  if (!result.ok) toastMsg(result.offline ? T('order.errOffline') : I18N.apiError(result, 'order.errDownload'), true);
  const b = document.getElementById('download-order');
  if (b) b.disabled = lastOrder ? lastOrder.status !== 'paid' : false;
}

async function loadPayOptions() {
  try {
    const res = await fetch('/api/checkout/options');
    payOptions = (await res.json()).options || null;
  } catch (_) {
    payOptions = null;
  }
}

document.querySelectorAll('.filter').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    render();
  };
});

// Typing re-filters on every keystroke. The catalogue is already in memory, so
// there is nothing to wait for and nothing to debounce — a request would only add a
// way for the list to arrive out of order with the letters being typed.
//
// Esc clears it, which is the shortcut people already expect from a search field
// and which costs one line. A result that follows the cursor into a hidden state
// is not obvious otherwise: the box still reads what was typed.
if (searchInput) {
  searchInput.addEventListener('input', () => { searchTerm = foldDiacritics(searchInput.value); render(); });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !searchInput.value) return;
    e.preventDefault();
    searchInput.value = '';
    searchTerm = '';
    render();
  });
}
modal.addEventListener('click', (e) => { if (e.target === modal || e.target.hasAttribute('data-close')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

// Repaint in place when the language flips so an open modal follows along.
window.addEventListener('i18n:ready', () => { render(); });
window.I18N.onChange(() => {
  if (lastOrder && lastToken) showOrder(lastOrder, lastToken, null, { serverTime: new Date(Date.now() + deadlineState.offset).toISOString(), expiresAt: deadlineState.expiresAt });
  else if (!modal.hidden && lastOrder) showOrder(lastOrder, lastToken, null);
  else if (!modal.hidden && currentOpenProduct) openProduct(currentOpenProduct);
  else render();
});
// A connection that comes back should immediately re-check whatever order is
// open, instead of leaving the buyer on a stale screen until the next poll.
window.addEventListener('online', () => { if (lastOrder && lastToken) checkOrder(lastOrder.id, lastToken, true); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && lastOrder && lastToken) checkOrder(lastOrder.id, lastToken, true); });

loadProducts().then(() => {
  // A product page links here as /?buy=<id> so the buyer lands with the checkout
  // already open. The product page itself carries no checkout code, which is
  // what keeps a single implementation of the flow instead of two that drift.
  const query = new URLSearchParams(location.search);
  const wanted = query.get('buy');
  // PayPal sends a buyer who backed out to /?paypal=cancelled. Nothing used to
  // read it, so the one moment a worried buyer needs an answer was the one moment
  // the page said nothing at all. It matters twice: they need to know they have
  // not been charged, and an order left pending expires on its own.
  if (query.get('paypal') === 'cancelled') {
    toastMsg(`${T('paypal.cancelled')}. ${T('paypal.cancelledHint')}`);
  }
  if (wanted) {
    openProduct(wanted);
  }
  if (query.get('buy') || query.get('paypal')) history.replaceState(null, '', location.pathname + location.hash);
});
loadPayOptions();
