/* TechHelp — couche cloud permanente */
(()=>{
 const SB=window.supabase?.createClient?.(window.TECHHELP_SUPABASE?.url||'',window.TECHHELP_SUPABASE?.anonKey||'');
 if(!SB)return;
 let user=null, busy=false;
 const $=id=>document.getElementById(id), localKey='techhelpState';
 const get=()=>JSON.parse(localStorage.getItem(localKey)||'null');
 const put=s=>localStorage.setItem(localKey,JSON.stringify(s));
 const msg=t=>{if(typeof toast==='function')toast(t)};
 async function profile(){
   if(!user)return;
   const s=get()||{};
   const {error}=await SB.from('profiles').upsert({id:user.id,name:s.name||'Utilisateur',bio:s.bio||'Membre TechHelp',avatar_url:s.avatar||null,updated_at:new Date().toISOString()});
   if(error)console.warn('profile sync',error);
 }
 async function memory(){
   if(!user)return;
   const s=get()||{};
   const rows=(s.memory||[]).slice(0,1000).map(x=>({user_id:user.id,content:String(x.text||''),created_at:x.date||new Date().toISOString()})).filter(x=>x.content);
   if(rows.length){
     const {data:old}=await SB.from('memory').select('content,created_at').eq('user_id',user.id);
     const known=new Set((old||[]).map(x=>x.created_at+'|'+x.content));
     const fresh=rows.filter(x=>!known.has(x.created_at+'|'+x.content));
     if(fresh.length)await SB.from('memory').insert(fresh);
   }
 }
 async function devices(){
   if(!user)return;
   const s=get()||{};
   for(const d of (s.devices||[])){
     if(d.id)continue;
     const {data}=await SB.from('devices').insert({user_id:user.id,name:String(d.name||'Appareil'),info:String(d.info||'')}).select().single();
     if(data)d.id=data.id;
   }
 }
 async function posts(){
   if(!user)return;
   const s=get()||{};
   for(const p of (s.posts||[])){
     if(p.user_id)continue;
     const {data,error}=await SB.from('posts').insert({user_id:user.id,title:String(p.title||''),body:String(p.body||''),category:String(p.cat||'other'),image_url:null,likes:Number(p.likes||0),solved:!!p.solved,created_at:p.createdAt||new Date().toISOString()}).select().single();
     if(!error&&data)p.user_id=user.id,p.id=data.id,p.image=null;
   }
 }
 async function push(){if(!user||busy)return;busy=true;try{const s=get()||{};await profile();await memory();await devices();await posts();put(s)}finally{busy=false}}
 async function pull(){
   if(!user)return;
   const s=get()||{};
   const {data:p}=await SB.from('profiles').select('*').eq('id',user.id).maybeSingle();
   if(p){s.name=p.name||s.name;s.bio=p.bio||s.bio;s.avatar=p.avatar_url||s.avatar}
   const {data:m}=await SB.from('memory').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(1000);
   if(m)s.memory=m.map(x=>({id:String(x.id),date:x.created_at,text:x.content}));
   const {data:d}=await SB.from('devices').select('*').eq('user_id',user.id).order('created_at',{ascending:false});
   if(d)s.devices=d.map(x=>({id:x.id,name:x.name,info:x.info}));
   const {data:ps}=await SB.from('posts').select('*').order('created_at',{ascending:false});
   if(ps)s.posts=ps.map(x=>({id:x.id,user:x.user_id===user.id?s.name:'Utilisateur',avatar:x.user_id===user.id?s.avatar:null,cat:x.category,title:x.title,body:x.body,likes:x.likes,solved:x.solved,comments:[],image:x.image_url,createdAt:x.created_at,user_id:x.user_id}));
   put(s);if(typeof render==='function')render();
 }
 function authUI(){
   if($('cloudAuth'))return;
   const b=document.createElement('div');b.id='cloudAuth';b.style.cssText='position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;gap:8px;align-items:center;background:rgba(8,17,31,.94);padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 12px 40px #0006;color:#fff;font:14px system-ui';
   b.innerHTML='<span id="cloudStatus">☁️ Non connecté</span><button id="cloudLogin" style="padding:8px 11px;border:0;border-radius:9px;cursor:pointer">Se connecter</button><button id="cloudLogout" style="display:none;padding:8px 11px;border:0;border-radius:9px;cursor:pointer">Déconnexion</button>';
   document.body.appendChild(b);
   $('cloudLogin').onclick=async()=>{const email=prompt('Adresse e-mail du compte TechHelp');if(!email)return;const password=prompt('Mot de passe');if(!password)return;let r=await SB.auth.signInWithPassword({email,password});if(r.error){const create=confirm('Compte introuvable. Créer ce compte maintenant ?');if(create)r=await SB.auth.signUp({email,password});}if(r.error)msg('Connexion impossible : '+r.error.message);else msg('Compte connecté ☁️')};
   $('cloudLogout').onclick=async()=>{await SB.auth.signOut();msg('Déconnecté')};
 }
 async function state(){const {data}=await SB.auth.getSession();user=data.session?.user||null;authUI();refreshUI();if(user){await pull();await push()} }
 function refreshUI(){const st=$('cloudStatus'),li=$('cloudLogin'),lo=$('cloudLogout');if(!st)return;st.textContent=user?'☁️ '+(user.email||'Compte connecté'):'☁️ Non connecté';li.style.display=user?'none':'inline-block';lo.style.display=user?'inline-block':'none'}
 SB.auth.onAuthStateChange(async(_e,s)=>{user=s?.user||null;refreshUI();if(user){await pull();await push()}});
 window.addEventListener('online',()=>{if(user)push()});
 setInterval(()=>{if(user)push()},5000);
 setInterval(()=>{if(user)pull()},15000);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',state);else state();
})();
