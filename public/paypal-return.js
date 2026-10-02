const state = window.OrderClient.read();
const title=document.getElementById('title'),message=document.getElementById('message'),actions=document.getElementById('actions'),loader=document.getElementById('loader'),eyebrow=document.getElementById('eyebrow');
// PayPal buyers are the overseas half of the shop, so this page follows the same
// dictionary as the storefront instead of carrying its own fixed copy.
const T=key=>window.I18N.t(key);
// Injected into the page from SUPPORT_EMAIL on the server, so the address here
// cannot drift from the one the emails go to. The dictionary holds the
// configured default for the case where the page was served without it.
const SUPPORT=()=>document.body?.dataset?.support||window.I18N.t('brand.supportEmail');
function goHome(){location.href='/'}
function showMissing(){eyebrow.textContent=T('paypal.eyebrow');title.textContent=T('order.notFound');message.textContent=T('paypal.noSession');loader.hidden=true;actions.innerHTML=`<a class="button button-primary" href="/lookup">${T('nav.lookup')}</a>`}
function link(token){const dl=document.createElement('button');dl.className='button button-primary';dl.id='download';dl.textContent=T('order.download')+' ↓';dl.onclick=async()=>{const result=await window.OrderClient.download(state.id,token);if(!result.ok)message.textContent=result.offline?T('order.errOffline'):T('order.errDownload')};return dl}
function showPaid(){eyebrow.textContent=T('paypal.success');title.textContent=T('paypal.success');message.textContent=T('paypal.successHint');actions.innerHTML='';actions.appendChild(link(state.token));const back=document.createElement('a');back.className='button button-secondary';back.href='/';back.textContent=T('paypal.back');actions.appendChild(back);loader.hidden=true}
function showRetry(text){eyebrow.textContent=T('paypal.pending');title.textContent=T('paypal.pending');message.textContent=text;actions.innerHTML='';const retry=document.createElement('button');retry.className='button button-primary';retry.textContent=T('order.check')+' ↻';retry.onclick=()=>{retry.disabled=true;start()};const order=document.createElement('a');order.className='button button-secondary';order.href='/order/'+encodeURIComponent(state.id);order.textContent=T('paypal.myOrders');actions.appendChild(retry);actions.appendChild(order)}
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
// The webhook may have already marked the order paid while this tab had no
// connection, so a failed capture is never proof the money did not arrive.
async function alreadyPaid(){
  try{const response=await fetch('/api/orders/'+encodeURIComponent(state.id),{headers:{'x-order-token':state.token}});if(!response.ok)return false;const data=await response.json();return data.order?.status==='paid'}catch(error){return false}
}
async function start(){
  if(!state)return showMissing();
  showRetry(T('paypal.pending'));
  // A dropped connection is the common case here, and a single attempt turned it
  // into "payment failed" for a buyer who had already been charged. Retry with
  // backoff, then fall back to asking our own server whether the order cleared.
  for(const delay of [0,1200,2500,5000,9000]){
    if(delay)await wait(delay);
    if(navigator.onLine===false)continue;
    try{
      const response=await fetch('/api/paypal/capture',{method:'POST',headers:{'content-type':'application/json','x-order-token':state.token},body:JSON.stringify({id:state.id})});
      const data=await response.json();
      if(response.ok&&data.order?.status==='paid')return showPaid();
      if(response.status===409)break;
      if(response.status===404)return showMissing();
    }catch(error){
      // Offline or the tab was suspended: keep waiting rather than guessing.
    }
  }
  for(let attempt=0;attempt<8;attempt++){
    if(await alreadyPaid())return showPaid();
    await wait(5000);
  }
  if(await alreadyPaid())return showPaid();
  eyebrow.textContent=T('paypal.err');
  title.textContent=T('paypal.err');
  // The order id and the support address are the only two things that let a
  // buyer who was actually charged get their money or their file, so they stay
  // in the sentence even though the sentence now comes from the dictionary.
  message.textContent=T('paypal.errHint',{id:state.id,support:SUPPORT()});
  actions.innerHTML='';
  const retry=document.createElement('button');retry.className='button button-primary';retry.textContent=T('order.check')+' ↻';retry.onclick=()=>{retry.disabled=true;start()};
  const order=document.createElement('a');order.className='button button-secondary';order.href='/order/'+encodeURIComponent(state.id);order.textContent=T('paypal.myOrders');
  const home=document.createElement('a');home.className='button button-secondary';home.href='/';home.textContent=T('paypal.back');
  actions.appendChild(retry);actions.appendChild(order);actions.appendChild(home);
  loader.hidden=true;
}
start();
