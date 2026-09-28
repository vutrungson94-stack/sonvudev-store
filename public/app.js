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

const T = (key, fallback) => window.I18N.t(key, fallback);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

function render() {
  const list = visibleProducts();
  count.textContent = `${list.length.toString().padStart(2, '0')} ${T('products.count')}`;
  grid.innerHTML = list.length
    ? list.map(card).join('')
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

function openProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  modalContent.innerHTML = `<div class="detail-art">
      <div class="product-logo large">${initials(p.name)}</div>
      <span>${esc(p.badge || 'SonVuDev')}</span>
    </div>
    <div class="detail-copy">
      <p class="eyebrow">${esc(p.platform)} · ${esc(T('product.version'))} ${esc(p.version)}</p>
      <h2 id="modal-title">${esc(p.name)}</h2>
      <p>${esc(p.description || p.shortDescription || '')}</p>
      <ul class="feature-list">${(p.features || []).map((f) => `<li><span>✓</span>${esc(f)}</li>`).join('')}</ul>
      <div class="detail-requirements">
        <b>${esc(T('product.requirements'))}</b>
        <span>${esc(p.requirements || T('product.seeGuide'))}</span>
      </div>
      <div class="detail-footer">
        <div><small>${esc(T('product.priceOnce'))}</small><strong>${money(p.price, p.currency)}</strong></div>
        <button class="button button-primary" id="buy-product">${esc(T('product.buyNow'))} <span>→</span></button>
      </div>
    </div>`;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  document.getElementById('buy-product').onclick = () => openCheckout(p);
}

function closeModal() {
  modal.hidden = true;
  document.body.classList.remove('modal-open');
}

function openCheckout(p) {
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
  button.disabled = true;
  button.textContent = T('cart.paying');
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, productId: p.id }),
    });
    const json = await res.json();
    if (!res.ok) throw Error(json.error || T('cart.errCreate'));
    sessionStorage.setItem('sonvudev_order', JSON.stringify({ id: json.order.id, token: json.accessToken }));
    if (json.approvalUrl) {
      location.href = json.approvalUrl;
      return;
    }
    showOrder(json.order, json.accessToken, json.payment);
  } catch (error) {
    toastMsg(error.message, true);
    button.disabled = false;
    button.innerHTML = `${esc(T('cart.continue'))} <span>→</span>`;
  }
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

function showOrder(order, token, payment) {
  lastOrder = order;
  lastToken = token;
  const channels = (payment && payment.channels) || [];
  const tabs = channels.length > 1
    ? `<div class="pay-tabs">${channels.map((c, i) => `<button class="pay-tab${i === 0 ? ' is-active' : ''}" data-tab="${esc(c.id)}">${esc(c.label)}</button>`).join('')}</div>`
    : '';
  const box = payment
    ? `<div class="bank-box payment-box">${channels.map((c, i) => channelCard(c, i === 0)).join('')}${payment.paypalEmail ? `<div class="payment-alt"><span>PayPal: <b>${esc(payment.paypalEmail)}</b></span></div>` : ''}</div>`
    : '';

  modalContent.innerHTML = `<div class="success-state">
    <div class="success-mark">✓</div>
    <p class="eyebrow">${esc(T('order.created'))}</p>
    <h2 id="modal-title">${esc(T('order.thanksShort'))}</h2>
    <p>${esc(T('order.recorded'))} <b>${esc(order.id)}</b></p>
    <div class="token-box">
      <small>${esc(T('order.code'))}</small>
      <code>${esc(token)}</code>
      <button id="copy-token" class="text-link">${esc(T('order.copy'))} ↗</button>
    </div>
    ${tabs}${box}
    <button id="check-order" class="button button-primary button-wide">${esc(T('order.check'))} <span>→</span></button>
    <button id="download-order" class="button button-secondary button-wide" hidden>${esc(T('order.download'))} <span>↓</span></button>
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
  const dl = document.getElementById('download-order');

async function checkOrder(id, token) {
  const button = document.getElementById('check-order');
  button.disabled = true;
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, { headers: { 'x-order-token': token } });
    const data = await res.json();
    if (!res.ok) throw Error(data.error || T('order.errStatus'));
    lastOrder = data.order;
    const labels = {
      pending: 'order.pending', pending_transfer: 'order.pending',
      paid: 'order.paid', payment_failed: 'order.failed', cancelled: 'order.cancelled',
    };
    const key = labels[data.order.status] || 'order.pending';
    const note = data.order.status === 'paid' ? T('order.paidHint') : T(key === 'order.pending' ? 'order.pendingHint' : 'order.statusHint');
    modalContent.insertAdjacentHTML('afterbegin',
      `<div class="order-status"><b>${esc(T(key))}</b><span>${esc(note)}</span></div>`);
    showOrder(data.order, token, null);
    const dl = document.getElementById('download-order');
    if (dl) dl.hidden = data.order.status !== 'paid';
  } catch (error) {
    toastMsg(error.message, true);
  } finally {
    const b = document.getElementById('check-order');
    if (b) b.disabled = false;
  }
}

async function downloadOrder(id, token) {
  const button = document.getElementById('download-order');
  button.disabled = true;
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}/download`, { headers: { 'x-order-token': token } });
    const data = await res.json();
    if (!res.ok) throw Error(data.error || T('order.errDownload'));
    location.href = data.url;
  } catch (error) {
    toastMsg(error.message, true);
  } finally {
    button.disabled = false;
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
  if (lastOrder && lastToken) showOrder(lastOrder, lastToken, null);
  else if (!modal.hidden && lastOrder) showOrder(lastOrder, lastToken, null);
});

loadProducts();
loadPayOptions();

  dl.hidden = order.status !== 'paid';
  dl.onclick = () => downloadOrder(order.id, token);
}
