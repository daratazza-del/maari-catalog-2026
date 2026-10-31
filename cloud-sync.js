/* Al Maari cross-device sync. Configure www/cloud-config.js using your own Supabase project. */
(function(){
  const cfg=window.MAARI_CLOUD_CONFIG||{};
  const configured=!!(cfg.url&&cfg.anonKey&&cfg.ownerUserId);
  let accessToken=null;
  const endpoint=()=>cfg.url.replace(/\/$/,'');
  async function request(path,opts={}){
    const headers=Object.assign({'apikey':cfg.anonKey,'Content-Type':'application/json'},opts.headers||{});
    if(accessToken)headers.Authorization='Bearer '+accessToken;
    const res=await fetch(endpoint()+path,Object.assign({},opts,{headers}));
    const body=await res.text();let parsed=null;try{parsed=body?JSON.parse(body):null}catch{}
    if(!res.ok)throw new Error(parsed?.message||parsed?.msg||`HTTP ${res.status}`);
    return parsed;
  }
  async function fetchState(){
    if(!configured)return null;
    const rows=await request('/rest/v1/catalog_state?id=eq.main&select=payload,updated_at');
    return rows&&rows.length&&rows[0].payload?rows[0]:null;
  }
  async function bootstrap(){
    const row=await fetchState();
    if(row){lastUpdatedAt=row.updated_at||null;return row.payload;}
    return null;
  }
  let lastUpdatedAt=null;
  function watch(onUpdate, intervalMs=45000){
    if(!configured||typeof onUpdate!=='function')return ()=>{};
    let stopped=false,busy=false;
    const tick=async()=>{
      if(stopped||busy||accessToken)return;
      busy=true;
      try{const row=await fetchState();if(row&&row.updated_at&&row.updated_at!==lastUpdatedAt){lastUpdatedAt=row.updated_at;onUpdate(row.payload);}}
      catch(e){console.warn('Maari cloud refresh failed',e);}
      finally{busy=false;}
    };
    const id=setInterval(tick,intervalMs);
    return ()=>{stopped=true;clearInterval(id);};
  }
  let timer=null;
  async function save(data){
    if(!configured||!accessToken)return;
    clearTimeout(timer);
    return new Promise((resolve,reject)=>{timer=setTimeout(async()=>{
      try{await request('/rest/v1/catalog_state?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({id:'main',payload:data,updated_at:new Date().toISOString()})});resolve(true);}
      catch(e){console.error('Maari cloud save failed',e);reject(e);}
    },700);});
  }
  async function signIn(email,password){
    if(!configured)throw new Error('إعداد السحابة غير مكتمل.');
    const result=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});
    if(!result?.access_token)throw new Error('لم يتم استلام رمز الدخول.');
    // Only the designated owner account can unlock the admin UI.
    const user=result.user||{};
    if(user.id!==cfg.ownerUserId){accessToken=null;throw new Error('هذا الحساب ليس حساب مالك المستودع.');}
    accessToken=result.access_token;
    return true;
  }
  window.MaariCloud={isConfigured:()=>configured,isAuthenticated:()=>!!accessToken,bootstrap,save,signIn,watch};
})();
