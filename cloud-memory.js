/* Assistant Vocal IA — mémoire cloud Supabase */
'use strict';
(function(){
  if(!window.supabase || !window.TECHHELP_SUPABASE) return;
  const cfg=window.TECHHELP_SUPABASE;
  if(!cfg.url || !cfg.anonKey) return;
  const client=window.supabase.createClient(cfg.url,cfg.anonKey);
  window.VACloud={client};
  const keys=['va_reminders','va_events','va_notes','va_chat','va_theme','va_provider','va_model','va_ttsvoice'];
  function read(){const o={};for(const k of keys){const v=localStorage.getItem(k);if(v!==null){try{o[k]=JSON.parse(v)}catch{o[k]=v}}}return o}
  function write(o){for(const k of keys)if(o[k]!==undefined)localStorage.setItem(k,typeof o[k]==='string'?o[k]:JSON.stringify(o[k]));window.dispatchEvent(new Event('va-cloud-loaded'))}
  let timer;
  async function saveCloud(){const {data:{user}}=await client.auth.getUser();if(!user)return;const d=read();await client.from('voice_assistant_data').upsert({user_id:user.id,reminders:d.va_reminders||[],events:d.va_events||[],notes:d.va_notes||[],chat:d.va_chat||[],theme:d.va_theme||'dark',provider:d.va_provider||null,model:d.va_model||null,ttsvoice:d.va_ttsvoice||null,updated_at:new Date().toISOString()});}
  window.VACloud.save=()=>{clearTimeout(timer);timer=setTimeout(saveCloud,500)};
  async function loadCloud(){const {data:{user}}=await client.auth.getUser();if(!user)return;const {data,error}=await client.from('voice_assistant_data').select('*').eq('user_id',user.id).maybeSingle();if(error||!data)return;write({va_reminders:data.reminders,va_events:data.events,va_notes:data.notes,va_chat:data.chat,va_theme:data.theme,va_provider:data.provider,va_model:data.model,va_ttsvoice:data.ttsvoice});}
  async function boot(){const {data:{session}}=await client.auth.getSession();if(session){await loadCloud();}else{const {data,error}=await client.auth.signInAnonymously();if(!error&&data?.session){await saveCloud();}}}
  client.auth.onAuthStateChange((event,session)=>{if(session && (event==='SIGNED_IN'||event==='INITIAL_SESSION'))loadCloud();});
  const oldSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){oldSet.call(this,k,v);if(keys.includes(k))window.VACloud?.save?.()};
  window.VACloud.boot=boot;boot();
})();
