const title=document.getElementById('order-title'),lead=document.getElementById('order-lead'),body=document.getElementById('order-body');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(v,c='VND')=>new Intl.NumberFormat('vi-VN',c==='USD'?{style:'currency',currency:c}:{maximumFractionDigits:0}).format(Number(v||0));
const statusLabels={pending:'Đang xử lý',pending_transfer:'Đang chờ chuyển khoản',paid:'Đã thanh toán',payment_failed:'Thất bại',cancelled:'Đã hủy'};
const state=JSON.parse(sessionStorage.getItem('sonvudev_order')||'null');
function missing(){title.textContent='Chưa tìm thấy phiên đơn hàng';lead.textContent='Vì lý do bảo mật, mã tra cứu chỉ được giữ trong trình duyệt này. Nếu bạn mở trang này ở thiết bị khác, hãy tra cứu lại bằng mã đơn và email.';body.innerHTML='<a class="button button-primary" href="/lookup">Tra cứu đơn hàng <span>→</span></a>'}
async function render(){
  if(!state||!state.token) return missing();
  const response=await fetch('/api/orders/'+encodeURIComponent(state.id),{headers:{'x-order-token':state.token}});
  const data=await response.json();
  if(!response.ok){
    sessionStorage.removeItem('sonvudev_order');
    return missing();
  }
  const order=data.order,item=order.items?.[0]||{};
  title.textContent='Đơn '+order.id;
  lead.textContent=statusLabels[order.status]||order.status;
  const channel=(c)=>`<div class="order-channel"><b>${esc(c.label)}</b><span>Số tài khoản: <b>${esc(c.account)}</b></span><span>Số tiền: <b>${money(c.amount,c.currency)}</b></span><span class="order-note">Nội dung: <code>${esc(c.transferNote)}</code></span>${c.qrUrl?`<img class="order-qr" src="${esc(c.qrUrl)}" alt="Mã QR ${esc(c.label)}" width="220" height="220" referrerpolicy="no-referrer">`:''}${c.qrImage?`<img class="order-qr" src="${esc(c.qrImage)}" alt="Mã QR ${esc(c.label)}" width="220" height="220" referrerpolicy="no-referrer">`:''}</div>`;
  const channels=(data.payment?.channels||[]).map(channel).join('');
  const paid=order.status==='paid';
  body.innerHTML=`
<div class="order-card">
<div class="order-row"><span>Sản phẩm</span><b>${esc(item.name||'')} v${esc(item.version||'')}</b></div>
<div class="order-row"><span>Số tiền</span><b>${money(order.amount,order.currency)}</b></div>
<div class="order-row"><span>Trạng thái</span><b class="status-pill status-${esc(order.status)}">${esc(statusLabels[order.status]||order.status)}</b></div>
<div class="order-row"><span>Thời điểm</span><b>${esc(new Date(order.createdAt||order.created_at).toLocaleString('vi-VN'))}</b></div>
</div>
${paid?'<button class="button button-primary button-wide" id="order-download">Tải sản phẩm <span>↓</span></button>':`
<p class="order-hint">${order.status==='pending_transfer'?'Chuyển khoản xong bạn bấm nút bên dưới để chúng tôi kiểm tra trạng thái. Đơn chuyển khoản được xác nhận trong thời gian làm việc.':'Đơn hàng đang được xử lý. Bạn có thể tải ngay khi trạng thái chuyển sang đã thanh toán.'}</p>
${channels}
<button class="button button-secondary button-wide" id="order-refresh">Kiểm tra trạng thái <span>↻</span></button>`}
<p class="order-help">Cần trợ giúp? <a href="mailto:hello@sonvudev.com">hello@sonvudev.com</a> hoặc xem <a href="/refund">chính sách hoàn tiền</a>.</p>`;
  document.getElementById('order-download')?.addEventListener('click',async()=>{
    const result=await fetch('/api/orders/'+encodeURIComponent(order.id)+'/download',{headers:{'x-order-token':state.token}});
    const payload=await result.json();
    if(result.ok) location.href=payload.url; else lead.textContent=payload.error||'Chưa thể tải sản phẩm.';
  });
  document.getElementById('order-refresh')?.addEventListener('click',render);
}
render();
