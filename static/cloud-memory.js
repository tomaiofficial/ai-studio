/* Assistant Vocal IA — mémoire cloud Supabase */
'use strict';
(function(){
  const cfg=window.TECHHELP_SUPABASE;
  if(!window.supabase||!cfg?.url||!cfg?.anonKey)return;
  const client=window.supabase.createClient(cfg.url,cfg.anonKey);
  window.VACloud={client};
  const keys=['va_reminders','va_events','va_notes','va_chat','va_theme','va_provider','va_model','va_ttsvoice'];
  let hydrating=false, timer;
  const read=()=>{const o={};for(const k of keys){const v=localStorage.getItem(k);if(v!==null){try{o[k]=JSON.parse(v)}catch{o[k]=v}}}return o};
  const set=(k,v)=>localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));
  function write(d){hydrating=true;for(const k of keys)if(d[k]!==undefined)set(k,d[k]);hydrating=false;window.dispatchEvent(new Event('va-cloud-loaded'));}
  async function user(){return (await client.auth.getUser()).data.user||null;}
  async function saveCloud(){if(hydrating)return;const u=await user();if(!u)return;const d=read();await client.from('voice_assistant_data').upsert({user_id:u.id,reminders:d.va_reminders||[],events:d.va_events||[],notes:d.va_notes||[],chat:d.va_chat||[],theme:d.va_theme||'dark',provider:d.va_provider||null,model:d.va_model||null,ttsvoice:d.va_ttsvoice||null,updated_at:new Date().toISOString()});}
  window.VACloud.save=()=>{clearTimeout(timer);timer=setTimeout(saveCloud,500)};
  async function loadFor(u){const {data,error}=await client.from('voice_assistant_data').select('*').eq('user_id',u.id).maybeSingle();if(error){console.warn(error);return}if(data)write({va_reminders:data.reminders,va_events:data.events,va_notes:data.notes,va_chat:data.chat,va_theme:data.theme,va_provider:data.provider,va_model:data.model,va_ttsvoice:data.ttsvoice});else await saveCloud();}
  function setAuth(t){const x=document.getElementById('vaAuthStatus');if(x)x.textContent=t;}
  async function updateUI(){const u=await user();if(u){setAuth('☁️ Mémoire cloud active · '+(u.email||'compte invité'));}else{setAuth('🔒 Connecte-toi pour retrouver ta mémoire sur tous tes appareils.');}}
  function hookStorage(){const oldSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){oldSet.call(this,k,v);if(keys.includes(k)&&!hydrating)window.VACloud?.save?.()};}
  client.auth.onAuthStateChange((event,session)=>{if(session){setTimeout(async()=>{await loadFor(session.user);updateUI()},0)}else updateUI()});
  async function boot(){hookStorage();const {data:{session}}=await client.auth.getSession();if(session){await loadFor(session.user)}else{try{const r=await client.auth.signInAnonymously();if(r.data?.session)await loadFor(r.data.session.user)}catch{}}updateUI();}
  window.addEventListener('va-cloud-loaded',updateUI);
  boot();
})();
