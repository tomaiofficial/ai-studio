(() => {
  const cfg = window.TECHHELP_SUPABASE;
  if (!cfg?.url || !cfg?.anonKey || !window.supabase) return;
  const db = window.supabase.createClient(cfg.url, cfg.anonKey);
  const KEY = 'techhelpState';
  const $ = id => document.getElementById(id);
  let syncing = false;
  const getState = () => JSON.parse(localStorage.getItem(KEY) || 'null') || {name:'Utilisateur',bio:'Membre TechHelp',avatar:null,posts:[],devices:[],memory:[],reputation:0,theme:'dark'};
  const setState = s => localStorage.setItem(KEY, JSON.stringify(s));
  const toast = t => window.toast ? window.toast(t) : console.log(t);

  function addAuthUI(){
    if ($('techAuth')) return;
    const b=document.createElement('button'); b.id='techAuth'; b.className='secondary'; b.style.marginLeft='8px'; b.textContent='☁️ Connexion';
    b.onclick=authDialog; document.querySelector('.top')?.appendChild(b);
  }
  async function authDialog(){
    const {data:{session}}=await db.auth.getSession();
    if(session){
      if(confirm('Se déconnecter de TechHelp ?')){await db.auth.signOut();toast('Déconnecté');location.reload();}
      return;
    }
    const email=prompt('E-mail pour ton compte TechHelp :'); if(!email)return;
    const password=prompt('Mot de passe du compte (8 caractères minimum) :'); if(!password)return;
    const mode=confirm('OK = créer un compte\nAnnuler = se connecter');
    const result=mode?await db.auth.signUp({email,password}):await db.auth.signInWithPassword({email,password});
    if(result.error){alert(result.error.message);return;}
    if(mode && !result.data.session){alert('Compte créé. Si la confirmation e-mail est activée, confirme ton e-mail puis reconnecte-toi.');return;}
    await loadCloud(result.data.user.id); location.reload();
  }

  async function uploadDataUrl(dataUrl, path){
    if(!dataUrl?.startsWith('data:')) return dataUrl;
    const [head,b64]=dataUrl.split(','); const mime=(head.match(/data:(.*?);/)||[])[1]||'image/jpeg';
    const bin=atob(b64); const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    const ext=mime.split('/')[1]?.replace('jpeg','jpg')||'jpg'; const filePath=path+'.'+ext;
    const {error}=await db.storage.from('avatars').upload(filePath,new Blob([bytes],{type:mime}),{upsert:true,contentType:mime});
    if(error) throw error;
    return db.storage.from('avatars').getPublicUrl(filePath).data.publicUrl;
  }

  async function loadCloud(userId){
    const [pr,po,de,me,co]=await Promise.all([
      db.from('profiles').select('*').eq('id',userId).maybeSingle(),
      db.from('posts').select('*').order('created_at',{ascending:false}),
      db.from('devices').select('*').eq('user_id',userId).order('created_at',{ascending:false}),
      db.from('memory').select('*').eq('user_id',userId).order('created_at',{ascending:false}),
      db.from('comments').select('*').order('created_at',{ascending:true})
    ]);
    if(pr.error||po.error||de.error||me.error||co.error) throw (pr.error||po.error||de.error||me.error||co.error);
    const old=getState();
    const profile=pr.data||{id:userId,name:old.name||'Utilisateur',bio:old.bio||'Membre TechHelp',avatar_url:old.avatar||null};
    if(!pr.data) await db.from('profiles').upsert({id:userId,name:profile.name,bio:profile.bio,avatar_url:profile.avatar_url});
    const commentsBy={}; (co.data||[]).forEach(c=>(commentsBy[c.post_id]??=[]).push([c.user_id,c.body,null]));
    const posts=(po.data||[]).filter(p=>p.user_id===userId || true).map(p=>({id:p.id,user: p.user_id===userId?profile.name:'Membre',avatar:profile.avatar_url,cat:p.category,title:p.title,body:p.body,likes:p.likes,solved:p.solved,comments:commentsBy[p.id]||[],image:p.image_url||null,createdAt:p.created_at}));
    setState({...old,name:profile.name,bio:profile.bio,avatar:profile.avatar_url,posts,devices:(de.data||[]).map(d=>({name:d.name,info:d.info||''})),memory:(me.data||[]).map(m=>({id:m.id,date:m.created_at,text:m.content}))});
  }

  async function syncCloud(){
    if(syncing) return; syncing=true;
    try{
      const {data:{user}}=await db.auth.getUser(); if(!user)return;
      let s=getState();
      let avatar=s.avatar;
      if(avatar?.startsWith('data:')){avatar=await uploadDataUrl(avatar,user.id+'/avatar');s.avatar=avatar;setState(s);}
      await db.from('profiles').upsert({id:user.id,name:s.name||'Utilisateur',bio:s.bio||'',avatar_url:avatar,updated_at:new Date().toISOString()});
      for(const d of s.devices||[]){await db.from('devices').upsert({user_id:user.id,name:d.name,info:d.info||''});}
      for(const m of (s.memory||[]).slice(0,1000)){await db.from('memory').upsert({user_id:user.id,content:m.text,created_at:m.date||new Date().toISOString()});}
      for(const p of s.posts||[]){
        if(!String(p.id).includes('-')) continue;
        await db.from('posts').upsert({id:p.id,user_id:user.id,title:p.title,body:p.body,category:p.cat,image_url:p.image||null,likes:p.likes||0,solved:!!p.solved,created_at:p.createdAt||new Date().toISOString()});
        for(const c of p.comments||[]){if(c[1]) await db.from('comments').insert({post_id:p.id,user_id:user.id,body:c[1]});}
      }
    }catch(e){console.warn('TechHelp cloud sync:',e.message)} finally{syncing=false}
  }

  async function init(){
    addAuthUI();
    const {data:{session}}=await db.auth.getSession();
    const b=$('techAuth'); if(b)b.textContent=session?'☁️ Compte connecté':'☁️ Connexion';
    if(session){
      try{await loadCloud(session.user.id); if($('techAuth'))$('techAuth').textContent='☁️ Compte connecté';}
      catch(e){console.warn('Cloud load:',e.message)}
      setInterval(syncCloud,2500); setTimeout(syncCloud,1000);
    }
    db.channel('techhelp-live').on('postgres_changes',{event:'*',schema:'public',table:'posts'},()=>{if(!syncing)location.reload()}).subscribe();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
