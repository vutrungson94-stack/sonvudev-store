const body=document.getElementById('orders-body'),summary=document.getElementById('order-summary'),login=document.getElementById('login-card'),dashboard=document.getElementById('dashboard'),tokenInput=document.getElementById('admin-token'),status=document.getElementById('login-status'),logout=document.getElementById('logout'),toast=document.getElementById('toast'),productPanel=document.getElementById('product-panel'),productForm=document.getElementById('product-form'),productStatus=document.getElementById('product-status'),productList=document.getElementById('admin-product-list');let token=sessionStorage.getItem('sonvudev_admin')||'';const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const money=v=>new Intl.NumberFormat('vi-VN').format(Number(v||0));const labels={pending:'Chờ xử lý',pending_transfer:'Chờ chuyển khoản',paid:'Đã thanh toán',payment_failed:'Thất bại',cancelled:'Đã hủy'};function showToast(m,error=false){toast.textContent=m;toast.className=`toast show${error?' error':''}`;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.className='toast',3500)}async function api(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json','x-admin-token':token,...(options.headers||{})}}),d=await r.json();if(!r.ok)throw Error(d.error||'Không thể tải dữ liệu');return d}
// Order alerts. A bank transfer can sit unpaid for hours, so the panel polls a
// cheap endpoint and complains loudly rather than waiting for a manual refresh.
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
async function loadOrders(){if(!token)return;try{const d=await api('/api/admin/orders'),orders=d.orders||[];const waiting=orders.filter(o=>o.status==='pending_transfer').length;summary.textContent=waiting?`${orders.length} đơn hàng · ${waiting} đang chờ chuyển khoản`:`${orders.length} đơn hàng trong hệ thống`;body.innerHTML=orders.length?orders.map(orderRow).join(''):'<tr><td colspan="6" class="table-empty">Chưa có đơn hàng.</td></tr>';body.querySelectorAll('[data-status]').forEach(btn=>btn.onclick=()=>updateOrder(btn.dataset.id,btn.dataset.status))}catch(e){showToast(e.message,true)}}function orderRow(o){const item=o.items?.[0]||{};return `<tr><td><code>${esc(o.id)}</code><small>${esc(new Date(o.createdAt||o.created_at).toLocaleString('vi-VN'))}</small></td><td>${esc(o.customerName||o.customer_name||'—')}<small>${esc(o.customerEmail||o.customer_email)}</small></td><td>${esc(item.name||'—')}<small>v${esc(item.version||'—')}</small></td><td><strong>${money(o.amount)} ${esc(o.currency||'VND')}</strong></td><td><span class="status-pill status-${esc(o.status)}">${esc(labels[o.status]||o.status)}</span></td><td>${o.status==='pending_transfer'?`<button class="table-action" data-id="${esc(o.id)}" data-status="paid">Xác nhận đã thanh toán</button>`:'—'}</td></tr>`}async function updateOrder(id,nextStatus){if(!confirm('Xác nhận đơn hàng đã thanh toán?'))return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:nextStatus})});showToast('Đã cập nhật đơn hàng');loadOrders()}catch(e){showToast(e.message,true)}}
async function uploadRelease(file, productRef, version, onProgress = () => {}) {
  onProgress('Đang tạo link upload R2…');
  const presign = await api('/api/admin/uploads/presign', { method: 'POST', body: JSON.stringify({ productRef, version, fileName: file.name, contentType: file.type || 'application/octet-stream' }) });
  onProgress('Đang upload file lên R2…');
  const upload = await fetch(presign.url, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (!upload.ok) throw Error('Upload R2 thất bại');
  return presign.key;
}

async function loadProducts(){try{const d=await api('/api/admin/products');productList.innerHTML=d.products.length?d.products.map(p=>`<div class="admin-product-row"><span class="admin-product-icon">${esc((p.name||'SV').slice(0,2).toUpperCase())}</span><div><b>${esc(p.name)}</b><small>${esc(p.version)} · ${money(p.price)} ${esc(p.currency)} · ${p.status==='active'?'Đang bán':'Bản nháp'}</small></div><div class="admin-product-actions"><span>${p.fileKey?'Đã có file':'Chưa có file'}</span><label class="admin-upload-button">Cập nhật file<input type="file" accept=".zip,.exe,.msi,.7z" data-product-id="${esc(p.id)}" data-product-ref="${esc(p.slug)}" data-version="${esc(p.version)}" hidden></label></div></div>`).join(''):'<p class="table-empty">Chưa có sản phẩm.</p>';productList.querySelectorAll('input[type=file]').forEach(input=>input.onchange=uploadExistingProduct)}catch(e){showToast(e.message,true)}}
async function uploadExistingProduct(event){const input=event.currentTarget,file=input.files?.[0];if(!file)return;input.disabled=true;try{const fileKey=await uploadRelease(file,input.dataset.productRef,input.dataset.version,m=>showToast(m));await api('/api/admin/products/'+encodeURIComponent(input.dataset.productId),{method:'PATCH',body:JSON.stringify({fileKey,status:'active'})});showToast('Đã cập nhật file phát hành');await loadProducts()}catch(e){showToast(e.message,true)}finally{input.disabled=false;input.value=''}}async function submitProduct(event){event.preventDefault();const form=event.currentTarget,button=document.getElementById('save-product'),data=Object.fromEntries(new FormData(form)),file=form.elements.releaseFile.files[0];button.disabled=true;productStatus.className='form-message';productStatus.textContent='Đang tạo sản phẩm…';try{const created=await api('/api/admin/products',{method:'POST',body:JSON.stringify({...data,features:data.features.split('\n').map(x=>x.trim()).filter(Boolean)})});let fileKey=created.product.fileKey||'';if(file){fileKey=await uploadRelease(file,created.product.slug||created.product.id,created.product.version,m=>productStatus.textContent=m);await api('/api/admin/products/'+encodeURIComponent(created.product.id),{method:'PATCH',body:JSON.stringify({fileKey,status:'active'})})}else if(fileKey){await api('/api/admin/products/'+encodeURIComponent(created.product.id),{method:'PATCH',body:JSON.stringify({status:'active'})})}form.reset();productStatus.textContent=fileKey?'Đã tạo sản phẩm và file phát hành.':'Đã tạo bản nháp. Hãy thêm file phát hành trước khi bán.';await loadProducts()}catch(error){productStatus.textContent=error.message;productStatus.className='form-message error'}finally{button.disabled=false}}async function loginSubmit(event){event.preventDefault();token=tokenInput.value.trim();try{await api('/api/admin/orders');sessionStorage.setItem('sonvudev_admin',token);tokenInput.value='';login.hidden=true;dashboard.hidden=false;productPanel.hidden=false;logout.hidden=false;loadOrders();loadProducts();if('Notification'in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});startPolling()}catch(error){status.textContent=error.message;status.className='form-message error';token=''}}document.getElementById('login-form').onsubmit=loginSubmit;logout.onclick=()=>{stopPolling();sessionStorage.removeItem('sonvudev_admin');token='';dashboard.hidden=true;productPanel.hidden=true;login.hidden=false;logout.hidden=true};document.getElementById('refresh').onclick=()=>{loadOrders();loadProducts()};document.getElementById('toggle-products').onclick=()=>{productList.hidden=!productList.hidden};productForm.onsubmit=submitProduct;if(token){login.hidden=true;dashboard.hidden=false;productPanel.hidden=false;logout.hidden=false;loadOrders();loadProducts();startPolling()}

