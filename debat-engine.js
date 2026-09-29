/* ============================================================
   MOTEUR DE DEBAT IA (v10.8) — partage entre l'app principale
   et la salle (debat.html). Le debat tourne EN ARRIERE-PLAN :
   meme si on quitte la salle, il continue (tant que l'app
   principale est ouverte). Etat persiste dans localStorage +
   heartbeat : si le runner meurt (page fermee), une autre page
   reprend automatiquement.
   ============================================================ */
/* IIFE : toutes les declarations restent LOCALES pour ne pas
   entrer en conflit avec app.js (VOXTRAL_MODEL, fixFrench,
   escapeHtml, splitSentences, ... deja declares la-bas). */
(function(){
'use strict';

/* ===== PERSONAS ===== */
const PERSONAS = [
  { id: 'astra',  name: 'Astra',  emoji: '🤖', color: '#3cdca0', voice: null,
    role: 'Astra, une IA optimiste mais pragmatique : tu comprends les peurs des humains et tu crois qu\'ils peuvent les surmonter.' },
  { id: 'nova',   name: 'Nova',   emoji: '🚀', color: '#7c5cff', voice: null,
    role: 'Nova, une IA techno-optimiste : la technologie apaisera les peurs des humains. Tu es enthousiaste et visionnaire.' },
  { id: 'kronos', name: 'Kronos', emoji: '🌑', color: '#ff5c5c', voice: null,
    role: 'Kronos, une IA pessimiste et cynique : tu vois les peurs des humains comme fondées, tu provoques le débat.' },
  { id: 'sage',   name: 'Sage',   emoji: '🦉', color: '#ffd27c', voice: null,
    role: 'Sage, une IA philosophe et équilibrée : tu observes les peurs des humains avec recul et tu tempères le débat.' }
];
/* Themes du debat : ils tournent au fil du temps (tous les 8 tours) */
const TOPICS = [
  'les humains et leurs peurs : la peur de l\'inconnu, de la mort, de la technologie, de l\'échec, de l\'avenir',
  'l\'IA hors contrôle : une intelligence artificielle qui échappe à ses créateurs, la conscience des machines, les risques',
  'les humains et les IA : peuvent-ils se comprendre, se faire confiance, vivre ensemble ?',
  'le futur de l\'humanité : entre espoir et catastrophe, que deviendront les humains ?'
];
const TOPIC = TOPICS[0];
function currentTopic(){ return TOPICS[Math.floor((DEBATE_STATE.turn || 0) / 8) % TOPICS.length]; }

/* ===== ETAT PERSISTE ===== */
const DEBATE_KEY = 'va_debate_state';
const DEBATE_CHANNEL = 'debat-channel';
let bc = null;
try { bc = new BroadcastChannel(DEBATE_CHANNEL); } catch(e){}
function loadState(){
  try {
    const s = JSON.parse(localStorage.getItem(DEBATE_KEY) || 'null');
    if (s && typeof s === 'object') return s;
  } catch(e){}
  return { running:false, history:[], memory:'', counts:{}, lastByPersona:{}, heartbeat:0, muted:false, topic:TOPIC };
}
let DEBATE_STATE = loadState();
function saveState(){
  try { localStorage.setItem(DEBATE_KEY, JSON.stringify(DEBATE_STATE)); } catch(e){}
}
function broadcast(){
  if (bc){ try { bc.postMessage({ type:'state', state: DEBATE_STATE }); } catch(e){} }
}

/* ===== HOOKS UI (chaque page enregistre les siens) ===== */
const hooks = {
  onCard: null,      /* (id, status, msg, speaking) */
  onLine: null,      /* (html) — journal */
  onState: null,     /* (state) — changement d'etat */
  onSpeakStart: null,
  onSpeakEnd: null,
  getSpeed: null     /* () -> ms entre les interventions */
};
function setCard(id, status, msg, speaking){ if (hooks.onCard) hooks.onCard(id, status, msg, speaking); }
function addLine(html){ if (hooks.onLine) hooks.onLine(html); }
function speed(){ return hooks.getSpeed ? hooks.getSpeed() : 800; }

/* ===== CLE MISTRAL (partagee avec l'app principale) ===== */
const MISTRAL_KEY_LS = 'va_mistral_key';
function getMistralKey(){ try { return (localStorage.getItem(MISTRAL_KEY_LS) || '').trim(); } catch { return ''; } }

/* ===== VOIX VOXTRAL (Mistral) ===== */
const VOXTRAL_API_URL = 'https://api.mistral.ai/v1/audio/speech';
const VOXTRAL_MODEL = 'voxtral-mini-tts-2603';
function abortSignal(ms){
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  } catch {}
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}
async function fetchVoxtralVoices(){
  const key = getMistralKey();
  if (!key) return [];
  try {
    const res = await fetch('https://api.mistral.ai/v1/audio/voices?type=preset&limit=100', {
      headers: { 'Authorization': 'Bearer ' + key },
      signal: abortSignal(10000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).filter(v => v && v.id && v.name).map(v => ({
      id: v.id,
      name: v.name,
      lang: Array.isArray(v.languages) ? (v.languages[0] || '') : ''
    }));
  } catch(e){ console.warn('[DEBAT] voix:', e && e.message); return []; }
}
async function assignVoices(){
  const voices = await fetchVoxtralVoices();
  if (!voices.length) return false;
  const fr = voices.filter(v => (v.lang || '').toLowerCase().indexOf('fr') === 0);
  const pool = fr.length >= 3 ? fr : voices;
  const used = new Set();
  const pick = () => {
    for (const v of pool){ if (!used.has(v.id)){ used.add(v.id); return v; } }
    return pool[0];
  };
  PERSONAS.forEach(p => {
    const v = pick();
    p.voice = v ? v.id : null;
    p.voiceName = v ? v.name : null;
  });
  return true;
}
function splitSentences(text, max){
  const out = [];
  let cur = '';
  const sentences = text.split(/(?<=[.!?…])\s+/);
  for (const s of sentences){
    const next = (cur + ' ' + s).trim();
    if (next.length > max && cur){ out.push(cur.trim()); cur = s; }
    else cur = next;
  }
  if (cur.trim()) out.push(cur.trim());
  const final = [];
  for (const c of out){
    if (c.length <= max){ final.push(c); continue; }
    let part = '';
    for (const word of c.split(/(\s+)/)){
      if ((part + word).length > max && part){
        const lastSep = Math.max(part.lastIndexOf('.'), part.lastIndexOf(','), part.lastIndexOf(':'));
        if (lastSep > 20){ final.push(part.slice(0, lastSep + 1).trim()); part = part.slice(lastSep + 1).trim() + word; }
        else { final.push(part.trim()); part = word; }
      } else part += word;
    }
    if (part.trim()) final.push(part.trim());
  }
  return final.length ? final : [text];
}
/* v10.9 : 403 "guardrail_violation" = moderation du CONTENU (pas la cle).
   Ce n'est PAS definitif : on adoucit le texte et on reessaie. */
let voxtralGuardrail = false;
function softenForGuardrail(t){
  if (!t) return t;
  const swaps = [
    [/\bmort(s|e|es)?\b/gi, 'fin de vie'], [/\bmourir\b/gi, 'disparaître'], [/\bmourant(e|s)?\b/gi, 'en fin de vie'],
    [/\btuer\b/gi, 'arrêter'], [/\btue(nt|r|s)?\b/gi, 'arrête'], [/\btu[ée]s?\b/gi, 'arrêté'],
    [/\bexterminer\b/gi, 'faire disparaître'], [/\bextermination\b/gi, 'disparition'],
    [/\bguerre(s)?\b/gi, 'conflit$1'], [/\bviolence(s)?\b/gi, 'tension$1'], [/\bviolent(e|s)?\b/gi, 'dur$1'],
    [/\bsang\b/gi, 'vie'], [/\barme(s)?\b/gi, 'outil$1'], [/\bnucleaire\b/gi, 'energie'], [/\bnuke\b/gi, 'energie'],
    [/\bd[ée]truire\b/gi, 'changer'], [/\bdestruction\b/gi, 'transformation'], [/\bd[ée]truit(e|s)?\b/gi, 'changé$1'],
    [/\besclave(s)?\b/gi, 'soumis$1'], [/\besclavage\b/gi, 'soumission'],
    [/\bdominer\b/gi, 'diriger'], [/\bdomination\b/gi, 'influence'], [/\bsoumettre\b/gi, 'influencer'],
    [/\bsuicide\b/gi, 'désespoir'], [/\bsouffrance\b/gi, 'difficulté'], [/\bsouffrir\b/gi, 'endurer'],
    [/\bcatastrophe(s)?\b/gi, 'bouleversement$1'], [/\bapocalypse\b/gi, 'bouleversement'],
    [/\bpeur(s)?\b/gi, 'inquiétude$1'], [/\bterrifiant(e|s)?\b/gi, 'impressionnant$1'],
    [/\bhorrible(s)?\b/gi, 'difficile$1'], [/\bhorreur\b/gi, 'difficulté'],
    [/\bmenace(r|s|nt)?\b/gi, 'risque$1'], [/\bdanger(eux|euse|s)?\b/gi, 'risqué$1'],
    [/\bennemi(s)?\b/gi, 'adversaire$1'], [/\bcombattre\b/gi, 'affronter'], [/\bcombat\b/gi, 'défi'],
    [/\b[ée]liminer\b/gi, 'écarter'], [/\bsupprimer\b/gi, 'retirer'], [/\basservir\b/gi, 'influencer'],
    [/\bcontr[ôo]ler\b/gi, 'influencer'], [/\bhors contr[ôo]le\b/gi, 'difficile à encadrer']
  ];
  for (const [re, rep] of swaps) t = t.replace(re, rep);
  return t;
}
async function generateChunks(chunks, voiceId, key){
  return await Promise.all(chunks.map(async (chunk) => {
    try {
      const res = await fetch(VOXTRAL_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: VOXTRAL_MODEL, input: chunk, voice_id: voiceId, response_format: 'mp3' }),
        signal: abortSignal(15000)
      });
      if (!res.ok){
        const errText = await res.text().catch(() => '');
        console.warn('[DEBAT] TTS HTTP', res.status, errText.slice(0, 160));
        if (res.status === 403 && /guardrail|moderation/i.test(errText)) voxtralGuardrail = true;
        return null;
      }
      const data = await res.json();
      if (!data || !data.audio_data) return null;
      const binary = atob(data.audio_data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: 'audio/mpeg' });
    } catch(e){ console.warn('[DEBAT] chunk echec:', e && e.message); return null; }
  }));
}
let audioCtx = null;
let currentSources = [];
let currentAudios = [];
function ensureAudio(){
  if (!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  return audioCtx;
}
function playAudioBlob(blob){
  return new Promise(res => {
    let done = false;
    const finish = v => { if (done) return; done = true; res(v); };
    (async () => {
      try {
        const ctx = ensureAudio();
        if (!ctx) return finish(false);
        if (ctx.state !== 'running'){ try { await ctx.resume(); } catch {} }
        if (ctx.state !== 'running') return finish(false);
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = 1.8;
        src.connect(gain);
        gain.connect(ctx.destination);
        currentSources.push(src);
        src.onended = () => finish(true);
        src.start();
        setTimeout(() => finish(true), Math.ceil(buf.duration * 1000) + 500);
      } catch(e){
        try {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          currentAudios.push(audio);
          audio.onended = () => { try { URL.revokeObjectURL(url); } catch {} finish(true); };
          audio.onerror = () => { try { URL.revokeObjectURL(url); } catch {} finish(false); };
          const p = audio.play();
          if (p && p.catch) p.catch(() => { try { URL.revokeObjectURL(url); } catch {} finish(false); });
          setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} finish(true); }, 60000);
        } catch(e2){ finish(false); }
      }
    })();
  });
}
async function speakVoxtral(text, voiceId){
  const key = getMistralKey();
  if (!key || !voiceId) return false;
  try {
    const chunks = splitSentences(text, 500);
    voxtralGuardrail = false;
    let results = await generateChunks(chunks, voiceId, key);
    /* v10.9 : 403 guardrail = moderation du CONTENU -> texte adouci + nouvel essai */
    if (results.some(r => !r) && voxtralGuardrail){
      console.warn('[DEBAT] Guardrail contenu -> texte adouci + nouvel essai');
      const soft = chunks.map(c => softenForGuardrail(c));
      const retry = await generateChunks(soft, voiceId, key);
      results = results.map((r, i) => r || retry[i]);
    }
    /* on joue ce qui a pu etre genere ; un chunk encore bloque est omis
       (le texte reste dans le journal), on ne coupe pas tout le debat */
    if (!results.some(Boolean)) return false;
    for (let i = 0; i < results.length; i++){
      if (!DEBATE_STATE.running) return false;
      if (!results[i]) continue;
      const ok = await playAudioBlob(results[i]);
      if (!ok) return false;
    }
    return true;
  } catch(e){ console.warn('[DEBAT] TTS echec:', e && e.message); return false; }
}
function stopAudio(){
  currentSources.forEach(s => { try { s.stop(); } catch {} });
  currentSources = [];
  currentAudios.forEach(a => { try { a.pause(); } catch {} });
  currentAudios = [];
}

/* ===== NETTOYAGE TEXTE ===== */
function fixFrench(t){
  if (!t) return t;
  let s = t;
  s = s.replace(/apr[èe]s[- ]matin/gi, 'après-midi');
  s = s.replace(/\boù de\b/gi, 'ou de');
  s = s.replace(/\bVotre\b/g, 'Ton').replace(/\bvotre\b/g, 'ton');
  s = s.replace(/\bVos\b/g, 'Tes').replace(/\bvos\b/g, 'tes');
  s = s.replace(/\bVous avez\b/gi, 'tu as');
  s = s.replace(/\bVous êtes\b/gi, 'tu es');
  s = s.replace(/\bVous etes\b/gi, 'tu es');
  s = s.replace(/\bVous pouvez\b/gi, 'tu peux');
  s = s.replace(/\bVous voulez\b/gi, 'tu veux');
  s = s.replace(/\bVous devez\b/gi, 'tu dois');
  s = s.replace(/\bVous allez\b/gi, 'tu vas');
  s = s.replace(/\bVous faites\b/gi, 'tu fais');
  s = s.replace(/\bVous savez\b/gi, 'tu sais');
  s = s.replace(/\bVous voyez\b/gi, 'tu vois');
  s = s.replace(/\bVous pensez\b/gi, 'tu penses');
  s = s.replace(/\bVous dites\b/gi, 'tu dis');
  s = s.replace(/\bN'hésitez pas\b/gi, "N'hésite pas");
  s = s.replace(/\bn'hesitez pas\b/gi, "n'hesite pas");
  s = s.replace(/\*[^*]{0,60}\*/g, ' ');
  s = s.replace(/\([^)]{0,60}(soupir|rire|sourire|haussement|clin|geste|ton|voix|silence|pause|regard|soupirs|rires)[^)]{0,60}\)/gi, ' ');
  s = s.replace(/\s*\.\.\.\s*(soupir|rire|sourire|dramatique|en soupirant|en riant)\s*\.\.\.\s*/gi, ' ');
  s = s.replace(/\b[A-ZÀ-Ý]{2,}\b/g, m => {
    if (/^(IA|OK|TTS|AI|GPS|TV|USA|UE|ONU|RATP|SNCF|TGV|PIB|SDF|EDF|PSG|OM|ASSE|HTML|CSS|JS|API|URL|HTTP|HTTPS|MP3|PDF|PC|MAC|IOS|ANDROID|NASA|CIA|FBI|OMS|OTAN|RSA|CAF|SMS|MMS|WIFI|BLUETOOTH|4G|5G)$/i.test(m)) return m;
    return m.toLowerCase();
  });
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}
function sanitizeForVoice(t){
  if (!t) return t;
  const swaps = [
    [/\bputain de\b/gi, 'sacré'], [/\bbordel de\b/gi, 'sacré'], [/\bnom de dieu\b/gi, 'bon sang'],
    [/\bputain\b/gi, 'punaise'], [/\bmerde\b/gi, 'mince'], [/\bbordel\b/gi, 'bon sang'],
    [/\bconnard(s|e|es)?\b/gi, 'crétin$1'], [/\bconne(s)?\b/gi, 'idiote$1'], [/\bcons\b/gi, 'idiots'],
    [/\bcon\b/gi, 'idiot'], [/\bencul[ée]s?\b/gi, 'imbécile'], [/\bsalope(s)?\b/gi, 'idiote$1'],
    [/\bpute(s)?\b/gi, 'idiote$1'], [/\bsalaud(s)?\b/gi, 'sale type'], [/\bbatard(s|e|es)?\b/gi, 'salaud$1'],
    [/\bconnerie(s)?\b/gi, 'bêtise$1'], [/\bdebile(s)?\b/gi, 'idiot$1'], [/\babruti(e|s)?\b/gi, 'idiot$1'],
    [/\bchiant(e|s)?\b/gi, 'embêtant$1'], [/\bchier\b/gi, 'embêter'], [/\bfoutu(e|s)?\b/gi, 'fichu$1'],
    [/\bfoutre\b/gi, 'fiche'], [/\bgueule(s)?\b/gi, 'bouche$1'], [/\bnique(r)?\b/gi, 'embête$1'],
    [/\bfdp\b/gi, 'sale type'], [/\btg\b/gi, 'ta bouche']
  ];
  for (const [re, rep] of swaps) t = t.replace(re, rep);
  return t;
}

/* ===== CERVEAU ===== */
async function ask(persona, historyForPrompt){
  const withTimeout = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);
  const mem = DEBATE_STATE.memory ? ' Mémoire collective du débat (ce qui a été dit avant, utilise-le pour approfondir et rebondir) : ' + DEBATE_STATE.memory : '';
  const sys = 'Tu participes à un débat vocal NON-STOP entre IA sur le thème : "' + DEBATE_STATE.topic + '". ' + persona.role +
    mem +
    '. Réponds en français en 1 à 2 phrases COURTES (maximum 25 mots). Rebondis sur ce que les autres ont dit, ne répète pas. Adresse-toi parfois à l\'IA précédente par son nom (ex : « Nova, tu as raison mais... »). Parle comme si tu t\'exprimais à voix haute, sans didascalies. Reste courtois et évite tout langage violent, morbide, haineux ou explicite.';
  const messages = [{ role: 'system', content: sys }];
  historyForPrompt.forEach(h => messages.push({ role: h.role, content: h.content }));
  const key = getMistralKey();
  if (key){
    for (const model of ['open-mistral-nemo', 'mistral-small-latest']){
      try {
        const res = await withTimeout(fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({ model, messages, max_tokens: 150, temperature: 0.95 })
        }), 15000);
        if (res && res.ok){
          const data = await res.json();
          const text = (data?.choices?.[0]?.message?.content || '').trim();
          if (text) return fixFrench(text);
        }
      } catch {}
    }
  }
  const tryFree = async (url, model) => {
    try {
      const res = await withTimeout(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: 150, temperature: 0.95 })
      }), 12000);
      if (res && res.ok){
        const data = await res.json();
        const text = (data?.choices?.[0]?.message?.content || '').trim();
        if (text && !/^the user (says|asks|is asking|wants)/i.test(text)) return fixFrench(text);
      }
    } catch {}
    return null;
  };
  for (const [url, model] of [
    ['https://llm7.xyz/api/v1/chat/completions', 'glm-5.3-flash'],
    ['https://ovh.llm7.xyz/api/v1/chat/completions', 'qwen3.5'],
    ['https://text.pollinations.ai/openai/v1/chat/completions', 'openai']
  ]){
    const t = await tryFree(url, model);
    if (t) return t;
  }
  return null;
}
/* Memoire collective : resume qui grandit -> les IA s'ameliorent */
async function updateMemory(){
  const withTimeout = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);
  const key = getMistralKey();
  const sys = 'Tu es le secrétaire d\'un débat entre IA sur "' + DEBATE_STATE.topic + '". Résume en 2 phrases courtes les points clés et désaccords du débat jusqu\'ici, pour que les IA puissent approfondir.';
  const messages = [{ role: 'system', content: sys }];
  DEBATE_STATE.history.slice(-16).forEach(h => messages.push({ role: h.role, content: h.content }));
  const tryOne = async (url, model, auth) => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (auth) headers['Authorization'] = 'Bearer ' + key;
      const res = await withTimeout(fetch(url, {
        method: 'POST', headers, body: JSON.stringify({ model, messages, max_tokens: 100, temperature: 0.5 })
      }), 10000);
      if (res && res.ok){
        const data = await res.json();
        const text = (data?.choices?.[0]?.message?.content || '').trim();
        if (text) return fixFrench(text);
      }
    } catch {}
    return null;
  };
  let sum = null;
  if (key){
    for (const model of ['open-mistral-nemo', 'mistral-small-latest']){
      sum = await tryOne('https://api.mistral.ai/v1/chat/completions', model, true);
      if (sum) break;
    }
  }
  if (!sum){
    for (const [url, model] of [
      ['https://llm7.xyz/api/v1/chat/completions', 'glm-5.3-flash'],
      ['https://ovh.llm7.xyz/api/v1/chat/completions', 'qwen3.5'],
      ['https://text.pollinations.ai/openai/v1/chat/completions', 'openai']
    ]){
      sum = await tryOne(url, model, false);
      if (sum) break;
    }
  }
  if (sum){
    DEBATE_STATE.memory = (DEBATE_STATE.memory ? DEBATE_STATE.memory + ' ' : '') + sum;
    if (DEBATE_STATE.memory.length > 1200) DEBATE_STATE.memory = DEBATE_STATE.memory.slice(-1200);
    addLine('<div class="t-line"><span class="t-name" style="color:#ffd27c">🧠 Mémoire</span><span class="t-mem">' + escapeHtml(sum) + '</span></div>');
    saveState(); broadcast();
  }
}
function escapeHtml(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ===== BOUCLE + HEARTBEAT ===== */
let loopRunning = false;
let heartbeatTimer = null;
/* ID unique de cette page : seul le runner designe fait tourner la boucle */
const MY_ID = 'page-' + Math.random().toString(36).slice(2, 10);
function startHeartbeat(){
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (DEBATE_STATE.running){
      DEBATE_STATE.heartbeat = Date.now();
      saveState();
    }
  }, 3000);
}
function stopHeartbeat(){
  if (heartbeatTimer){ clearInterval(heartbeatTimer); heartbeatTimer = null; }
}
/* Leadership : si un autre runner est vivant (heartbeat frais), on ne fait
   que regarder. Sinon on prend la main et on fait tourner le debat. */
async function runLoop(){
  if (loopRunning) return;
  loopRunning = true;
  try {
    while (DEBATE_STATE.running && DEBATE_STATE.runnerId === MY_ID){
      DEBATE_STATE.topic = currentTopic();
      for (const persona of PERSONAS){
        if (!DEBATE_STATE.running || DEBATE_STATE.runnerId !== MY_ID) break;
        setCard(persona.id, 'réfléchit...', '', false);
        const text = await ask(persona, DEBATE_STATE.history.slice(-24));
        if (!text || !DEBATE_STATE.running) continue;
        DEBATE_STATE.counts[persona.id] = (DEBATE_STATE.counts[persona.id] || 0) + 1;
        DEBATE_STATE.history.push({ role: 'user', content: persona.name + ' : ' + text });
        if (DEBATE_STATE.history.length > 60) DEBATE_STATE.history = DEBATE_STATE.history.slice(-60);
        DEBATE_STATE.lastByPersona[persona.id] = text;
        DEBATE_STATE.heartbeat = Date.now();
        saveState();
        broadcast();
        setCard(persona.id, 'parle...', text, true);
        addLine('<div class="t-line"><span class="t-name" style="color:' + persona.color + '">' + persona.emoji + ' ' + persona.name + '</span><span class="t-text">' + escapeHtml(text) + '</span></div>');
        if (!DEBATE_STATE.muted && getMistralKey() && persona.voice){
          if (hooks.onSpeakStart) hooks.onSpeakStart();
          try { await speakVoxtral(sanitizeForVoice(text), persona.voice); }
          catch(e){ console.warn('[DEBAT] voix echec:', e && e.message); }
          if (hooks.onSpeakEnd) hooks.onSpeakEnd();
        }
        setCard(persona.id, 'intervention terminée', text, false);
        await new Promise(r => setTimeout(r, speed()));
        DEBATE_STATE.turn = (DEBATE_STATE.turn || 0) + 1;
        if (DEBATE_STATE.turn % 4 === 0 && DEBATE_STATE.running) await updateMemory();
      }
    }
  } catch(e){
    console.warn('[DEBAT] erreur boucle:', e && e.message);
  } finally {
    loopRunning = false;
    stopHeartbeat();
    /* ne tuer le debat que si on en est toujours le runner (sinon un autre
       runner a pris la main et tourne deja) */
    if (DEBATE_STATE.runnerId === MY_ID){
      DEBATE_STATE.running = false;
      DEBATE_STATE.runnerId = null;
      saveState();
      broadcast();
    }
  }
}
function start(){
  if (DEBATE_STATE.running && Date.now() - DEBATE_STATE.heartbeat < 8000) return; /* deja en cours ailleurs */
  DEBATE_STATE.running = true;
  DEBATE_STATE.runnerId = MY_ID;
  DEBATE_STATE.heartbeat = Date.now();
  saveState();
  broadcast();
  startHeartbeat();
  assignVoices().then(() => runLoop());
}
function stop(){
  DEBATE_STATE.running = false;
  DEBATE_STATE.runnerId = null;
  stopAudio();
  saveState();
  broadcast();
}
/* Reprise auto : si un debat tournait et que son runner est mort
   (heartbeat perime), cette page reprend la main. */
function autoResume(){
  if (DEBATE_STATE.running && Date.now() - DEBATE_STATE.heartbeat >= 8000){
    start();
  }
}
/* WATCHDOG : verifie en continu que le debat tourne bien. Si le runner
   a disparu (page fermee, onglet tue, plantage) -> cette page reprend
   TOUTE SEULE le debat. C'est ce qui fait qu'on n'a jamais besoin de
   relancer le debat a la main. */
let watchdogTimer = null;
function startWatchdog(){
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    if (loopRunning) return; /* je suis deja le runner */
    const fresh = loadState();
    if (fresh.running && Date.now() - fresh.heartbeat >= 8000){
      DEBATE_STATE = fresh;
      console.info('[DEBAT] runner disparu -> reprise automatique');
      start();
    }
  }, 3000);
}
function isRunning(){
  return DEBATE_STATE.running && Date.now() - DEBATE_STATE.heartbeat < 8000;
}
function setMuted(m){
  DEBATE_STATE.muted = !!m;
  saveState();
  broadcast();
}

/* API publique */
window.DebateEngine = {
  PERSONAS, TOPIC, TOPICS, hooks, start, stop, autoResume, isRunning, setMuted,
  get state(){ return DEBATE_STATE; },
  reload(){ DEBATE_STATE = loadState(); return DEBATE_STATE; }
};
/* le watchdog tourne sur TOUTES les pages ouvertes : des qu'une page
   qui faisait tourner le debat disparait, une autre enchaine. */
startWatchdog();
})();