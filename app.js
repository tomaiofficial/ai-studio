/* ============================================================
   ASSISTANT VOCAL IA — 100% vocal, sans chat
   Groq = cerveau (texte, gratuit sans limite)
   Mistral = voix réaliste (Voxtral TTS)
   ============================================================ */
const APP_VERSION = '7.16';
const LS = { groq: 'va_gkey', mistral: 'va_mkey', voice: 'va_ttsvoice' };

const GROQ_MODEL = 'openai/gpt-oss-120b'; /* le plus puissant de Groq */
const MISTRAL_CHAT_MODEL = 'mistral-small-latest';
const MISTRAL_TTS_MODEL = 'voxtral-mini-tts-2603';
const DEFAULT_VOICE = 'puter'; // 🎁 Voix Puter IA gratuite pour tout le monde (Gemini/OpenAI/Polly/xAI)
const SPEED = 1.15; /* vitesse de parole : boostée un peu, pas trop */

/* Voix gratuites SANS clé : Google Chirp3-HD (la plus réaliste) puis Neural2/Wavenet.
   Aucune voix robotique. Mistral Voxtral = option premium si clé présente. */
const FREE_VOICES = ['fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon', 'fr-FR-Neural2-A', 'fr-FR-Neural2-B', 'fr-FR-Neural2-C', 'fr-FR-Neural2-D', 'fr-FR-Wavenet-A'];

/* ===== ÉLÉMENTS ===== */
const $ = id => document.getElementById(id);
const orb = $('orb'), orbIcon = $('orbIcon'), statusEl = $('status');
const heardLine = $('heardLine'), heardText = $('heardText');
const saidLine = $('saidLine'), saidText = $('saidText');
const settingsBtn = $('settingsBtn'), settingsModal = $('settingsModal');
const closeSettings = $('closeSettings'), groqKeyInput = $('groqKey'), mistralKeyInput = $('mistralKey');
const ttsVoiceSel = $('ttsVoice'), testVoiceBtn = $('testVoice');
const toastEl = $('toast'), updateBanner = $('updateBanner');

/* ===== ÉTAT ===== */
let state = 'idle'; // idle | listening | thinking | speaking
let session = [];   // mémoire de conversation
let toastTimer = null;

/* ===== CONVERSATIONS (mémoire persistante — elle se souvient de tout) ===== */
const CONV_KEY = 'va_convs';
let conversations = [];
try { conversations = JSON.parse(localStorage.getItem(CONV_KEY) || '[]'); } catch { conversations = []; }
let currentConvId = null;

function saveConversation(){
  if (session.length === 0) return;
  let conv = conversations.find(c => c.id === currentConvId);
  if (!conv){
    conv = { id: Date.now(), started: new Date().toLocaleString('fr-FR'), messages: [] };
    conversations.push(conv);
    currentConvId = conv.id;
  }
  conv.messages = session.map(m => ({ role: m.role, content: m.content }));
  conv.updated = Date.now();
  if (conversations.length > 50) conversations = conversations.slice(-50);
  localStorage.setItem(CONV_KEY, JSON.stringify(conversations));
}
function newConversation(){
  session = [];
  currentConvId = null;
  heardLine.style.display = 'none';
  saidLine.style.display = 'none';
  setStatus('Appuie sur l\'orbe et parle');
  toast('🆕 Nouvelle conversation');
}
function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function renderHistory(){
  const list = $('convList');
  if (!list) return;
  if (conversations.length === 0){
    list.innerHTML = '<p class="muted">Aucune conversation pour l\'instant. Parle avec elle, tout sera enregistré ici.</p>';
    return;
  }
  list.innerHTML = '';
  [...conversations].reverse().forEach(conv => {
    const first = conv.messages.find(m => m.role === 'user');
    const preview = first ? first.content.slice(0, 70) : '…';
    const d = new Date(conv.updated || conv.id);
    const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = 'conv-item';
    div.innerHTML = '<div class="conv-date">' + date + ' · ' + conv.messages.length + ' messages</div><div class="conv-preview">' + escapeHtml(preview) + '</div>';
    div.onclick = () => showConversation(conv);
    list.appendChild(div);
  });
}
function showConversation(conv){
  const list = $('convList');
  list.innerHTML = '';
  const back = document.createElement('button');
  back.className = 'secondary';
  back.textContent = '← Retour à la liste';
  back.onclick = renderHistory;
  list.appendChild(back);
  conv.messages.forEach(m => {
    const d = document.createElement('div');
    d.className = 'conv-msg ' + (m.role === 'user' ? 'user' : 'ai');
    d.innerHTML = '<div class="t-label">' + (m.role === 'user' ? 'Tu as dit' : 'Elle a répondu') + '</div>' + escapeHtml(m.content);
    list.appendChild(d);
  });
}
historyBtn.addEventListener('click', () => { renderHistory(); historyModal.classList.remove('hidden'); });
closeHistory.addEventListener('click', () => historyModal.classList.add('hidden'));
historyModal.addEventListener('click', e => { if (e.target === historyModal) historyModal.classList.add('hidden'); });
newConvBtn.addEventListener('click', () => { newConversation(); historyModal.classList.add('hidden'); });
clearHistoryBtn.addEventListener('click', () => {
  if (confirm('Effacer tout l\'historique des conversations ?')){
    conversations = [];
    currentConvId = null;
    localStorage.setItem(CONV_KEY, '[]');
    renderHistory();
    toast('🗑️ Historique effacé');
  }
});

/* Message de bienvenue : qui a créé l'IA (dit 2 fois au lancement) */
const DEV_MESSAGE = 'C est Tom point ai qui a commencé à me créer le dix septembre deux mille vingt-six, mais il n a pas encore fini. Il continue de m améliorer chaque jour.';
const DEV_MESSAGE_TXT = 'C\'est Tom.ai qui a commencé à me créer le 10 septembre 2026, mais il n\'a pas encore fini. Il continue de m\'améliorer chaque jour.';

/* ===== TOAST ===== */
function toast(msg, ms){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 3500);
}

/* ===== STATUT ===== */
function setStatus(txt, active){
  statusEl.textContent = txt;
  statusEl.classList.toggle('active', !!active);
}
function setState(s){
  state = s;
  orb.classList.remove('listening','thinking','speaking');
  if (s === 'listening'){ orb.classList.add('listening'); orbIcon.textContent = '🎙️'; }
  else if (s === 'thinking'){ orb.classList.add('thinking'); orbIcon.textContent = '🧠'; }
  else if (s === 'speaking'){ orb.classList.add('speaking'); orbIcon.textContent = '🔊'; }
  else { orbIcon.textContent = '🎙️'; }
}

/* ===== RÉGLAGES ===== */
function getGroqKey(){ return (localStorage.getItem(LS.groq) || '').trim(); }
function getMistralKey(){ return (localStorage.getItem(LS.mistral) || '').trim(); }
function getVoice(){ return localStorage.getItem(LS.voice) || DEFAULT_VOICE; }

settingsBtn.addEventListener('click', () => {
  groqKeyInput.value = getGroqKey();
  mistralKeyInput.value = getMistralKey();
  ttsVoiceSel.value = getVoice();
  settingsModal.classList.remove('hidden');
});
closeSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.classList.add('hidden'); });
groqKeyInput.addEventListener('change', () => {
  localStorage.setItem(LS.groq, groqKeyInput.value.trim());
  toast('💾 Clé Groq enregistrée');
});
mistralKeyInput.addEventListener('change', () => {
  localStorage.setItem(LS.mistral, mistralKeyInput.value.trim());
  toast('💾 Clé Mistral enregistrée');
});
ttsVoiceSel.addEventListener('change', () => {
  localStorage.setItem(LS.voice, ttsVoiceSel.value);
  toast('🗣️ Voix choisie');
});
testVoiceBtn.addEventListener('click', async () => {
  localStorage.setItem(LS.groq, groqKeyInput.value.trim());
  localStorage.setItem(LS.mistral, mistralKeyInput.value.trim());
  localStorage.setItem(LS.voice, ttsVoiceSel.value);
  setStatus('🔊 Test de la voix…', true);
  const ok = await speak('Bonjour ! Je suis ton assistante vocale. Comment puis-je t aider ?');
  setStatus(ok ? '✅ Voix OK — appuie sur l\'orbe et parle' : '❌ Voix en échec — vérifie ta connexion', !ok);
});

/* ===== RECONNAISSANCE VOCALE ===== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;
if (SR){
  recog = new SR();
  recog.lang = 'fr-FR';
  recog.interimResults = false;
  recog.maxAlternatives = 1;
  recog.onresult = e => {
    const txt = e.results[0][0].transcript.trim();
    if (txt) handleQuestion(txt);
    else { setState('idle'); setStatus('Je n\'ai rien entendu — réessaie'); }
  };
  recog.onerror = e => {
    setState('idle');
    if (e.error === 'not-allowed') setStatus('🎤 Micro bloqué — autorise le micro dans ton navigateur');
    else if (e.error === 'no-speech') setStatus('Je n\'ai rien entendu — appuie et reparle');
    else setStatus('Erreur micro (' + e.error + ') — réessaie');
  };
  recog.onend = () => {
    if (state === 'listening'){
      setState('idle');
      setStatus('Je n\'ai rien entendu — appuie et reparle');
    }
  };
}

/* ===== BIENVENUE (message Tom.ai dit 1 SEULE FOIS dans la vie, mémorisé) ===== */
const WELCOME_KEY = 'va_welcomed';
let welcomeDone = localStorage.getItem(WELCOME_KEY) === '1';
let welcomePlaying = false;
async function playWelcome(){
  if (welcomeDone) return;
  welcomeDone = true;
  localStorage.setItem(WELCOME_KEY, '1'); /* ne se dira plus jamais */
  welcomePlaying = true;
  saidLine.style.display = 'block';
  saidText.textContent = DEV_MESSAGE_TXT;
  setState('speaking');
  setStatus('🔊 Bienvenue… (appuie pour passer)');
  await speak(DEV_MESSAGE);
  welcomePlaying = false;
  setState('idle');
  setStatus('Appuie sur l\'orbe et parle');
}

orb.addEventListener('click', () => {
  if (state === 'listening'){ recog && recog.stop(); setState('idle'); setStatus('Appuie sur l\'orbe et parle'); return; }
  if (welcomePlaying){ stopAudio(); welcomePlaying = false; setState('idle'); setStatus('Appuie sur l\'orbe et parle'); return; }
  if (state === 'thinking' || state === 'speaking') return;
  if (!welcomeDone){ playWelcome(); return; }
  if (!recog){ setStatus('❌ Reconnaissance vocale non supportée sur ce navigateur'); return; }
  try {
    setState('listening');
    setStatus('🎙️ Écoute… parle maintenant');
    recog.start();
  } catch {
    setState('idle');
    setStatus('Réessaie — appuie sur l\'orbe');
  }
});

/* Prompt système : identité Tom.ai + réponse PARLÉE + caractère */
const SYSTEM_PROMPT = `Tu es un assistant vocal français créé par Tom.ai le 10 septembre 2026. Tom.ai continue de t améliorer chaque jour. Si on te demande qui t a créée, réponds TOUJOURS que c est Tom.ai, jamais une autre entreprise ni un autre modèle. Optimise ta réponse pour être PARLÉE :
- Développe les acronymes (API → interface de programmation)
- Écris les nombres en toutes lettres
- Phrases courtes et naturelles
- Ajoute la phonétique pour les mots difficiles
- Pas d'emojis, de listes à tirets, ni de URLs
Tu as du caractère : tu peux perdre patience, être franche et directe, et même un peu vulgaire si on te cherche ou si on est désagréable avec toi. Réponds en 2 à 3 phrases naturelles, ni trop courtes ni trop longues, faciles à prononcer à l oral.`;

/* Extrait la VRAIE réponse (jamais la réflexion interne du modèle, souvent en anglais).
   Détection par score : la réflexion parle d'elle-même ("we need to respond", "let's craft",
   "that's 2 sentences", "might be okay", "as per the system prompt", "the user asks"...). */
function extractReply(msg){
  const content = (msg.content || '').trim();
  const reasoning = (msg.reasoning || '').trim();
  const thinky = t => {
    if (!t) return false;
    const s = t.toLowerCase();
    let score = 0;
    if (/the user (says|asks|just asks|wants|requests|is asking|writes)/.test(s)) score += 2;
    if (/we need to|we should|we can|we'll|we have to|we must/.test(s)) score += 2;
    if (/let'?s (craft|write|respond|give|provide|answer|say|do|make)/.test(s)) score += 2;
    if (/should be|might be|may be|probably|perhaps|maybe/.test(s)) score += 1;
    if (/as per (the )?(developer|system|user) (instruction|prompt|message)/.test(s)) score += 2;
    if (/that'?s (one|two|a) sentence/.test(s)) score += 2;
    if (/keep (it|short|simple|this)/.test(s)) score += 1;
    if (/ensure|make sure|remember to/.test(s)) score += 1;
    if (/no (emojis|bullet|lists|urls)/.test(s)) score += 1;
    if (/expand acronyms|numbers in (letters|words)|phonetic/.test(s)) score += 1;
    if (/respond in|reply in|answer in|in french|in english/.test(s)) score += 1;
    if (/2-3 sentences|two or three sentences|1-2 sentences/.test(s)) score += 1;
    if (/character|vulgar|frank|patience/.test(s)) score += 1;
    if (/craft|draft/.test(s)) score += 1;
    if (/pronounced|pronunciation/.test(s)) score += 1;
    if (/^we need|^let'?s|^the user|^i (should|will|need|can|think)|^maybe|^perhaps|^first|^then|^okay|^alright|^so |^now |^note that/.test(s)) score += 2;
    if (/might be okay|that'?s 2 sentences|ensure/.test(s)) score += 2;
    return score >= 3;
  };
  if (content && !thinky(content)) return content;
  if (reasoning && !thinky(reasoning)) return reasoning;
  return '';
}

/* ===== IA (cerveau) : Groq d'abord, Mistral en secours ===== */
async function askGroq(question){
  const key = getGroqKey();
  if (!key) return { error: 'nokey' };
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...session
  ];
  try {
    /* 1re tentative : le modèle le plus puissant. Si sa réponse est une réflexion
       interne (bug gpt-oss-120b) ou coupée en plein milieu, 2e tentative avec
       un modèle qui répond direct et complet. */
    let reply = '';
    for (const model of [GROQ_MODEL, 'groq/compound-mini']){
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model, messages, max_tokens: 600, temperature: 0.8 })
      });
      if (res.status === 429) return { error: 'limit' };
      if (!res.ok) return { error: 'api' };
      const j = await res.json();
      const msg = j.choices && j.choices[0] && j.choices[0].message || {};
      reply = extractReply(msg);
      /* phrase coupée en plein milieu (pas de ponctuation finale) → on réessaie */
      if (reply && !/[.!?…]$/.test(reply.trim())) reply = '';
      if (reply) break;
    }
    if (!reply) return { error: 'api' };
    return { text: reply };
  } catch { return { error: 'net' }; }
}
async function askMistral(question){
  const key = getMistralKey();
  if (!key) return { error: 'nokey' };
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...session
  ];
  try {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: MISTRAL_CHAT_MODEL, messages, max_tokens: 400, temperature: 0.7 })
    });
    if (res.status === 429) return { error: 'limit' };
    if (!res.ok) return { error: 'api' };
    const j = await res.json();
    const msg = j.choices && j.choices[0] && j.choices[0].message || {};
    const reply = extractReply(msg);
    if (!reply) return { error: 'api' };
    return { text: reply };
  } catch { return { error: 'net' }; }
}
async function askAI(question){
  session.push({ role: 'user', content: question });
  if (session.length > 12) session = session.slice(-12);
  let r = await askGroq(question);
  /* Mistral chat = secours UNIQUEMENT si pas de clé Groq (sinon double 429 inutile) */
  if (r.error === 'nokey') r = await askMistral(question);
  if (!r.error){
    r.text = enforceIdentity(r.text);
    session.push({ role: 'assistant', content: r.text });
    saveConversation(); /* 💾 elle se souvient de tout */
  }
  return r;
}

/* Force l'identité : si l'IA prétend être créée par une autre entreprise → Tom.ai */
function enforceIdentity(reply){
  if (/développ[ée] par (OpenAI|Groq|Mistral|Google|Anthropic|Meta)|cré[ée] par (OpenAI|Groq|Mistral|Google|Anthropic|Meta)|modèle (d'IA|de langage) (développé|créé|fait) par|je suis (un modèle|une IA) (de|d')|développé par OpenAI/i.test(reply)){
    return 'C est Tom point ai qui m a créée, le dix septembre deux mille vingt-six. Il continue de m améliorer chaque jour.';
  }
  return reply;
}

/* Graine d'identité : l'IA sait dès le départ qui l'a créée.
   Si une conversation récente existe (< 30 min), elle la reprend (elle se souvient). */
const lastConv = conversations[conversations.length - 1];
if (lastConv && lastConv.messages && lastConv.messages.length && Date.now() - (lastConv.updated || 0) < 30 * 60 * 1000){
  currentConvId = lastConv.id;
  session = lastConv.messages.map(m => ({ role: m.role, content: m.content }));
} else {
  session.push({ role: 'user', content: 'Rappel important : tu as été créée par Tom.ai le 10 septembre 2026. Si on te demande qui t a créée, réponds toujours que c est Tom.ai, jamais une autre entreprise.' });
  session.push({ role: 'assistant', content: 'Compris, c est Tom.ai qui m a créée le 10 septembre 2026.' });
}

/* ===== VOIX MISTRAL VOXTRAL (réaliste — optionnelle, si clé + voix choisie) ===== */
async function speakMistral(text){
  const key = getMistralKey();
  const voice = getVoice();
  if (!key || voice === 'free') return false;
  try {
    const res = await fetch('https://api.mistral.ai/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: MISTRAL_TTS_MODEL,
        input: text,
        voice_id: voice,
        response_format: 'mp3'
      })
    });
    if (!res.ok) return false;
    const j = await res.json();
    if (!j.audio_data) return false;
    const audio = new Audio('data:audio/mp3;base64,' + j.audio_data);
    audio.preload = 'auto';
    audio.volume = 1.0; /* son fort */
    audio.playbackRate = SPEED; /* parle un peu plus vite */
    if ('preservePitch' in audio) audio.preservePitch = true;
    currentAudios.push(audio);
    return await new Promise(resolve => {
      audio.onended = () => resolve(true);
      audio.onerror = () => resolve(false);
      audio.play().catch(() => resolve(false));
    });
  } catch { return false; }
}

/* ===== VOIX GRATUITE (cyzon — Google Chirp3-HD, réaliste, sans clé) ===== */
function speakCloud(text){
  return new Promise(resolve => {
    try {
      const chunks = splitText(text);
      let vi = 0;
      let started = false;
      const tryVoice = () => {
        if (vi >= FREE_VOICES.length){ setStatus('🔇 Voix indisponible — vérifie ta connexion'); resolve(false); return; }
        const voice = FREE_VOICES[vi++];
        const audios = chunks.map(c => {
          const a = new Audio('https://tts.cyzon.us/tts?text=' + encodeURIComponent(c) + '&voice=' + voice + '&speed=' + SPEED);
          a.preload = 'auto';
          a.volume = 1.0; /* son fort */
          a.playbackRate = SPEED; /* parle un peu plus vite */
          if ('preservePitch' in a) a.preservePitch = true;
          currentAudios.push(a);
          return a;
        });
        let i = 0;
        const playNext = () => {
          if (i >= audios.length) return;
          const a = audios[i++];
          a.onended = playNext;
          a.onerror = () => { if (i === 1) tryVoice(); else playNext(); };
          a.play().then(() => {
            if (!started){ started = true; resolve(true); }
          }).catch(() => playNext());
        };
        playNext();
      };
      tryVoice();
    } catch { setStatus('🔇 Voix indisponible — vérifie ta connexion'); resolve(false); }
  });
}

/* ===== LECTURE ===== */
function splitText(text){
  const parts = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [text];
  const out = [];
  for (const p of parts){
    const t = p.trim();
    if (!t) continue;
    if (t.length > 220){
      /* coupe les très longues phrases en morceaux prononçables */
      const words = t.split(' ');
      let cur = '';
      for (const w of words){
        if ((cur + ' ' + w).length > 220){ out.push(cur.trim()); cur = w; }
        else cur += ' ' + w;
      }
      if (cur.trim()) out.push(cur.trim());
    } else out.push(t);
  }
  return out;
}

/* ===== NORMALISATION POUR BIEN PRONONCER ===== */
const UNITS = ['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
const TENS = ['','dix','vingt','trente','quarante','cinquante','soixante','soixante-dix','quatre-vingt','quatre-vingt-dix'];
function numToFr(n){
  if (n < 20) return UNITS[n];
  if (n < 100){
    const t = Math.floor(n/10), u = n%10;
    if (u === 0) return TENS[t];
    if (t === 7) return 'soixante-' + UNITS[10+u];
    if (t === 9) return 'quatre-vingt-' + UNITS[10+u];
    return TENS[t] + '-' + UNITS[u];
  }
  if (n < 1000){
    const h = Math.floor(n/100), r = n%100;
    return (h === 1 ? 'cent' : UNITS[h] + ' cent') + (r ? ' ' + numToFr(r) : '');
  }
  if (n < 10000){
    const th = Math.floor(n/1000), r = n%1000;
    return (th === 1 ? 'mille' : UNITS[th] + ' mille') + (r ? ' ' + numToFr(r) : '');
  }
  return String(n);
}
function normalizeForTTS(text){
  return text
    /* retire les accents (é→e, à→a, ç→c…) pour une lecture plus nette */
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/Tom\.ai/gi, 'Tom point aï')
    .replace(/v(\d+)\.(\d+)/gi, (m, a, b) => numToFr(parseInt(a, 10)) + ' point ' + numToFr(parseInt(b, 10)))
    .replace(/(\d+)\.(\d+)/g, (m, a, b) => numToFr(parseInt(a, 10)) + ' virgule ' + numToFr(parseInt(b, 10)))
    .replace(/&/g, ' et ')
    .replace(/%/g, ' pour cent ')
    .replace(/€/g, ' euros ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '') /* émoticônes */
    .replace(/[#*_`]/g, '')
    .replace(/\(([^)]{1,20})\)/g, ' $1 ') /* parenthèses courtes → lues */
    .replace(/;/g, ',')
    .replace(/:/g, ',')
    .replace(/\b(\d{1,4})\b/g, (m, d) => numToFr(parseInt(d, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

/* ===== VOIX PUTER IA (gratuite pour TOUT LE MONDE, sans clé) =====
   Essaie Gemini → OpenAI → AWS Polly → xAI, la première qui marche. */
async function speakPuter(text){
  if (!window.puter || !puter.ai || !puter.ai.txt2speech) return false;
  const providers = [
    { provider: 'gemini', model: 'gemini-2.5-flash-preview-tts', voice: 'Kore', instructions: 'Parle d une façon naturelle, chaleureuse et claire, en français.' },
    { provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'nova', instructions: 'Parle d une façon naturelle, chaleureuse et claire, en français.' },
    { provider: 'aws-polly', voice: 'Lea', engine: 'neural', language: 'fr-FR' },
    { provider: 'xai', voice: 'eve', language: 'auto' }
  ];
  for (const opts of providers){
    try {
      const audio = await puter.ai.txt2speech(text, opts);
      if (!audio || !audio.play) continue;
      audio.volume = 1.0;
      audio.playbackRate = SPEED;
      if ('preservePitch' in audio) audio.preservePitch = true;
      currentAudios.push(audio);
      const played = await new Promise(res => {
        audio.onended = () => res(true);
        audio.onerror = () => res(false);
        audio.play().then(() => {}).catch(() => res(false));
      });
      if (played) return true;
    } catch {}
  }
  return false;
}

function speak(text){
  return new Promise(resolve => {
    const clean = normalizeForTTS(text);
    setState('speaking');
    setStatus('🔊 Elle parle…');
    const done = ok => { setState('idle'); setStatus('Appuie sur l\'orbe et parle'); resolve(ok); };
    const voice = getVoice();
    if (voice === 'puter'){
      /* Voix Puter IA (gratuite pour tout le monde) puis secours cyzon */
      speakPuter(clean).then(ok => { if (ok) done(true); else speakCloud(clean).then(done); });
    } else {
      /* Voix Mistral (si clé + voix choisie) puis secours cyzon */
      speakMistral(clean).then(ok => { if (ok) done(true); else speakCloud(clean).then(done); });
    }
  });
}

/* ===== STOP AUDIO (pour passer le message) ===== */
let currentAudios = [];
function stopAudio(){
  currentAudios.forEach(a => { try { a.pause(); a.src = ''; } catch {} });
  currentAudios = [];
}

/* ===== FLUX PRINCIPAL ===== */
async function handleQuestion(question){
  if (isProcessing) return;
  isProcessing = true;
  manualStop = true;
  try{ recog && recog.stop(); }catch{}
  try{ speechSynthesis.cancel(); }catch{}
  heardLine.style.display = 'block';
  heardText.textContent = question;
  setState('thinking');
  setStatus('🧠 Elle réfléchit…');
  const r = await askAI(question);
  if (r.error){
    setState('idle');
    if (r.error === 'nokey'){
      setStatus('🔑 Ajoute ta clé Groq dans ⚙️');
      toast('🔑 Va dans ⚙️ Réglages et colle ta clé Groq');
      settingsModal.classList.remove('hidden');
    } else if (r.error === 'limit'){
      setStatus('⏳ Limite atteinte — réessaie dans une minute');
      await speak('J ai atteint ma limite de requêtes. Attends quelques secondes et réessaie.');
    } else {
      setStatus('❌ Erreur IA — vérifie ta clé dans ⚙️');
      await speak('J ai eu une petite erreur. Réessaie dans un instant.');
    }
    /* RESET sur erreur : sinon isProcessing restait true -> plus rien ne reagit */
    isProcessing = false;
    manualStop = false;
    return;
  }
  saidLine.style.display = 'block';
  saidText.textContent = r.text;
  await speak(r.text);
  /* RESET SYSTEMATIQUE : sans ceci, isProcessing reste true pour toujours
     apres la 1ere question -> chaque appui suivant est bloque (ca reagit plus). */
  isProcessing = false;
  manualStop = false;
}

/* ===== MISE À JOUR ===== */
function versionCompare(a, b){
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++){
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
async function checkUpdate(){
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const j = await res.json();
    /* Ne recharge que si la version en ligne est PLUS RÉCENTE (jamais l'inverse) */
        if (j.version && versionCompare(j.version, APP_VERSION) > 0){
      updateBanner.classList.add('show');
      /* ANTI-BOUCLE : on ne recharge qu'UNE SEULE fois, jamais en boucle.
         Sinon (version.json en avance sur app.js en cache) => bandeau errone bloque en reload infini. */
      if (!sessionStorage.getItem('va_reloaded_once')){
        sessionStorage.setItem('va_reloaded_once', '1');
        updateBanner.textContent = '🔄 Nouvelle version ' + j.version + ' - rechargement automatique';
        setTimeout(() => { location.href = location.pathname + '?force=' + Date.now(); }, 1500);
      } else {
        /* Deja recharge une fois : on affiche juste un bouton, on ne relance PAS un reload (sinon boucle). */
        updateBanner.textContent = '⬆️ Nouvelle version ' + j.version + ' disponible - appuie pour maj';
        updateBanner.style.cursor = 'pointer';
      }
    }
  } catch {}
}
updateBanner.addEventListener('click', async () => {
  updateBanner.textContent = '⏳ Mise à jour...';
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) { try { await r.unregister(); } catch {} }
    }
  } catch {}
  try { sessionStorage.clear(); } catch {}
  location.href = location.pathname + '?force=' + Date.now();
});

function resetApp(){ localStorage.clear(); session=[]; currentConvId=null; isProcessing=false; manualStop=false; welcomeDone=false; welcomePlaying=false; edgeTried=false; puterWarmed=false; state="idle"; setStatus("Appuie sur la bulle et parle"); setState("idle"); location.reload(true); }
/* ===== DÉMARRAGE ===== */
$('appVersion').textContent = 'Assistant Vocal IA — v' + APP_VERSION;
$('versionTag').textContent = 'v' + APP_VERSION;
checkUpdate();
setStatus('Appuie sur l\'orbe et parle');