const title=document.getElementById('order-title'),lead=document.getElementById('order-lead'),body=document.getElementById('order-body');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(v,c='VND')=>new Intl.NumberFormat('vi-VN',c==='USD'?{style:'currency',currency:c}:{maximumFractionDigits:0}).format(Number(v||0));
const statusLabels={pending:'Đang xử lý',pending_transfer:'Đang chờ chuyển khoản',paid:'Đã thanh toán',payment_failed:'Thất bại',cancelled:'Đã hủy',refunded:'Đã hoàn tiền'};
const state=JSON.parse(sessionStorage.getItem('sonvudev_order')||'null');
function missing(){title.textContent='Chưa tìm thấy phiên đơn hàng';lead.textContent='Vì lý do bảo mật, mã tra cứu chỉ được giữ trong trình duyệt này. Nếu bạn mở trang này ở thiết bị khác, hãy tra cứu lại bằng mã đơn và email.';body.innerHTML='<a class="button button-primary" href="/lookup">Tra cứu đơn hàng <span>→</span></a>'}
// A dead device leaves no session, so the order id has to be the one thing the
// buyer can still act on. It is a link, not plain text: recovery should be one
// tap away, not something to retype from a screenshot.
function recoveryBar(id){return `<div class="order-recover"><p>Mất mạng, đóng máy hoặc chuyển thiết bị? Đơn <b>${esc(id)}</b> vẫn còn. Mở lại bằng mã đơn này và email bạn đã dùng để thanh toán.</p><a class="button button-secondary button-wide" href="/lookup?order=${encodeURIComponent(id)}">Tra cứu đơn hàng <span>→</span></a></div>`}

// The countdown is measured against the server's clock, not this device's, so a
// phone with a wrong time cannot show a buyer more time than they actually have.
let deadline=null,clockOffset=0,current=null,watchTimer=null,countdownTimer=null;
const remaining=()=>deadline?new Date(deadline).getTime()-(Date.now()+clockOffset):null;
const pad=n=>String(n).padStart(2,'0');
const formatLeft=ms=>{const t=Math.max(0,Math.floor(ms/1000)),h=Math.floor(t/3600),m=Math.floor((t%3600)/60);return h>0?`${h}:${pad(m)}:${pad(t%60)}`:`${pad(m)}:${pad(t%60)}`};
const closed=o=>Boolean(o&&o.deliveredAt)&&o.status!=='paid';
function countdownText(){const left=remaining();if(left===null)return'';return left<=0?'Đơn hàng đã hết hạn':`Còn ${formatLeft(left)} để thanh toán`}

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
  if(!current||!state||current.status==='paid'||closed(current))return;
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
  if(o.status==='refunded')return `Chúng tôi đã hoàn lại tiền cho đơn này. Lý do: ${o.refundReason||'không rõ'}. Quyền tải sản phẩm đã được thu hồi. Nếu bạn cho là nhầm lẫn, hãy liên hệ hello@sonvudev.com kèm mã đơn.`;
  if(o.status==='paid')return'Thanh toán đã được xác nhận. Bạn có thể tải sản phẩm ngay. Nếu tải bị gián đoạn, bấm tải lại là được, đơn vẫn còn hiệu lực.';
  if(closed(o))return'Bạn đã tải sản phẩm và đơn đã hoàn tất. Nếu tệp tải về bị hỏng hoặc thiếu, gửi email cho chúng tôi kèm mã đơn, chúng tôi mở lại đơn ngay.';
  if(o.status==='cancelled'){
    if(o.paidProviderAmount||o.paidCount)return'Đơn này đã hết hạn nhưng tiền đã vào tài khoản của chúng tôi, nên đơn đã được mở lại. Nếu bạn vẫn không thấy nút tải, hãy liên hệ kèm mã đơn.';
    // Only PayPal can prove money did not move. For a bank transfer we simply do
    // not know, and telling a buyer who did pay that they were not charged is
    // the single worst thing this page can say.
    if(o.paymentProvider==='paypal')return'Đơn hàng quá thời gian thanh toán nên đã bị hủy, và PayPal không ghi nhận khoản nào nên bạn chưa bị trừ tiền. Bạn có thể đặt đơn mới.';
    return'Đơn hàng quá thời gian nên đã bị hủy. Chúng tôi chưa ghi nhận được khoản chuyển khoản này — nếu bạn đã chuyển, hãy gửi ảnh biên lai kèm mã đơn, chúng tôi sẽ mở lại đơn hoặc hoàn lại. Nếu chưa chuyển, bạn có thể đặt đơn mới.';
  }
  if(o.status==='payment_failed')return'Thanh toán không thành công nên bạn chưa bị trừ tiền. Bạn có thể thử lại, đơn vẫn giữ nguyên.';
  const left=remaining();
  if(left!==null&&left<=0)return'Đơn hàng đã hết thời gian thanh toán và sắp bị hủy. Nếu bạn đã chuyển khoản, hãy liên hệ để chúng tôi đối soát, chúng tôi sẽ mở lại đơn cho bạn.';
  if(o.status==='pending_transfer')return'Bạn đang thanh toán bằng chuyển khoản, nên thao tác nằm trong app ngân hàng chứ không ở trang này. Nếu app ngân hàng bị treo hoặc máy tắt giữa chừng, hãy mở lại app để kiểm tra giao dịch đã thực hiện hay chưa. Đơn này được giữ nguyên, còn thời gian và chúng tôi sẽ báo ngay khi bạn bấm nút bên dưới.';
  if(o.paymentProvider==='paypal'&&o.providerOrderId)return'Nếu bạn đã bấm thanh toán ở PayPal nhưng trang này chưa xác nhận được, đừng thanh toán lại lần nữa. Hãy tải lại trang hoặc bấm nút bên dưới: hệ thống sẽ hỏi lại PayPal và mở nút tải nếu tiền đã vào. Nếu PayPal chưa ghi nhận khoản nào, bạn chưa bị trừ tiền và có thể thanh toán lại bình thường.';
  return'Đơn hàng đang được xử lý. Bạn có thể tải ngay khi trạng thái chuyển sang đã thanh toán, trang này sẽ tự cập nhật.';
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
    body.insertAdjacentHTML('afterbegin','<p class="order-offline">Mất kết nối. Trang sẽ tự kiểm tra lại khi bạn có mạng.</p>');
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
  current=order;
  deadline=(data.expiresAt||order.expiresAt)&&order.status!=='paid'&&!closed(order)?(data.expiresAt||order.expiresAt):null;
  // A phone that dies after approving but before the capture finishes leaves the
  // money taken and the order unpaid. capture is safe to re-ask for: it only
  // succeeds if PayPal already has an approval, and an already-captured order is
  // reconciled rather than charged twice. A successful capture re-renders, so the
  // caller must stop here or this stale pending view would repaint over it.
  if(order.paymentProvider==='paypal'&&order.status!=='paid'&&order.status!=='refunded'&&!closed(order)&&order.providerOrderId&&await resumePayPalCapture()) return;
  title.textContent='Đơn '+order.id;
  const paid=order.status==='paid',done=closed(order);
  lead.textContent=done?'Đã hoàn tất':(statusLabels[order.status]||order.status);
  const channel=(c)=>`<div class="order-channel"><b>${esc(c.label)}</b><span>Số tài khoản: <b>${esc(c.account)}</b></span><span>Số tiền: <b>${money(c.amount,c.currency)}</b></span><span class="order-note">Nội dung: <code>${esc(c.transferNote)}</code></span>${c.qrUrl?`<img class="order-qr" src="${esc(c.qrUrl)}" alt="Mã QR ${esc(c.label)}" width="220" height="220" referrerpolicy="no-referrer">`:''}${c.qrImage?`<img class="order-qr" src="${esc(c.qrImage)}" alt="Mã QR ${esc(c.label)}" width="220" height="220" referrerpolicy="no-referrer">`:''}</div>`;
  const channels=(data.payment?.channels||[]).map(channel).join('');
  const left=remaining();
  body.innerHTML=`
<div class="order-card">
<div class="order-row"><span>Sản phẩm</span><b>${esc(item.name||'')} v${esc(item.version||'')}</b></div>
<div class="order-row"><span>Số tiền</span><b>${money(order.amount,order.currency)}</b></div>
<div class="order-row"><span>Trạng thái</span><b class="status-pill status-${esc(order.status)}">${esc(statusLabels[order.status]||order.status)}</b></div>
<div class="order-row"><span>Thời điểm</span><b>${esc(new Date(order.createdAt||order.created_at).toLocaleString('vi-VN'))}</b></div>
</div>
${paid?`<p class="order-hint">${esc(hintFor(order))}</p><button class="button button-primary button-wide" id="order-download">Tải sản phẩm <span>↓</span></button>`:`
<p class="order-hint">${esc(hintFor(order))}</p>
${deadline?`<p class="order-deadline${left!==null&&left<=0?' is-over':''}" id="order-countdown">${esc(countdownText())}</p>`:''}
${order.status==='cancelled'?'':`${channels}`}
<button class="button button-primary button-wide" id="order-download" disabled>Thanh toán thành công để mở nút tải <span>↓</span></button>
<button class="button button-secondary button-wide" id="order-refresh">Kiểm tra trạng thái <span>↻</span></button>`}
<p class="order-help">Cần trợ giúp? <a href="mailto:hello@sonvudev.com">hello@sonvudev.com</a> hoặc xem <a href="/refund">chính sách hoàn tiền</a>.</p>
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
        lead.textContent=payload.error||'Chưa thể tải sản phẩm.';
        button.disabled=false;
      }
    }catch(error){
      lead.textContent='Mất kết nối khi tải. Bạn có thể thử lại, đơn vẫn còn hiệu lực.';
      button.disabled=false;
    }
  });
  document.getElementById('order-refresh')?.addEventListener('click',()=>render());
  if(deadline) countdownTimer=setTimeout(tickCountdown,1000);
  scheduleWatch();
}
window.addEventListener('online',()=>{if(state)render()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state)render()});
render();
