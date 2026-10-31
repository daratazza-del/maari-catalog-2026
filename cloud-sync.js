/* Al Maari cloud sync: persistent owner session + verified writes. */
(function(){
  const cfg=window.MAARI_CLOUD_CONFIG||{};
  const configured=!!(cfg.url&&cfg.anonKey&&cfg.ownerUserId);
  const SESSION_KEY='maari_cloud_owner_session_v1';
  let accessToken=null, refreshToken=null, expiresAt=0, lastUpdatedAt=null, writeQueue=Promise.resolve(), restoring=null;

  const endpoint=()=>String(cfg.url||'').replace(/\/$/,'');
  function status(message){
    const el=document.getElementById('cloudStatus');
    if(el)el.textContent=message;
  }

  function persist(){
    try{
      if(refreshToken){
        localStorage.setItem(SESSION_KEY,JSON.stringify({
          refresh_token:refreshToken,
          expires_at:expiresAt
        }));
      }
    }catch(e){
      console.warn('Could not persist cloud session',e);
    }
  }

  function clearSession(){
    accessToken=null;
    refreshToken=null;
    expiresAt=0;
    try{localStorage.removeItem(SESSION_KEY);}catch{}
  }

  async function rawRequest(path,opts={},token){
    const headers=Object.assign({
      'apikey':cfg.anonKey,
      'Content-Type':'application/json'
    },opts.headers||{});

    if(token)headers.Authorization='Bearer '+token;

    const res=await fetch(
      endpoint()+path,
      Object.assign({},opts,{headers})
    );

    const body=await res.text();
    let parsed=null;

    try{
      parsed=body?JSON.parse(body):null;
    }catch{}

    if(!res.ok){
      throw new Error(
        parsed?.message||
        parsed?.msg||
        parsed?.error_description||
        `HTTP ${res.status}: ${body.slice(0,300)}`
      );
    }

    return parsed;
  }

  async function refreshSession(){
    if(!refreshToken)return false;

    try{
      const result=await rawRequest(
        '/auth/v1/token?grant_type=refresh_token',
        {
          method:'POST',
          body:JSON.stringify({refresh_token:refreshToken})
        }
      );

      if(
        !result?.access_token||
        !result?.refresh_token||
        result?.user?.id!==cfg.ownerUserId
      ){
        clearSession();
        return false;
      }

      accessToken=result.access_token;
      refreshToken=result.refresh_token;
      expiresAt=Date.now()+Number(result.expires_in||3600)*1000;
      persist();

      return true;
    }catch(e){
      console.warn('Owner session refresh failed',e);
      clearSession();
      return false;
    }
  }

  async function restoreSession(){
    if(!configured)return false;

    if(accessToken&&Date.now()<expiresAt-60000)return true;

    if(restoring)return restoring;

    restoring=(async()=>{
      try{
        const saved=JSON.parse(
          localStorage.getItem(SESSION_KEY)||'null'
        );

        if(saved?.refresh_token){
          refreshToken=saved.refresh_token;
        }
      }catch{}

      const ok=await refreshSession();
      restoring=null;
      return ok;
    })();

    return restoring;
  }

  async function request(path,opts={}){
    if(accessToken&&Date.now()>=expiresAt-60000){
      await refreshSession();
    }

    try{
      return await rawRequest(path,opts,accessToken);
    }catch(e){
      if(
        accessToken&&
        /HTTP 401|HTTP 403/.test(e.message)&&
        await refreshSession()
      ){
        return await rawRequest(path,opts,accessToken);
      }

      throw e;
    }
  }

  async function fetchState(){
    if(!configured)return null;

    const rows=await request(
      '/rest/v1/catalog_state?id=eq.main&select=payload,updated_at'
    );

    return rows&&rows.length&&rows[0].payload?rows[0]:null;
  }

  async function bootstrap(){
    if(!configured)return null;

    await restoreSession();

    const row=await fetchState();

    if(row){
      lastUpdatedAt=row.updated_at||null;
      return row.payload;
    }

    return null;
  }

  function watch(onUpdate,intervalMs=12000){
    if(!configured||typeof onUpdate!=='function')return ()=>{};

    let stopped=false,busy=false;

    const tick=async()=>{
      if(stopped||busy)return;

      busy=true;

      try{
        const row=await fetchState();

        if(
          row&&
          row.updated_at&&
          row.updated_at!==lastUpdatedAt
        ){
          lastUpdatedAt=row.updated_at;
          onUpdate(row.payload);
        }
      }catch(e){
        console.warn('Maari cloud refresh failed',e);
      }finally{
        busy=false;
      }
    };

    const id=setInterval(tick,intervalMs);

    return ()=>{
      stopped=true;
      clearInterval(id);
    };
  }

  async function write(data){
    if(!configured){
      throw new Error('إعداد السحابة غير مكتمل.');
    }

    if(!(await restoreSession())){
      throw new Error(
        'انتهت جلسة المالك. افتح لوحة الإدارة وسجّل الدخول مجدداً.'
      );
    }

    const stamp=new Date().toISOString();

    await request(
      '/rest/v1/catalog_state?on_conflict=id',
      {
        method:'POST',
        headers:{
          Prefer:'resolution=merge-duplicates,return=minimal'
        },
        body:JSON.stringify({
          id:'main',
          payload:data,
          updated_at:stamp
        })
      }
    );

    const check=await fetchState();

    if(
      !check||
      !check.payload||
      !check.updated_at||
      new Date(check.updated_at).getTime()<
      new Date(stamp).getTime()-2000
    ){
      throw new Error(
        'لم يتم تأكيد وصول الحفظ إلى Supabase. لم نعتبر العملية ناجحة.'
      );
    }

    lastUpdatedAt=check.updated_at;
    status('☁️ تم تأكيد حفظ التعديلات على السحابة');

    return true;
  }

  function save(data){
    const snapshot=JSON.parse(JSON.stringify(data));

    status('☁️ جارٍ التحقق من جلسة المالك ورفع التعديلات…');

    const task=writeQueue.then(()=>write(snapshot));

    writeQueue=task.catch(()=>{});

    return task.catch(e=>{
      status(
        '⚠️ فشل الحفظ السحابي: '+
        (e.message||'خطأ غير معروف')
      );

      console.error('Maari cloud save failed',e);
      throw e;
    });
  }

  async function signIn(email,password){
    if(!configured){
      throw new Error('إعداد السحابة غير مكتمل.');
    }

    const result=await rawRequest(
      '/auth/v1/token?grant_type=password',
      {
        method:'POST',
        body:JSON.stringify({email,password})
      }
    );

    if(!result?.access_token||!result?.refresh_token){
      throw new Error('لم يتم استلام بيانات جلسة الدخول.');
    }

    if(result.user?.id!==cfg.ownerUserId){
      clearSession();
      throw new Error('هذا الحساب ليس حساب مالك المستودع.');
    }

    accessToken=result.access_token;
    refreshToken=result.refresh_token;
    expiresAt=Date.now()+Number(result.expires_in||3600)*1000;

    persist();

    return true;
  }

  window.MaariCloud={
    isConfigured:()=>configured,
    isAuthenticated:()=>!!(accessToken||refreshToken),
    bootstrap,
    save,
    signIn,
    watch
  };
})();
