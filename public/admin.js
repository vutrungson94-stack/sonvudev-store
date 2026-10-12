const body=document.getElementById('orders-body'),summary=document.getElementById('order-summary'),login=document.getElementById('login-card'),dashboard=document.getElementById('dashboard'),tokenInput=document.getElementById('admin-token'),status=document.getElementById('login-status'),logout=document.getElementById('logout'),toast=document.getElementById('toast'),productPanel=document.getElementById('product-panel'),productForm=document.getElementById('product-form'),productStatus=document.getElementById('product-status'),productList=document.getElementById('admin-product-list'),revenuePanel=document.getElementById('revenue-panel'),moreRow=document.getElementById('orders-more'),moreBtn=document.getElementById('orders-more-btn'),revenueBody=document.getElementById('revenue-body'),revenueTotals=document.getElementById('revenue-totals'),revenueNote=document.getElementById('revenue-note'),revenueRefresh=document.getElementById('revenue-refresh'),orderSearch=document.getElementById('order-search'),orderStatusFilter=document.getElementById('order-status'),productSearch=document.getElementById('product-search'),productStatusFilter=document.getElementById('product-status'),refundModal=document.getElementById('refund-modal'),refundForm=document.getElementById('refund-form'),refundOrderLine=document.getElementById('refund-order'),refundEvidence=document.getElementById('refund-evidence'),refundStatus=document.getElementById('refund-status'),refundPartial=document.getElementById('refund-partial'),refundSubmit=document.getElementById('refund-submit');let token=sessionStorage.getItem('sonvudev_admin')||'';const esc=v=>window.SVDFormat.esc(v);// Money is formatted for the currency of the row, never for VND with the code
// appended afterwards. That combination is wrong the moment a row is not VND: the
// amount was grouped as vi-VN with no decimals and then labelled USD, which is the
// exact mistake src/format.js documents — a PayPal order read "3 USD" or
// "3,81 USD" depending on the browser, next to a bank-transfer row reading
// "99.000 VND". One call, the row's own currency.
const amount=(v,currency)=>window.SVDFormat.money(v,currency);const labels={pending:'Chờ xử lý',pending_transfer:'Chờ chuyển khoản',paid:'Đã thanh toán',payment_failed:'Thất bại',cancelled:'Đã hủy',refunded:'Đã hoàn tiền'};function showToast(m,error=false){toast.textContent=m;toast.className=`toast show${error?' error':''}`;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.className='toast',3500)}async function api(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json','x-admin-token':token,...(options.headers||{})}}),d=await r.json();if(!r.ok)throw Error(d.error||'Không thể tải dữ liệu');return d}
// Order alerts. A bank transfer can sit unpaid for hours, so the panel polls a
// cheap endpoint and complains loudly rather than waiting for a manual refresh.
// Expired orders are already cancelled by the server, so only orders that are
// still inside their payment window are worth waking the owner for.
const alertBox=document.getElementById('admin-alert'),alertTitle=document.getElementById('admin-alert-title'),alertText=document.getElementById('admin-alert-text'),alertGo=document.getElementById('admin-alert-go');
let seenLatest=null,pendingTimer=null,alertAcked=false,lastPending=null;
const titleBase=document.title;
function beep(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const ctx=new C(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.type='sine';osc.frequency.setValueAtTime(880,ctx.currentTime);osc.frequency.setValueAtTime(1180,ctx.currentTime+.18);gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.25,ctx.currentTime+.02);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.45);osc.start();osc.stop(ctx.currentTime+.5)}catch(e){}}
function notifyOrder(text){try{if(document.hidden&&'Notification'in window&&Notification.permission==='granted')new Notification((document.querySelector('.brand')?.textContent||'Shop').trim()+': đơn hàng mới',{body:text,tag:'sonvudev-order'})}catch(e){}}
function showAlert(kind,count,order){
  if(kind==='pending'){alertTitle.textContent=count+' đơn đang chờ chuyển khoản';alertText.textContent='Vào xác nhận để khách tải được sản phẩm.'}
  else{alertTitle.textContent='Có đơn mới';alertText.textContent=order?'Đơn '+order.id+' vừa được tạo.':'Mở bảng bên dưới để xem.'}
  alertBox.hidden=false;
}
async function pollPending(){
  if(!token||(document.hidden&&seenLatest!==null))return;
  try{
    const data=await api('/api/admin/orders/pending');
    if(seenLatest===null){seenLatest=data.latest;lastPending=data.pending;return}
    if(data.latest>seenLatest){
      seenLatest=data.latest;
      lastPending=data.pending;
      // Một đơn mới luôn báo, kể cả khi chủ shop vừa bỏ qua nhắc nhở cũ.
      alertAcked=false;
      showAlert('new',0,data.newest);
      document.title='(NEW) '+titleBase;
      beep();
      notifyOrder(data.newest?'Đơn '+data.newest.id:'Có đơn mới chờ xữ lý');
      resetOrderPage();
    }else if(data.pending>0){
      // Số đơn chờ thay đổi thì nhắc lại; cùng số thì im nếu đã bỏ qua.
      if(data.pending!==lastPending)alertAcked=false;
      lastPending=data.pending;
      if(alertAcked)alertBox.hidden=true;
      else showAlert('pending',data.pending,null);
    }else{
      lastPending=null;
      alertAcked=false;
      alertBox.hidden=true;
      document.title=titleBase;
    }
  }catch(e){}
}
function startPolling(){stopPolling();pollPending();pendingTimer=setInterval(pollPending,30000)}
function stopPolling(){if(pendingTimer)clearInterval(pendingTimer);pendingTimer=null;seenLatest=null;document.title=titleBase;if(alertBox)alertBox.hidden=true}
// Bỏ qua chỉ tắt nhắc nhở hiện tại: đơn mới, hoặc số đơn chờ thay đổi, vẫn báo lại.
if(alertGo)alertGo.onclick=()=>{alertAcked=true;alertBox.hidden=true;document.title=titleBase;resetOrderPage()};
const alertClose=document.getElementById('admin-alert-close');
if(alertClose)alertClose.onclick=()=>{alertAcked=true;alertBox.hidden=true;document.title=titleBase};
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
// tells them nothing when money already moved. It also needs a *category*, because
// the three kinds are not the same decision and only one of them is a partial: a
// defect and a duplicate are the shop's fault and return everything, while a buyer
// who already holds the file is the case the policy is written for. The evidence
// panel above the form is there on purpose — how many times the file left, and
// when, is what the conversation with that buyer is actually about.
let refundTarget=null;
function refundOrder(id){const order=ordersById.get(id);if(order)openRefund(order)}
function refundCategory(){return (refundForm.querySelector('input[name=category]:checked')||{}).value||''}
function openRefund(order){
  refundTarget=order;
  const paid=Number(order.paidAmount||order.amount)||0,delivered=order.deliveredAt?new Date(order.deliveredAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'',paidAt=order.paidAt?new Date(order.paidAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'';
  refundOrderLine.textContent=`Đơn ${order.id} · ${order.customerEmail||order.customer_name||''} · đã thu ${amount(paid,order.currency)}`;
  const facts=[paidAt?`Đã thu tiền lúc ${paidAt}`:'',delivered?`File đã giao lúc ${delivered}`:'Chưa giao file',order.downloads?`Đã tải ${order.downloads} lần`:'Chưa tải lần nào',order.policyAcceptedAt?`Đồng ý điều khoản lúc ${new Date(order.policyAcceptedAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}${order.policyAcceptedIp?` (IP ${order.policyAcceptedIp})`:''}${order.policyAcceptedVersion?` · chính sách ${order.policyAcceptedVersion}`:''}`:'Không có bản ghi đồng ý điều khoản'].filter(Boolean);
  refundEvidence.innerHTML=facts.map(f=>`<div>${esc(f)}</div>`).join('');
  refundEvidence.hidden=false;
  refundForm.reset();
  refundPartial.hidden=true;
  refundStatus.textContent='';
  refundModal.hidden=false;
}
function closeRefund(){refundModal.hidden=true;refundTarget=null}
for(const el of[document.getElementById('refund-close'),document.getElementById('refund-cancel')])if(el)el.onclick=closeRefund;
if(refundForm)refundForm.onchange=()=>{refundPartial.hidden=refundCategory()!=='changed_mind';if(refundCategory()==='changed_mind'&&refundTarget)refundPartial.querySelector('input').placeholder=`Giá trị thực, nhỏ hơn ${amount(Number(refundTarget.paidAmount||refundTarget.amount)||0,refundTarget.currency)}`};
if(refundForm)refundForm.onsubmit=async event=>{
  event.preventDefault();
  const category=refundCategory(),reason=new FormData(refundForm).get('reason')||'';
  if(!category||!String(reason).trim())return;
  const payload={refund:true,category,reason:String(reason).trim()};
  if(category==='changed_mind')payload.partialAmount=Number(new FormData(refundForm).get('partialAmount'));
  refundSubmit.disabled=true;refundSubmit.textContent='Đang hoàn…';
  try{
    await api('/api/admin/orders/'+encodeURIComponent(refundTarget.id),{method:'PATCH',body:JSON.stringify(payload)});
    showToast('Đã ghi nhận hoàn tiền và gửi email cho khách');closeRefund();resetOrderPage();loadRevenue()
  }catch(e){refundStatus.textContent=e.message;refundStatus.className='form-message error'}
  finally{refundSubmit.disabled=false;refundSubmit.textContent='Hoàn tiền'}
};
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
    // Each bucket formatted with its own currency. The USD branch was a special
    // case in three places that all did the same thing; the shared formatter takes
    // the currency as an argument, so the branch disappears along with the chance
    // of adding a fourth currency and forgetting it in one of the three.
    const bucket=(map)=>Object.entries(map||{}).filter(([,v])=>Number(v)>0).map(([c,v])=>amount(v,c));
    const parts=bucket(data.net);
    const back=bucket(data.refunds);
    const waiting=bucket(data.outstanding);
    revenueTotals.innerHTML=`<div><b>${esc(parts.join(' + ')||'Chưa có doanh thu')}</b><small>thu ròng, ${data.paidOrders} lượt đã thu${data.refundedOrders?`, ${data.refundedOrders} đã hoàn lại`:''}</small></div><div><b>${back.length?esc(back.join(' + ')):'0đ'}</b><small>đã hoàn trả cho khách</small></div><div><b>${waiting.length?esc(waiting.join(' + ')):'0'}</b><small>đang chờ thu, chưa quá hạn</small></div>`;
    const rows=data.products||[];
    revenueBody.innerHTML=rows.length?rows.map(r=>`<tr><td data-label="Sản phẩm"><b>${esc(r.name)}</b><small>v${esc(r.version||'—')}</small></td><td data-label="Đã bán">${r.units}</td><td data-label="Số đơn">${r.orders}</td><td data-label="Doanh thu"><strong>${esc(amount(r.revenue, r.currency))}</strong><small>TB ${esc(amount(r.avg, r.currency))}${r.refunds?` · hoàn ${esc(amount(r.refunds, r.currency))}`:''}</small></td><td data-label="Thực nhận PayPal">${r.provider>0?`<strong>${esc(amount(r.provider, 'USD'))}</strong>`:'—'}</td></tr>`).join(''):'<tr><td colspan="5" class="table-empty">Chưa có doanh thu.</td></tr>';
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

// orderTotal was declared here and reset here and read nowhere. The count the owner
// actually sees comes from the server's `total` on each page, because that is the
// number of rows matching the filter rather than of rows loaded — two different
// numbers, and only one of them is written to the screen.
let orderPage=0, orderHasMore=false, orderLoading=false;
const ORDER_PAGE=50;
// What the owner typed or picked, sent to the server on every request. The count
// in the summary below is filtered by the same terms, so the sentence on screen
// describes the rows on screen instead of the rows the panel refused to show.
const orderFilterActive=()=>Boolean(orderSearch.value.trim()||orderStatusFilter.value);
const orderQuery=(append)=>{
  const params=new URLSearchParams({limit:String(ORDER_PAGE),offset:String(append?orderPage*ORDER_PAGE:0)});
  const q=orderSearch.value.trim();
  if(q)params.set('q',q);
  if(orderStatusFilter.value)params.set('status',orderStatusFilter.value);
  return params.toString();
};
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
    const d=await api('/api/admin/orders?'+orderQuery(append)),orders=d.orders||[];
    orderPage=append?orderPage+1:1;
    orderHasMore=Boolean(d.hasMore);
    refundedEmails=new Set((d.refundedEmails||[]).map(e=>String(e).toLowerCase()));
    if(!append)ordersById.clear();
    for(const order of orders)ordersById.set(order.id,order);
    // Live orders are counted across the whole shop rather than the page on
    // screen, so the figure does not drop back just because the owner scrolled.
    const open=(Number(d.live)||0)+orders.filter(o=>o.status==='pending_transfer'&&!o.deliveredAt).length;
    const rows=orders.map(orderRow).join('');
    if(append&&body.innerHTML)body.insertAdjacentHTML('beforeend',rows);
    else body.innerHTML=orders.length?rows:`<tr><td colspan="6" class="table-empty">${orderFilterActive()?'Không có đơn nào khớp bộ lọc.':'Chưa có đơn hàng.'}</td></tr>`;
    for(const attr of ['data-status','data-delivered','data-reopen','data-refund','data-reopen2']){
      body.querySelectorAll('['+attr+']').forEach(btn=>{
        const id=btn.dataset[attr.slice(5).replace(/-([a-z])/g,(m,c)=>c.toUpperCase())];
        if(attr==='data-status')btn.onclick=()=>updateOrder(id,btn.dataset.next);
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
    // Filtered, the scroll figure is meaningless ("đã xem 50 / 2"), so it gives way
    // to how many matched — with the shop-wide waiting count kept beside it, since
    // that figure is about the shop rather than about the rows being looked at.
    summary.textContent=orderFilterActive()
      ? (total+' đơn khớp bộ lọc'+(open?' · '+open+' đơn đang chờ thu trên toàn shop':''))
      : open
        ? (open+' đơn đang chờ chuyển khoản · đã xem '+(orderPage*ORDER_PAGE)+suffix+' / '+total)
        : (total+' đơn hàng trong hệ thống');
    moreRow.hidden=!orderHasMore;
    moreBtn.textContent=orderHasMore?'Tải thêm đơn hàng':'Đã xem hết đơn hàng';
  }catch(e){showToast(e.message,true)}
  finally{orderLoading=false;moreBtn.disabled=false}
}
function resetOrderPage(){orderPage=0;orderHasMore=false;return loadOrders()}
// A returning buyer who was once given money back is the row the owner has to see
// before confirming a second payment. The set comes from the server and answers
// for every order ever refunded, not just the page on screen — which is why it is
// a Set and not something derived from the rows currently rendered.
let refundedEmails=new Set();
const refundedFlag=(o)=>{const email=String(o.customerEmail||o.customer_email||'').toLowerCase();return o.status!=='refunded'&&email&&refundedEmails.has(email)?'<small class="refunded-flag">KH này đã từng được hoàn tiền</small>':''};
// The refund dialog is opened from an order id on a button, but it is about the
// order: the evidence it shows is read off the row. The map holds every order the
// page has loaded, so a click on a row appended three pages deep still finds it.
const ordersById=new Map();
moreBtn.onclick=()=>loadOrders({append:true});function orderRow(o){const item=o.items?.[0]||{};const when=new Date(o.createdAt||o.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});return `<tr><td data-label="Mã đơn"><code>${esc(o.id)}</code><small title="${esc(when)}">${esc(new Date(o.createdAt||o.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}))}</small></td><td data-label="Khách hàng">${esc(o.customerName||o.customer_name||'—')}<small>${esc(o.customerEmail||o.customer_email)}</small>${refundedFlag(o)}</td><td data-label="Sản phẩm">${esc(item.name||'—')}<small>v${esc(item.version||'—')}</small></td><td data-label="Số tiền"><strong>${esc(amount(o.amount, o.currency))}</strong>${o.paidCount?`<small>${o.paidCount} lần đã thu</small>`:''}</td><td data-label="Trạng thái"><span class="status-pill status-${esc(o.status)}">${esc(labels[o.status]||o.status)}</span>${o.deliveredAt?`<small>đã giao ${esc(new Date(o.deliveredAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))}</small>`:''}${o.refundedAt?`<small>đã hoàn ${esc(new Date(o.refundedAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))}</small>`:''}${o.status==='cancelled'&&o.cancelledAt?`<small>hết hạn lúc ${esc(new Date(o.cancelledAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))}</small>`:''}${o.downloads?`<small>đã tải ${esc(String(o.downloads))} lần</small>`:''}</td><td data-label="Thao tác">${o.status==='pending_transfer'?`<button class="table-action" data-status="${esc(o.id)}" data-next="paid">Xác nhận thu</button>`:o.status==='paid'?`<button class="table-action" data-delivered="${esc(o.id)}">Đã giao xong</button> <button class="table-action" data-refund="${esc(o.id)}">Hoàn tiền</button>`:o.status==='refunded'?`<button class="table-action" data-reopen2="${esc(o.id)}">Mở lại đơn</button>`:o.deliveredAt?`<button class="table-action" data-reopen="${esc(o.id)}">Mở lại đơn</button>`:'—'}</td></tr>`}async function updateOrder(id,nextStatus){if(!confirm('Xác nhận đơn hàng đã thanh toán?'))return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:nextStatus})});showToast('Đã cập nhật đơn hàng và gửi email cho khách');resetOrderPage()}catch(e){showToast(e.message,true)}}async function markDelivered(id){if(!confirm('Đóng đơn hàng? Nút tải sẽ khóa lại.'))return;try{await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({delivered:true})});showToast('Đã đóng đơn hàng');resetOrderPage()}catch(e){showToast(e.message,true)}}
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
const productCount=document.getElementById('product-count');
// A hundred products made this list a page of its own; the owner looks for one of
// them by name. The filter goes to the server so a shop with a thousand products
// costs the same query, and the row count reflects what matched rather than what
// the shop holds.
const productQuery=()=>{const params=new URLSearchParams();if(productSearch.value.trim())params.set('q',productSearch.value.trim());if(productStatusFilter.value)params.set('status',productStatusFilter.value);return params};
const productFiltering=()=>Boolean(productSearch.value.trim()||productStatusFilter.value);
async function loadProducts(){try{const params=productQuery(),d=await api('/api/admin/products'+(params.toString()?'?'+params.toString():'')),list=d.products||[];if(productCount)productCount.textContent=list.length+' sản phẩm';productList.innerHTML=list.length?list.map(p=>`<div class="admin-product-row"><span class="admin-product-icon">${esc((p.name||'SV').slice(0,2).toUpperCase())}</span><div><b>${esc(p.name)}</b><small>${esc(p.version)} · ${esc(amount(p.price, p.currency))} · ${esc(productStatusLabel(p.status))}</small></div><div class="admin-product-actions"><span>${p.fileKey?'Đã có file':'Chưa có file'}</span><label class="admin-upload-button">Cập nhật file<input type="file" accept=".zip,.exe,.msi,.7z" data-product-id="${esc(p.id)}" data-product-ref="${esc(p.slug)}" data-version="${esc(p.version)}" hidden></label><button class="text-link" type="button" data-seo-toggle="${esc(p.id)}">${p.seoTitle?'Sửa SEO':'Thêm SEO'}</button><button class="text-link" type="button" data-archive="${esc(p.id)}" data-archive-to="${p.status==='archived'?(p.fileKey?'active':'draft'):'archived'}">${p.status==='archived'?'Bỏ lưu trữ':'Lưu trữ'}</button><button class="text-link text-link-danger" type="button" data-delete="${esc(p.id)}">Xoá</button></div>${seoEditor(p)}</div>`).join(''):`<p class="table-empty">${productFiltering()?'Không có sản phẩm nào khớp bộ lọc.':'Chưa có sản phẩm.'}</p>`;productList.querySelectorAll('input[type=file]').forEach(input=>input.onchange=uploadExistingProduct);productList.querySelectorAll('[data-seo-toggle]').forEach(button=>button.onclick=()=>{const form=productList.querySelector(`[data-seo-form="${button.dataset.seoToggle}"]`);if(form){form.hidden=!form.hidden;if(!form.hidden){seoLock(form,false);countSeo(form)}}});productList.querySelectorAll('[data-seo-form]').forEach(form=>{form.onsubmit=saveSeo;seoLock(form,true);form.querySelectorAll('input,textarea').forEach(input=>input.oninput=()=>countSeo(form))});productList.querySelectorAll('[data-archive]').forEach(button=>button.onclick=()=>changeProductStatus(button));productList.querySelectorAll('[data-delete]').forEach(button=>button.onclick=()=>deleteProductRow(button))}catch(e){showToast(e.message,true)}}
function seoEditor(p){return `<form class="admin-seo-form" data-seo-form="${esc(p.id)}" data-seo-title="${esc(p.seoTitle||'')}" data-seo-description="${esc(p.seoDescription||'')}" data-seo-title-en="${esc(p.seoTitleEn||'')}" data-seo-description-en="${esc(p.seoDescriptionEn||'')}" hidden><label>Tiêu đề tìm kiếm<input name="seoTitle" maxlength="70" value="${esc(p.seoTitle||'')}" placeholder="Để trống thì lấy tên sản phẩm"></label><label>Mô tả tìm kiếm<textarea name="seoDescription" maxlength="175" rows="2" placeholder="Câu người ta gõ vào Google, trả lời thẳng vấn đề của họ">${esc(p.seoDescription||'')}</textarea></label><label>SEO tiếng Anh — tiêu đề<input name="seoTitleEn" maxlength="70" value="${esc(p.seoTitleEn||'')}" placeholder="Để trống: trang /en/ tự sinh tiêu đề từ tên sản phẩm"></label><label>SEO tiếng Anh — mô tả<textarea name="seoDescriptionEn" maxlength="175" rows="2" placeholder="Để trống: trang /en/ dùng mô tả tiếng Anh của sản phẩm">${esc(p.seoDescriptionEn||'')}</textarea></label><p class="admin-seo-count"></p><button class="button button-primary" type="submit" disabled>Lưu SEO</button></form>`}
// Read-only once saved, editable once "Sửa SEO" is pressed.
//
// A form that is saved and still accepts typing is the form the owner reported:
// they pressed Lưu SEO, nothing visibly happened, and pressing it again wrote the
// same two fields. Locking the inputs and saying so removes the ambiguity — the
// greyed fields are the confirmation, not just the button. The alternative, leaving
// them live and relying on a disabled button, was tried and read as a broken form.
function seoLock(form,locked){for(const el of form.querySelectorAll('input,textarea'))el.readOnly=locked;form.classList.toggle('locked',locked)}
// The four SEO fields, in one list, so "is this form dirty", the counters and the
// save payload cannot each name a different subset. The Vietnamese pair and the
// English pair are the same field in two languages, which is why they travel
// together: saving one and forgetting the other leaves /en/ with no SEO copy.
//
// The dataset key is the field name, so the baseline written after a save and the
// baseline compared before it can never be two different spellings of one thing.
const SEO_FIELDS=[['seoTitle','Tiêu đề',70,60],['seoDescription','Mô tả',175,160],['seoTitleEn','SEO EN tiêu đề',70,60],['seoDescriptionEn','SEO EN mô tả',175,160]];
function seoDirty(form){return SEO_FIELDS.some(([field])=>(form.elements[field]?form.elements[field].value.trim():'')!==(form.dataset[field]||''))}
// The counter doubles as the form's state. A clean form says so: the save button is
// disabled because there is nothing to save, and saying "Đã lưu" is the only visible
// sign that the click a moment ago worked. Without it the owner presses save, sees a
// toast they may have missed, and presses it again — which is what happened.
function countSeo(form){const out=form.querySelector('.admin-seo-count'),button=form.querySelector('button[type=submit]'),clean=!seoDirty(form);if(button)button.disabled=clean;if(!out)return;const parts=SEO_FIELDS.map(([field,label,max,cut])=>{const el=form.elements[field],n=(el?el.value:'').length;return `${label} ${n}/${max}${n>cut?' (bị cắt)':''}`});out.textContent=parts.join(' · ')+(clean?' · Đã lưu':'');out.className='admin-seo-count'+(clean?' clean':'')+(parts.some(x=>x.includes('bị cắt'))?' over':'')}
async function saveSeo(event){event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]');button.disabled=true;const data=Object.fromEntries(new FormData(form)),payload={};for(const [field] of SEO_FIELDS)payload[field]=(data[field]||'').trim();try{const saved=await api('/api/admin/products/'+encodeURIComponent(form.dataset.seoForm),{method:'PATCH',body:JSON.stringify(payload)}),stored=(saved&&saved.product)||{};
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
const storedTitle=stored.seoTitle!==undefined?stored.seoTitle:payload.seoTitle,storedDescription=stored.seoDescription!==undefined?stored.seoDescription:payload.seoDescription,storedTitleEn=stored.seoTitleEn!==undefined?stored.seoTitleEn:payload.seoTitleEn,storedDescriptionEn=stored.seoDescriptionEn!==undefined?stored.seoDescriptionEn:payload.seoDescriptionEn;form.dataset.seoTitle=storedTitle;form.dataset.seoDescription=storedDescription;form.dataset.seoTitleEn=storedTitleEn;form.dataset.seoDescriptionEn=storedDescriptionEn;
// If the server shortened anything, put its version back in the box so what is shown
// is what will be published.
if(form.elements.seoTitle.value!==storedTitle)form.elements.seoTitle.value=storedTitle;if(form.elements.seoDescription.value!==storedDescription)form.elements.seoDescription.value=storedDescription;if(form.elements.seoTitleEn.value!==storedTitleEn)form.elements.seoTitleEn.value=storedTitleEn;if(form.elements.seoDescriptionEn.value!==storedDescriptionEn)form.elements.seoDescriptionEn.value=storedDescriptionEn;
// The row's toggle still reads "Thêm SEO" until a title exists, so that one word is
// updated directly rather than by re-rendering everything.
for(const toggle of productList.querySelectorAll('[data-seo-toggle]')){if(toggle.dataset.seoToggle===form.dataset.seoForm){toggle.textContent='Sửa SEO';break}}seoLock(form,true);showToast('Đã lưu SEO')}catch(e){showToast(e.message,true)}
// Runs on the form that is still on screen, and the button follows the same
// comparison rule it always did. Clean after a save, so it locks; still dirty after a
// failure, so it unlocks and the owner can try again. Nothing sets it either way.
countSeo(form)}
async function uploadExistingProduct(event){const input=event.currentTarget,file=input.files?.[0];if(!file)return;input.disabled=true;try{const fileKey=await uploadRelease(file,input.dataset.productRef,input.dataset.version,m=>showToast(m));await api('/api/admin/products/'+encodeURIComponent(input.dataset.productId),{method:'PATCH',body:JSON.stringify({fileKey,status:'active'})});showToast('Đã cập nhật file phát hành');await loadProducts()}catch(e){showToast(e.message,true)}finally{input.disabled=false;input.value=''}}// One feature per line, into an array. Used for both languages: the server wants
// an array, and featuresEn went unsplit when the field did not exist yet, which
// silently discarded every English feature on the /en/ page.
const lines=v=>String(v||'').split('\n').map(x=>x.trim()).filter(Boolean);
async function submitProduct(event){event.preventDefault();const form=event.currentTarget,button=document.getElementById('save-product'),data=Object.fromEntries(new FormData(form)),file=form.elements.releaseFile.files[0];button.disabled=true;productStatus.className='form-message';productStatus.textContent='Đang tạo sản phẩm…';try{const created=await api('/api/admin/products',{method:'POST',body:JSON.stringify({...data,features:lines(data.features),featuresEn:lines(data.featuresEn)})});let fileKey=created.product.fileKey||'';if(file){fileKey=await uploadRelease(file,created.product.slug||created.product.id,created.product.version,m=>productStatus.textContent=m);await api('/api/admin/products/'+encodeURIComponent(created.product.id),{method:'PATCH',body:JSON.stringify({fileKey,status:'active'})})}else if(fileKey){await api('/api/admin/products/'+encodeURIComponent(created.product.id),{method:'PATCH',body:JSON.stringify({status:'active'})})}form.reset();productStatus.textContent=fileKey?'Đã tạo sản phẩm và file phát hành.':'Đã tạo bản nháp. Hãy thêm file phát hành trước khi bán.';await loadProducts()}catch(error){productStatus.textContent=error.message;productStatus.className='form-message error'}finally{button.disabled=false}}async function loginSubmit(event){event.preventDefault();token=tokenInput.value.trim();try{await api('/api/admin/orders');sessionStorage.setItem('sonvudev_admin',token);tokenInput.value='';login.hidden=true;showAfterLogin();resetOrderPage();loadProducts();if('Notification'in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});startPolling()}catch(error){status.textContent=error.message;status.className='form-message error';token=''}}// Everything the session could have put on screen goes back down, in one list, so a
// new panel cannot be forgotten here. The revenue panel was: logout hid the
// dashboard, the product editor, the login card and the button, and left the
// revenue totals and the per-product revenue table visible for whoever was at the
// keyboard next — which is exactly the number the owner would not want a shared
// machine to keep showing.
const hideAll=()=>{for(const panel of[dashboard,productPanel,revenuePanel])if(panel)panel.hidden=true};
const showAfterLogin=()=>{hideAll();if(revenuePanel)revenuePanel.hidden=false;dashboard.hidden=false;productPanel.hidden=false;logout.hidden=false};
// Archiving is how a product comes off sale without its history going with it: it
// leaves the shop, the sitemap and the catalogue, and keeps its page, its reviews
// and every order ever placed for it. Coming back puts it where the file allows —
// a product with no release file returns as a draft rather than straight on sale.
async function changeProductStatus(button){const next=button.dataset.archiveTo;if(!confirm(next==='archived'?'Lưu trữ sản phẩm này? Nó sẽ biến khỏi cửa hàng; đơn cũ và doanh thu vẫn giữ nguyên.':'Bỏ lưu trữ để sản phẩm hiện lại trong cửa hàng?'))return;try{await api('/api/admin/products/'+encodeURIComponent(button.dataset.archive),{method:'PATCH',body:JSON.stringify({status:next})});showToast(next==='archived'?'Đã lưu trữ sản phẩm':'Đã bỏ lưu trữ sản phẩm');await loadProducts()}catch(e){showToast(e.message,true)}}
// Deletion is for a product that never sold. The server is the one that knows: a
// product with orders behind it is refused, and its sentence is shown exactly as
// it arrived — how many orders there are, and to archive instead — because that
// reply is the whole point of asking in the first place.
async function deleteProductRow(button){if(!confirm('Xoá hẳn sản phẩm này? Không hoàn tác được.'))return;try{await api('/api/admin/products/'+encodeURIComponent(button.dataset.delete),{method:'DELETE'});showToast('Đã xoá sản phẩm');await loadProducts()}catch(e){showToast(e.message,true)}}
// One request per pause, not per keystroke. Both boxes answer from the shop's own
// data, so typing a long email address used to fire a query per character.
const debounce=(fn,ms)=>{let timer;return()=>{clearTimeout(timer);timer=setTimeout(fn,ms)}};
if(orderSearch){orderSearch.addEventListener('input',debounce(()=>resetOrderPage(),300));orderSearch.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();resetOrderPage()}else if(e.key==='Escape'){orderSearch.value='';resetOrderPage()}})}
if(orderStatusFilter)orderStatusFilter.addEventListener('change',()=>resetOrderPage());
if(productSearch){productSearch.addEventListener('input',debounce(()=>loadProducts(),300));productSearch.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();loadProducts()}else if(e.key==='Escape'){productSearch.value='';loadProducts()}})}
if(productStatusFilter)productStatusFilter.addEventListener('change',()=>loadProducts());
document.getElementById('login-form').onsubmit=loginSubmit;logout.onclick=()=>{stopPolling();sessionStorage.removeItem('sonvudev_admin');token='';hideAll();login.hidden=false;logout.hidden=true};document.getElementById('refresh').onclick=()=>{resetOrderPage();loadProducts()};// The list now starts visible; the button collapses it, so the label has to
// describe the action rather than the destination.
const productToggle=document.getElementById('toggle-products');productToggle.onclick=()=>{productList.hidden=!productList.hidden;productToggle.textContent=productList.hidden?'Xem danh sách ↓':'Ẩn danh sách ↑'};productForm.onsubmit=submitProduct;if(token){login.hidden=true;showAfterLogin();resetOrderPage();loadRevenue();loadProducts();checkMail();startPolling()}

