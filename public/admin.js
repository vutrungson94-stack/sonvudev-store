const body=document.getElementById('orders-body'),summary=document.getElementById('order-summary'),login=document.getElementById('login-card'),dashboard=document.getElementById('dashboard'),tokenInput=document.getElementById('admin-token'),status=document.getElementById('login-status'),logout=document.getElementById('logout'),toast=document.getElementById('toast'),productPanel=document.getElementById('product-panel'),productForm=document.getElementById('product-form'),productStatus=document.getElementById('product-status'),productList=document.getElementById('admin-product-list'),revenuePanel=document.getElementById('revenue-panel'),moreRow=document.getElementById('orders-more'),moreBtn=document.getElementById('orders-more-btn'),revenueBody=document.getElementById('revenue-body'),revenueTotals=document.getElementById('revenue-totals'),revenueNote=document.getElementById('revenue-note'),revenueRefresh=document.getElementById('revenue-refresh');let token=sessionStorage.getItem('sonvudev_admin')||'';const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const money=v=>new Intl.NumberFormat('vi-VN').format(Number(v||0));const usd=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v||0));const labels={pending:'Chờ xử lý',pending_transfer:'Chờ chuyển khoản',paid:'Đã thanh toán',payment_failed:'Thất bại',cancelled:'Đã hủy',refunded:'Đã hoàn tiền'};function showToast(m,error=false){toast.textContent=m;toast.className=`toast show${error?' error':''}`;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.className='toast',3500)}async function api(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json','x-admin-token':token,...(options.headers||{})}}),d=await r.json();if(!r.ok)throw Error(d.error||'Không thể tải dữ liệu');return d}
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
      resetOrderPage();
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
if(alertGo)alertGo.onclick=()=>{alertBox.hidden=true;resetOrderPage()};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollPending()});
// Revenue lives in the admin panel rather than a separate page: it reads the
// same orders the table below shows, it is behind the same token, and the owner
// only ever looks at it here. A second page would need a second place to protect
// and a second place to go stale.
// A server cannot see a file finish arriving in someone's browser, so a download
// that dies at ten percent still closes the order. This is the one-click undo
// for when a customer comes back saying the file never made it.
async function reopenOrder(id){if(!confirm('Mở lại đơn để khách tải lại?'))return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({reopen:true})});showToast('Đã mở lại đơn, khách tải lại được');resetOrderPage();loadRevenue()}catch(e){showToast(e.message,true)}}

// A refund needs a reason because the buyer is emailed with it, and "cancelled"
// tells them nothing when money already moved.
async function refundOrder(id){const reason=prompt('Lý do hoàn tiền (khách sẽ thấy nội dung này trong email):');if(!reason||!reason.trim())return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({refund:true,reason:reason.trim()})});showToast('Đã ghi nhận hoàn tiền và gửi email cho khách');resetOrderPage();loadRevenue()}catch(e){showToast(e.message,true)}}
// A refunded order can be reopened if the money came back to the buyer by
// mistake, or the chargeback was reversed.
async function reopenRefunded(id){if(!confirm('Mở lại đơn đã hoàn tiền? Khách tải lại được.'))return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:'paid'})});showToast('Đã mở lại đơn');resetOrderPage();loadRevenue()}catch(e){showToast(e.message,true)}}

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

let orderPage=0, orderHasMore=false, orderLoading=false, orderTotal=0;
const ORDER_PAGE=50;
// The order list grew past what one screen holds, so it loads a page at a time
// and says plainly how many are still below. Appending rather than replacing
// keeps the scroll position and the row the owner was reading, which page
// numbers throw away on every click.
async function loadOrders({append=false}={}){
  if(!token||orderLoading)return;
  orderLoading=true;
  moreBtn.disabled=true;
  moreBtn.textContent='Đang tải…';
  try{
    const d=await api('/api/admin/orders?limit='+ORDER_PAGE+'&offset='+(append?orderPage*ORDER_PAGE:0)),orders=d.orders||[];
    orderPage=append?orderPage+1:1;
    orderHasMore=Boolean(d.hasMore);
    // Live orders are counted across the whole shop rather than the page on
    // screen, so the figure does not drop back just because the owner scrolled.
    const open=(Number(d.live)||0)+orders.filter(o=>o.status==='pending_transfer'&&!o.deliveredAt).length;
    const rows=orders.map(orderRow).join('');
    if(append&&body.innerHTML)body.insertAdjacentHTML('beforeend',rows);
    else body.innerHTML=orders.length?rows:'<tr><td colspan="6" class="table-empty">Chưa có đơn hàng.</td></tr>';
    for(const attr of ['data-status','data-delivered','data-reopen','data-refund','data-reopen2']){
      body.querySelectorAll('['+attr+']').forEach(btn=>{
        const id=btn.dataset[attr.slice(5).replace(/-([a-z])/g,(m,c)=>c.toUpperCase())];
        if(attr==='data-status')btn.onclick=()=>updateOrder(id,btn.dataset.status);
        else if(attr==='data-delivered')btn.onclick=()=>markDelivered(id);
        else if(attr==='data-reopen')btn.onclick=()=>reopenOrder(id);
        else if(attr==='data-refund')btn.onclick=()=>refundOrder(id);
        else btn.onclick=()=>reopenRefunded(id);
      });
    }
const suffix=orderHasMore?'+':'';
    // The total comes from the server, not from how far the owner has scrolled. It
    // used to be page * pageSize, which labelled "50 orders in the system" for a shop
    // with two — right by coincidence, which is worse than wrong on purpose.
    const total=Number(d.total)||0;
    summary.textContent=open
      ? (open+' đơn đang chờ chuyển khoản · đã xem '+(orderPage*ORDER_PAGE)+suffix+' / '+total)
      : (total+' đơn hàng trong hệ thống');
    moreRow.hidden=!orderHasMore;
    moreBtn.textContent=orderHasMore?'Tải thêm đơn hàng':'Đã xem hết đơn hàng';
  }catch(e){showToast(e.message,true)}
  finally{orderLoading=false;moreBtn.disabled=false}
}
function resetOrderPage(){orderPage=0;orderHasMore=false;orderTotal=0;return loadOrders()}
moreBtn.onclick=()=>loadOrders({append:true});function orderRow(o){const item=o.items?.[0]||{};return `<tr><td><code>${esc(o.id)}</code><small>${esc(new Date(o.createdAt||o.created_at).toLocaleString('vi-VN'))}</small></td><td>${esc(o.customerName||o.customer_name||'—')}<small>${esc(o.customerEmail||o.customer_email)}</small></td><td>${esc(item.name||'—')}<small>v${esc(item.version||'—')}</small></td><td><strong>${money(o.amount)} ${esc(o.currency||'VND')}</strong>${o.paidCount?`<small>${o.paidCount} lần đã thu</small>`:''}</td><td><span class="status-pill status-${esc(o.status)}">${esc(labels[o.status]||o.status)}</span>${o.deliveredAt?`<small>đã giao ${esc(new Date(o.deliveredAt).toLocaleString('vi-VN'))}</small>`:''}${o.refundedAt?`<small>đã hoàn ${esc(new Date(o.refundedAt).toLocaleString('vi-VN'))}</small>`:''}${o.status==='cancelled'&&o.cancelledAt?`<small>hết hạn lúc ${esc(new Date(o.cancelledAt).toLocaleString('vi-VN'))}</small>`:''}</td><td>${o.status==='pending_transfer'?`<button class="table-action" data-id="${esc(o.id)}" data-status="paid">Xác nhận đã thanh toán</button>`:o.status==='paid'?`<button class="table-action" data-delivered="${esc(o.id)}">Đã giao xong</button> <button class="table-action" data-refund="${esc(o.id)}">Hoàn tiền</button>`:o.status==='refunded'?`<button class="table-action" data-reopen2="${esc(o.id)}">Mở lại đơn</button>`:o.deliveredAt?`<button class="table-action" data-reopen="${esc(o.id)}">Mở lại đơn</button>`:'—'}</td></tr>`}async function updateOrder(id,nextStatus){if(!confirm('Xác nhận đơn hàng đã thanh toán?'))return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:nextStatus})});showToast('Đã cập nhật đơn hàng và gửi email cho khách');resetOrderPage()}catch(e){showToast(e.message,true)}}async function markDelivered(id){if(!confirm('Đóng đơn hàng? Nút tải sẽ khóa lại.'))return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({delivered:true})});showToast('Đã đóng đơn hàng');resetOrderPage()}catch(e){showToast(e.message,true)}}
async function uploadRelease(file, productRef, version, onProgress = () => {}) {
  onProgress('Đang tạo link upload R2…');
  const presign = await api('/api/admin/uploads/presign', { method: 'POST', body: JSON.stringify({ productRef, version, fileName: file.name, contentType: file.type || 'application/octet-stream' }) });
  onProgress('Đang upload file lên R2…');
  const upload = await fetch(presign.url, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (!upload.ok) throw Error('Upload R2 thất bại');
  return presign.key;
}

// The three states the schema allows, each with its own label.
//
// The panel used to print "Bản nháp" for anything that was not `active`, so a
// product archived through the API — deliberately withdrawn from sale but kept
// for the buyers who already bought it — was listed as a draft someone forgot to
// finish. Reading the state as named rather than as not-the-other-one is what
// keeps the panel telling the truth about what the shop is actually selling.
const productStatusLabel=(status)=>({active:'Đang bán',archived:'Đã ẩn khỏi cửa hàng'}[status]||'Bản nháp');
async function loadProducts(){try{const d=await api('/api/admin/products');productList.innerHTML=d.products.length?d.products.map(p=>`<div class="admin-product-row"><span class="admin-product-icon">${esc((p.name||'SV').slice(0,2).toUpperCase())}</span><div><b>${esc(p.name)}</b><small>${esc(p.version)} · ${money(p.price)} ${esc(p.currency)} · ${esc(productStatusLabel(p.status))}</small></div><div class="admin-product-actions"><span>${p.fileKey?'Đã có file':'Chưa có file'}</span><label class="admin-upload-button">Cập nhật file<input type="file" accept=".zip,.exe,.msi,.7z" data-product-id="${esc(p.id)}" data-product-ref="${esc(p.slug)}" data-version="${esc(p.version)}" hidden></label><button class="text-link" type="button" data-seo-toggle="${esc(p.id)}">${p.seoTitle?'Sửa SEO':'Thêm SEO'}</button></div>${seoEditor(p)}</div>`).join(''):'<p class="table-empty">Chưa có sản phẩm.</p>';productList.querySelectorAll('input[type=file]').forEach(input=>input.onchange=uploadExistingProduct);productList.querySelectorAll('[data-seo-toggle]').forEach(button=>button.onclick=()=>{const form=productList.querySelector(`[data-seo-form="${button.dataset.seoToggle}"]`);if(form){form.hidden=!form.hidden;if(!form.hidden){seoLock(form,false);countSeo(form)}}});productList.querySelectorAll('[data-seo-form]').forEach(form=>{form.onsubmit=saveSeo;seoLock(form,true);form.querySelectorAll('input,textarea').forEach(input=>input.oninput=()=>countSeo(form))})}catch(e){showToast(e.message,true)}}
function seoEditor(p){return `<form class="admin-seo-form" data-seo-form="${esc(p.id)}" data-seo-title="${esc(p.seoTitle||'')}" data-seo-description="${esc(p.seoDescription||'')}" hidden><label>Tiêu đề tìm kiếm<input name="seoTitle" maxlength="70" value="${esc(p.seoTitle||'')}" placeholder="Để trống thì lấy tên sản phẩm"></label><label>Mô tả tìm kiếm<textarea name="seoDescription" maxlength="175" rows="2" placeholder="Câu người ta gõ vào Google, trả lời thẳng vấn đề của họ">${esc(p.seoDescription||'')}</textarea></label><p class="admin-seo-count"></p><button class="button button-primary" type="submit" disabled>Lưu SEO</button></form>`}
// Read-only once saved, editable once "Sửa SEO" is pressed.
//
// A form that is saved and still accepts typing is the form the owner reported:
// they pressed Lưu SEO, nothing visibly happened, and pressing it again wrote the
// same two fields. Locking the inputs and saying so removes the ambiguity — the
// greyed fields are the confirmation, not just the button. The alternative, leaving
// them live and relying on a disabled button, was tried and read as a broken form.
function seoLock(form,locked){for(const el of form.querySelectorAll('input,textarea'))el.readOnly=locked;form.classList.toggle('locked',locked)}
function seoDirty(form){return (form.elements.seoTitle?form.elements.seoTitle.value.trim():'')!==(form.dataset.seoTitle||'')||(form.elements.seoDescription?form.elements.seoDescription.value.trim():'')!==(form.dataset.seoDescription||'')}
// The counter doubles as the form's state. A clean form says so: the save button is
// disabled because there is nothing to save, and saying "Đã lưu" is the only visible
// sign that the click a moment ago worked. Without it the owner presses save, sees a
// toast they may have missed, and presses it again — which is what happened.
function countSeo(form){const out=form.querySelector('.admin-seo-count'),button=form.querySelector('button[type=submit]'),clean=!seoDirty(form);if(button)button.disabled=clean;if(!out)return;const parts=[['Tiêu đề',form.elements.seoTitle,70,60],['Mô tả',form.elements.seoDescription,175,160]].map(([label,el,max,cut])=>{const n=(el?el.value:'').length;return `${label} ${n}/${max}${n>cut?' (bị cắt)':''}`});out.textContent=parts.join(' · ')+(clean?' · Đã lưu':'');out.className='admin-seo-count'+(clean?' clean':'')+(parts.some(x=>x.includes('bị cắt'))?' over':'')}
async function saveSeo(event){event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]');button.disabled=true;const data=Object.fromEntries(new FormData(form)),seoTitle=data.seoTitle.trim(),seoDescription=data.seoDescription.trim();try{const saved=await api('/api/admin/products/'+encodeURIComponent(form.dataset.seoForm),{method:'PATCH',body:JSON.stringify({seoTitle,seoDescription})}),stored=(saved&&saved.product)||{};
// The baseline is what "dirty" is measured against, so it has to be written or the
// form can never be clean again — the button would stay lit, the counters would keep
// reporting unsaved text, and every further save would write the same two fields.
//
// Taken from what the server stored rather than from what was sent. The API truncates
// a title to 70 characters and a description to 175, so a long paste comes back
// shorter; comparing against the text that was typed would leave the form permanently
// "dirty" and quietly re-send the over-length value on the next save.
//
// The list is deliberately not re-rendered here. That replaced productList.innerHTML,
// which destroyed this very form, so the old `finally` block updated a button that
// was no longer on the page, and it closed the form the owner was working in.
const storedTitle=stored.seoTitle!==undefined?stored.seoTitle:seoTitle,storedDescription=stored.seoDescription!==undefined?stored.seoDescription:seoDescription;form.dataset.seoTitle=storedTitle;form.dataset.seoDescription=storedDescription;
// If the server shortened anything, put its version back in the box so what is shown
// is what will be published.
if(form.elements.seoTitle.value!==storedTitle)form.elements.seoTitle.value=storedTitle;if(form.elements.seoDescription.value!==storedDescription)form.elements.seoDescription.value=storedDescription;
// The row's toggle still reads "Thêm SEO" until a title exists, so that one word is
// updated directly rather than by re-rendering everything.
for(const toggle of productList.querySelectorAll('[data-seo-toggle]')){if(toggle.dataset.seoToggle===form.dataset.seoForm){toggle.textContent='Sửa SEO';break}}seoLock(form,true);showToast('Đã lưu SEO')}catch(e){showToast(e.message,true)}
// Runs on the form that is still on screen, and the button follows the same
// comparison rule it always did. Clean after a save, so it locks; still dirty after a
// failure, so it unlocks and the owner can try again. Nothing sets it either way.
countSeo(form)}
async function uploadExistingProduct(event){const input=event.currentTarget,file=input.files?.[0];if(!file)return;input.disabled=true;try{const fileKey=await uploadRelease(file,input.dataset.productRef,input.dataset.version,m=>showToast(m));await api('/api/admin/products/'+encodeURIComponent(input.dataset.productId),{method:'PATCH',body:JSON.stringify({fileKey,status:'active'})});showToast('Đã cập nhật file phát hành');await loadProducts()}catch(e){showToast(e.message,true)}finally{input.disabled=false;input.value=''}}async function submitProduct(event){event.preventDefault();const form=event.currentTarget,button=document.getElementById('save-product'),data=Object.fromEntries(new FormData(form)),file=form.elements.releaseFile.files[0];button.disabled=true;productStatus.className='form-message';productStatus.textContent='Đang tạo sản phẩm…';try{const created=await api('/api/admin/products',{method:'POST',body:JSON.stringify({...data,features:data.features.split('\n').map(x=>x.trim()).filter(Boolean)})});let fileKey=created.product.fileKey||'';if(file){fileKey=await uploadRelease(file,created.product.slug||created.product.id,created.product.version,m=>productStatus.textContent=m);await api('/api/admin/products/'+encodeURIComponent(created.product.id),{method:'PATCH',body:JSON.stringify({fileKey,status:'active'})})}else if(fileKey){await api('/api/admin/products/'+encodeURIComponent(created.product.id),{method:'PATCH',body:JSON.stringify({status:'active'})})}form.reset();productStatus.textContent=fileKey?'Đã tạo sản phẩm và file phát hành.':'Đã tạo bản nháp. Hãy thêm file phát hành trước khi bán.';await loadProducts()}catch(error){productStatus.textContent=error.message;productStatus.className='form-message error'}finally{button.disabled=false}}async function loginSubmit(event){event.preventDefault();token=tokenInput.value.trim();try{await api('/api/admin/orders');sessionStorage.setItem('sonvudev_admin',token);tokenInput.value='';login.hidden=true;dashboard.hidden=false;productPanel.hidden=false;logout.hidden=false;resetOrderPage();loadProducts();if('Notification'in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});startPolling()}catch(error){status.textContent=error.message;status.className='form-message error';token=''}}document.getElementById('login-form').onsubmit=loginSubmit;logout.onclick=()=>{stopPolling();sessionStorage.removeItem('sonvudev_admin');token='';dashboard.hidden=true;productPanel.hidden=true;login.hidden=false;logout.hidden=true};document.getElementById('refresh').onclick=()=>{resetOrderPage();loadProducts()};// The list now starts visible; the button collapses it, so the label has to
// describe the action rather than the destination.
const productToggle=document.getElementById('toggle-products');productToggle.onclick=()=>{productList.hidden=!productList.hidden;productToggle.textContent=productList.hidden?'Xem danh sách ↓':'Ẩn danh sách ↑'};productForm.onsubmit=submitProduct;if(token){login.hidden=true;dashboard.hidden=false;productPanel.hidden=false;logout.hidden=false;if(revenuePanel)revenuePanel.hidden=false;resetOrderPage();loadRevenue();loadProducts();checkMail();startPolling()}

