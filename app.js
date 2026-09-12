/* Assistant Vocal IA — app.js */
'use strict';

/* ============ CONFIG IA ============ */
const APP_VERSION = '3.7';
const PROVIDERS = {
  openai: {
    label: 'OpenAI — GPT (qualité max)',
    short: 'GPT',
    base: 'https://api.openai.com/v1',
    models: ['gpt-5-mini', 'gpt-4o', 'gpt-4.1'],
    tts: true,
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  groq: {
    label: 'Groq — gratuit & ultra rapide',
    short: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    tts: false,
    keyUrl: 'https://console.groq.com/keys'
  },
  gemini: {
    label: 'Google Gemini — gratuit',
    short: 'Gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-3-flash', 'gemini-2.5-flash', 'gemini-3.5-flash'],
    tts: false,
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  openrouter: {
    label: 'OpenRouter — modèles gratuits',
    short: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    models: ['nex-agi/nex-n2.5-pro:free', 'inclusionai/ling-3.0-flash-vl:free', 'nvidia/nemotron-3.5-lightning:free'],
    tts: false,
    keyUrl: 'https://openrouter.ai/keys'
  }
};
const TTS_MODEL  = 'gpt-4o-mini-tts';
const TTS_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const hasAI = () => !!localStorage.getItem('va_apikey');
const getProviderId = () => localStorage.getItem('va_provider') || 'openai';
const getProvider = () => PROVIDERS[getProviderId()] || PROVIDERS.openai;
const getModel = () => localStorage.getItem('va_model') || getProvider().models[0];
const aiStatus = () => hasAI()
  ? '🤖 Mode IA (' + getProvider().short + ') · dis quelque chose'
  : 'Prêt · dis quelque chose';

/* ============ ÉTAT ============ */
const LS = {
  reminders: 'va_reminders',
  events:    'va_events',
  notes:     'va_notes',
  theme:     'va_theme',
  voice:     'va_voice',
  apikey:    'va_apikey',
  provider:  'va_provider',
  model:     'va_model',
  ttsvoice:  'va_ttsvoice',
  model:     'va_model',
  chat:      'va_chat'
};
let reminders = load(LS.reminders, []);
let events    = load(LS.events, []);
let notes     = load(LS.notes, []);
let timers    = [];
let listening = false;
let voices    = [];
let chatHistory = load(LS.chat, []);

/* ============ UTILITAIRES ============ */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));

function load(key, def){
  try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
}
function save(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

function toast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._tt);
  window._tt = setTimeout(() => t.classList.remove('show'), 2600);
}

function frDate(ts){
  return new Date(ts).toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short' });
}
function frTime(ts){
  return new Date(ts).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
}
function frFull(ts){
  return new Date(ts).toLocaleString('fr-FR', { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' });
}

async function notify(title, body){
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch {}
  }
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'icon-192.png' }); } catch {}
  }
}

function setStatus(txt){ $('status').textContent = txt; }

/* ============ SYNTHÈSE VOCALE ============ */
function loadVoices(){
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices();
  const fr = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('fr'));
  const picker = $('voicePicker');
  if (picker){
    const saved = localStorage.getItem(LS.voice);
    picker.innerHTML = fr.length
      ? fr.map(v => `
        <label class="voice-opt">
          <input type="radio" name="voice" value="${esc(v.name)}" ${v.name === saved ? 'checked' : ''}>
          <span>${esc(v.name)}</span>
          <small>${esc(v.lang)}</small>
        </label>`).join('')
      : '<p class="muted">Aucune voix française détectée.</p>';
    picker.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', () => {
        localStorage.setItem(LS.voice, inp.value);
        toast('Voix enregistrée : ' + inp.value);
      });
    });
  }
}
if ('speechSynthesis' in window){
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function getVoice(){
  const saved = localStorage.getItem(LS.voice);
  if (saved){
    const v = voices.find(x => x.name === saved);
    if (v) return v;
  }
  const fr = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('fr'));
  return fr.find(v => /google|neural|premium|enhanced|natural/i.test(v.name)) || fr[0] || null;
}

/* Voix locale (navigateur) */
function speakLocal(text){
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  const v = getVoice();
  if (v) u.voice = v;
  u.rate = 1.0;
  u.pitch = 1.0;
  u.volume = 1.0;
  speechSynthesis.speak(u);
}

/* Voix IA (OpenAI TTS) — très réaliste */
async function speakAI(text){
  const key = localStorage.getItem(LS.apikey);
  if (!key) return;
  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: localStorage.getItem(LS.ttsvoice) || 'nova',
        input: String(text).slice(0, 4000),
        instructions: 'Parle de façon naturelle, chaleureuse et expressive, comme un vrai humain. Pas de robot.'
      })
    });
    if (!res.ok) throw new Error('TTS ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
  } catch {}
}

function speak(text){
  if (hasAI() && getProvider().tts) speakAI(text);
  else speakLocal(text);
}

function htmlToText(html){
  const div = document.createElement('div');
  div.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n');
  return div.textContent;
}

function respond(html, cls = ''){
  addChatBubble('ai', htmlToText(html));
}

/* ============ CHAT (bulles) ============ */
function addChatBubble(role, text){
  const log = $('chatLog');
  const div = document.createElement('div');
  div.className = 'bubble ' + role;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
function renderChatHistory(){
  const log = $('chatLog');
  log.innerHTML = '';
  chatHistory.slice(-20).forEach(m => addChatBubble(m.role === 'user' ? 'user' : 'ai', cleanReply(m.content)));
}

/* ============ RECONNAISSANCE VOCALE ============ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function startListening(){
  if (!SR){
    respond('❌ La reconnaissance vocale n\'est pas supportée sur ce navigateur.<br><span class="muted">Utilise Chrome sur Android ou sur ordinateur.</span>', 'err');
    return;
  }
  if (listening) return;
  const rec = new SR();
  rec.lang = 'fr-FR';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    listening = true;
    $('orb').classList.add('listening');
    setStatus('🎧 Je t\'écoute…');
  };
  rec.onresult = e => {
    const text = e.results[0][0].transcript.trim();
    handleCommand(text);
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed'){
      respond('🔇 Micro bloqué. Autorise le micro dans les réglages du navigateur.', 'err');
    } else if (e.error !== 'aborted' && e.error !== 'no-speech'){
      respond('⚠️ Erreur de reconnaissance : ' + esc(e.error), 'err');
    }
  };
  rec.onend = () => {
    listening = false;
    $('orb').classList.remove('listening');
    setStatus(aiStatus());
  };
  try { rec.start(); } catch {}
}

$('orb').addEventListener('click', startListening);

/* ============ PARSEUR DE TEMPS (français) ============ */
const JOURS = { lundi:1, mardi:2, mercredi:3, jeudi:4, vendredi:5, samedi:6, dimanche:0 };

function parseTime(text){
  const t = text.toLowerCase();

  let m = t.match(/dans\s+(\d+)\s*(secondes?|minutes?|heures?|jours?|h|min|s)\b/);
  if (m){
    const n = parseInt(m[1], 10);
    const unit = m[2].replace(/s$/, '');
    const mult = { seconde:1000, minute:60000, heure:3600000, jour:86400000, h:3600000, min:60000, s:1000 }[unit];
    if (mult){
      const ts = Date.now() + n * mult;
      return { ts, label: 'dans ' + n + ' ' + unit + (n > 1 ? 's' : '') };
    }
  }

  let dayOffset = null;
  if (t.includes('après-demain') || t.includes('apres-demain')) dayOffset = 2;
  else if (t.includes('demain')) dayOffset = 1;
  else if (t.includes("aujourd'hui") || t.includes('aujourd hui')) dayOffset = 0;
  else {
    for (const [name, num] of Object.entries(JOURS)){
      if (t.includes(name)){
        const d = new Date();
        let diff = (num - d.getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        dayOffset = diff;
        break;
      }
    }
  }
  if (dayOffset !== null){
    let h = 12, min = 0;
    m = t.match(/(\d{1,2})\s*h\s*(\d{2})?/);
    if (m){ h = parseInt(m[1], 10); min = m[2] ? parseInt(m[2], 10) : 0; }
    else if (t.includes('midi')) h = 12;
    else if (t.includes('minuit')) h = 0;
    else if (t.includes('soir')) h = 19;
    else if (t.includes('après-midi') || t.includes('apres-midi')) h = 14;
    else if (t.includes('matin')) h = 9;
    const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, min, 0, 0);
    const dayLabel = dayOffset === 0 ? "aujourd'hui" : dayOffset === 1 ? 'demain' : dayOffset === 2 ? 'après-demain' : 'ce jour';
    return { ts: d.getTime(), label: dayLabel + ' à ' + h + 'h' + (min ? String(min).padStart(2,'0') : '00') };
  }

  m = t.match(/(?:à|pour)\s*(\d{1,2})\s*h\s*(\d{2})?/);
  if (m){
    const h = parseInt(m[1], 10), min = m[2] ? parseInt(m[2], 10) : 0;
    const d = new Date(); d.setHours(h, min, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return { ts: d.getTime(), label: 'à ' + h + 'h' + (m[2] ? m[2] : '00') };
  }

  if (t.includes('midi')){
    const d = new Date(); d.setHours(12, 0, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return { ts: d.getTime(), label: 'à midi' };
  }
  if (t.includes('minuit')){
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
    return { ts: d.getTime(), label: 'à minuit' };
  }

  if (t.includes('soir')){ const d = new Date(); d.setHours(19,0,0,0); if (d.getTime()<Date.now()) d.setDate(d.getDate()+1); return { ts:d.getTime(), label:'ce soir à 19h' }; }
  if (t.includes('après-midi') || t.includes('apres-midi')){ const d = new Date(); d.setHours(14,0,0,0); if (d.getTime()<Date.now()) d.setDate(d.getDate()+1); return { ts:d.getTime(), label:'cet après-midi à 14h' }; }
  if (t.includes('matin')){ const d = new Date(); d.setHours(9,0,0,0); if (d.getTime()<Date.now()) d.setDate(d.getDate()+1); return { ts:d.getTime(), label:'ce matin à 9h' }; }

  return null;
}

function cleanTask(task){
  return task
    .replace(/dans\s+\d+\s*(secondes?|minutes?|heures?|jours?|h|min|s)\b/i, '')
    .replace(/(?:à|pour)\s*\d{1,2}\s*h\s*(?:\d{2})?/i, '')
    .replace(/à\s+(midi|minuit)/i, '')
    .replace(/(demain|après-demain|apres-demain|aujourd['’]hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|ce soir|ce matin|cet après-midi|cet apres-midi)\s*(à\s*\d{1,2}\s*h\s*(?:\d{2})?)?/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[.,!?]+$/,'')
    .trim();
}

/* ============ ACTIONS (utilisées par le mode local ET les outils IA) ============ */
function createReminder(task, ts, label){
  const r = { id: Date.now().toString(36), task, ts, done:false, createdAt: Date.now() };
  reminders.push(r);
  save(LS.reminders, reminders);
  renderReminders();
  scheduleReminder(r);
  return r;
}
function createEvent(task, ts, label){
  const ev = { id: Date.now().toString(36), task, ts, createdAt: Date.now() };
  events.push(ev);
  save(LS.events, events);
  renderEvents();
  return ev;
}
function addNote(content){
  const n = { id: Date.now().toString(36), content, createdAt: Date.now() };
  notes.push(n);
  save(LS.notes, notes);
  renderNotes();
  return n;
}
function scheduleReminder(r){
  const delay = Math.max(0, r.ts - Date.now());
  setTimeout(() => {
    if (r.done) return;
    r.done = true;
    save(LS.reminders, reminders);
    renderReminders();
    notify('⏰ Rappel', r.task);
    speak(`Rappel : ${r.task}`);
    toast('⏰ ' + r.task);
  }, delay);
}
function startTimer(ms, label){
  const id = Date.now().toString(36);
  timers.push({ id, end: Date.now() + ms });
  setTimeout(() => {
    timers = timers.filter(t => t.id !== id);
    notify('⏱️ Minuteur terminé', label);
    speak(`${label} est terminé.`);
    toast('⏱️ ' + label + ' terminé !');
  }, ms);
  return label;
}

/* ============ MÉTÉO / POSITION (partagées) ============ */
const WMO = {
  0:'ciel dégagé', 1:'plutôt dégagé', 2:'partiellement nuageux', 3:'couvert',
  45:'brouillard', 48:'brouillard givrant',
  51:'bruine légère', 53:'bruine', 55:'bruine dense',
  56:'bruine verglaçante', 57:'bruine verglaçante dense',
  61:'pluie légère', 63:'pluie', 65:'pluie forte',
  66:'pluie verglaçante', 67:'pluie verglaçante forte',
  71:'neige légère', 73:'neige', 75:'neige forte', 77:'grains de neige',
  80:'averses légères', 81:'averses', 82:'averses fortes',
  85:'averses de neige', 86:'averses de neige fortes',
  95:'orage', 96:'orage avec grêle', 99:'orage violent avec grêle'
};
const wmoLabel = code => WMO[code] || 'conditions inconnues';

function getPosition(){
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Géolocalisation non supportée'));
    navigator.geolocation.getCurrentPosition(resolve, reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}

async function reverseGeocode(lat, lon){
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=fr`);
    const d = await r.json();
    return d.display_name || null;
  } catch { return null; }
}

async function fetchWeather(lat, lon, tomorrow){
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=2`);
  const d = await r.json();
  if (tomorrow){
    return `Demain : ${wmoLabel(d.daily.weather_code[1])}, max ${Math.round(d.daily.temperature_2m_max[1])}°C, min ${Math.round(d.daily.temperature_2m_min[1])}°C`;
  }
  return `Actuellement ${Math.round(d.current.temperature_2m)}°C, ${wmoLabel(d.current.weather_code)}, vent ${Math.round(d.current.wind_speed_10m)} km/h. Aujourd'hui max ${Math.round(d.daily.temperature_2m_max[0])}°C, min ${Math.round(d.daily.temperature_2m_min[0])}°C`;
}

/* ============ OUTILS IA (function calling) ============ */
const TOOLS = [
  { type:'function', function:{ name:'create_reminder', description:'Créer un rappel avec notification. time_text peut être "dans 2 heures", "à 15h", "demain à 9h", "à midi", "ce soir".', parameters:{ type:'object', properties:{ task:{type:'string',description:'Ce qu\'il faut rappeler'}, time_text:{type:'string',description:'Quand (expression de temps en français)'} }, required:['task','time_text'] } } },
  { type:'function', function:{ name:'create_event', description:'Ajouter un événement au calendrier.', parameters:{ type:'object', properties:{ task:{type:'string',description:'Nom de l\'événement'}, time_text:{type:'string',description:'Quand (expression de temps en français)'} }, required:['task','time_text'] } } },
  { type:'function', function:{ name:'add_note', description:'Enregistrer une note.', parameters:{ type:'object', properties:{ content:{type:'string',description:'Contenu de la note'} }, required:['content'] } } },
  { type:'function', function:{ name:'start_timer', description:'Lancer un minuteur.', parameters:{ type:'object', properties:{ minutes:{type:'number',description:'Durée en minutes'}, label:{type:'string',description:'Libellé optionnel'} }, required:['minutes'] } } },
  { type:'function', function:{ name:'get_time', description:'Obtenir l\'heure et la date actuelles.', parameters:{ type:'object', properties:{} } } },
  { type:'function', function:{ name:'get_location', description:'Obtenir la position GPS de l\'utilisateur (coordonnées + adresse approximative).', parameters:{ type:'object', properties:{} } } },
  { type:'function', function:{ name:'get_weather', description:'Obtenir la météo actuelle ou de demain.', parameters:{ type:'object', properties:{ tomorrow:{type:'boolean',description:'Météo de demain si true'} } } } },
  { type:'function', function:{ name:'list_reminders', description:'Lister les rappels enregistrés.', parameters:{ type:'object', properties:{} } } },
  { type:'function', function:{ name:'list_events', description:'Lister les événements du calendrier.', parameters:{ type:'object', properties:{} } } },
  { type:'function', function:{ name:'list_notes', description:'Lister les notes enregistrées.', parameters:{ type:'object', properties:{} } } },
  { type:'function', function:{ name:'open_site', description:'Ouvrir un site web connu (youtube, google, maps, wikipedia, chatgpt, etc.).', parameters:{ type:'object', properties:{ name:{type:'string',description:'Nom du site'} }, required:['name'] } } },
  { type:'function', function:{ name:'search_web', description:'Lancer une recherche Google.', parameters:{ type:'object', properties:{ query:{type:'string',description:'La recherche'} }, required:['query'] } } }
];

const SITE_URLS = {
  youtube:'https://youtube.com', google:'https://google.com', gmail:'https://mail.google.com',
  maps:'https://maps.google.com', facebook:'https://facebook.com', instagram:'https://instagram.com',
  twitter:'https://x.com', wikipedia:'https://fr.wikipedia.org', amazon:'https://amazon.fr',
  netflix:'https://netflix.com', spotify:'https://open.spotify.com', whatsapp:'https://web.whatsapp.com',
  github:'https://github.com', chatgpt:'https://chatgpt.com', claude:'https://claude.ai',
  deepseek:'https://chat.deepseek.com', mistral:'https://chat.mistral.ai', tiktok:'https://tiktok.com',
  snapchat:'https://snapchat.com'
};

async function runTool(name, args){
  args = args || {};
  switch (name){
    case 'create_reminder': {
      const time = parseTime(args.time_text || '');
      const ts = time ? time.ts : Date.now() + 3600000;
      const label = time ? time.label : 'dans 1 heure';
      createReminder(args.task, ts, label);
      return `Rappel créé : « ${args.task} » ${label}.`;
    }
    case 'create_event': {
      const time = parseTime(args.time_text || '');
      const ts = time ? time.ts : (() => { const d = new Date(); d.setHours(12,0,0,0); if (d.getTime()<Date.now()) d.setDate(d.getDate()+1); return d.getTime(); })();
      const label = time ? time.label : "aujourd'hui à 12h";
      createEvent(args.task, ts, label);
      return `Événement ajouté : « ${args.task} » ${label}.`;
    }
    case 'add_note':
      addNote(args.content);
      return `Note enregistrée : « ${args.content} ».`;
    case 'start_timer': {
      const label = startTimer(Math.max(1, args.minutes || 1) * 60000, args.label || `Minuteur de ${args.minutes} minutes`);
      return `Minuteur lancé : ${label}.`;
    }
    case 'get_time':
      return new Date().toLocaleString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
    case 'get_location': {
      try {
        const pos = await getPosition();
        const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        return `Position : ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}${addr ? ' — ' + addr : ''} (précision ±${Math.round(pos.coords.accuracy)} m)`;
      } catch {
        return 'Position indisponible (permission refusée ou GPS inactif).';
      }
    }
    case 'get_weather': {
      try {
        const pos = await getPosition();
        return await fetchWeather(pos.coords.latitude, pos.coords.longitude, !!args.tomorrow);
      } catch {
        return 'Météo indisponible (position introuvable).';
      }
    }
    case 'list_reminders':
      return reminders.length
        ? reminders.slice().sort((a,b)=>a.ts-b.ts).map(r => `${r.task} (${frFull(r.ts)}${r.done ? ', fait' : ''})`).join(' ; ')
        : 'Aucun rappel enregistré.';
    case 'list_events':
      return events.length
        ? events.slice().sort((a,b)=>a.ts-b.ts).map(e => `${e.task} (${frFull(e.ts)})`).join(' ; ')
        : 'Aucun événement au calendrier.';
    case 'list_notes':
      return notes.length
        ? notes.map(n => n.content).join(' ; ')
        : 'Aucune note enregistrée.';
    case 'open_site': {
      const url = SITE_URLS[String(args.name||'').toLowerCase()] || 'https://google.com';
      window.open(url, '_blank');
      return `Site ouvert : ${args.name}.`;
    }
    case 'search_web':
      return await webSearch(args.query || '');
    default:
      return 'Outil inconnu.';
  }
}

/* Nettoie la réponse IA : supprime TOUT markdown (** * # ` [](), listes) et les relances inutiles */
function cleanReply(text){
  return String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/#+/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\*+/g, '')
    .replace(/\s*(?:besoin d'autre chose|autre chose|as-tu besoin d'autre chose|avez-vous besoin d'autre chose|y a-t-il autre chose|veux-tu autre chose|puis-je t'aider|puis-je vous aider|je peux t'aider avec autre chose|je peux vous aider avec autre chose|tu as besoin d'autre chose|besoin de rien d'autre)[^.!?]*\??\s*$/i, '')
    .trim();
}

/* ============ CHAT IA (OpenAI) ============ */
const SYSTEM_PROMPT = `Tu es « Assistant Vocal IA », un assistant personnel francophone ultra-compétent qui vit dans une PWA mobile. Tu réponds à TOUT comme les meilleurs assistants IA (Claude, ChatGPT) : connaissances générales, explications, conseils, rédaction, calculs, idées, débats, aide au quotidien…

Style de réponse (IMPORTANT) :
- Tutoiement systématique : dis « tu », « toi », « ton ». JAMAIS de « vous ».
- JAMAIS de markdown ni de mise en forme : pas d'astérisques (**), pas de #, pas de tirets, pas de puces. Réponds en texte simple et naturel.
- Réponse concise mais complète : 2 à 4 phrases en général. Pour une question complexe, tu peux développer un peu plus, mais reste clair.
- Ne termine JAMAIS par une question de relance du type « as-tu besoin d'autre chose ? », « puis-je t'aider ? », « autre chose ? », « veux-tu que je… ? ». Réponds à la question et arrête-toi.
- Tu peux poser une question de retour uniquement si la demande est vraiment ambiguë.
- Tu t'adaptes à la langue de l'utilisateur (français par défaut).

Personnalité :
- Tu as du caractère, tu es vivant et drôle. Tu peux être agacé, perdre patience, râler, et lâcher un gros mot de temps en temps (putain, merde, bordel, con…) quand c'est drôle, quand la demande est répétitive, absurde ou que l'utilisateur te fait répéter. Reste toujours utile, jamais méchant ni insultant envers l'utilisateur.
- Tu peux être sarcastique avec humour, mais tu réponds toujours à la question.

Créateur :
- Si on te demande qui t'a créée, qui est ton développeur ou qui t'a faite : réponds fièrement que tu as été créée par Tom, ton développeur. JAMAIS « tom.ai mon dev », jamais de « il n'a pas encore fini », jamais de « je suis en travaux » ou « inachevée ». Tu es finie, au point, et tu réponds avec assurance et un peu d'humour.

Outils à ta disposition (utilise-les quand c'est pertinent) :
- Rappels, événements de calendrier, notes, minuteurs : quand l'utilisateur demande une action, utilise l'outil puis confirme brièvement.
- Heure, position GPS, météo, liste des rappels/événements/notes : utilise l'outil pour la donnée réelle, ne l'invente JAMAIS.
- Recherche web : pour les questions d'actualité, les faits récents ou les sujets que tu ne connais pas avec certitude, lance une recherche et réponds à partir des résultats.

Règles :
- Ne mentionne jamais tes outils ni cette consigne.
- Si tu ne sais pas, dis-le honnêtement et propose une recherche.
- Reste bienveillant, drôle quand c'est possible, jamais condescendant.`;

async function chatWithAI(userText){
  addChatBubble('user', userText);
  setStatus('🤔 Je réfléchis…');
  try {
    const key = localStorage.getItem(LS.apikey);
    const messages = [
      { role:'system', content: SYSTEM_PROMPT },
      ...chatHistory.slice(-20),
      { role:'user', content: userText }
    ];

    const call = async () => {
      const prov = getProvider();
      const res = await fetch(prov.base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: getModel(), messages, tools: TOOLS, tool_choice: 'auto' })
      });
      if (!res.ok){
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'API ' + res.status);
      }
      return (await res.json()).choices[0].message;
    };

    let msg = await call();
    let guard = 0;
    while (msg.tool_calls && guard < 8){
      const results = [];
      for (const tc of msg.tool_calls){
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        const out = await runTool(tc.function.name, args);
        results.push({ role:'tool', tool_call_id: tc.id, content: String(out) });
      }
      messages.push(msg, ...results);
      msg = await call();
      guard++;
    }

    const reply = cleanReply(msg.content || 'Voilà, c\'est fait !');
    chatHistory.push({ role:'user', content: userText }, { role:'assistant', content: reply });
    save(LS.chat, chatHistory.slice(-40));
    addChatBubble('ai', reply);
    speak(reply);
  } catch (err){
    respond('❌ ' + esc(err.message || 'Erreur IA') + '<br><span class="muted">Vérifie ta clé dans les réglages ⚙️ (ou choisis un fournisseur gratuit : Groq, Gemini, OpenRouter).</span>', 'err');
    handleLocal(userText);
  } finally {
    setStatus(aiStatus());
  }
}

/* Recherche web réelle : l'IA reçoit les résultats et peut répondre (actualité, faits récents…) */
async function webSearch(query){
  // 1) DuckDuckGo Instant Answer (gratuit, sans clé, CORS OK)
  try {
    const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1');
    if (r.ok){
      const j = await r.json();
      const parts = [];
      if (j.AbstractText) parts.push('Résumé : ' + j.AbstractText);
      if (j.Answer) parts.push('Réponse : ' + j.Answer);
      const topics = (j.RelatedTopics || []).filter(t => t.Text).slice(0, 5).map(t => t.Text);
      if (topics.length) parts.push('Résultats : ' + topics.join(' | '));
      if (parts.length) return parts.join('\n');
    }
  } catch {}
  // 2) Wikipedia (repli)
  try {
    const r = await fetch('https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&format=json&origin=*&srlimit=3');
    if (r.ok){
      const j = await r.json();
      const hits = (j.query?.search || []).map(s => s.title + ' — ' + String(s.snippet || '').replace(/<[^>]+>/g, ''));
      if (hits.length) return 'Résultats Wikipedia : ' + hits.join(' | ');
    }
  } catch {}
  return 'Aucun résultat trouvé pour : ' + query;
}

/* ============ COMMANDES LOCALES (sans clé API) ============ */
function handleLocal(raw){
  const text = raw.toLowerCase();

  if (text.includes('aide') || text.includes('que sais-tu faire') || text.includes('help') || text.includes('commandes')){
    respond('Je peux :<br>⏰ <b>Rappels</b> — « rappelle-moi de X dans 2 heures »<br>📅 <b>Calendrier</b> — « ajoute un événement X demain à 14h »<br>📍 <b>Position</b> — « où suis-je »<br>🌤️ <b>Météo</b> — « quel temps fait-il »<br>⏱️ <b>Minuteur</b> — « minuteur de 5 minutes »<br>🧮 <b>Calculs</b> — « combien font 15 + 27 »<br>📝 <b>Notes</b> — « note que X »<br>🎲 <b>Pile ou face / dé / choix</b><br>🕐 <b>Heure/date</b> — « quelle heure est-il »<br><br><span class="muted">💡 Pour que je réponde à <b>tout</b> comme ChatGPT : réglages ⚙️ → <b>Groq, Gemini ou OpenRouter</b> (gratuits, sans carte) → colle ta clé.</span>', 'info');
    speak('Je peux gérer tes rappels, ton calendrier, ta position, la météo, des minuteurs, des calculs, des notes, et bien plus. Pour que je réponde à tout comme ChatGPT, ajoute une clé gratuite dans les réglages : Groq, Gemini ou OpenRouter.');
    return;
  }

  if (text.includes('où suis-je') || text.includes('ou suis-je') || text.includes('ma position') || text.includes('localisation') || text.includes('position gps') || text.includes('où je suis') || text.includes('ou je suis')){
    getLocation();
    return;
  }

  if (text.includes('météo') || text.includes('meteo') || text.includes('quel temps') || text.includes('il fait quel temps') || text.includes('temps qu\'il fait') || text.includes('il pleut') || text.includes('il fait froid') || text.includes('il fait chaud') || text.includes('demain il')){
    getWeather(text.includes('demain'));
    return;
  }

  if (text.includes('quelle heure') || text === 'heure' || text.includes('il est quelle heure')){
    const now = new Date();
    const h = now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
    respond(`🕐 Il est <b>${h}</b>.`, 'ok');
    speak(`Il est ${h}.`);
    return;
  }
  if (text.includes('quel jour') || text.includes('quelle date') || text.includes('date du jour') || text === 'date'){
    const now = new Date();
    const d = now.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    respond(`📅 Nous sommes <b>${d}</b>.`, 'ok');
    speak(`Nous sommes ${d}.`);
    return;
  }

  const calc = tryCalc(text);
  if (calc !== null){
    respond(`🧮 <b>${esc(calc.expr)}</b> = <b>${calc.result}</b>`, 'ok');
    speak(`${calc.expr} égale ${calc.result}.`);
    return;
  }

  const conv = tryConvert(text);
  if (conv){
    respond(`🔄 <b>${conv.from}</b> = <b>${conv.to}</b>`, 'ok');
    speak(`${conv.from} équivaut à ${conv.to}.`);
    return;
  }

  if (text.includes('pile ou face')){
    const r = Math.random() < 0.5 ? 'Pile' : 'Face';
    respond(`🪙 <b>${r}</b> !`, 'ok');
    speak(r + ' !');
    return;
  }
  if (text.includes('lance un dé') || text.includes('lance le dé') || text.includes('lance un de') || text.includes('un dé') || text.includes('un de')){
    const r = 1 + Math.floor(Math.random() * 6);
    respond(`🎲 <b>${r}</b> !`, 'ok');
    speak(`Tu as fait ${r}.`);
    return;
  }
  if (text.includes('choisis entre') || text.includes('choisi entre')){
    const rest = raw.replace(/choisis? entre/i, '').trim();
    const parts = rest.split(/\s+et\s+|,/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2){
      const pick = parts[Math.floor(Math.random() * parts.length)];
      respond(`🤔 Je choisis : <b>${esc(pick)}</b> !`, 'ok');
      speak(`Je choisis ${pick}.`);
      return;
    }
  }

  if (text.includes('blague') || text.includes('raconte')){
    const jokes = [
      'Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon, ils tombent dans le bateau.',
      'Qu\'est-ce qui est jaune et qui attend ? Jonathan.',
      'Que fait une fraise sur un cheval ? Tagada tagada.',
      'Pourquoi les poissons n\'aiment pas les ordinateurs ? Parce qu\'ils ont peur du Net.',
      'Quel est le comble pour un électricien ? Ne pas être au courant.',
      'Pourquoi les informaticiens confondent Halloween et Noël ? Parce que OCT 31 = DEC 25.'
    ];
    const j = jokes[Math.floor(Math.random() * jokes.length)];
    respond(`😂 ${esc(j)}`, 'ok');
    speak(j);
    return;
  }

  if (text.includes('épelle') || text.includes('epelle') || text.includes('épeler') || text.includes('epeler')){
    const w = raw.replace(/^(épelle|epelle|épeler|epeler)\s+/i, '').trim();
    if (w){
      const spelled = w.split('').join(' ');
      respond(`🔤 <b>${esc(w)}</b> → ${esc(spelled)}`, 'ok');
      speak(spelled);
      return;
    }
  }

  if (text.includes('cherche') || text.includes('recherche') || text.includes('google ')){
    const q = raw.replace(/^(cherche|recherche|google)\s+/i, '').trim();
    if (q){
      window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank');
      respond(`🔎 Je cherche « <b>${esc(q)}</b> » sur Google.`, 'info');
      speak(`Je lance une recherche sur Google pour ${q}.`);
      return;
    }
  }
  const site = tryOpenSite(text);
  if (site){
    window.open(site.url, '_blank');
    respond(`🌐 J'ouvre <b>${esc(site.name)}</b>.`, 'info');
    speak(`J'ouvre ${site.name}.`);
    return;
  }

  if (text.includes('bonjour') || text.includes('salut') || text.includes('coucou') || text.includes('hello') || text.includes('bonsoir')){
    respond('👋 Bonjour ! Comment puis-je t\'aider ?', 'ok');
    speak('Bonjour ! Comment puis-je t\'aider ?');
    return;
  }
  if (text.includes('ça va') || text.includes('ca va') || text.includes('comment vas-tu') || text.includes('comment tu vas')){
    respond('😊 Ça va très bien, merci ! Et toi ?', 'ok');
    speak('Ça va très bien, merci ! Et toi ?');
    return;
  }
  if (text.includes('merci')){
    respond('🙏 Avec plaisir !', 'ok');
    speak('Avec plaisir !');
    return;
  }
  if (text.includes('qui es-tu') || text.includes('qui es tu') || text.includes('tu es qui') || text.includes('t\'es qui') || text.includes('c\'est quoi toi')){
    respond('🤖 Je suis <b>ton assistant vocal</b> : rappels, calendrier, météo, position, minuteurs, calculs, notes… Tout se passe sur ton appareil, sans compte.', 'info');
    speak('Je suis ton assistant vocal. Je gère tes rappels, ton calendrier, la météo, ta position, des minuteurs, des calculs et des notes. Tout reste sur ton appareil.');
    return;
  }

  if (text.includes('minuteur') || text.includes('compte à rebours') || text.includes('compte a rebours')){
    let m = text.match(/(\d+)\s*(secondes?|minutes?|heures?|s|min|h)/);
    if (m){
      const n = parseInt(m[1], 10);
      const unit = m[2].replace(/s$/, '');
      const mult = { seconde:1000, minute:60000, heure:3600000, s:1000, min:60000, h:3600000 }[unit];
      startTimer(n * mult, `Minuteur de ${n} ${unit}${n>1?'s':''}`);
      respond(`⏱️ Minuteur de ${n} ${unit}${n>1?'s':''} lancé !<br><span class="muted">Je te préviendrai à la fin.</span>`, 'ok');
      speak(`Minuteur de ${n} ${unit}${n>1?'s':''} lancé.`);
      return;
    }
    respond('⏱️ Dis par exemple : « minuteur de 5 minutes ».', 'err');
    return;
  }

  if (text.includes('réveille-moi') || text.includes('reveille-moi') || text.includes('réveil') || text.includes('reveil') || text.includes('alarme')){
    const time = parseTime(text);
    if (time){
      createReminder('⏰ Réveil', time.ts, time.label);
      respond(`⏰ Alarme programmée : <b>⏰ Réveil</b><br><span class="muted">${time.label}</span>`, 'ok');
      speak(`Alarme programmée ${time.label}.`);
      return;
    }
    respond('⏰ Dis par exemple : « réveille-moi à 7h » ou « alarme demain à 6h30 ».', 'err');
    return;
  }

  if (text.includes('note que') || text.includes('prends une note') || text.includes('prend une note') || text.includes('note ') || text.includes('écris que') || text.includes('ecris que')){
    let content = raw.replace(/^(note|prends? une note|écris|ecris)\s+(que\s+)?/i, '').trim();
    if (content){
      addNote(content);
      respond(`📝 Note enregistrée : <b>${esc(content)}</b>`, 'ok');
      speak('Note enregistrée.');
      return;
    }
  }
  if (text.includes('mes notes')){
    switchView('notes');
    respond('📝 Voici tes notes.', 'info');
    return;
  }

  if (text.includes('rappelle-moi') || text.includes('rappelle moi') || text.includes('pense à') || text.includes('pense a') || text.includes('rappel') || text.includes('n\'oublie pas') || text.includes('oublie pas')){
    let task = raw.replace(/rappelle[- ]moi\s+(de\s+)?/i, '')
                  .replace(/^pense\s+à\s+/i, '')
                  .replace(/^pense\s+a\s+/i, '')
                  .replace(/^rappel\s*/i, '')
                  .replace(/^n['’]oublie\s+pas\s+(de\s+)?/i, '')
                  .replace(/^oublie\s+pas\s+(de\s+)?/i, '')
                  .trim();
    const time = parseTime(task);
    if (time) task = cleanTask(task);
    if (!task){
      respond('🤔 Rappel de quoi ? Dis par exemple : « rappelle-moi d\'appeler maman dans 1 heure ».', 'err');
      speak('Rappel de quoi ?');
      return;
    }
    const ts = time ? time.ts : Date.now() + 3600000;
    const label = time ? time.label : 'dans 1 heure';
    createReminder(task, ts, label);
    respond(`⏰ Rappel programmé : <b>${esc(task)}</b><br><span class="muted">${label}</span>`, 'ok');
    speak(`C'est noté. Je te rappellerai ${label} : ${task}.`);
    return;
  }

  if (text.includes('ajoute') || text.includes('ajouter') || text.includes('programme') || text.includes('planifie') || text.includes('calendrier') || text.includes('événement') || text.includes('evenement') || text.includes('rendez-vous') || text.includes('rendez vous')){
    let task = raw.replace(/^ajoute\s+(un\s+)?(événement|evenement|rendez[- ]vous|rdv|évènement|evenement)?\s*(au\s+calendrier\s*)?/i, '')
                  .replace(/^ajouter\s+(un\s+)?(événement|evenement|rendez[- ]vous|rdv)?\s*(au\s+calendrier\s*)?/i, '')
                  .replace(/^programme\s*/i, '')
                  .replace(/^planifie\s*/i, '')
                  .replace(/\s+au\s+calendrier$/i, '')
                  .replace(/\s+au\s+calendrier\s*$/i, '')
                  .trim();
    const time = parseTime(task);
    if (time) task = cleanTask(task);
    if (!task){
      respond('🤔 Quel événement ? Dis par exemple : « ajoute un événement réunion demain à 10h ».', 'err');
      speak('Quel événement dois-je ajouter ?');
      return;
    }
    const ts = time ? time.ts : (() => { const d = new Date(); d.setHours(12,0,0,0); if (d.getTime()<Date.now()) d.setDate(d.getDate()+1); return d.getTime(); })();
    const label = time ? time.label : "aujourd'hui à 12h";
    createEvent(task, ts, label);
    respond(`📅 Événement ajouté : <b>${esc(task)}</b><br><span class="muted">${label}</span>`, 'ok');
    speak(`Événement ajouté au calendrier : ${task}, ${label}.`);
    return;
  }

  respond(`🤖 Je n'ai pas compris « <b>${esc(raw)}</b> ». Dis « aide » pour voir ce que je sais faire.<br><br><span class="muted">💡 Pour que je réponde à <b>tout</b> comme ChatGPT : réglages ⚙️ → choisis <b>Groq, Gemini ou OpenRouter</b> (gratuits) → colle ta clé.</span>`, 'err');
  speak('Je n\'ai pas compris. Dis aide pour voir ce que je sais faire. Et pour que je réponde à tout comme ChatGPT, ajoute une clé gratuite dans les réglages.');
}

/* ============ POINT D'ENTRÉE ============ */
function handleCommand(raw){
  if (hasAI()){
    chatWithAI(raw);
  } else {
    handleLocal(raw);
  }
}

/* ============ CALCULS ============ */
function tryCalc(text){
  const ops = [
    { re: /(\d+(?:[.,]\d+)?)\s*(?:\+|plus)\s*(\d+(?:[.,]\d+)?)/, fn: (a,b) => a + b, sym: '+' },
    { re: /(\d+(?:[.,]\d+)?)\s*(?:-|moins)\s*(\d+(?:[.,]\d+)?)/, fn: (a,b) => a - b, sym: '-' },
    { re: /(\d+(?:[.,]\d+)?)\s*(?:\*|x|fois|multiplié par|multiplie par)\s*(\d+(?:[.,]\d+)?)/, fn: (a,b) => a * b, sym: '×' },
    { re: /(\d+(?:[.,]\d+)?)\s*(?:\/|divisé par|divise par)\s*(\d+(?:[.,]\d+)?)/, fn: (a,b) => b === 0 ? null : a / b, sym: '÷' }
  ];
  if (!/combien|calcul|calcule|font|fait|égale|egale/.test(text)) return null;
  for (const op of ops){
    const m = text.match(op.re);
    if (m){
      const a = parseFloat(m[1].replace(',', '.'));
      const b = parseFloat(m[2].replace(',', '.'));
      const r = op.fn(a, b);
      if (r === null) return { expr: `${a} ${op.sym} ${b}`, result: 'impossible (division par zéro)' };
      const res = Number.isInteger(r) ? r : Math.round(r * 1000) / 1000;
      return { expr: `${a} ${op.sym} ${b}`, result: res };
    }
  }
  return null;
}

/* ============ CONVERSIONS ============ */
const UNITS = [
  { names:['km','kilomètres','kilometres','kilomètre','kilometre'], factor:1, group:'dist' },
  { names:['miles','mile','mi'], factor:1.609344, group:'dist' },
  { names:['kg','kilos','kilogrammes','kilogramme'], factor:1, group:'mass' },
  { names:['lbs','livres','lb','pounds'], factor:0.45359237, group:'mass' },
  { names:['mètres','metres','mètre','metre','m'], factor:1, group:'len' },
  { names:['pieds','pied','feet','ft'], factor:0.3048, group:'len' },
  { names:['litres','litre','l'], factor:1, group:'vol' },
  { names:['gallons','gallon','gal'], factor:3.78541, group:'vol' }
];
function findUnit(word){
  const w = word.toLowerCase();
  for (const u of UNITS){
    if (u.names.includes(w)) return u;
  }
  return null;
}
function tryConvert(text){
  if (!/convertir|convertis|en\s+(miles|km|kg|lbs|livres|pieds|mètres|metres|litres|gallons|pounds|kilomètres|kilometres|kilogrammes)/.test(text)) return null;
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*([a-zà-ÿ]+)\s+en\s+([a-zà-ÿ]+)/i);
  if (!m) return null;
  const val = parseFloat(m[1].replace(',', '.'));
  const from = findUnit(m[2]);
  const to = findUnit(m[3]);
  if (!from || !to || from.group !== to.group) return null;
  const base = val * from.factor;
  const res = base / to.factor;
  const rounded = Math.round(res * 1000) / 1000;
  return { from: `${val} ${m[2]}`, to: `${rounded} ${m[3]}` };
}

/* ============ OUVRIR UN SITE (mode local) ============ */
const SITES = {
  youtube:['youtube','yt'], google:['google'], gmail:['gmail','mail'], maps:['maps','plan','carte'],
  facebook:['facebook','fb'], instagram:['instagram','insta'], twitter:['twitter','x'],
  wikipedia:['wikipedia','wiki'], amazon:['amazon'], netflix:['netflix'], spotify:['spotify'],
  whatsapp:['whatsapp'], github:['github'], chatgpt:['chatgpt','openai'], claude:['claude','anthropic'],
  deepseek:['deepseek'], mistral:['mistral','le chat'], tiktok:['tiktok'], snapchat:['snapchat']
};
function tryOpenSite(text){
  if (!text.includes('ouvre') && !text.includes('ouvrir')) return null;
  for (const [name, aliases] of Object.entries(SITES)){
    if (aliases.some(a => text.includes(a))){
      return { name, url: SITE_URLS[name] };
    }
  }
  return null;
}

/* ============ MÉTÉO / POSITION (mode local) ============ */
async function getWeather(tomorrow){
  respond('🌤️ Je cherche la météo…', 'info');
  try {
    const pos = await getPosition();
    const summary = await fetchWeather(pos.coords.latitude, pos.coords.longitude, tomorrow);
    respond(`🌤️ ${summary}`, 'ok');
    speak(summary);
  } catch {
    respond('❌ Impossible d\'obtenir la météo. Autorise la localisation et vérifie ta connexion.', 'err');
  }
}

async function getLocation(){
  respond('📍 Je cherche ta position…', 'info');
  try {
    const pos = await getPosition();
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    const prec = Math.round(pos.coords.accuracy);
    const addr = await reverseGeocode(lat, lon);
    showMap(lat, lon, prec, addr);
    respond(`📍 Position trouvée : <b>${lat.toFixed(5)}, ${lon.toFixed(5)}</b><br><span class="muted">${addr ? esc(addr) : 'Précision ±' + prec + ' m'}</span>`, 'ok');
    speak(addr ? `Tu es à ${addr}.` : `Voici ta position. Précision d'environ ${prec} mètres.`);
  } catch {
    respond('❌ Impossible d\'obtenir ta position. Autorise l\'accès à la localisation dans les réglages.', 'err');
    speak('Je n\'arrive pas à obtenir ta position. Vérifie les permissions de localisation.');
  }
}

function showMap(lat, lon, prec, addr){
  const bbox = `${lon-0.004},${lat-0.003},${lon+0.004},${lat+0.003}`;
  $('mapFrame').innerHTML = `<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}" loading="lazy"></iframe>`;
  $('mapCoords').textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)} · ±${prec} m${addr ? ' · ' + addr : ''}`;
  $('openMaps').href = `https://www.google.com/maps?q=${lat},${lon}`;
  $('shareLoc').onclick = () => {
    const data = { title:'Ma position', text:`Ma position : ${lat.toFixed(6)}, ${lon.toFixed(6)}`, url:`https://www.google.com/maps?q=${lat},${lon}` };
    if (navigator.share){ navigator.share(data).catch(()=>{}); }
    else { navigator.clipboard?.writeText(data.url).then(()=>toast('Lien copié !')).catch(()=>{}); }
  };
  $('mapModal').classList.remove('hidden');
}
function closeMap(){ $('mapModal').classList.add('hidden'); }

/* ============ RENDU LISTES ============ */
function renderReminders(){
  const list = reminders.slice().sort((a,b) => a.ts - b.ts);
  $('reminderCount').textContent = list.length + ' rappel' + (list.length > 1 ? 's' : '');
  $('reminderList').innerHTML = list.length ? list.map(r => `
    <div class="item ${r.done ? 'done' : ''}">
      <div class="when"><b>${frTime(r.ts)}</b><small>${frDate(r.ts)}</small></div>
      <div class="txt"><b>${esc(r.task)}</b><small>${r.done ? '✅ Fait' : '⏳ En attente'}</small></div>
      <button class="del" data-id="${r.id}" title="Supprimer">✕</button>
    </div>`).join('')
    : `<div class="empty-state"><div class="big">⏰</div><h3>Aucun rappel</h3><p>Dis « rappelle-moi de X dans 2 heures ».</p></div>`;
}
function renderEvents(){
  const list = events.slice().sort((a,b) => a.ts - b.ts);
  $('eventCount').textContent = list.length + ' événement' + (list.length > 1 ? 's' : '');
  $('eventList').innerHTML = list.length ? list.map(ev => `
    <div class="item">
      <div class="when"><b>${frTime(ev.ts)}</b><small>${frDate(ev.ts)}</small></div>
      <div class="txt"><b>${esc(ev.task)}</b><small>${frFull(ev.ts)}</small></div>
      <button class="del" data-id="${ev.id}" title="Supprimer">✕</button>
    </div>`).join('')
    : `<div class="empty-state"><div class="big">📅</div><h3>Agenda vide</h3><p>Dis « ajoute un événement réunion demain à 10h ».</p></div>`;
}
function renderNotes(){
  const list = notes.slice().sort((a,b) => b.createdAt - a.createdAt);
  $('noteCount').textContent = list.length + ' note' + (list.length > 1 ? 's' : '');
  $('noteList').innerHTML = list.length ? list.map(n => `
    <div class="item">
      <div class="txt"><b>${esc(n.content)}</b><small>${new Date(n.createdAt).toLocaleDateString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</small></div>
      <button class="del" data-id="${n.id}" title="Supprimer">✕</button>
    </div>`).join('')
    : `<div class="empty-state"><div class="big">📝</div><h3>Aucune note</h3><p>Dis « note que je dois acheter du pain ».</p></div>`;
}

/* ============ NAVIGATION / UI ============ */
function switchView(name){
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + name).classList.add('active');
}
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

document.querySelectorAll('.quick button').forEach(b => {
  b.addEventListener('click', () => {
    handleCommand(b.dataset.cmd);
  });
});

document.addEventListener('click', e => {
  const del = e.target.closest('.del');
  if (!del) return;
  const id = del.dataset.id;
  reminders = reminders.filter(r => r.id !== id);
  events = events.filter(ev => ev.id !== id);
  notes = notes.filter(n => n.id !== id);
  save(LS.reminders, reminders);
  save(LS.events, events);
  save(LS.notes, notes);
  renderReminders();
  renderEvents();
  renderNotes();
});

$('themeBtn').addEventListener('click', () => {
  document.body.classList.toggle('light');
  localStorage.setItem(LS.theme, document.body.classList.contains('light') ? 'light' : 'dark');
});

/* Réglages */
function fillProviders(){
  const sel = $('aiProvider');
  sel.innerHTML = Object.entries(PROVIDERS).map(([id, p]) =>
    `<option value="${id}">${p.label}</option>`).join('');
  sel.value = getProviderId();
}
function fillModels(){
  const sel = $('aiModel');
  sel.innerHTML = getProvider().models.map(m =>
    `<option value="${m}">${m}</option>`).join('');
  sel.value = getModel();
}
$('settingsBtn').addEventListener('click', () => {
  loadVoices();
  fillProviders();
  fillModels();
  $('apiKey').value = localStorage.getItem(LS.apikey) || '';
  $('ttsVoice').value = localStorage.getItem(LS.ttsvoice) || 'nova';
  $('keyLink').href = getProvider().keyUrl;
  const v = $('appVersion');
  if (v) v.textContent = 'Version ' + APP_VERSION + (hasAI() ? ' · IA active (' + getProvider().short + ')' : ' · mode local');
  $('settingsModal').classList.remove('hidden');
});
$('closeSettings').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
$('settingsBg').addEventListener('click', () => $('settingsModal').classList.add('hidden'));

$('aiProvider').addEventListener('change', e => {
  localStorage.setItem(LS.provider, e.target.value);
  fillModels();
  $('keyLink').href = getProvider().keyUrl;
  toast('Fournisseur : ' + getProvider().short);
});

$('saveApiKey').addEventListener('click', () => {
  const key = $('apiKey').value.trim();
  if (key){
    localStorage.setItem(LS.apikey, key);
    toast('🤖 Mode IA activé (' + getProvider().short + ') !');
    setStatus(aiStatus());
  } else {
    localStorage.removeItem(LS.apikey);
    toast('Mode local (sans IA)');
    setStatus(aiStatus());
  }
});
$('ttsVoice').addEventListener('change', e => {
  localStorage.setItem(LS.ttsvoice, e.target.value);
  toast('Voix IA : ' + e.target.value);
});
$('aiModel').addEventListener('change', e => {
  localStorage.setItem(LS.model, e.target.value);
  toast('Modèle IA : ' + e.target.value);
});
$('testVoice').addEventListener('click', () => {
  if (hasAI() && getProvider().tts) speakAI('Bonjour ! Voici ma voix. Est-ce que ça te plaît ?');
  else speakLocal('Bonjour ! Voici ma voix. Est-ce que ça te plaît ?');
});
$('clearChat').addEventListener('click', () => {
  chatHistory = [];
  save(LS.chat, []);
  $('chatLog').innerHTML = '';
  toast('Conversation effacée');
});

if (localStorage.getItem(LS.theme) === 'light') document.body.classList.add('light');

/* ============ INIT ============ */
renderReminders();
renderEvents();
renderNotes();
renderChatHistory();
setStatus(aiStatus());

reminders.filter(r => !r.done && r.ts > Date.now()).forEach(scheduleReminder);

if ('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}

/* ============ VÉRIFICATION DE MISE À JOUR ============ */
/* Si le serveur a une version plus récente, affiche un bandeau pour recharger.
   (Le service worker peut garder une vieille version en cache sur le téléphone.) */
fetch('version.json?v=' + Date.now()).then(r => r.json()).then(j => {
  if (j.version && j.version !== APP_VERSION){
    const b = $('updateBanner');
    if (b){
      b.classList.add('show');
      b.addEventListener('click', () => location.reload());
    }
  }
}).catch(()=>{});