const state=JSON.parse(sessionStorage.getItem('sonvudev_order')||'null');
const title=document.getElementById('title'),message=document.getElementById('message'),actions=document.getElementById('actions'),loader=document.getElementById('loader'),eyebrow=document.getElementById('eyebrow');
function goHome(){location.href='/'}
function showMissing(){title.textContent='Không tìm thấy đơn hàng';message.textContent='Mã tra cứu PayPal không có trong phiên trình duyệt này.';loader.hidden=true;actions.innerHTML='<a class="button button-primary" href="/">Về cửa hàng</a>'}
function link(token){const dl=document.createElement('button');dl.className='button button-primary';dl.id='download';dl.textContent='Tải sản phẩm ↓';dl.onclick=async()=>{try{const result=await fetch('/api/orders/'+encodeURIComponent(state.id)+'/download',{headers:{'x-order-token':token}}),payload=await result.json();if(result.ok){location.href=payload.url;fetch('/api/orders/'+encodeURIComponent(state.id)+'/delivered',{method:'POST',headers:{'x-order-token':token,'content-type':'application/json'}}).catch(()=>{})}else message.textContent=payload.error||'Chưa thể tải sản phẩm.'}catch(error){message.textContent='Mất kết nối. Bạn có thể thử lại, đơn vẫn còn hiệu lực.'}};return dl}
function showPaid(){eyebrow.textContent='Thành công';title.textContent='Thanh toán hoàn tất!';message.textContent='Đơn '+state.id+' đã được thanh toán. Bạn có thể tải sản phẩm ngay.';actions.innerHTML='';actions.appendChild(link(state.token));const back=document.createElement('a');back.className='button button-secondary';back.href='/';back.textContent='Về cửa hàng';actions.appendChild(back);loader.hidden=true}
function showRetry(text){eyebrow.textContent='Đang chờ';title.textContent='Đang xác nhận thanh toán…';message.textContent=text;actions.innerHTML='';const retry=document.createElement('button');retry.className='button button-primary';retry.textContent='Kiểm tra lại ↻';retry.onclick=()=>{retry.disabled=true;start()};const order=document.createElement('a');order.className='button button-secondary';order.href='/order/'+encodeURIComponent(state.id);order.textContent='Mở đơn hàng';actions.appendChild(retry);actions.appendChild(order)}
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
// The webhook may have already marked the order paid while this tab had no
// connection, so a failed capture is never proof the money did not arrive.
async function alreadyPaid(){
  try{const response=await fetch('/api/orders/'+encodeURIComponent(state.id),{headers:{'x-order-token':state.token}});if(!response.ok)return false;const data=await response.json();return data.order?.status==='paid'}catch(error){return false}
}
async function start(){
  if(!state)return showMissing();
  showRetry('Bạn vừa thanh toán. Trang đang chờ PayPal xác nhận, vui lòng không đóng.');
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
  eyebrow.textContent='Chưa hoàn tất';
  title.textContent='Chưa xác nhận được thanh toán';
  message.textContent='PayPal chưa báo thành công. Nếu bạn đã bị trừ tiền, hãy thử lại sau ít phút hoặc liên hệ hello@sonvudev.com kèm mã đơn '+state.id+'.';
  actions.innerHTML='';
  const retry=document.createElement('button');retry.className='button button-primary';retry.textContent='Kiểm tra lại ↻';retry.onclick=()=>{retry.disabled=true;start()};
  const order=document.createElement('a');order.className='button button-secondary';order.href='/order/'+encodeURIComponent(state.id);order.textContent='Mở đơn hàng';
  const home=document.createElement('a');home.className='button button-secondary';home.href='/';home.textContent='Về cửa hàng';
  actions.appendChild(retry);actions.appendChild(order);actions.appendChild(home);
  loader.hidden=true;
}
start();
