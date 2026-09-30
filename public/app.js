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
// One key per checkout attempt, so a retry after a dropped connection returns
// the order that already exists instead of opening a second one for one
// purchase. Cleared once an order is safely in hand.
let checkoutKey = null;
// The deadline is counted against the server's clock, not the device's.
let deadlineState = { expiresAt: null, offset: 0 };
let countdownTimer = null;
let watchTimer = null;

const T = (key, fallback) => window.I18N.t(key, fallback);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
const initials = (n) => String(n || 'SV').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
const money = (v, c = 'VND') => new Intl.NumberFormat(
  window.I18N.lang === 'en' ? 'en-US' : 'vi-VN',
  c === 'USD' ? { style: 'currency', currency: c } : { maximumFractionDigits: 0 },
).format(Number(v || 0));

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
function paymentList() {
  return payOptions && payOptions.length ? payOptions : [
    { id: 'bank_transfer', label: T('pay.bank'), hint: T('pay.bankHint') },
    { id: 'paypal', label: 'PayPal', hint: T('pay.paypalHint') },
  ];
}

function renderPaymentOptions() {
  return paymentList().map((o, i) => `<label class="payment-option">
    <input type="radio" name="paymentMethod" value="${esc(o.id)}"${i === 0 ? ' checked' : ''}>
    <span><b>${esc(o.label)}</b><small>${esc(o.hint || '')}</small></span>
    <em>${o.id === 'paypal' ? '◉' : '◎'}</em>
  </label>`).join('');
}

function geoNote() {
  const d = payOptions;
  if (!d || !d.country) return '';
  const outside = d.country !== 'VN';
  const text = outside
    ? T('geo.outside').replace('{country}', d.country)
    : T('geo.domestic');
  return `<p class="geo-note">${esc(text)}</p>`;
}

// The form has to state the deadline before the buyer commits, not after: the
// whole point of cancelling a stale order is that the buyer was told it would
// happen. The number comes from the same env var the sweep enforces.
function expiryNote() {
  const hours = Number(payOptions && payOptions.paymentWindowHours) || 24;
  return `<p class="expiry-note">${esc(T('cart.expiry').replace('{hours}', String(hours)))}</p>`;
}

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    if (!res.ok) throw Error(data.error || T('products.loadError'));
    products = data.products || [];
    render();
  } catch (error) {
    grid.innerHTML = `<div class="empty-state"><b>${esc(T('products.loadError'))}</b><p>${esc(error.message)}</p></div>`;
    count.textContent = T('products.loadErrorText');
  }
}

function visibleProducts() {
  return products.filter((p) => activeFilter === 'all' || p.category === activeFilter || p.platform === activeFilter);
}

// Products carry an optional English copy. When the visitor switches to English
// we prefer those fields but always fall back to the Vietnamese text, so a
// product that has not been translated yet never shows an empty description.
function localized(p) {
  if (window.I18N.lang !== 'en') return p;
  const hasEn = typeof p.descriptionEn === 'string' && p.descriptionEn.trim();
  if (!hasEn) return p;
  return {
    ...p,
    shortDescription: p.shortDescriptionEn || p.shortDescription,
    description: p.descriptionEn,
    features: (p.featuresEn && p.featuresEn.length ? p.featuresEn : p.features) || [],
  };
}

function render() {
  const list = visibleProducts();
  count.textContent = `${list.length.toString().padStart(2, '0')} ${T('products.count')}`;
  grid.innerHTML = list.length
    ? list.map((p) => card(localized(p))).join('')
    : `<div class="empty-state"><b>${esc(T('products.emptyTitle'))}</b><p>${esc(T('products.emptyText'))}</p></div>`;
  grid.querySelectorAll('.product-card').forEach((c) => { c.onclick = () => openProduct(c.dataset.id); });
}

function card(p) {
  const art = esc(p.category.toLowerCase().replace(/\s+/g, '-'));
  return `<article class="product-card" data-id="${esc(p.id)}">
    <div class="product-art art-${art}">
      <span class="product-badge">${esc(p.badge || T('products.new'))}</span>
      <div class="product-logo">${initials(p.name)}</div>
      <div class="art-grid"></div>
      <span class="art-spark">✦</span>
    </div>
    <div class="product-info">
      <div class="product-meta"><span>${esc(p.platform)} · v${esc(p.version)}</span><span>${esc(p.category)}</span></div>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.shortDescription || p.description || '')}</p>
      <ul>${(p.features || []).slice(0, 2).map((f) => `<li>✓ ${esc(f)}</li>`).join('')}</ul>
      <div class="product-buy">
        <strong>${money(p.price, p.currency)}</strong>
        <button class="round-arrow" aria-label="${esc(T('products.buyAria'))} ${esc(p.name)}">↗</button>
      </div>
    </div>
  </article>`;
}

function openProduct(id) {
  const raw = products.find((x) => x.id === id);
  if (!raw) return;
  // Leaving the order view behind, so its background polling cannot repaint the
  // modal with an order nobody is looking at any more.
  stopWatch();
  stopCountdown();
  const p = localized(raw);
  modalContent.innerHTML = `<div class="detail-art">
      <div class="product-logo large">${initials(p.name)}</div>
      <span>${esc(p.badge || 'SonVuDev')}</span>
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
      <div><small>${esc(T('product.priceOnce'))}</small><strong>${money(p.price, p.currency)}</strong></div>
      <button class="button button-primary" id="buy-product">${esc(T('product.buyNow'))} <span>→</span></button>
    </div>`;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  document.getElementById('buy-product').onclick = () => openCheckout(p);
}

function closeModal() {
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
      <label>${esc(T('cart.name'))}<input name="customerName" required maxlength="100" placeholder="Nguyen Van A" autocomplete="name"></label>
      <label>${esc(T('cart.email'))}<input name="email" type="email" required placeholder="ban@example.com" autocomplete="email"></label>
      ${geoNote()}
      <fieldset><legend>${esc(T('cart.methodLabel'))}</legend>${renderPaymentOptions()}</fieldset>
      ${expiryNote()}
      <p class="safety-note">${esc(T('cart.safety'))}</p>
      <button class="button button-primary button-wide" type="submit">${esc(T('cart.continue'))} <span>→</span></button>
      <p class="legal-copy">${esc(T('cart.agree'))} <a href="/terms" target="_blank" rel="noopener">${esc(T('nav.terms'))}</a> · <a href="/privacy" target="_blank" rel="noopener">${esc(T('nav.privacy'))}</a> · <a href="/refund" target="_blank" rel="noopener">${esc(T('nav.refund'))}</a>.</p>
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
    if (!res.ok) throw Error(json.error || T('cart.errCreate'));
    sessionStorage.setItem('sonvudev_order', JSON.stringify({ id: json.order.id, token: json.accessToken }));
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
  <header class="pay-channel-head"><b>${esc(c.label)}</b><span>${esc(c.hint || '')}</span></header>
  ${c.qrUrl ? `<img class="payment-qr" src="${esc(c.qrUrl)}" alt="${esc(c.label)}" width="240" height="240" loading="lazy" referrerpolicy="no-referrer">` : ''}
  ${c.qrImage ? `<img class="payment-qr" src="${esc(c.qrImage)}" alt="${esc(c.label)}" loading="lazy" referrerpolicy="no-referrer">` : ''}
  ${c.qrHint ? `<small class="pay-warn">${esc(c.qrHint)}</small>` : ''}
  <span class="pay-account">${esc(T('pay.accountLabel'))}: <b>${esc(c.account)}</b></span>
  <span class="payment-amount">${esc(T('pay.amountLabel'))}: <b>${money(c.amount, c.currency)}</b></span>
  <div class="payment-note"><small>${esc(T('pay.transferNote'))}</small><code>${esc(c.transferNote)}</code></div>
</section>`;

const formatDuration = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(total % 60)}` : `${pad(m)}:${pad(total % 60)}`;
};

const remainingMs = () => (deadlineState.expiresAt ? new Date(deadlineState.expiresAt).getTime() - (Date.now() + deadlineState.offset) : null);
const closedOrder = (order) => Boolean(order && order.deliveredAt) && order.status !== 'paid';

function countdownText() {
  const left = remainingMs();
  if (left === null) return '';
  return left <= 0 ? T('order.deadlineOver') : T('order.expiresIn').replace('{time}', formatDuration(left));
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
    <p class="order-hint">${esc(orderHint(order, paid, closed))}</p>
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
  document.getElementById('copy-token').onclick = async () => {
    await navigator.clipboard?.writeText(token);
    toastMsg(T('order.copied'));
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

function orderHint(order, paid, closed) {
  if (paid) return T('order.paidHint');
  if (closed) return T('order.completedHint');
  if (order.status === 'cancelled') return T('order.cancelledHint');
  const left = remainingMs();
  if (left !== null && left <= 0) return T('order.expiredHint');
  return order.status === 'pending_transfer' ? T('order.transferHint') : T('order.statusHint');
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
    if (!res.ok) throw Error(data.error || T('order.errStatus'));
    const wasPaid = lastOrder && lastOrder.status === 'paid';
    lastOrder = data.order;
    const labels = {
      pending: 'order.pending', pending_transfer: 'order.pending',
      paid: 'order.paid', payment_failed: 'order.failed', cancelled: 'order.cancelled',
    };
    const key = labels[data.order.status] || 'order.pending';
    const note = data.order.status === 'paid' ? T('order.paidHint') : T(key === 'order.pending' ? 'order.pendingHint' : 'order.statusHint');
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
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}/download`, { headers: { 'x-order-token': token } });
    if (!res.ok && !res.status) throw Error(T('order.errOffline'));
    const data = await res.json();
    if (!res.ok) throw Error(data.error || T('order.errDownload'));
    // The server cannot watch a file arrive in someone's browser, so the
    // download click is what closes the order. A failure here must never block
    // the transfer that is already under way.
    location.href = data.url;
    fetch(`/api/orders/${encodeURIComponent(id)}/delivered`, { method: 'POST', headers: { 'x-order-token': token, 'content-type': 'application/json' } }).catch(() => {});
  } catch (error) {
    toastMsg(error.message, true);
  } finally {
    const b = document.getElementById('download-order');
    if (b) b.disabled = lastOrder ? lastOrder.status !== 'paid' : false;
  }
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
modal.addEventListener('click', (e) => { if (e.target === modal || e.target.hasAttribute('data-close')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

// Repaint in place when the language flips so an open modal follows along.
window.addEventListener('i18n:ready', () => { render(); });
window.I18N.onChange(() => {
  if (lastOrder && lastToken) showOrder(lastOrder, lastToken, null, { serverTime: new Date(Date.now() + deadlineState.offset).toISOString(), expiresAt: deadlineState.expiresAt });
  else if (!modal.hidden && lastOrder) showOrder(lastOrder, lastToken, null);
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
