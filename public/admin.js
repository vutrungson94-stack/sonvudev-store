const body=document.getElementById('orders-body'),summary=document.getElementById('order-summary'),login=document.getElementById('login-card'),dashboard=document.getElementById('dashboard'),tokenInput=document.getElementById('admin-token'),status=document.getElementById('login-status'),logout=document.getElementById('logout'),toast=document.getElementById('toast'),productPanel=document.getElementById('product-panel'),productForm=document.getElementById('product-form'),productStatus=document.getElementById('product-status'),productList=document.getElementById('admin-product-list'),revenuePanel=document.getElementById('revenue-panel'),revenueBody=document.getElementById('revenue-body'),revenueTotals=document.getElementById('revenue-totals'),revenueNote=document.getElementById('revenue-note'),revenueRefresh=document.getElementById('revenue-refresh');let token=sessionStorage.getItem('sonvudev_admin')||'';const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const money=v=>new Intl.NumberFormat('vi-VN').format(Number(v||0));const usd=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v||0));const labels={pending:'Chờ xử lý',pending_transfer:'Chờ chuyển khoản',paid:'Đã thanh toán',payment_failed:'Thất bại',cancelled:'Đã hủy',refunded:'Đã hoàn tiền'};function showToast(m,error=false){toast.textContent=m;toast.className=`toast show${error?' error':''}`;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.className='toast',3500)}async function api(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json','x-admin-token':token,...(options.headers||{})}}),d=await r.json();if(!r.ok)throw Error(d.error||'Không thể tải dữ liệu');return d}
// Order alerts. A bank transfer can sit unpaid for hours, so the panel polls a
// cheap endpoint and complains loudly rather than waiting for a manual refresh.
// Expired orders are already cancelled by the server, so only orders that are
// still inside their payment window are worth waking the owner for.
const alertBox=document.getElementById('admin-alert'),alertTitle=document.getElementById('admin-alert-title'),alertText=document.getElementById('admin-alert-text'),alertGo=document.getElementById('admin-alert-go');
let seenLatest=null,pendingTimer=null;
const titleBase=document.title;
function beep(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const ctx=new C(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.type='sine';osc.frequency.setValueAtTime(880,ctx.currentTime);osc.frequency.setValueAtTime(1180,ctx.currentTime+.18);gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.25,ctx.currentTime+.02);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.45);osc.start();osc.stop(ctx.currentTime+.5)}catch(e){}}
function notifyOrder(text){try{if(document.hidden&&'Notification'in window&&Notification.permission==='granted')new Notification('SonVuDev: đơn hàng mới',{body:text,tag:'sonvudev-order'})}catch(e){}}
function showAlert(kind,count,order){
  if(kind==='pending'){alertTitle.textContent=count+' đơn đang chờ chuyển khoản';alertText.textContent='Vào xác nhận để khách tải được sản phẩm.'}
  else{alertTitle.textContent='Có đơn mới';alertText.textContent=order?'Đơn '+order.id+' vừa được tạo.':'Mở bảng bên dưới để xem.'}
  alertBox.hidden=false;
}
async function pollPending(){
  if(!token||(document.hidden&&seenLatest!==null))return;
  try{
    const data=await api('/api/admin/orders/pending');
    if(seenLatest===null){seenLatest=data.latest;return}
    if(data.latest>seenLatest){
      seenLatest=data.latest;
      showAlert('new',0,data.newest);
      document.title='(NEW) '+titleBase;
      beep();
      notifyOrder(data.newest?'Đơn '+data.newest.id:'Có đơn mới chờ xữ lý');
      loadOrders();
    }else if(data.pending>0){
      showAlert('pending',data.pending,null);
    }else{
      alertBox.hidden=true;
      document.title=titleBase;
    }
  }catch(e){}
}
function startPolling(){stopPolling();pollPending();pendingTimer=setInterval(pollPending,30000)}
function stopPolling(){if(pendingTimer)clearInterval(pendingTimer);pendingTimer=null;seenLatest=null;document.title=titleBase;if(alertBox)alertBox.hidden=true}
if(alertGo)alertGo.onclick=()=>{alertBox.hidden=true;loadOrders()};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollPending()});
// Revenue lives in the admin panel rather than a separate page: it reads the
// same orders the table below shows, it is behind the same token, and the owner
// only ever looks at it here. A second page would need a second place to protect
// and a second place to go stale.
// A server cannot see a file finish arriving in someone's browser, so a download
// that dies at ten percent still closes the order. This is the one-click undo
// for when a customer comes back saying the file never made it.
async function reopenOrder(id){if(!confirm('Mở lại đơn để khách tải lại?'))return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({reopen:true})});showToast('Đã mở lại đơn, khách tải lại được');loadOrders();loadRevenue()}catch(e){showToast(e.message,true)}}

// A refund needs a reason because the buyer is emailed with it, and "cancelled"
// tells them nothing when money already moved.
async function refundOrder(id){const reason=prompt('Lý do hoàn tiền (khách sẽ thấy nội dung này trong email):');if(!reason||!reason.trim())return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({refund:true,reason:reason.trim()})});showToast('Đã ghi nhận hoàn tiền và gửi email cho khách');loadOrders();loadRevenue()}catch(e){showToast(e.message,true)}}
// A refunded order can be reopened if the money came back to the buyer by
// mistake, or the chargeback was reversed.
async function reopenRefunded(id){if(!confirm('Mở lại đơn đã hoàn tiền? Khách tải lại được.'))return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:'paid'})});showToast('Đã mở lại đơn');loadOrders();loadRevenue()}catch(e){showToast(e.message,true)}}

async function loadRevenue(){
  if(!token)return;
  if(revenueRefresh)revenueRefresh.disabled=true;
  try{
    const data=await api('/api/admin/revenue');
    // Two currencies are shown side by side and never summed: a USD PayPal sale
    // and a VND transfer have no honest combined total.
    const parts=Object.entries(data.net||{}).filter(([,v])=>Number(v)>0).map(([c,v])=>c==='USD'?usd(v):`${money(v)} ${c}`);
    const back=Object.entries(data.refunds||{}).filter(([,v])=>Number(v)>0).map(([c,v])=>c==='USD'?usd(v):`${money(v)} ${c}`);
    revenueTotals.innerHTML=`<div><b>${esc(parts.join(' + ')||'Chưa có doanh thu')}</b><small>thu ròng, ${data.paidOrders} lượt đã thu${data.refundedOrders?`, ${data.refundedOrders} đã hoàn lại`:''}</small></div><div><b>${back.length?esc(back.join(' + ')):'0đ'}</b><small>đã hoàn trả cho khách</small></div><div><b>${money(data.outstanding||0)} VND</b><small>đang chờ thu, chưa quá hạn</small></div>`;
    const rows=data.products||[];
    revenueBody.innerHTML=rows.length?rows.map(r=>`<tr><td><b>${esc(r.name)}</b><small>v${esc(r.version||'—')}</small></td><td>${r.units}</td><td>${r.orders}</td><td><strong>${money(r.revenue)} ${esc(r.currency||'VND')}</strong><small>TB ${money(r.avg)}${r.refunds?` · hoàn ${money(r.refunds)}`:''}</small></td><td>${r.provider>0?`<strong>${esc(usd(r.provider))}</strong>`:'—'}</td></tr>`).join(''):'<tr><td colspan="5" class="table-empty">Chưa có doanh thu.</td></tr>';
    revenueNote.textContent=`Cột USD là số tiền thực nhận từ PayPal, chưa trừ phí. Cột VND là giá niêm yết của đơn chuyển khoản. Hoàn tiền được ghi riêng, không bị trừ khỏi doanh thu gộp.`;
    revenueNote.hidden=false;
  }catch(e){
    if(revenueBody)revenueBody.innerHTML=`<tr><td colspan="5" class="table-empty">${esc(e.message)}</td></tr>`;
  }finally{
    if(revenueRefresh)revenueRefresh.disabled=false;
  }
}
if(revenueRefresh)revenueRefresh.onclick=loadRevenue;
// Health is public, but the dashboard is not, so this is where a silent mail
// outage becomes something the owner sees without having to go looking.
async function checkMail(){
  const warn=document.getElementById('mail-warn');
  if(!warn)return;
  try{const health=await (await fetch('/api/health')).json();warn.hidden=health.email!=='outbox'}catch(error){}
}

async function loadOrders(){if(!token)return;try{const d=await api('/api/admin/orders'),orders=d.orders||[];const waiting=orders.filter(o=>o.status==='pending_transfer').length;summary.textContent=waiting?`${orders.length} đơn hàng · ${waiting} đang chờ chuyển khoản`:`${orders.length} đơn hàng trong hệ thống`;body.innerHTML=orders.length?orders.map(orderRow).join(''):'<tr><td colspan="6" class="table-empty">Chưa có đơn hàng.</td></tr>';body.querySelectorAll('[data-status]').forEach(btn=>btn.onclick=()=>updateOrder(btn.dataset.id,btn.dataset.status));body.querySelectorAll('[data-delivered]').forEach(btn=>btn.onclick=()=>markDelivered(btn.dataset.delivered));body.querySelectorAll('[data-reopen]').forEach(btn=>btn.onclick=()=>reopenOrder(btn.dataset.reopen));body.querySelectorAll('[data-refund]').forEach(btn=>btn.onclick=()=>refundOrder(btn.dataset.refund));body.querySelectorAll('[data-reopen2]').forEach(btn=>btn.onclick=()=>reopenRefunded(btn.dataset.reopen2))}catch(e){showToast(e.message,true)}}function orderRow(o){const item=o.items?.[0]||{};return `<tr><td><code>${esc(o.id)}</code><small>${esc(new Date(o.createdAt||o.created_at).toLocaleString('vi-VN'))}</small></td><td>${esc(o.customerName||o.customer_name||'—')}<small>${esc(o.customerEmail||o.customer_email)}</small></td><td>${esc(item.name||'—')}<small>v${esc(item.version||'—')}</small></td><td><strong>${money(o.amount)} ${esc(o.currency||'VND')}</strong>${o.paidCount?`<small>${o.paidCount} lần đã thu</small>`:''}</td><td><span class="status-pill status-${esc(o.status)}">${esc(labels[o.status]||o.status)}</span>${o.deliveredAt?`<small>đã giao ${esc(new Date(o.deliveredAt).toLocaleString('vi-VN'))}</small>`:''}${o.refundedAt?`<small>đã hoàn ${esc(new Date(o.refundedAt).toLocaleString('vi-VN'))}</small>`:''}${o.status==='cancelled'&&o.cancelledAt?`<small>hết hạn lúc ${esc(new Date(o.cancelledAt).toLocaleString('vi-VN'))}</small>`:''}</td><td>${o.status==='pending_transfer'?`<button class="table-action" data-id="${esc(o.id)}" data-status="paid">Xác nhận đã thanh toán</button>`:o.status==='paid'?`<button class="table-action" data-delivered="${esc(o.id)}">Đã giao xong</button> <button class="table-action" data-refund="${esc(o.id)}">Hoàn tiền</button>`:o.status==='refunded'?`<button class="table-action" data-reopen2="${esc(o.id)}">Mở lại đơn</button>`:o.deliveredAt?`<button class="table-action" data-reopen="${esc(o.id)}">Mở lại đơn</button>`:'—'}</td></tr>`}async function updateOrder(id,nextStatus){if(!confirm('Xác nhận đơn hàng đã thanh toán?'))return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:nextStatus})});showToast('Đã cập nhật đơn hàng và gửi email cho khách');loadOrders()}catch(e){showToast(e.message,true)}}async function markDelivered(id){if(!confirm('Đóng đơn hàng? Nút tải sẽ khóa lại.'))return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({delivered:true})});showToast('Đã đóng đơn hàng');loadOrders()}catch(e){showToast(e.message,true)}}
async function uploadRelease(file, productRef, version, onProgress = () => {}) {
  onProgress('Đang tạo link upload R2…');
  const presign = await api('/api/admin/uploads/presign', { method: 'POST', body: JSON.stringify({ productRef, version, fileName: file.name, contentType: file.type || 'application/octet-stream' }) });
  onProgress('Đang upload file lên R2…');
  const upload = await fetch(presign.url, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (!upload.ok) throw Error('Upload R2 thất bại');
  return presign.key;
}

async function loadProducts(){try{const d=await api('/api/admin/products');productList.innerHTML=d.products.length?d.products.map(p=>`<div class="admin-product-row"><span class="admin-product-icon">${esc((p.name||'SV').slice(0,2).toUpperCase())}</span><div><b>${esc(p.name)}</b><small>${esc(p.version)} · ${money(p.price)} ${esc(p.currency)} · ${p.status==='active'?'Đang bán':'Bản nháp'}</small></div><div class="admin-product-actions"><span>${p.fileKey?'Đã có file':'Chưa có file'}</span><label class="admin-upload-button">Cập nhật file<input type="file" accept=".zip,.exe,.msi,.7z" data-product-id="${esc(p.id)}" data-product-ref="${esc(p.slug)}" data-version="${esc(p.version)}" hidden></label><button class="text-link" type="button" data-seo-toggle="${esc(p.id)}">${p.seoTitle?'Sửa SEO':'Thêm SEO'}</button></div>${seoEditor(p)}</div>`).join(''):'<p class="table-empty">Chưa có sản phẩm.</p>';productList.querySelectorAll('input[type=file]').forEach(input=>input.onchange=uploadExistingProduct);productList.querySelectorAll('[data-seo-toggle]').forEach(button=>button.onclick=()=>{const form=productList.querySelector(`[data-seo-form="${button.dataset.seoToggle}"]`);if(form){form.hidden=!form.hidden;if(!form.hidden)countSeo(form)}});productList.querySelectorAll('[data-seo-form]').forEach(form=>{form.onsubmit=saveSeo;form.querySelectorAll('input,textarea').forEach(input=>input.oninput=()=>countSeo(form))})}catch(e){showToast(e.message,true)}}
function seoEditor(p){return `<form class="admin-seo-form" data-seo-form="${esc(p.id)}" hidden><label>Tiêu đề tìm kiếm<input name="seoTitle" maxlength="70" value="${esc(p.seoTitle||'')}" placeholder="Để trống thì lấy tên sản phẩm"></label><label>Mô tả tìm kiếm<textarea name="seoDescription" maxlength="175" rows="2" placeholder="Câu người ta gõ vào Google, trả lời thẳng vấn đề của họ">${esc(p.seoDescription||'')}</textarea></label><p class="admin-seo-count"></p><button class="button button-primary" type="submit">Lưu SEO</button></form>`}
function countSeo(form){const out=form.querySelector('.admin-seo-count');if(!out)return;const parts=[['Tiêu đề',form.elements.seoTitle,70,60],['Mô tả',form.elements.seoDescription,175,160]].map(([label,el,max,cut])=>{const n=(el?el.value:'').length;return `${label} ${n}/${max}${n>cut?' (bị cắt)':''}`});out.textContent=parts.join(' · ');out.className='admin-seo-count'+(parts.some(x=>x.includes('bị cắt'))?' over':'')}
async function saveSeo(event){event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{const data=Object.fromEntries(new FormData(form));await api('/api/admin/products/'+encodeURIComponent(form.dataset.seoForm),{method:'PATCH',body:JSON.stringify({seoTitle:data.seoTitle.trim(),seoDescription:data.seoDescription.trim()})});showToast('Đã lưu SEO');await loadProducts()}catch(e){showToast(e.message,true)}finally{button.disabled=false}}
async function uploadExistingProduct(event){const input=event.currentTarget,file=input.files?.[0];if(!file)return;input.disabled=true;try{const fileKey=await uploadRelease(file,input.dataset.productRef,input.dataset.version,m=>showToast(m));await api('/api/admin/products/'+encodeURIComponent(input.dataset.productId),{method:'PATCH',body:JSON.stringify({fileKey,status:'active'})});showToast('Đã cập nhật file phát hành');await loadProducts()}catch(e){showToast(e.message,true)}finally{input.disabled=false;input.value=''}}async function submitProduct(event){event.preventDefault();const form=event.currentTarget,button=document.getElementById('save-product'),data=Object.fromEntries(new FormData(form)),file=form.elements.releaseFile.files[0];button.disabled=true;productStatus.className='form-message';productStatus.textContent='Đang tạo sản phẩm…';try{const created=await api('/api/admin/products',{method:'POST',body:JSON.stringify({...data,features:data.features.split('\n').map(x=>x.trim()).filter(Boolean)})});let fileKey=created.product.fileKey||'';if(file){fileKey=await uploadRelease(file,created.product.slug||created.product.id,created.product.version,m=>productStatus.textContent=m);await api('/api/admin/products/'+encodeURIComponent(created.product.id),{method:'PATCH',body:JSON.stringify({fileKey,status:'active'})})}else if(fileKey){await api('/api/admin/products/'+encodeURIComponent(created.product.id),{method:'PATCH',body:JSON.stringify({status:'active'})})}form.reset();productStatus.textContent=fileKey?'Đã tạo sản phẩm và file phát hành.':'Đã tạo bản nháp. Hãy thêm file phát hành trước khi bán.';await loadProducts()}catch(error){productStatus.textContent=error.message;productStatus.className='form-message error'}finally{button.disabled=false}}async function loginSubmit(event){event.preventDefault();token=tokenInput.value.trim();try{await api('/api/admin/orders');sessionStorage.setItem('sonvudev_admin',token);tokenInput.value='';login.hidden=true;dashboard.hidden=false;productPanel.hidden=false;logout.hidden=false;loadOrders();loadProducts();if('Notification'in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});startPolling()}catch(error){status.textContent=error.message;status.className='form-message error';token=''}}document.getElementById('login-form').onsubmit=loginSubmit;logout.onclick=()=>{stopPolling();sessionStorage.removeItem('sonvudev_admin');token='';dashboard.hidden=true;productPanel.hidden=true;login.hidden=false;logout.hidden=true};document.getElementById('refresh').onclick=()=>{loadOrders();loadProducts()};// The list now starts visible; the button collapses it, so the label has to
// describe the action rather than the destination.
const productToggle=document.getElementById('toggle-products');productToggle.onclick=()=>{productList.hidden=!productList.hidden;productToggle.textContent=productList.hidden?'Xem danh sách ↓':'Ẩn danh sách ↑'};productForm.onsubmit=submitProduct;if(token){login.hidden=true;dashboard.hidden=false;productPanel.hidden=false;logout.hidden=false;if(revenuePanel)revenuePanel.hidden=false;loadOrders();loadRevenue();loadProducts();checkMail();startPolling()}

