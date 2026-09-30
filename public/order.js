const title=document.getElementById('order-title'),lead=document.getElementById('order-lead'),body=document.getElementById('order-body');
// One dictionary, one set of formatters. This page used to define its own
// escape helper, its own money format and its own status words, all of which
// already existed in i18n.js — and the status words had drifted, so the same
// order read differently here than in the checkout popup.
const T=(key,vars)=>window.I18N.t(key,undefined,vars);
const esc=v=>window.I18N.esc(v);
const money=(v,c)=>window.I18N.money(v,c);
const statusLabel=o=>window.I18N.status(o.status);
const SUPPORT='hello@sonvudev.com';
const state=JSON.parse(sessionStorage.getItem('sonvudev_order')||'null');
function missing(){title.textContent=T('order.noSession.title');lead.textContent=T('order.noSession.hint');body.innerHTML='<a class="button button-primary" href="/lookup">'+esc(T('order.noSession.cta'))+' <span>→</span></a>'}
// A dead device leaves no session, so the order id has to be the one thing the
// buyer can still act on. It is a link, not plain text: recovery should be one
// tap away, not something to retype from a screenshot.
function recoveryBar(id){return `<div class="order-recover"><p>${esc(T('order.recover.hint',{id}))}</p><a class="button button-secondary button-wide" href="/lookup?order=${encodeURIComponent(id)}">${esc(T('order.recover.cta'))} <span>→</span></a></div>`}

// The countdown is measured against the server's clock, not this device's, so a
// phone with a wrong time cannot show a buyer more time than they actually have.
let deadline=null,clockOffset=0,activeOrder=null,watchTimer=null,countdownTimer=null;
const remaining=()=>deadline?new Date(deadline).getTime()-(Date.now()+clockOffset):null;
const pad=n=>String(n).padStart(2,'0');
const formatLeft=ms=>{const t=Math.max(0,Math.floor(ms/1000)),h=Math.floor(t/3600),m=Math.floor((t%3600)/60);return h>0?`${h}:${pad(m)}:${pad(t%60)}`:`${pad(m)}:${pad(t%60)}`};
const closed=o=>Boolean(o&&o.deliveredAt)&&o.status!=='paid';
function countdownText(){const left=remaining();if(left===null)return'';return left<=0?T('order.deadlineOver'):T('order.expiresIn',{time:formatLeft(left)})}

function stopTimers(){if(watchTimer)clearTimeout(watchTimer);if(countdownTimer)clearTimeout(countdownTimer);watchTimer=null;countdownTimer=null}
function tickCountdown(){
  const node=document.getElementById('order-countdown');
  if(!node)return void(countdownTimer=null);
  const left=remaining();
  node.textContent=countdownText();
  node.classList.toggle('is-over',left!==null&&left<=0);
  // Running out locally is not proof the server cancelled anything, so ask it.
  if(left!==null&&left<=0){countdownTimer=null;return void render()}
  countdownTimer=setTimeout(tickCountdown,1000);
}
// A bank transfer can sit unpaid for hours and the browser is the only place
// that can notice the moment it clears, so an open order keeps asking. Pausing
// on a hidden tab and on a lost connection keeps that cheap and quiet.
function scheduleWatch(delay=10000){
  if(watchTimer)clearTimeout(watchTimer);
  watchTimer=null;
  if(!activeOrder||!state||activeOrder.status==='paid'||closed(activeOrder))return;
  watchTimer=setTimeout(()=>{
    watchTimer=null;
    if(document.hidden||navigator.onLine===false)return void scheduleWatch(10000);
    render().finally(()=>scheduleWatch(10000));
  },delay);
}
// What the buyer is told depends on *when* things broke, not just on the status.
// The same "pending" state means completely different things depending on
// whether PayPal has seen an approval, and telling a buyer who just watched
// money leave their account that nothing happened is the one answer that turns a
// glitch into a chargeback.
function hintFor(o){
  if(o.status==='refunded')return T('order.hint.refunded',{reason:o.refundReason||T('order.hint.refundUnknown'),support:SUPPORT});
  if(o.status==='paid')return T('order.hint.paid');
  if(closed(o))return T('order.hint.delivered');
  if(o.status==='cancelled'){
    if(o.paidProviderAmount||o.paidCount)return T('order.hint.expiredPaid');
    // Only PayPal can prove money did not move. For a bank transfer we simply do
    // not know, and telling a buyer who did pay that they were not charged is
    // the single worst thing this page can say.
    if(o.paymentProvider==='paypal')return T('order.hint.expiredPaypal');
    return T('order.hint.expiredBank');
  }
  if(o.status==='payment_failed')return T('order.hint.paymentFailed');
  const left=remaining();
  if(left!==null&&left<=0)return T('order.hint.deadlinePassed');
  if(o.status==='pending_transfer')return T('order.hint.pendingTransfer');
  if(o.paymentProvider==='paypal'&&o.providerOrderId)return T('order.hint.paypalUnconfirmed');
  return T('order.hint.processing');
}
let captureTries=0;
async function resumePayPalCapture(){
  // One attempt per page load. Re-rendering calls back into here, and a server
  // that somehow keeps answering "still pending" would otherwise turn this into
  // a capture request loop.
  if(captureTries>=1)return false;
  captureTries+=1;
  try{
    const response=await fetch('/api/paypal/capture',{method:'POST',headers:{'content-type':'application/json','x-order-token':state.token},body:JSON.stringify({id:state.id})});
    const data=await response.json();
    if(response.ok&&data.order?.status==='paid'){await render();return true}
  }catch(error){
    // Offline: the scheduled poll picks it up once the connection is back.
  }
  return false;
}
async function render(){
  if(!state||!state.token) return missing();
  stopTimers();
  let response;
  try{
    response=await fetch('/api/orders/'+encodeURIComponent(state.id),{headers:{'x-order-token':state.token}});
  }catch(error){
    // Offline. The order is still on the server, so keep the last known state
    // and say plainly that the page is waiting for the connection to return.
    body.insertAdjacentHTML('afterbegin','<p class="order-offline">'+esc(T('order.errOffline'))+'</p>');
    return scheduleWatch(5000);
  }
  if(!response.ok&&!response.status) return scheduleWatch(5000);
  const data=await response.json();
  if(!response.ok){
    sessionStorage.removeItem('sonvudev_order');
    return missing();
  }
  if(data.serverTime) clockOffset=new Date(data.serverTime).getTime()-Date.now();
  const order=data.order,item=order.items?.[0]||{};
  activeOrder=order;
  deadline=(data.expiresAt||order.expiresAt)&&order.status!=='paid'&&!closed(order)?(data.expiresAt||order.expiresAt):null;
  // A phone that dies after approving but before the capture finishes leaves the
  // money taken and the order unpaid. capture is safe to re-ask for: it only
  // succeeds if PayPal already has an approval, and an already-captured order is
  // reconciled rather than charged twice. A successful capture re-renders, so the
  // caller must stop here or this stale pending view would repaint over it.
  if(order.paymentProvider==='paypal'&&order.status!=='paid'&&order.status!=='refunded'&&!closed(order)&&order.providerOrderId&&await resumePayPalCapture()) return;
  title.textContent=T('order.title',{id:order.id});
  const paid=order.status==='paid',done=closed(order);
  lead.textContent=done?T('order.completed'):statusLabel(order);
  const channel=(c)=>{const label=esc(c.label),qr=c.qrUrl||c.qrImage,alt=esc(T('order.channel.qr',{label:c.label}));return `<div class="order-channel"><b>${label}</b><span>${esc(T('order.channel.account'))}: <b>${esc(c.account)}</b></span><span>${esc(T('order.channel.amount'))}: <b>${money(c.amount,c.currency)}</b></span><span class="order-note">${esc(T('order.channel.note'))}: <code>${esc(c.transferNote)}</code></span>${qr?`<img class="order-qr" src="${esc(qr)}" alt="${alt}" width="220" height="220" referrerpolicy="no-referrer">`:''}</div>`};
  const channels=(data.payment?.channels||[]).map(channel).join('');
  const left=remaining();
  body.innerHTML=`
<div class="order-card">
<div class="order-row"><span>${esc(T('order.row.product'))}</span><b>${esc(item.name||'')} v${esc(item.version||'')}</b></div>
<div class="order-row"><span>${esc(T('order.row.amount'))}</span><b>${money(order.amount,order.currency)}</b></div>
<div class="order-row"><span>${esc(T('order.row.status'))}</span><b class="status-pill status-${esc(order.status)}">${esc(statusLabel(order))}</b></div>
<div class="order-row"><span>${esc(T('order.row.created'))}</span><b>${esc(window.I18N.date(order.createdAt||order.created_at))}</b></div>
</div>
${paid?`<p class="order-hint">${esc(hintFor(order))}</p><button class="button button-primary button-wide" id="order-download">${esc(T('order.download'))} <span>↓</span></button>`:`
<p class="order-hint">${esc(hintFor(order))}</p>
${deadline?`<p class="order-deadline${left!==null&&left<=0?' is-over':''}" id="order-countdown">${esc(countdownText())}</p>`:''}
${order.status==='cancelled'?'':`${channels}`}
<button class="button button-primary button-wide" id="order-download" disabled>${esc(T('order.unlock'))} <span>↓</span></button>
<button class="button button-secondary button-wide" id="order-refresh">${esc(T('order.refresh'))} <span>↻</span></button>`}
<p class="order-help">${esc(T('order.help.need'))} <a href="mailto:${SUPPORT}">${SUPPORT}</a> hoặc xem <a href="/refund">${esc(T('order.help.refundPolicy'))}</a>.</p>
${recoveryBar(order.id)}`;
  document.getElementById('order-download')?.addEventListener('click',async()=>{
    const button=document.getElementById('order-download');
    if(button.disabled)return;
    button.disabled=true;
    try{
      const result=await fetch('/api/orders/'+encodeURIComponent(order.id)+'/download',{headers:{'x-order-token':state.token}});
      const payload=await result.json();
      if(result.ok){
        // The server cannot see the file arrive in the browser, so this click is
        // what closes the order. Best effort: never block the transfer on it.
        location.href=payload.url;
        fetch('/api/orders/'+encodeURIComponent(order.id)+'/delivered',{method:'POST',headers:{'x-order-token':state.token,'content-type':'application/json'}}).then(()=>render()).catch(()=>{});
      }else{
        lead.textContent=payload.error||T('order.errDownload');
        button.disabled=false;
      }
    }catch(error){
      lead.textContent=T('order.errDownloadOffline');
      button.disabled=false;
    }
  });
  document.getElementById('order-refresh')?.addEventListener('click',()=>render());
  if(deadline) countdownTimer=setTimeout(tickCountdown,1000);
  scheduleWatch();
}
// The buyer can switch language on this page, and the order is repainted from
  // the dictionary rather than translated in place, so nothing is left behind
  // half in one language.
window.I18N.onChange(()=>render());
window.addEventListener('online',()=>{if(state)render()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state)render()});
render();
