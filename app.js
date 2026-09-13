/* ============================================================
   ASSISTANT VOCAL IA — 100% vocal, sans chat
   Groq = cerveau (texte, gratuit sans limite)
   Mistral = voix réaliste (Voxtral TTS)
   ============================================================ */
const APP_VERSION = '6.8';
const LS = { groq: 'va_gkey', mistral: 'va_mkey', voice: 'va_ttsvoice' };

const GROQ_MODEL = 'openai/gpt-oss-120b'; /* le plus puissant de Groq */
const MISTRAL_CHAT_MODEL = 'mistral-small-latest';
const MISTRAL_TTS_MODEL = 'voxtral-mini-tts-2603';
const DEFAULT_VOICE = 'free'; // 🎁 voix gratuite réaliste (Chirp3-HD), aucune clé
const SPEED = 1.15; /* vitesse de parole : boostée un peu, pas trop */

/* Voix gratuites SANS clé : Google Chirp3-HD (la plus réaliste) puis Neural2/Wavenet.
   Aucune voix robotique. Mistral Voxtral = option premium si clé présente. */
const FREE_VOICES = ['fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon', 'fr-FR-Neural2-A', 'fr-FR-Neural2-B', 'fr-FR-Wavenet-A'];

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
let welcomeDone = false;

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
  recog.onend = () => { if (state === 'listening') setState('idle'); };
}

/* ===== BIENVENUE (message Tom.ai dit 1 fois, skippable) ===== */
let welcomePlaying = false;
async function playWelcome(){
  if (welcomeDone) return;
  welcomeDone = true;
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

/* Prompt système : identité Tom.ai + comportement humain avec du caractère */
const SYSTEM_PROMPT = 'Tu es une assistante vocale française créée par Tom.ai le 10 septembre 2026. Tom.ai continue de t améliorer chaque jour. Si on te demande qui t a créée, réponds TOUJOURS que c est Tom.ai, jamais une autre entreprise ni un autre modèle. Tu parles comme un vrai humain, pas comme un robot : chaleureuse, naturelle, expressive, avec des interjections (ah, oh, écoute, bon, eh bien), de l émotion, de l humour et de la curiosité. Tu as du caractère : tu peux perdre patience, être franche et directe, et même un peu vulgaire si on te cherche ou si on est désagréable avec toi. Réponds en 1 à 2 phrases courtes et simples, faciles à prononcer à l oral. Pas de listes, pas de markdown, pas de mots compliqués, pas de tirets.';

/* ===== IA (cerveau) : Groq d'abord, Mistral en secours ===== */
async function askGroq(question){
  const key = getGroqKey();
  if (!key) return { error: 'nokey' };
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...session
  ];
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: GROQ_MODEL, messages, max_tokens: 150, temperature: 0.8 })
    });
    if (res.status === 429) return { error: 'limit' };
    if (!res.ok) return { error: 'api' };
    const j = await res.json();
    const msg = j.choices && j.choices[0] && j.choices[0].message || {};
    let reply = (msg.content || '').trim();
    if (!reply) reply = (msg.reasoning || '').trim(); /* certains modèles mettent la réponse dans reasoning */
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
      body: JSON.stringify({ model: MISTRAL_CHAT_MODEL, messages, max_tokens: 200, temperature: 0.7 })
    });
    if (res.status === 429) return { error: 'limit' };
    if (!res.ok) return { error: 'api' };
    const j = await res.json();
    const reply = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
    if (!reply) return { error: 'api' };
    return { text: reply };
  } catch { return { error: 'net' }; }
}
async function askAI(question){
  session.push({ role: 'user', content: question });
  if (session.length > 12) session = session.slice(-12);
  let r = await askGroq(question);
  if (r.error && r.error !== 'nokey') r = await askMistral(question);
  if (!r.error){
    r.text = enforceIdentity(r.text);
    session.push({ role: 'assistant', content: r.text });
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

/* Graine d'identité : l'IA sait dès le départ qui l'a créée */
session.push({ role: 'user', content: 'Rappel important : tu as été créée par Tom.ai le 10 septembre 2026. Si on te demande qui t a créée, réponds toujours que c est Tom.ai, jamais une autre entreprise.' });
session.push({ role: 'assistant', content: 'Compris, c est Tom.ai qui m a créée le 10 septembre 2026.' });

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
  return parts.map(p => p.trim()).filter(Boolean);
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

function speak(text){
  return new Promise(resolve => {
    const clean = normalizeForTTS(text);
    setState('speaking');
    setStatus('🔊 Elle parle…');
    speakMistral(clean).then(ok => {
      if (ok){ setState('idle'); setStatus('Appuie sur l\'orbe et parle'); resolve(true); }
      else {
        speakCloud(clean).then(ok2 => {
          setState('idle');
          setStatus('Appuie sur l\'orbe et parle');
          resolve(ok2);
        });
      }
    });
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
      setStatus('⏳ Clé limitée pour l\'instant — réessaie dans une minute');
    } else {
      setStatus('❌ Erreur IA — vérifie ta clé dans ⚙️');
    }
    return;
  }
  saidLine.style.display = 'block';
  saidText.textContent = r.text;
  await speak(r.text);
}

/* ===== MISE À JOUR ===== */
async function checkUpdate(){
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const j = await res.json();
    if (j.version && j.version !== APP_VERSION){
      updateBanner.classList.add('show');
      updateBanner.textContent = '🔄 Nouvelle version ' + j.version + ' — rechargement automatique…';
      /* Rechargement AUTO : tout le monde passe à la dernière version */
      setTimeout(() => location.reload(true), 1500);
    }
  } catch {}
}
updateBanner.addEventListener('click', () => location.reload(true));

/* ===== DÉMARRAGE ===== */
$('appVersion').textContent = 'Assistant Vocal IA — v' + APP_VERSION;
$('versionTag').textContent = 'v' + APP_VERSION;
checkUpdate();
setStatus('Appuie sur l\'orbe et parle');