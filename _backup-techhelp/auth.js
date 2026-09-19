// TechHelp — authentification + synchronisation cloud Supabase
(() => {
  const sb = window.supabase?.createClient?.(window.TECHHELP_SUPABASE?.url, window.TECHHELP_SUPABASE?.anonKey);
  if (!sb) return;
  const KEY='techhelpState';
  const getLocal=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}};
  const saveLocal=s=>localStorage.setItem(KEY,JSON.stringify(s));
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const userEmail=()=>document.getElementById('authEmail')?.value.trim();
  const password=()=>document.getElementById('authPassword')?.value;
  function openAuth(){document.getElementById('authModal')?.classList.add('show');}
  function closeAuth(){document.getElementById('authModal')?.classList.remove('show');}
  function setStatus(t){const x=document.getElementById('authStatus');if(x)x.textContent=t;}
  async function ensureProfile(user,s){
    if(!user)return;
    const {data}=await sb.from('profiles').select('*').eq('id',user.id).maybeSingle();
    if(data){s.name=data.name||s.name;s.bio=data.bio||s.bio;s.avatar=data.avatar_url||s.avatar;}
    else await sb.from('profiles').upsert({id:user.id,name:s.name||'Utilisateur',bio:s.bio||'',avatar_url:s.avatar||null});
  }
  async function pullCloud(user){
    if(!user)return;
    const local=getLocal()||{name:'Utilisateur',bio:'Membre TechHelp',avatar:null,posts:[],devices:[],memory:[],reputation:0,theme:'dark'};
    await ensureProfile(user,local);
    const [{data:mem},{data:dev},{data:posts}]=await Promise.all([
      sb.from('memory').select('*').eq('user_id',user.id).order('created_at',{ascending:false}),
      sb.from('devices').select('*').eq('user_id',user.id).order('created_at',{ascending:false}),
      sb.from('posts').select('*').eq('user_id',user.id).order('created_at',{ascending:false})
    ]);
    local.memory=(mem||[]).map(x=>({id:String(x.id),date:x.created_at,text:x.content}));
    local.devices=(dev||[]).map(x=>({id:x.id,name:x.name,info:x.info||''}));
    local.posts=(posts||[]).map(p=>({id:p.id,user:local.name,avatar:local.avatar,cat:p.category,title:p.title,body:p.body,likes:p.likes||0,solved:!!p.solved,comments:[],image:p.image_url||null,createdAt:p.created_at}));
    saveLocal(local);location.reload();
  }
  async function pushState(s,user){
    if(!user||window.__cloudSyncBusy)return;
    window.__cloudSyncBusy=true;
    try{
      await sb.from('profiles').upsert({id:user.id,name:s.name||'Utilisateur',bio:s.bio||'',avatar_url:s.avatar||null,updated_at:new Date().toISOString()});
      const old=window.__lastCloudState||{memory:[],devices:[],posts:[]};
      for(const m of (s.memory||[]).slice(0,1000)) if(!old.memory.some(x=>String(x.id)===String(m.id))) await sb.from('memory').insert({user_id:user.id,content:m.text,created_at:m.date||new Date().toISOString()});
      for(const d of (s.devices||[])) if(!old.devices.some(x=>String(x.id)===String(d.id))) await sb.from('devices').insert({user_id:user.id,name:d.name,info:d.info||''});
      for(const p of (s.posts||[])) if(!old.posts.some(x=>String(x.id)===String(p.id))) await sb.from('posts').upsert({id:p.id.length>20?p.id:undefined,user_id:user.id,title:p.title,body:p.body,category:p.cat,image_url:p.image||null,likes:p.likes||0,solved:!!p.solved,created_at:p.createdAt||new Date().toISOString()});
      window.__lastCloudState=structuredClone(s);
    }finally{window.__cloudSyncBusy=false;}
  }
  async function signUp(){const email=userEmail(),pass=password();if(!email||!pass)return setStatus('Renseigne un e-mail et un mot de passe.');setStatus('Création du compte…');const {error}=await sb.auth.signUp({email,password:pass});if(error)setStatus(error.message);else setStatus('Compte créé. Vérifie ton e-mail si la confirmation est demandée.');}
  async function signIn(){const email=userEmail(),pass=password();if(!email||!pass)return setStatus('Renseigne un e-mail et un mot de passe.');setStatus('Connexion…');const {data,error}=await sb.auth.signInWithPassword({email,password:pass});if(error)setStatus(error.message);else{closeAuth();await pullCloud(data.user);}}
  async function signOut(){await sb.auth.signOut();localStorage.removeItem(KEY);location.reload();}
  async function init(){
    const {data}=await sb.auth.getSession();
    window.TechHelpAuth={sb,user:data.session?.user||null,openAuth,closeAuth,signUp,signIn,signOut,pushState};
    document.getElementById('authOpen')?.addEventListener('click',openAuth);
    document.getElementById('authClose')?.addEventListener('click',closeAuth);
    document.getElementById('authSignup')?.addEventListener('click',signUp);
    document.getElementById('authSignin')?.addEventListener('click',signIn);
    document.getElementById('authLogout')?.addEventListener('click',signOut);
    if(data.session?.user){await pullCloud(data.session.user);return;}
    document.getElementById('authOpen')?.classList.remove('hidden');
    const oldSet=localStorage.setItem.bind(localStorage);
    localStorage.setItem=(k,v)=>{oldSet(k,v);if(k===KEY&&window.TechHelpAuth?.user){try{pushState(JSON.parse(v),window.TechHelpAuth.user)}catch{}}};
  }
  init();
})();
