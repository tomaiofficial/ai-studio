// TechHelp Cloud — compte, mémoire, profils, publications et photos synchronisés avec Supabase.
(() => {
  if (!window.supabase || !window.TECHHELP_SUPABASE) return;
  const db = window.supabase.createClient(window.TECHHELP_SUPABASE.url, window.TECHHELP_SUPABASE.anonKey);
  window.techHelpCloud = db;
  let user = null;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const oldSave = window.save;
  const localSave = () => { try { localStorage.setItem('techhelpState', JSON.stringify(window.S)); } catch(e){} };
  function msg(t){ if(typeof window.toast==='function') window.toast(t); }
  async function upload(file,folder){
    if(!user || !file) return null;
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
    const path=`${user.id}/${folder}-${Date.now()}.${ext}`;
    const {error}=await db.storage.from('avatars').upload(path,file,{upsert:false,contentType:file.type||'image/jpeg'});
    if(error) throw error;
    return db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  }
  async function ensureProfile(){
    if(!user) return;
    const {data}=await db.from('profiles').select('*').eq('id',user.id).maybeSingle();
    if(!data){ await db.from('profiles').insert({id:user.id,name:window.S.name||'Utilisateur',bio:window.S.bio||'Membre TechHelp',avatar_url:window.S.avatar||null}); return; }
    window.S.name=data.name||window.S.name; window.S.bio=data.bio||window.S.bio; window.S.avatar=data.avatar_url||null;
  }
  async function load(){
    if(!user) return;
    await ensureProfile();
    const [m,d,p,c]=await Promise.all([
      db.from('memory').select('*').eq('user_id',user.id).order('created_at',{ascending:false}),
      db.from('devices').select('*').eq('user_id',user.id).order('created_at',{ascending:false}),
      db.from('posts').select('*').eq('user_id',user.id).order('created_at',{ascending:false}),
      db.from('comments').select('id,post_id,user_id,body,created_at,profiles(name,avatar_url)').order('created_at',{ascending:true})
    ]);
    window.S.memory=(m.data||[]).map(x=>({id:x.id,date:x.created_at,text:x.content}));
    window.S.devices=(d.data||[]).map(x=>({id:x.id,name:x.name,info:x.info}));
    window.S.posts=(p.data||[]).map(x=>({id:x.id,user:window.S.name,avatar:window.S.avatar,cat:x.category,title:x.title,body:x.body,likes:x.likes,solved:x.solved,image:x.image_url,comments:[],createdAt:x.created_at}));
    (c.data||[]).forEach(x=>{const post=window.S.posts.find(p=>p.id===x.post_id);if(post){post.comments.push({user_id:x.user_id,user:x.profiles?.name||'Utilisateur',avatar:x.profiles?.avatar_url||null,body:x.body,createdAt:x.created_at});}});
    localSave(); if(typeof window.render==='function') window.render();
  }
  async function login(){
    const email=$('cloudEmail').value.trim(), password=$('cloudPassword').value;
    if(!email||!password) return;
    const {data,error}=await db.auth.signInWithPassword({email,password});
    if(error){$('cloudStatus').textContent=error.message;return;}
    user=data.user; $('cloudModal').style.display='none'; await load(); msg('Compte connecté ☁️'); update();
  }
  async function signup(){
    const email=$('cloudEmail').value.trim(), password=$('cloudPassword').value;
    if(!email||password.length<6){$('cloudStatus').textContent='E-mail valide + mot de passe de 6 caractères minimum.';return;}
    const {data,error}=await db.auth.signUp({email,password});
    if(error){$('cloudStatus').textContent=error.message;return;}
    if(data.session){user=data.user;$('cloudModal').style.display='none';await load();msg('Compte créé ☁️');update();}
    else $('cloudStatus').textContent='Compte créé. Vérifie ton e-mail si une confirmation est demandée.';
  }
  async function logout(){await db.auth.signOut();user=null;update();msg('Déconnexion effectuée');}
  function modal(){
    if($('cloudModal')) return;
    const d=document.createElement('div'); d.id='cloudModal'; d.style.cssText='position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.68);backdrop-filter:blur(12px)';
    d.innerHTML=`<div style="width:min(430px,100%);padding:26px;border-radius:22px;background:#101827;color:#fff;border:1px solid rgba(255,255,255,.12);box-shadow:0 25px 80px rgba(0,0,0,.45)"><div style="display:flex;justify-content:space-between;align-items:center"><div><span class="eyebrow">TECHHELP CLOUD</span><h2 style="margin:6px 0">Compte et mémoire</h2></div><button id="cloudClose" class="icon">✕</button></div><p id="cloudStatus">Crée un compte pour retrouver tes données sur tes autres appareils.</p><label style="display:block;margin:12px 0">E-mail<input id="cloudEmail" type="email" autocomplete="email"></label><label style="display:block;margin:12px 0">Mot de passe<input id="cloudPassword" type="password" autocomplete="current-password" minlength="6"></label><div style="display:flex;gap:10px;flex-wrap:wrap"><button id="cloudLogin" class="primary">Se connecter</button><button id="cloudSignup" class="secondary">Créer un compte</button><button id="cloudLogout" class="secondary" style="display:none">Se déconnecter</button></div></div>`;
    document.body.appendChild(d); $('cloudClose').onclick=()=>d.style.display='none'; $('cloudLogin').onclick=login; $('cloudSignup').onclick=signup; $('cloudLogout').onclick=logout;
  }
  function open(){modal();$('cloudModal').style.display='flex';$('cloudStatus').textContent=user?`Connecté : ${user.email}`:'Crée un compte pour retrouver tes données sur tes autres appareils.';$('cloudLogin').style.display=user?'none':'inline-flex';$('cloudSignup').style.display=user?'none':'inline-flex';$('cloudLogout').style.display=user?'inline-flex':'none';}
  function update(){let b=$('cloudQuick');if(!b){b=document.createElement('button');b.id='cloudQuick';b.className='secondary';b.style.marginLeft='8px';b.onclick=open;$('profile')?.parentElement?.appendChild(b);}b.textContent=user?'☁️ Compte':'☁️ Se connecter';}
  async function cloudProfile(){if(!user)return;await db.from('profiles').upsert({id:user.id,name:window.S.name||'Utilisateur',bio:window.S.bio||'Membre TechHelp',avatar_url:window.S.avatar||null,updated_at:new Date().toISOString()},{onConflict:'id'});}
  async function memory(text){if(!user)return;await db.from('memory').insert({user_id:user.id,content:text});}
  // Synchronise la mémoire générée par les fonctions existantes.
  const oldRemember=window.remember;
  if(oldRemember){window.remember=function(text){oldRemember(text);if(user)memory(text).catch(()=>{});};}
  // Publication : le handler cloud passe avant le handler local.
  const form=$('postForm'); if(form) form.addEventListener('submit',async e=>{
    if(!user){e.preventDefault();e.stopImmediatePropagation();open();return;}
    e.preventDefault();e.stopImmediatePropagation();
    const title=$('postTitle').value.trim(),body=$('postBody').value.trim();if(!title||!body)return;
    let image=null; const file=$('postImage').files[0]; if(file) try{image=await upload(file,'post');}catch(err){msg('Photo non envoyée, publication sans photo');}
    const {data,error}=await db.from('posts').insert({user_id:user.id,title,body,category:$('postCategory').value,image_url:image}).select().single();
    if(error){msg('Erreur de publication cloud');return;}
    window.S.posts.unshift({id:data.id,user:window.S.name,avatar:window.S.avatar,cat:data.category,title:data.title,body:data.body,likes:0,solved:false,comments:[],image:data.image_url,createdAt:data.created_at});
    window.S.reputation+=5; localSave(); await cloudProfile(); if(typeof window.render==='function')window.render();form.reset();$('imagePreview')?.classList.add('hidden');msg('Publication enregistrée dans le cloud ☁️');
  },true);
  // Photo de profil : stockage Supabase au lieu du data URL local.
  const pf=$('profileImage'); if(pf) pf.addEventListener('change',async e=>{
    if(!user){e.preventDefault();e.stopImmediatePropagation();e.target.value='';open();return;}
    e.preventDefault();e.stopImmediatePropagation();const file=e.target.files[0];if(!file)return;if(!file.type.startsWith('image/'))return;if(file.size>8*1024*1024){msg('Photo trop lourde : 8 Mo maximum');return;}
    try{window.S.avatar=await upload(file,'avatar');window.S.posts.forEach(p=>p.avatar=window.S.avatar);localSave();await cloudProfile();if(typeof window.render==='function')window.render();msg('Photo de profil sauvegardée ☁️');}catch(err){msg('Impossible de sauvegarder la photo');}
  },true);
  db.auth.getSession().then(async({data})=>{user=data.session?.user||null;update();if(user)await load();});
  db.auth.onAuthStateChange(async(_event,session)=>{user=session?.user||null;update();if(user)await load();});
  // Expose a clean account action and cloud status.
  window.openTechHelpCloud=open;
  update();
})();
