const form=document.getElementById('lookup-form'),status=document.getElementById('lookup-status'),submit=document.getElementById('lookup-submit');
// The order screen links here with the id already attached. Retyping a code from
// a receipt onto a phone keyboard is exactly the step that stops people
// recovering, so the one value we already know arrives filled in.
try{
  const prefilled=new URLSearchParams(location.search).get('order');
  if(prefilled)form.elements.orderId.value=prefilled.toUpperCase().slice(0,80);
}catch(error){}
// The checkout token only ever lives in the browser session, so this page
// recovers access by order id + email. The server re-issues a fresh token and
// invalidates the old one, which is why this stays safe without emailing anyone.
async function lookup(event){
  event.preventDefault();
  const data=Object.fromEntries(new FormData(form));
  status.className='form-message';
  status.textContent='Đang tra cứu…';
  submit.disabled=true;
  try{
    const response=await fetch('/api/orders/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:data.orderId,email:data.email})});
    const payload=await response.json();
    if(!response.ok) throw Error(payload.error||'Không tra cứu được đơn hàng.');
    sessionStorage.setItem('sonvudev_order',JSON.stringify({id:payload.order.id,token:payload.accessToken}));
    status.className='form-message ok';
    status.textContent='Đã tìm thấy đơn '+payload.order.id+'. Đang mở trang đơn hàng…';
    location.href='/order/'+encodeURIComponent(payload.order.id);
  }catch(error){
    status.className='form-message error';
    status.textContent=error.message;
  }finally{
    submit.disabled=false;
  }
}
form.addEventListener('submit',lookup);
