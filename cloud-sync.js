/* Al Maari cross-device sync - verified writes and visible status. */
(function(){
  const cfg=window.MAARI_CLOUD_CONFIG||{};
  const configured=!!(cfg.url&&cfg.anonKey&&cfg.ownerUserId);
  let accessToken=null, lastUpdatedAt=null, writeQueue=Promise.resolve();
  const endpoint=()=>String(cfg.url||'').replace(/\/$/,'');
  function status(message){const el=document.getElementById('cloudStatus');if(el)el.textContent=message;}
  async function request(path,opts={}){
    const headers=Object.assign({'apikey':cfg.anonKey,'Content-Type':'application/json'},opts.headers||{});
    if(accessToken)headers.Authorization='Bearer '+accessToken;
    const res=await fetch(endpoint()+path,Object.assign({},opts,{headers}));
    const body=await res.text();let parsed=null;try{parsed=body?JSON.parse(body):null}catch{}
    if(!res.ok)throw new Error(parsed?.message||parsed?.msg||parsed?.error_description||`HTTP ${res.status}: ${body.slice(0,300)}`);
    return parsed;
  }
  async function fetchState(){
    if(!configured)return null;
    const rows=await request('/rest/v1/catalog_state?id=eq.main&select=payload,updated_at');
    return rows&&rows.length&&rows[0].payload?rows[0]:null;
  }
  async function bootstrap(){
    if(!configured)return null;
    const row=await fetchState();
    if(row){lastUpdatedAt=row.updated_at||null;return row.payload;}
    return null;
  }
  function watch(onUpdate,intervalMs=45000){
    if(!configured||typeof onUpdate!=='function')return ()=>{};
    let stopped=false,busy=false;
    const tick=async()=>{if(stopped||busy||accessToken)return;busy=true;try{const row=await fetchState();if(row&&row.updated_at&&row.updated_at!==lastUpdatedAt){lastUpdatedAt=row.updated_at;onUpdate(row.payload);}}catch(e){console.warn('Maari cloud refresh failed',e);}finally{busy=false;}};
    const id=setInterval(tick,intervalMs);return ()=>{stopped=true;clearInterval(id);};
  }
  async function write(data){
    if(!configured)throw new Error('إعداد السحابة غير مكتمل.');
    if(!accessToken)throw new Error('سجّل دخول المالك من لوحة الإدارة قبل الحفظ السحابي.');
    const stamp=new Date().toISOString();
    await request('/rest/v1/catalog_state?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({id:'main',payload:data,updated_at:stamp})});
    const check=await fetchState();
    if(!check||!check.payload)throw new Error('تم إرسال الحفظ لكن تعذّر التحقق من وجود النسخة السحابية.');
    lastUpdatedAt=check.updated_at||stamp;
    status('☁️ تم حفظ التعديلات على السحابة بنجاح');
    return true;
  }
  function save(data){
    const snapshot=JSON.parse(JSON.stringify(data));
    status('☁️ جارٍ رفع التعديلات إلى السحابة…');
    const task=writeQueue.then(()=>write(snapshot));
    writeQueue=task.catch(()=>{});
    return task.catch(e=>{status('⚠️ تعذّر رفع التعديلات: '+(e.message||'خطأ غير معروف'));console.error('Maari cloud save failed',e);throw e;});
  }
  async function signIn(email,password){
    if(!configured)throw new Error('إعداد السحابة غير مكتمل.');
    const result=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});
    if(!result?.access_token)throw new Error('لم يتم استلام رمز الدخول.');
    const user=result.user||{};
    if(user.id!==cfg.ownerUserId){accessToken=null;throw new Error('هذا الحساب ليس حساب مالك المستودع.');}
    accessToken=result.access_token;return true;
  }
  window.MaariCloud={isConfigured:()=>configured,isAuthenticated:()=>!!accessToken,bootstrap,save,signIn,watch};
})();
