/* ============================================================
   AGENTS AUTONOMES "TOUJOURS ACTIFS" (v10.10)
   -------------------------------------------------------
   Sur le modele des "dots" d'OpenAI : des agents qui recoivent
   un OBJECTIF (pas une consigne), qui travaillent en arriere-plan
   sans que tu aies a faire quoi que ce soit, qui gardent leur
   memoire, et qui te previennent quand ils ont trouve un truc
   qui les concerne.

   - Chaque agent a : un NOM, un EMOJI, un OBJECTIF
   - Il cherche tout seul sur le web (DuckDuckGo Instant Answer)
   - Il filtre avec l'IA : garde seulement ce qui sert a l'objectif
   - Il te previent dans le chat + a la voix
   - Il survit au rechargement (localStorage + heartbeat + watchdog)
   ============================================================ */
(function(){
'use strict';

const KEY = 'va_agents_state';
const CH  = 'agents-channel';
const TICK_MS = 4 * 60 * 1000;   /* un cycle de recherche toutes les 4 min */

let bc = null;
try { bc = new BroadcastChannel(CH); } catch(e){}

function blank(){
  return { running:true, agents:[], runnerId:null, heartbeat:0, logs:[] };
}
function load(){
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && typeof s === 'object'){
      if (!Array.isArray(s.agents)) s.agents = [];
      if (!Array.isArray(s.logs)) s.logs = [];
      if (typeof s.running !== 'boolean') s.running = true;
      return s;
    }
  } catch(e){}
  return blank();
}
let S = load();
function save(){ try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} }
function push(){ if (bc){ try { bc.postMessage({ type:'agents', state:S }); } catch(e){} } }

const MY_ID = 'ag-' + Math.random().toString(36).slice(2, 10);

/* ===== HOOKS (app.js s'y branche) ===== */
const hooks = { onLog:null, onNotify:null, onState:null };
function log(html){ if (hooks.onLog) hooks.onLog(html); }
function notify(agent, text){ if (hooks.onNotify) hooks.onNotify(agent, text); }
function emit(){ save(); push(); if (hooks.onState) hooks.onState(S); }

/* ===== OUTILS ===== */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function timeout(ms){
  try { if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms); } catch(e){}
  const c = new AbortController();
  setTimeout(() => { try { c.abort(); } catch(e){} }, ms);
  return c.signal;
}
function mkey(){ try { return (localStorage.getItem('va_mistral_key') || '').trim(); } catch(e){ return ''; } }

/* La recherche passe par websearch.js : plusieurs sources sont
   essaiees (Wikipedia, DuckDuckGo, passerelles) parce qu'une seule
   source peut etre bloquee CORS depuis le navigateur. Si rien ne
   repond, l'agent continue avec ses propres connaissances. */
async function searchWeb(query){
  const WS = window.WebSearch;
  if (!WS || typeof WS.search !== 'function') return null;
  const r = await WS.search(query);
  return r;
}

/*asked a un LLM (Mistral si cle, sinon modeles gratuits) */
async function llm(system, user, maxTokens, temperature){
  const messages = [{ role:'system', content:system }, { role:'user', content:user }];
  const key = mkey();
  const attempt = async (url, model, auth) => {
    try {
      const headers = { 'Content-Type':'application/json' };
      if (auth && key) headers['Authorization'] = 'Bearer ' + key;
      const res = await fetch(url, {
        method:'POST', headers,
        body: JSON.stringify({ model, messages, max_tokens:maxTokens || 220, temperature: temperature == null ? 0.4 : temperature }),
        signal: timeout(14000)
      });
      if (!res || !res.ok) return null;
      const data = await res.json();
      const txt = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
      return txt || null;
    } catch(e){ return null; }
  };
  if (key){
    for (const m of ['mistral-small-latest','open-mistral-nemo']){
      const t = await attempt('https://api.mistral.ai/v1/chat/completions', m, true);
      if (t) return t;
    }
  }
  for (const pair of [
    ['https://llm7.xyz/api/v1/chat/completions','glm-5.3-flash'],
    ['https://ovh.llm7.xyz/api/v1/chat/completions','qwen3.5'],
    ['https://text.pollinations.ai/openai/v1/chat/completions','openai']
  ]){
    const t = await attempt(pair[0], pair[1], false);
    if (t) return t;
  }
  return null;
}

/* Nettoie une reponse LLM : pas de markdown, pas de didascalie */
function tidy(t){
  if (!t) return '';
  let s = String(t);
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/[*_#`>]+/g, '');
  s = s.replace(/^\s*[-•]\s*/gm, '');
  s = s.replace(/\((?:sourire|rire|soupir|ton|voix|geste|regard|silence)[^)]*\)/gi, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

const EMPTY = /\b(rien|aucun|rien de pertinent|pas dinfo|pas d info|nothing|no relevant|aucun resultat)\b/i;

/* ===== UN CYCLE POUR UN AGENT ===== */
const BUSY = new Set();
async function runAgent(agent){
  if (BUSY.has(agent.id)) return;
  BUSY.add(agent.id);
  try {
  agent.status = 'cherche…';
  agent.runs = (agent.runs || 0) + 1;
  agent.lastRun = Date.now();
  emit();

  const found = await searchWeb(agent.objective);

  /* Aucun acces web (bloqueur, VPN, DNS...) : l'agent ne meurt pas,
     il repond avec ses propres connaissances ET le dit clairement,
     pour ne jamais faire croire a une info verifiee en direct. */
  if (!found || !found.ok || !found.live || !(found.text || '').trim()){
    const reason = (found && found.reason) ? found.reason : 'web indisponible';
    const own = tidy(await llm(
      'Tu es un agent autonome. La recherche en direct est INDISPONIBLE sur ce réseau : tu reponds uniquement avec ce que tu sais dans tes connaissances, et tu dois le dire en une phrase. Règles : 1) Si tu ne sais rien d\'utile sur l\'objectif, réponds exactement RIEN. 2) Sinon 1 à 2 phrases FRANÇAISES courtes (max 30 mots), en commenceant par "Sans web, je peux dire que". Aucun markdown, aucune didascalie.',
      'OBJECTIF : ' + agent.objective + '\n\nDonne ta réponse.',
      160, 0.3
    ));
    agent.status = 'hors web';
    if (own && !EMPTY.test(own)){
      agent.note = own;
      agent.findings = agent.findings || [];
      agent.findings.push({ t:Date.now(), text:own });
      if (agent.findings.length > 20) agent.findings = agent.findings.slice(-20);
      agent.memory = ((agent.memory || '') + ' ' + own).trim().slice(-1000);
      S.logs.unshift({ t:Date.now(), name:agent.name, emoji:agent.emoji, color:agent.color, text:own, offline:true });
      if (S.logs.length > 60) S.logs = S.logs.slice(0, 60);
      emit();
      log('<div class="ag-line"><span class="ag-name" style="color:' + agent.color + '">' + agent.emoji + ' ' + esc(agent.name) +
          '</span><span class="ag-text">' + esc(own) + '</span></div>');
      notify(agent, own);
    } else {
      agent.note = 'Recherche indisponible (' + reason + ')';
      emit();
      log('<div class="ag-line"><span class="ag-name" style="color:' + agent.color + '">' + agent.emoji + ' ' + esc(agent.name) +
          '</span><span class="ag-text">recherche web indisponible (' + esc(reason) + ')</span></div>');
    }
    return;
  }
  agent.lastSource = found.source || '';

  const verdict = await llm(
    'Tu es un agent autonome qui travaille en arrière-plan pour un utilisateur. Tu ne lui parles QUE si tu as trouvé quelque chose d\'utile. Règles : 1) Ignore tout ce qui ne sert pas l\'objectif. 2) Si rien d\'utile, réponds exactement RIEN. 3) Sinon 1 à 2 phrases FRANÇAISES courtes (max 35 mots), factuelles, en commençant par ce que tu as trouvé. Aucun markdown, aucune liste, aucune didascalie.',
    'OBJECTIF : ' + agent.objective + '\n\nCE QUE J\'AI TROUVÉ JUSTE MAINTENANT (source : ' + (found.source || 'web') + ') : ' + found.text.slice(0, 900) + '\n\nDonne ton verdict.',
    200, 0.3
  );

  const text = tidy(verdict);
  if (!text || EMPTY.test(text)){
    agent.status = 'rien de pertinent';
    agent.note = 'Recherche faite, rien d\'utile pour l\'objectif.';
    emit();
    log('<div class="ag-line"><span class="ag-name" style="color:' + agent.color + '">' + agent.emoji + ' ' + esc(agent.name) +
        '</span><span class="ag-text">rien de pertinent (« ' + esc((found.text || '').slice(0, 70)) + '… »)</span></div>');
    return;
  }

  /* on garde la memoire de l'agent (comme dots : il retient ses preferences) */
  agent.findings = agent.findings || [];
  agent.findings.push({ t:Date.now(), text:text });
  if (agent.findings.length > 20) agent.findings = agent.findings.slice(-20);
  agent.memory = ((agent.memory || '') + ' ' + text).trim().slice(-1000);
  agent.status = 'a trouvé un truc';
  agent.note = text;
  agent.found = (agent.found || 0) + 1;
  S.logs.unshift({ t:Date.now(), name:agent.name, emoji:agent.emoji, color:agent.color, text:text });
  if (S.logs.length > 60) S.logs = S.logs.slice(0, 60);
  emit();

  log('<div class="ag-line"><span class="ag-name" style="color:' + agent.color + '">' + agent.emoji + ' ' + esc(agent.name) +
      '</span><span class="ag-text">' + esc(text) + '</span></div>');
  notify(agent, text);
  } finally { BUSY.delete(agent.id); }
}

/* ===== BOUCLE + LEADERSHIP (comme le moteur de debat) ===== */
let looping = false;
let hb = null;
let wdog = null;
function startHb(){
  stopHb();
  hb = setInterval(() => {
    if (S.running){ S.heartbeat = Date.now(); save(); }
  }, 3000);
}
function stopHb(){ if (hb){ clearInterval(hb); hb = null; } }
/* La boucle tourne en permanence mais ne fait RIEN tant qu'aucun agent
   n'est du (lastRun plus vieux que TICK_MS, ou 0 = jamais lance).
   Comme ca un agent cree a l'instant est pris en charge en moins de
   POLL_MS secondes, au lieu d'attendre le prochain cycle de 4 min. */
const POLL_MS = 20000;
function due(agent){
  if (!agent || agent.paused || !(agent.objective || '').trim()) return false;
  if (BUSY.has(agent.id)) return false;
  return !agent.lastRun || (Date.now() - agent.lastRun) >= TICK_MS;
}
async function loop(){
  if (looping) return;
  looping = true;
  try {
    while (S.running && S.runnerId === MY_ID){
      const list = (S.agents || []).filter(due);
      for (const a of list){
        if (!S.running || S.runnerId !== MY_ID) break;
        try { await runAgent(a); } catch(e){}
        await new Promise(r => setTimeout(r, 1500));
      }
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  } catch(e){}
  finally {
    looping = false;
    stopHb();
    if (S.runnerId === MY_ID){ S.runnerId = null; save(); push(); }
  }
}
/* "Chercher maintenant" : lance la recherche tout de suite */
function runNow(id){
  const a = (S.agents || []).find(x => x.id === id);
  if (!a) return false;
  a.paused = false;
  if (BUSY.has(a.id)) return false;
  runAgent(a);
  return true;
}

function start(){
  if (S.running && S.runnerId && S.runnerId !== MY_ID && Date.now() - S.heartbeat < 10000) return;
  S.running = true;
  S.runnerId = MY_ID;
  S.heartbeat = Date.now();
  emit();
  startHb();
  if (!looping) loop();
}
function stop(){
  S.running = false;
  S.runnerId = null;
  stopHb();
  emit();
}
function resume(){
  const fresh = load();
  if (fresh.running && Date.now() - fresh.heartbeat >= 10000){ S = fresh; start(); }
}
function startWatchdog(){
  if (wdog) return;
  wdog = setInterval(() => {
    if (looping) return;
    const fresh = load();
    if (fresh.running && Date.now() - fresh.heartbeat >= 10000){
      S = fresh;
      console.info('[AGENTS] runner disparu -> reprise automatique');
      start();
    }
  }, 4000);
}

/* ===== API PUBLIC ===== */
const PALETTE = ['#3cdca0','#7c5cff','#ff5c9a','#ffd27c','#5cc8ff','#ff7c5c','#b6ff5c','#ff5c5c'];
function addAgent(name, emoji, objective){
  name = (name || '').trim() || 'Agent';
  objective = (objective || '').trim();
  if (!objective) return null;
  const agent = {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    name: name.slice(0, 24),
    emoji: (emoji || '🤖').trim().slice(0, 2) || '🤖',
    objective: objective.slice(0, 200),
    color: PALETTE[(S.agents || []).length % PALETTE.length],
    created: Date.now(),
    lastRun: 0, runs: 0, found: 0,
    status: 'en veille', note: '', memory: '', findings: [],
    paused: false
  };
  S.agents = S.agents || [];
  S.agents.push(agent);
  log('<div class="ag-line"><span class="ag-name" style="color:' + agent.color + '">' + agent.emoji + ' ' + esc(agent.name) +
      '</span><span class="ag-text">objectif : ' + esc(agent.objective) + '</span></div>');
  emit();
  if (!S.running) start();
  return agent;
}
function removeAgent(id){
  S.agents = (S.agents || []).filter(a => a.id !== id);
  emit();
}
function toggleAgent(id){
  const a = (S.agents || []).find(x => x.id === id);
  if (a){ a.paused = !a.paused; a.status = a.paused ? 'en pause' : 'en veille'; emit(); }
}
function renameAgent(id, name){
  const a = (S.agents || []).find(x => x.id === id);
  if (a && (name || '').trim()){ a.name = name.trim().slice(0, 24); emit(); }
}

if (bc){
  bc.onmessage = (ev) => {
    if (ev && ev.data && ev.data.type === 'agents' && ev.data.state){
      S = ev.data.state;
      if (hooks.onState) hooks.onState(S);
    }
  };
}
window.addEventListener('storage', (ev) => {
  if (ev.key === KEY){ S = load(); if (hooks.onState) hooks.onState(S); }
});

window.AgentsEngine = {
  hooks, addAgent, removeAgent, toggleAgent, renameAgent, runNow,
  start, stop, resume, isRunning(){ return !!S.running && Date.now() - S.heartbeat < 10000; },
  get agents(){ return S.agents || []; },
  get logs(){ return S.logs || []; },
  get state(){ return S; },
  reload(){ S = load(); return S; }
};

startWatchdog();
resume();
if (!(S.agents || []).length && !localStorage.getItem('va_agents_seeded')){
  /* premier agent offert : comme "un dot par compte" */
  localStorage.setItem('va_agents_seeded', '1');
}
if (S.running) start();
})();
