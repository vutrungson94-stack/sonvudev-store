const form=document.getElementById('lookup-form'),status=document.getElementById('lookup-status'),submit=document.getElementById('lookup-submit');
// Every string is read from the same dictionary the storefront uses. This page
// used to carry its own hardcoded copy, which is why an English buyer who lost
// their order code after paying by PayPal was told what to do in Vietnamese.
const T=(key,fallback)=>window.I18N.t(key,fallback);
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
  if(!data.orderId||!data.email){
    status.className='form-message error';
    status.textContent=T('lookup.errFields');
    return;
  }
  status.className='form-message';
  status.textContent=T('lookup.working');
  submit.disabled=true;
  try{
    const response=await fetch('/api/orders/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:data.orderId,email:data.email})});
    const payload=await response.json();
    // The rate limit is the one failure this page can recognise on its own: the
    // server's message is written in the server's language, not the reader's.
    if(response.status===429)throw Error(T('lookup.errRate'));
    if(!response.ok)throw Error(T('lookup.errNotFound'));
    window.OrderClient.write(payload.order.id,payload.accessToken);
    status.className='form-message ok';
    status.textContent='✓ '+payload.order.id;
    location.href='/order/'+encodeURIComponent(payload.order.id);
  }catch(error){
    status.className='form-message error';
    status.textContent=error.message;
  }finally{
    submit.disabled=false;
  }
}
form.addEventListener('submit',lookup);
