/* ============================================================
   SALLE DE DEBAT IA (v10.7) — page autonome
   4 IA avec des voix Mistral differentes discutent NON-STOP
   sur les humains. Elles se repondent, se souviennent de tout
   (memoire collective qui s'ameliore) et s'ecoutent en vocal.
   Reutilise la cle Mistral de l'app principale (localStorage).
   ============================================================ */
'use strict';

/* ===== PERSONAS ===== */
const PERSONAS = [
  { id: 'astra',  name: 'Astra',  emoji: '🤖', color: '#3cdca0', voice: null, count: 0,
    role: 'Astra, une IA optimiste mais pragmatique : tu vois les progrès des humains ET leurs risques. Tu crois en eux malgré tout.' },
  { id: 'nova',   name: 'Nova',   emoji: '🚀', color: '#7c5cff', voice: null, count: 0,
    role: 'Nova, une IA techno-optimiste : la technologie et la science sauveront les humains. Tu es enthousiaste et visionnaire.' },
  { id: 'kronos', name: 'Kronos', emoji: '🌑', color: '#ff5c5c', voice: null, count: 0,
    role: 'Kronos, une IA pessimiste et cynique : tu vois surtout les défauts des humains, leurs guerres et leurs dérives. Tu provoques le débat.' },
  { id: 'sage',   name: 'Sage',   emoji: '🦉', color: '#ffd27c', voice: null, count: 0,
    role: 'Sage, une IA philosophe et équilibrée : tu observes les humains avec recul, tu vois les deux côtés et tu tempères le débat.' }
];
const TOPIC = 'les humains : leur nature, leurs qualités, leurs défauts, leur avenir';

/* ===== ETAT ===== */
let running = false;
let history = [];          /* tout ce qui a ete dit */
let collectiveMemory = ''; /* resume qui grandit -> les IA s'ameliorent */
let stopRequested = false;
let currentSources = [];
let currentAudios = [];
let audioCtx = null;

/* ===== CLE MISTRAL (partagee avec l'app principale) ===== */
const MISTRAL_KEY_LS = 'va_mistral_key';
function getMistralKey(){ try { return (localStorage.getItem(MISTRAL_KEY_LS) || '').trim(); } catch { return ''; } }

/* ===== UI ===== */
const $ = id => document.getElementById(id);
function addLine(html){
  const t = $('transcript');
  if (!t) return;
  t.insertAdjacentHTML('beforeend', html);
  t.scrollTop = t.scrollHeight;
}
function setCard(id, status, msg, speaking){
  const card = $('card-' + id);
  if (!card) return;
  card.classList.toggle('speaking', !!speaking);
  card.classList.toggle('thinking', status === 'réfléchit...');
  const st = $('status-' + id);
  if (st) st.textContent = status;
  const ms = $('msg-' + id);
  if (ms){
    ms.textContent = msg || '';
    ms.classList.toggle('empty', !msg);
  }
}
function buildCards(){
  const stage = $('stage');
  if (!stage) return;
  stage.innerHTML = '';
  PERSONAS.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'card-' + p.id;
    card.style.setProperty('--dc', p.color);
    card.innerHTML =
      '<div class="card-head">' +
        '<div class="avatar">' + p.emoji + '</div>' +
        '<div>' +
          '<div class="card-name">' + p.name + '</div>' +
          '<div class="card-voice" id="voice-' + p.id + '">voix…</div>' +
        '</div>' +
      '</div>' +
      '<div class="card-status" id="status-' + p.id + '">en attente</div>' +
      '<div class="card-msg empty" id="msg-' + p.id + '">…</div>' +
      '<div class="card-count" id="count-' + p.id + '">0 intervention</div>';
    stage.appendChild(card);
  });
}
function setVoiceLabel(id, label){
  const v = $('voice-' + id);
  if (v) v.textContent = label;
}
function setCount(id, n){
  const c = $('count-' + id);
  if (c) c.textContent = n + (n > 1 ? ' interventions' : ' intervention');
}

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
    setVoiceLabel(p.id, v ? 'Voix : ' + v.name : 'pas de voix');
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
async function generateChunks(chunks, voiceId, key){
  return await Promise.all(chunks.map(async (chunk) => {
    try {
      const res = await fetch(VOXTRAL_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: VOXTRAL_MODEL, input: chunk, voice_id: voiceId, response_format: 'mp3' }),
        signal: abortSignal(15000)
      });
      if (!res.ok){ console.warn('[DEBAT] TTS HTTP', res.status); return null; }
      const data = await res.json();
      if (!data || !data.audio_data) return null;
      const binary = atob(data.audio_data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: 'audio/mpeg' });
    } catch(e){ console.warn('[DEBAT] chunk echec:', e && e.message); return null; }
  }));
}
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
    const results = await generateChunks(chunks, voiceId, key);
    if (results.some(r => !r)) return false;
    for (let i = 0; i < results.length; i++){
      if (stopRequested) return false;
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

/* ===== NETTOYAGE TEXTE (copie des fonctions eprouvees de l'app) ===== */
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
  const mem = collectiveMemory ? ' Mémoire collective du débat (ce qui a été dit avant, utilise-le pour approfondir et rebondir) : ' + collectiveMemory : '';
  const sys = 'Tu participes à un débat vocal NON-STOP entre IA sur le thème : "' + TOPIC + '". ' + persona.role +
    mem +
    '. Réponds en français, en 2 à 4 phrases, avec ton point de vue personnel. Rebondis sur ce que les autres ont dit, ne répète pas. Parle comme si tu t\'exprimais à voix haute, sans didascalies.';
  const messages = [{ role: 'system', content: sys }];
  historyForPrompt.forEach(h => messages.push({ role: h.role, content: h.content }));
  const key = getMistralKey();
  if (key){
    for (const model of ['open-mistral-nemo', 'mistral-small-latest']){
      try {
        const res = await withTimeout(fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({ model, messages, max_tokens: 300, temperature: 0.95 })
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
        body: JSON.stringify({ model, messages, max_tokens: 300, temperature: 0.95 })
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
/* Memoire collective : resume qui grandit a chaque tour -> les IA s'ameliorent */
async function updateMemory(){
  const withTimeout = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);
  const key = getMistralKey();
  const sys = 'Tu es le secrétaire d\'un débat entre IA sur "' + TOPIC + '". Résume en 2 phrases les points clés et désaccords du débat jusqu\'ici, pour que les IA puissent approfondir.';
  const messages = [{ role: 'system', content: sys }];
  history.slice(-16).forEach(h => messages.push({ role: h.role, content: h.content }));
  const tryOne = async (url, model, auth) => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (auth) headers['Authorization'] = 'Bearer ' + key;
      const res = await withTimeout(fetch(url, {
        method: 'POST', headers, body: JSON.stringify({ model, messages, max_tokens: 150, temperature: 0.5 })
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
    collectiveMemory = (collectiveMemory ? collectiveMemory + ' ' : '') + sum;
    if (collectiveMemory.length > 1200) collectiveMemory = collectiveMemory.slice(-1200);
    addLine('<div class="t-line"><span class="t-name" style="color:#ffd27c">🧠 Mémoire</span><span class="t-mem">' + escapeHtml(sum) + '</span></div>');
  }
}
function escapeHtml(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ===== BOUCLE NON-STOP ===== */
async function run(){
  running = true;
  stopRequested = false;
  $('startBtn').disabled = true;
  $('stopBtn').disabled = false;
  const speed = () => parseInt($('speedSel').value || '800', 10);
  let turn = 0;
  while (!stopRequested){
    for (const persona of PERSONAS){
      if (stopRequested) break;
      setCard(persona.id, 'réfléchit...', '', false);
      const text = await ask(persona, history.slice(-24));
      if (!text || stopRequested) continue;
      persona.count++;
      setCount(persona.id, persona.count);
      history.push({ role: 'user', content: persona.name + ' : ' + text });
      if (history.length > 60) history = history.slice(-60);
      setCard(persona.id, 'parle...', text, true);
      addLine('<div class="t-line"><span class="t-name" style="color:' + persona.color + '">' + persona.emoji + ' ' + persona.name + '</span><span class="t-text">' + escapeHtml(text) + '</span></div>');
      if (getMistralKey() && persona.voice){
        await speakVoxtral(sanitizeForVoice(text), persona.voice);
      }
      setCard(persona.id, 'intervention terminée', text, false);
      await new Promise(r => setTimeout(r, speed()));
      turn++;
      /* toutes les 4 interventions : la memoire collective s'ameliore */
      if (turn % 4 === 0 && !stopRequested) await updateMemory();
    }
  }
  running = false;
  $('startBtn').disabled = false;
  $('stopBtn').disabled = true;
  addLine('<div class="t-line"><span class="t-name" style="color:#8a8aa5">⏹</span><span class="t-text">Débat arrêté.</span></div>');
}
function stop(){
  stopRequested = true;
  stopAudio();
  PERSONAS.forEach(p => setCard(p.id, 'arrêté', '', false));
}

/* ===== DEMARRAGE ===== */
$('startBtn').addEventListener('click', () => {
  if (running) return;
  buildCards();
  $('transcript').innerHTML = '';
  history = [];
  collectiveMemory = '';
  const key = getMistralKey();
  if (!key){
    $('notice').style.display = 'block';
    $('notice').textContent = '⚠️ Pas de clé Mistral : le débat tournera en TEXTE seul (pas de voix). Ajoute ta clé dans l\'app principale (Réglages) pour les voix Voxtral.';
  } else {
    $('notice').style.display = 'none';
  }
  addLine('<div class="t-line"><span class="t-name" style="color:#3cdca0">🎙️</span><span class="t-text">Débat lancé : ' + TOPIC + '</span></div>');
  assignVoices().then(() => run());
});
$('stopBtn').addEventListener('click', stop);

/* construction initiale des cartes */
buildCards();