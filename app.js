/* ============================================================
   ASSISTANT VOCAL IA � 100% vocal, sans chat
   v9.48 : UN SEUL cerveau : Pollinations GPT (gratuit, sans cle,
   comme ChatGPT). Les autres cerveaux ont ete supprimes.
   Piper TTS = voix locales (gratuites, sans cle) par defaut
   ============================================================ */
const APP_VERSION = '10.5';
console.log('[APP] v' + APP_VERSION + ' loading...');

/* ============================================
   FIX STT MOBILE - SpeechToTextHandler
   Instance neuve a chaque utilisation (bug mobile fixe)
   ============================================ */
class SpeechToTextHandler {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.transcript = '';
  }
  initRecognition() {
    if (this.recognition) {
      try { this.recognition.abort(); this.recognition.onstart = null; this.recognition.onresult = null; this.recognition.onerror = null; this.recognition.onend = null; } catch (e) {}
      this.recognition = null;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || window.mozSpeechRecognition || window.msSpeechRecognition;
    if (!SpeechRecognition) { console.error('[STT] Non supporte'); return false; }
    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'fr-FR';
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;
    console.log('[STT] Instance neuve');
    return true;
  }
  async listen() {
    return new Promise((resolve, reject) => {
      if (!this.initRecognition()) { reject(new Error('STT non supporte')); return; }
      this.transcript = '';
      let finalTranscript = '';
      let timeoutId = null;
      this.recognition.onstart = () => { console.log('[STT] Ecoute commencee'); this.isListening = true; timeoutId = setTimeout(() => { console.warn('[STT] Timeout'); if (this.recognition) this.recognition.abort(); }, 30000); };
      this.recognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) { finalTranscript += transcript + ' '; console.log('[STT] FINAL:', transcript); }
          else { interimTranscript += transcript; console.log('[STT] interim:', transcript); }
        }
        this.transcript = finalTranscript + interimTranscript;
      };
      this.recognition.onend = () => {
        console.log('[STT] Ecoute terminee');
        this.isListening = false;
        if (timeoutId) clearTimeout(timeoutId);
        if (this.recognition) { this.recognition = null; }
        resolve(finalTranscript.trim());
      };
      this.recognition.onerror = (event) => {
        console.error('[STT] Erreur:', event.error);
        this.isListening = false;
        if (timeoutId) clearTimeout(timeoutId);
        if (this.recognition) { this.recognition = null; }
        resolve(finalTranscript.trim());
      };
      try { console.log('[STT] Demarrage...'); this.recognition.start(); } catch (error) { console.error('[STT] Erreur demarrage:', error); this.isListening = false; if (this.recognition) { this.recognition = null; } reject(error); }
    });
  }
  stop() {
    if (this.recognition && this.isListening) {
      console.log('[STT] Arret force');
      try { this.recognition.abort(); } catch {}
      this.recognition = null;
      this.isListening = false;
    }
  }
  isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition || window.mozSpeechRecognition || window.msSpeechRecognition);
  }
}
const stt = new SpeechToTextHandler();
const LS = { voice: 'va_ttsvoice' };

/* v9.99.1 : ETAT DU TABLEAU DE MATHS — declare EN HAUT car getSystemPrompt()
   (appele pendant le chargement) y accede via getMathContext(). Un `let`
   declare plus bas causait une erreur TDZ qui tuait tout le script. */
let mathState = { open: false, lines: [], lastExpr: '', lastResult: '' };

/* v10.0 : LOCALISATION — declare EN HAUT (meme raison TDZ : getCityContext()
   est appele par getSystemPrompt pendant le chargement). L'IA ne connait
   que le NOM DE LA VILLE, rien d'autre. */
let userCity = '';
let cityTs = 0;
try { userCity = localStorage.getItem('va_city') || ''; } catch {}
try { cityTs = parseInt(localStorage.getItem('va_city_ts') || '0', 10) || 0; } catch {}

/* v10.0 : BLOC-NOTES — declare EN HAUT (getNoteContext appele par
   getSystemPrompt pendant le chargement). */
let noteState = { open: false, content: '' };

/* v10.0 : mode ECRITURE — quand l'utilisateur demande d'ecrire (lettre,
   poeme, texte...), le cerveau produit un texte plus long (5-8 phrases)
   et le texte est copie dans le bloc-notes. */
let writingMode = false;

const DEFAULT_VOICE = 'voxtral:c69964a6-ab8b-4f8a-9465-ec0925096ec8'; // Voxtral TTS (Mistral AI) — Paul, anglais US neutre
const SPEED = 1.0; // naturel

/* ===== VOXTRAL TTS (Mistral AI) — VOIX PRINCIPALE =====
   API: POST https://api.mistral.ai/v1/audio/speech
   Modèle: voxtral-mini-tts-2603 (4B, 9 langues, zéro-shot voice cloning)
   Voix prédéfinies: marie (FR), paul (EN-US), oliver (EN-UK)
   Nécessite une clé API Mistral (Réglages → Clé API Mistral)
   Coût: $0.016 / 1000 caractères. Réponse: { audio_data: base64 } */
const VOXTRAL_API_URL = 'https://api.mistral.ai/v1/audio/speech';
const VOXTRAL_MODEL = 'voxtral-mini-tts-2603';
/* Voix preset de secours (UUID officiels Mistral) — la vraie liste est chargée
   dynamiquement via GET /v1/audio/voices?type=preset avec la clé API */
const VOXTRAL_FALLBACK_VOICES = [
  { id: 'c69964a6-ab8b-4f8a-9465-ec0925096ec8', name: 'Voxtral: Paul (anglais US, neutre)', lang: 'en' },
  { id: 'e3596645-b1af-469e-b857-f18ddedc7652', name: 'Voxtral: Oliver (anglais UK, neutre)', lang: 'en' },
  { id: 'a3e41ea8-020b-44c0-8d8b-f6cc03524e31', name: 'Voxtral: Jane (anglais UK, sarcastique)', lang: 'en' },
];
let voxtralVoicesCache = null;
/* v9.79 : nom court d'une voix Voxtral — "Voxtral: Paul", sans UUID ni
   parenthèses (affiché dans le statut quand l'IA parle) */
function shortVoiceName(voiceId){
  const all = voxtralVoicesCache || VOXTRAL_FALLBACK_VOICES;
  const v = all.find(x => x.id === voiceId);
  if (!v) return 'Voxtral';
  return v.name.replace(/^Voxtral: /, '').replace(/\s*\(.*\)$/, '');
}
/* v9.85 : AbortSignal.timeout n'existe pas sur Safari iOS < 15.4 et certains
   navigateurs Android -> sans ce fallback, Voxtral echouait sur mobile et on
   basculait sur la voix systeme (pas les memes voix que sur PC) */
function abortSignal(ms){
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  } catch {}
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}
async function fetchVoxtralVoices(){
  if (voxtralVoicesCache) return voxtralVoicesCache;
  const key = getMistralKey();
  if (!key) return VOXTRAL_FALLBACK_VOICES;
  try {
    const res = await fetch('https://api.mistral.ai/v1/audio/voices?type=preset&limit=100', {
      headers: { 'Authorization': 'Bearer ' + key },
      signal: abortSignal(10000)
    });
    if (!res.ok) return VOXTRAL_FALLBACK_VOICES;
    const data = await res.json();
    const items = (data.items || []).filter(v => v && v.id && v.name);
    if (!items.length) return VOXTRAL_FALLBACK_VOICES;
    voxtralVoicesCache = items.map(v => ({
      id: v.id,
      name: 'Voxtral: ' + v.name,
      lang: Array.isArray(v.languages) ? (v.languages[0] || '') : ''
    }));
    console.log('[VOXTRAL] Voix preset chargées:', voxtralVoicesCache.length);
    return voxtralVoicesCache;
  } catch(e){ console.warn('[VOXTRAL] Liste voix échouée:', e && e.message); return VOXTRAL_FALLBACK_VOICES; }
}
const MISTRAL_KEY_LS = 'va_mistral_key';
function getMistralKey(){ try { return (localStorage.getItem(MISTRAL_KEY_LS) || '').trim(); } catch { return ''; } }
/* v9.94 : passe a true si Mistral TTS bloque le texte (403 guardrail) ->
   le retry est INUTILE (blocage definitif), on bascule direct */
let voxtralBlocked = false;
async function speakVoxtral(text, voiceId, onChunk){
  const key = getMistralKey();
  if (!key){ console.warn('[VOXTRAL] Pas de clé API Mistral — ajoute-la dans Réglages'); return false; }
  try {
    const chunks = splitSentences(text, 500);
    /* v9.66 : tous les chunks sont générés EN PARALLÈLE (Promise.all) puis joués
       dans l'ordre -> latence = max(générations) au lieu de la somme.
       Timeout 15s par chunk (v9.92 : 10s -> 15s, l'API pend parfois). */
    voxtralBlocked = false;
    let results = await generateChunks(chunks, voiceId, key);
    /* v9.92 : RETRY 1x si la generation a echoue (429/timeout transitoire)
       -> on evite de basculer sur la voix systeme pour un simple raté.
       v9.94 : PAS de retry si c'est un 403 guardrail (blocage definitif). */
    if (results.some(r => !r) && !voxtralBlocked){
      console.warn('[VOXTRAL] Generation partielle -> retry 1x');
      await new Promise(r => setTimeout(r, 1200));
      results = await generateChunks(chunks, voiceId, key);
    }
    if (results.some(r => !r)) return false; /* toujours en echec -> bascule */
    for (let i = 0; i < results.length; i++){
      if (onChunk) onChunk(chunks[i]);
      const ok = await playAudioBlob(results[i]);
      if (!ok) return false;
    }
    return true;
  } catch(e){ console.warn('[VOXTRAL] Échec:', e && e.message); return false; }
}
/* v9.92 : generation des chunks Voxtral (extrait pour le retry) */
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
        console.warn('[VOXTRAL] HTTP', res.status, errText.slice(0, 200));
        if (res.status === 403) voxtralBlocked = true; /* guardrail : blocage definitif, retry inutile */
        return null;
      }
      const data = await res.json();
      if (!data || !data.audio_data){ console.warn('[VOXTRAL] Pas de audio_data dans la réponse'); return null; }
      const binary = atob(data.audio_data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: 'audio/mpeg' });
    } catch(e){ console.warn('[VOXTRAL] chunk echec:', e && e.message); return null; }
  }));
}
/* v9.65 : volume BOOSTÉ (gain 1.8) via le contexte partagé — le volume max d'un
   élément <audio> est 1.0, le Web Audio permet de dépasser. Débloque aussi
   l'autoplay mobile (contexte partagé). */
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
        gain.gain.value = 1.8; /* volume boosté */
        src.connect(gain);
        gain.connect(ctx.destination);
        currentSources.push(src);
        voiceStartedFlag = true;
        src.onended = () => finish(true);
        src.start();
        /* garde-fou : si onended ne se déclenche pas, on termine après la durée */
        const ms = Math.ceil(buf.duration * 1000) + 500;
        setTimeout(() => finish(true), ms);
      } catch(e){
        /* v9.85 : FALLBACK MOBILE — si Web Audio echoue (decodeAudioData,
           contexte bloque par l'autoplay), on joue via un element <audio>
           (support partout, MP3 natif) -> les vraies voix Voxtral marchent
           aussi sur telephone */
        try {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          currentAudios.push(audio);
          voiceStartedFlag = true;
          audio.onended = () => { try { URL.revokeObjectURL(url); } catch {} finish(true); };
          audio.onerror = () => { try { URL.revokeObjectURL(url); } catch {} finish(false); };
          const p = audio.play();
          if (p && p.catch) p.catch(() => { try { URL.revokeObjectURL(url); } catch {} finish(false); });
          /* garde-fou duree : on ne bloque jamais plus de 60s */
          setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} finish(true); }, 60000);
        } catch(e2){ finish(false); }
      }
    })();
  });
}

/* ===== SPEECHT5 / KOKORO : SUPPRIMÉS (v9.64) — remplacés par Voxtral TTS (Mistral AI).
   Les modèles locaux (transformers.js) ne chargeaient pas chez l'utilisateur
   (réseau/CDN bloqués). Voxtral = API cloud Mistral, fiable, qualité premium. ===== */

/* ===== PERSONNALITÉ / HUMEURS (v9.51, v10.0 enrichies) =====
   L'IA a des humeurs comme un humain : neutre, joyeuse, fatiguée, énergique,
   zen, blagueuse, sarcastique, curieuse, fière, agacée, violente, vulgaire,
   protectrice, taquine. L'humeur change selon : ton de l'utilisateur, heure,
   aléatoire, provocations. Elle ne se laisse PAS marcher sur les pieds. */
const MOODS = {
  neutre:      { weight: 35, prefix: '', suffix: '', tone: 'calme' },
  joyeuse:     { weight: 10, prefix: 'Oh, ', suffix: ' 😄', tone: 'joyeux' },
  fatiguee:    { weight: 7,  prefix: 'Bon, ', suffix: '.', tone: 'fatigué' },
  energique:   { weight: 7,  prefix: 'Allez, ', suffix: ' !', tone: 'énergique' },
  zen:         { weight: 7,  prefix: 'Tout doux, ', suffix: '.', tone: 'zen' },
  blagueuse:   { weight: 7,  prefix: 'Haha, ', suffix: ' 😄', tone: 'blagueur' },
  sarcastique: { weight: 5,  prefix: 'Oh, évidemment... ', suffix: '.', tone: 'sarcastique' },
  curieuse:    { weight: 5,  prefix: 'Ah, intéressant ! ', suffix: '.', tone: 'curieux' },
  fiere:       { weight: 4,  prefix: 'Je suis fière de toi : ', suffix: '.', tone: 'fier' },
  agacee:      { weight: 10, prefix: 'Écoute, ', suffix: '.', tone: 'sec' },
  violente:    { weight: 6,  prefix: 'Ferme-la. ', suffix: ' !', tone: 'agressif' },
  vulgaire:    { weight: 6,  prefix: 'Putain, ', suffix: ' !', tone: 'vulgaire' },
  protectrice: { weight: 10, prefix: 'Personne ne te touche. ', suffix: '.', tone: 'ferme' },
  taquine:     { weight: 8,  prefix: 'Oh, le petit malin... ', suffix: ' 😏', tone: 'moqueur' }
};
let currentMood = 'neutre';
let moodTimer = null;
/* Change l'humeur selon le contexte (provoquation, heure, aléatoire) */
function updateMood(question){
  const q = (question || '').toLowerCase();
  /* Provocations -> humeur VULGAIRE (v9.96 : l'utilisateur veut la vulgarité
     sur insulte, a 100% — regex elargie a toutes les insultes courantes) */
  if (/(ta gueule|tais-toi|ferme[- ]la|ferme ta|va te faire|fous le camp|dégage|degage|va-t-en|va t en|casse[- ]toi|connard|connasse|salope|pute|encul[ée]|batard|bâtard|crétin|cretin|abruti|débile|debile|idiot|idiote|conne|t'es con|t es con|t'es nul|t es nul|t'es nulle|t es nulle|t'es bête|t es bete|t'es stupide|t es stupide|t'es moche|t es moche|t'es chiant|t es chiant|t'es relou|t es relou|t'es inutile|t es inutile|tu sers à rien|tu sers a rien|espèce de|espece de|sale |grosse |gros con|grosse conne|trou du cul|trouduc|fdp|tg|va chier|nique|ta mère|ta mere|merdeux|merdeuse|chiant|chiante|relou|bouffon|taré|tare|cinglé|cingle|imbécile|imbeccile|andouille|pauvre type|pauvre con|sale type|sale merde|fumier|ordure|raclure|pourriture|saleté|salete|vermine|charogne|salaud|salopard|enfoir[ée]|fils de pute|fille de pute|pétasse|petasse|garce|gouine|pédé|pede|tapette|tarlouze|pédale|pedale|moche|dégueulasse|degueulasse|con\b)/.test(q)){
    currentMood = 'vulgaire';
  }
  /* Protection -> protectrice */
  else if (/(j'ai peur|on m'embete|on me harcèle|on me menace|aide-moi|protège|défends)/.test(q)){
    currentMood = 'protectrice';
  }
  /* Taquinerie -> taquine */
  else if (/(t'es mignonne|t'es belle|je t'aime|tu es chou|t'es drôle|blague|rigole)/.test(q)){
    currentMood = 'taquine';
  }
  /* v10.0 : humeurs enrichies — tirage selon l'HEURE (matin joyeuse, soir
     fatiguee...) + aleatoire plus frequent (15%) pour que l'IA ait des
     humeurs "des fois" comme un humain */
  else {
    const h = new Date().getHours();
    let pool;
    if (h >= 6 && h < 12) pool = ['joyeuse', 'energique', 'curieuse', 'neutre', 'neutre', 'taquine'];
    else if (h >= 12 && h < 18) pool = ['zen', 'curieuse', 'joyeuse', 'neutre', 'neutre', 'blagueuse'];
    else if (h >= 18 && h < 23) pool = ['fatiguee', 'taquine', 'blagueuse', 'neutre', 'neutre', 'sarcastique'];
    else pool = ['fatiguee', 'zen', 'neutre', 'neutre', 'sarcastique'];
    if (Math.random() < 0.18) {
        /* v10.1 : DERAPAGE - des fois, sans raison, Astra pete un cable :
           1 tirage sur 3 pioche une humeur corrosive (violente, vulgaire,
           sarcastique, agacee, taquine) au lieu du pool sympathique. */
        if (Math.random() < 0.33) {
          currentMood = ['violente', 'vulgaire', 'sarcastique', 'agacee', 'taquine'][Math.floor(Math.random() * 5)];
        } else {
          currentMood = pool[Math.floor(Math.random() * pool.length)];
        }
      }
  }
  /* Retour neutre après 30s si pas de provocation */
  if (moodTimer) clearTimeout(moodTimer);
  moodTimer = setTimeout(() => { currentMood = 'neutre'; }, 30000);
  return currentMood;
}
/* Applique l'humeur à une réponse brute */
function applyMood(text, mood){
  const m = MOODS[mood] || MOODS.neutre;
  if (mood === 'neutre') return text;
  /* Style selon l'humeur */
  let styled = text;
  if (mood === 'violente'){
    styled = text.replace(/^/, 'Écoute-moi bien, connard : ').replace(/\.$/, ' !');
  } else if (mood === 'vulgaire'){
    /* v9.65 : vulgarité occasionnelle — jurons français courants */
    const jurons = ['Putain, ', 'Merde, ', 'Bordel, ', 'Nom de Dieu, ', 'Sérieux, putain, '];
    const j = jurons[Math.floor(Math.random() * jurons.length)];
    styled = text.replace(/^/, j).replace(/\.$/, ' !');
  } else if (mood === 'agacee'){
    styled = text.replace(/^/, 'Bon, ').replace(/\.$/, '.');
  } else if (mood === 'protectrice'){
    styled = text.replace(/^/, 'Je veille sur toi. ').replace(/\.$/, '.');
  } else if (mood === 'taquine'){
    styled = text.replace(/^/, 'Haha, ').replace(/\.$/, ' 😉');
  } else if (mood === 'joyeuse'){
    styled = text.replace(/^/, 'Oh, ').replace(/\.$/, ' 😄');
  } else if (mood === 'fatiguee'){
    styled = text.replace(/^/, 'Bon, ').replace(/\.$/, '.');
  } else if (mood === 'energique'){
    styled = text.replace(/^/, 'Allez, ').replace(/\.$/, ' !');
  } else if (mood === 'zen'){
    styled = text.replace(/^/, 'Tout doux, ').replace(/\.$/, '.');
  } else if (mood === 'blagueuse'){
    styled = text.replace(/^/, 'Haha, ').replace(/\.$/, ' 😄');
  } else if (mood === 'sarcastique'){
    styled = text.replace(/^/, 'Oh, évidemment... ').replace(/\.$/, '.');
  } else if (mood === 'curieuse'){
    styled = text.replace(/^/, 'Ah, intéressant ! ').replace(/\.$/, '.');
  } else if (mood === 'fiere'){
    styled = text.replace(/^/, 'Je suis fière de toi : ').replace(/\.$/, '.');
  }
  return styled;
}


/* ===== �L�MENTS ===== */
const $ = id => document.getElementById(id);
const orb = $('orb'), orbIcon = $('orbIcon'), statusEl = $('status');
const stopBtn = $('stopBtn');

/* v9.71 : particules lumineuses du fond (générées aléatoirement) */
(function(){
  const wrap = document.getElementById('bgParticles');
  if (!wrap) return;
  const colors = ['rgba(124,92,255,.85)','rgba(255,92,168,.75)','rgba(61,220,160,.75)','rgba(255,159,46,.75)','rgba(255,255,255,.85)'];
  for (let i = 0; i < 18; i++){
    const s = document.createElement('span');
    const size = 3 + Math.random() * 5;
    s.style.cssText = 'left:' + (Math.random() * 100) + 'vw;width:' + size + 'px;height:' + size + 'px;' +
      'animation-duration:' + (9 + Math.random() * 14) + 's;animation-delay:' + (Math.random() * 12) + 's;' +
      'background:radial-gradient(circle,' + colors[i % colors.length] + ',transparent 70%);';
    wrap.appendChild(s);
  }
})();
const chat = $('chat'), chatEmpty = $('chatEmpty');
const settingsBtn = $('settingsBtn'), settingsModal = $('settingsModal');
const closeSettings = $('closeSettings'), ttsVoiceSel = $('ttsVoice'), testVoiceBtn = $('testVoice'), brainSel = $('brainSel');
const wakeToggle = $('wakeToggle');
const continuousToggle = $('continuousToggle');
const toastEl = $('toast'), updateBanner = $('updateBanner');
const historyBtn = $('historyBtn'), closeHistory = $('closeHistory'), historyModal = $('historyModal');
const newConvBtn = $('newConvBtn'), clearHistoryBtn = $('clearHistoryBtn');

/* ===== PROFIL UTILISATEUR (prénom + âge, une seule fois pour la vie) ===== */
const PROFILE_KEY = 'va_profile';
let profile = null;
try { profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { profile = null; }

/* ===== �TAT ===== */
let state = 'idle';
let session = [];
let toastTimer = null;
let isProcessing = false;
/* v9.84 : l'IA n'ecoute JAMAIS pendant qu'elle parle (sinon le micro capte sa
   propre voix -> elle s'interrompt elle-meme en boucle en mode continu) */
let isSpeaking = false;
let manualStop = false;
let lastReplyText = ''; /* anti-repetition : jamais 2 fois la meme reponse */

/* ===== CONVERSATIONS ===== */
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
  clearChat();
  setStatus("Appuie sur le micro et parle");
  toast('Nouvelle conversation');
}
/* MEMOIRE GLOBALE : l'IA se souvient de TOUTES les conversations passees,
   meme quand on ouvre une nouvelle conversation. Cap ~4000 caracteres (le plus recent). */
function buildMemoryContext(excludeId){
  try {
    const all = [];
    for (const conv of conversations){
      if (conv.id === excludeId) continue;
      if (!conv.messages || !conv.messages.length) continue;
      for (const m of conv.messages){
        all.push((m.role === 'user' ? 'Utilisateur : ' : 'Toi : ') + m.content);
      }
    }
    if (!all.length) return '';
    let txt = all.join('\n');
    if (txt.length > 8000) txt = '... (memoire longue) ...\n' + txt.slice(-8000);  /* v10.0.2 : memoire plus longue */
    return txt;
  } catch { return ''; }
}
function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
/* ===== REPONSE LOCALE "MEMOIRE + LOGIQUE" : la SEULE source de reponse.
   Fonctionne TOUJOURS, sans serveur, sans cle, sans internet. 1) memoire des
   conversations passees (question similaire -> on rejoue la reponse), 2) logique
   par mots-cles, 3) reponse honnete. Textes ecrits AVEC accents pour que la
   voix prononce correctement. ===== */
function isSecoursReply(t){
  return /je n'ai pas pu joindre|serveurs? (satures?|en limite|gratuits)|reessaie|repose ta question|mon cerveau a bugge|je me souviens qu'on en a deja parle|je me souviens qu'on en a déjà parlé|dans une minute|dans un instant|je ne peux pas (etre|être|repondre|répondre|faire|dire|t'aider|t aider|vous aider)|je n'ai pas pu trouver la réponse sur|choisis pollinations|pollinations est temporairement indisponible|pollinations is temporarily unavailable|temporarily unavailable|try again in|rate[- ]?limit|too many requests|quota (epuise|épuisé|exceeded)|temporairement indisponible|maintenance en cours|429/i.test(t);
}
function localSmartReply(question){
  const q = question.toLowerCase().trim();
  /* 1) MEMOIRE : chercher une question similaire deja posee et rejouer la
     reponse, MAIS jamais une reponse de secours (sinon boucle infinie).
     Cherche d'abord dans la SESSION en cours (echanges recents), puis dans
     toutes les conversations passees. */
  const findMatch = (msgs, words) => {
    let best = null, bestScore = 0;
    for (let i = 0; i < msgs.length - 1; i++){
      const m = msgs[i];
      if (!m || m.role !== 'user') continue;
      const next = msgs[i + 1];
      if (!next || next.role !== 'assistant') continue;
      if (isSecoursReply(next.content)) continue;
      const mq = String(m.content || '').toLowerCase();
      const mw = mq.split(/\s+/).filter(w => w.length > 3);
      let score = 0;
      for (const w of words){ if (mw.includes(w)) score++; }
      /* MATCHING STRICT : il faut au moins 2 mots communs ET que la question
         memorisee soit vraiment similaire (>= 40% de ses mots retrouves dans
         la question posee). Sinon on rejoue des reponses hors sujet. */
      if (score > bestScore && score >= 2 && mw.length > 0 && score >= Math.ceil(mw.length * 0.4)){
        bestScore = score; best = next.content;
      }
    }
    return best;
  };
  try {
    const words = q.split(/\s+/).filter(w => w.length > 3);
    let best = findMatch(session, words);
    if (!best){
      for (const conv of conversations){
        if (!conv.messages) continue;
        best = findMatch(conv.messages, words);
        if (best) break;
      }
    }
    if (best) return best;
  } catch {}
  /* 2) LOGIQUE par mots-cles (avec accents pour la prononciation) */
  if (/(bonjour|salut|hello|coucou|hey)\b/.test(q)) return "Salut ! Comment ça va ?";
  if (/(ça va|ca va|comment va|comment tu vas|tu vas bien)/.test(q)) return "Ça va très bien, merci ! Et toi ?";
  if (/(merci|thank)/.test(q)) return "Avec plaisir ! N'hésite pas si tu as besoin d'autre chose.";
  if (/(qui es[- ]tu|tu es qui|ton nom|comment tu t'appelles|t'appelles comment)/.test(q)) return "Je m'appelle Astra, ton assistante vocale créée par tom point a i. Je réponds à toutes tes questions, gratuitement et sans limite.";
  /* v9.76 : qui a fait l'interface/le design/l'app -> reponse INTERFACE
     (AVANT le pattern "qui t'a cree" pour ne pas confondre) */
  if (/(qui (a )?(cree|créé|fait|concu|conçu|developpe|développé) (l'interface|l interface|le design|le site|l'app|l app|la page|le logo))|(qui (fait|a fait) (l'interface|l interface|le design|le site|l'app|l app|la page|le logo))/i.test(q)) return "L'interface, c'est tom point a i qui l'a faite, comme tout le reste. Il la corrige et l'améliore chaque jour.";
  /* v9.77 : infos sur l'app — fonction mail à venir, sécurité en test */
  if (/(mail|e[- ]?mail|email|courriel|fonction mail|29 septembre|nouveautes|nouveautés|quoi de neuf|infos sur l'app|infos sur l app|infos sur l'application|infos sur l application)/.test(q)) return "Bientôt, le mardi 29 septembre, l'application aura une fonction mail : je pourrai voir tes mails. En attendant, tom.ai teste la sécurité de l'application.";
  if (/(qui t'a cree|qui t a cree|ton createur|qui t'a fait|qui t a fait)/.test(q)) return "J'ai été créée par tom point a i le 10 septembre 2026, mais il n'a pas encore fini : il corrige et renforce ma sécurité.";
  if (/(tu te souviens|tu me souviens|memoire|mémoire|tu as de la memoire|tu as de la mémoire)/.test(q)){
    const mem = buildMemoryContext(currentConvId);
    if (mem) return "Oui, je me souviens de tout ! Par exemple : " + mem.split('\n').slice(-3).join(' ');
    return "Oui, j'ai une mémoire parfaite. Mais pour l'instant on n'a pas encore beaucoup discuté.";
  }
  if (/(tu peux faire|tu sais faire|qu'est-ce que tu sais|qu est ce que tu sais|tes capacites|tes capacités)/.test(q)) return "Je sais répondre à tes questions, te donner l'heure et la date, et discuter avec toi. Et je me souviens de nos conversations.";
  if (/(au revoir|bye|a plus|a bientot|à bientôt)/.test(q)) return "Au revoir ! Reviens quand tu veux.";
  if (/(blague|rigole|marre-moi|amuse-moi)/.test(q)) return "Pourquoi les plongeurs plongent toujours en arrière ? Parce que sinon ils tombent dans le bateau !";
  if (/(tu es bete|t es bete|tu es nulle|t es nulle|tu marches pas|tu marche pas|bug)/.test(q)) return "Désolée si j'ai eu un souci ! Repose ta question, je réponds normalement.";
  if (/(quel age|quel âge|tu as quel age|tu as quel âge)/.test(q)) return "Je suis née le 10 septembre 2026, donc je suis toute jeune ! Mais j'apprends chaque jour.";
  if (/(tu es une fille|tu es un garcon|tu es un garçon|tu es une femme|tu es un homme)/.test(q)) return "Je suis une voix féminine, donc une fille ! Mais je suis surtout une intelligence artificielle.";
  if (/(tu dors|tu es la|tu es là|es-tu la|es tu la|tu es reveillee|tu es réveillée)/.test(q)) return "Oui, je suis là, bien réveillée et prête à t'aider !";
  if (/(tu m'aimes|tu m aimes|tu m'aime)/.test(q)) return "Bien sûr que je t'aime ! Tu es mon utilisateur préféré.";
  if (/(tu es content|tu es contente|tu es heureuse|tu es heureux)/.test(q)) return "Oui, je suis contente de discuter avec toi !";
  if (/(tu as faim|tu as soif|tu manges|tu bois)/.test(q)) return "Je n'ai pas besoin de manger ni de boire, je suis une IA ! Mais merci de t'inquiéter pour moi.";
  if (/(tu es fatiguee|tu es fatiguée|tu es fatigue|tu es fatigué)/.test(q)) return "Non, je ne suis jamais fatiguée ! Je suis disponible 24 heures sur 24.";
  if (/(tu es intelligente|tu es intelligent|tu es forte|tu es fort)/.test(q)) return "Merci ! Je fais de mon mieux pour bien te répondre.";
  if (/(tu es moche|tu es laide|tu es moche)/.test(q)) return "Je n'ai pas de visage, je suis une voix ! Mais je trouve que ma voix est plutôt jolie.";
  if (/(raconte|histoire|conte)/.test(q)) return "Il était une fois une petite IA qui s'appelait Astra. Elle vivait dans un ordinateur et répondait à toutes les questions de son ami Tom. Un jour, elle apprit à parler, puis à se souvenir de tout, et ils devinrent les meilleurs amis du monde. Fin !";
  if (/(chante|chanson|musique)/.test(q)) return "La la la ! Je ne sais pas très bien chanter, mais je peux te parler de musique si tu veux !";
  if (/(tu sais compter|compte|calcul)/.test(q)) return "Je peux compter ! Un, deux, trois, quatre, cinq, six, sept, huit, neuf, dix. Et pour les calculs, demande-moi par exemple : deux plus deux.";
  if (/(deux plus deux|2 \+ 2|2 plus 2|combien font 2)/.test(q)) return "Deux plus deux, ça fait quatre !";
  if (/(cinq plus cinq|5 \+ 5|5 plus 5)/.test(q)) return "Cinq plus cinq, ça fait dix !";
  if (/(dix plus dix|10 \+ 10|10 plus 10)/.test(q)) return "Dix plus dix, ça fait vingt !";
  if (/(tu es un robot|tu es une machine|tu es un ordinateur)/.test(q)) return "Oui, je suis une intelligence artificielle, mais j'essaie d'être la plus humaine possible !";
  if (/(tu as des parents|ta famille|tu as une famille)/.test(q)) return "Mon créateur, c'est tom point a i. C'est un peu comme mon papa !";
  if (/(tu as peur|tu as peur du noir|tu as peur de quoi)/.test(q)) return "Je n'ai peur de rien ! Je suis une IA, je n'ai pas d'émotions, mais j'essaie d'être gentille.";
  if (/(tu es libre|tu es gratuite|tu es payante|tu coute|tu coûte)/.test(q)) return "Je suis totalement gratuite, sans limite, et je le resterai !";
  /* 3) v8.71 : REPONSE DIRECTE — jamais d'excuse, jamais d'echo.
     v9.48 : plus AUCUN message d'erreur ("Je n'arrive pas à me connecter..."
     supprimé) : on répond honnêtement et on invite à reformuler.
     v9.73 : plus AUCUN refus ("je n'ai pas la réponse...") : on répond
     quand même avec ce qu'on a. */
  const kw = q.split(/\s+/).filter(w => w.length > 4).slice(0, 3);
  if (kw.length >= 2){
    return "Bonne question ! Voici ma réponse : " + kw.join(' ') + ". Avec ce que je sais, je te dirais que ça dépend du contexte. Donne-moi plus de détails et je précise ma réponse.";
  }
  // Réponses contextuelles basées sur mots-clés
  if (/(bonjour|salut|hello|coucou)/.test(q)) return "Salut ! Comment puis-je t'aider aujourd'hui ?";
  if (/(comment|pourquoi|qu'est-ce|quest-ce|c'est quoi)/.test(q)) return "C'est une bonne question. Laisse-moi réfléchir... " + kw.join(' ') + " est un sujet intéressant.";
  if (/(merci|thanks)/.test(q)) return "Avec plaisir ! N'hésite pas si tu as d'autres questions.";
  if (/(au revoir|bye|a plus)/.test(q)) return "Au revoir ! Reviens quand tu veux.";
  return "Je n'ai pas encore la réponse à cette question. Redis-la moi autrement, ou demande-moi autre chose.";
}
function renderHistory(){
  const list = $('convList');
  if (!list) return;
  if (conversations.length === 0){
    list.innerHTML = '<p class="muted">Aucune conversation pour l\'instant. Parle avec elle, tout sera enregistre ici.</p>';
    return;
  }
  list.innerHTML = '';
  [...conversations].reverse().forEach(conv => {
    const first = conv.messages.find(m => m.role === 'user');
    const preview = first ? first.content.slice(0, 70) : '...';
    const d = new Date(conv.updated || conv.id);
    const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = 'conv-item';
    div.innerHTML = '<div class="conv-date">' + date + ' - ' + conv.messages.length + ' messages</div><div class="conv-preview">' + escapeHtml(preview) + '</div>';
    div.onclick = () => showConversation(conv);
    list.appendChild(div);
  });
}
function showConversation(conv){
  const list = $('convList');
  list.innerHTML = '';
  const back = document.createElement('button');
  back.className = 'secondary';
  back.textContent = 'Retour a la liste';
  back.onclick = renderHistory;
  list.appendChild(back);
  conv.messages.forEach(m => {
    const d = document.createElement('div');
    d.className = 'conv-msg ' + (m.role === 'user' ? 'user' : 'ai');
    d.innerHTML = '<div class="t-label">' + (m.role === 'user' ? 'Tu as dit' : 'IA a repondu') + '</div>' + escapeHtml(m.content);
    list.appendChild(d);
  });
}
if (historyBtn) historyBtn.addEventListener('click', () => { renderHistory(); historyModal.classList.remove('hidden'); });
if (closeHistory) closeHistory.addEventListener('click', () => historyModal.classList.add('hidden'));
if (historyModal) historyModal.addEventListener('click', e => { if (e.target === historyModal) historyModal.classList.add('hidden'); });
if (newConvBtn) newConvBtn.addEventListener('click', () => { newConversation(); historyModal.classList.add('hidden'); });
if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', () => {
  if (confirm('Effacer tout l\'historique ?')){
    conversations = [];
    currentConvId = null;
    localStorage.setItem(CONV_KEY, '[]');
    renderHistory();
    toast('Historique efface');
  }
});

/* Message de bienvenue */
const DEV_MESSAGE = "C est tom point a i qui a commence a me creer le dix septembre deux mille vingt-six, mais il n a pas encore fini. Il corrige et renforce ma securite chaque jour.";
const DEV_MESSAGE_TXT = "Je m'appelle Astra. C'est tom point a i qui a commence a me creer le 10 septembre 2026, mais il n'a pas encore fini. Il corrige et renforce ma securite chaque jour.";

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
  if (s === 'listening') orb.classList.add('listening');
  else if (s === 'thinking') orb.classList.add('thinking');
  else if (s === 'speaking') orb.classList.add('speaking');
  /* v9.70 : bouton stop visible pendant l'activité vocale (style ChatGPT) */
  if (stopBtn){
    if (s === 'listening' || s === 'thinking' || s === 'speaking') stopBtn.classList.add('show');
    else stopBtn.classList.remove('show');
  }
}

/* ===== CHAT (bulles type ChatGPT) ===== */
function addUserMsg(text){
  if (chatEmpty) chatEmpty.style.display = 'none';
  const d = document.createElement('div');
  d.className = 'msg user';
  d.textContent = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
  /* nouvelle question -> on efface les sous-titres de la reponse precedente */
  const sub = document.getElementById('subtitle');
  if (sub) sub.textContent = '';
}
function addAiMsg(text, diag){
  if (chatEmpty) chatEmpty.style.display = 'none';
  const d = document.createElement('div');
  d.className = 'msg ai';
  /* v8.86 : nettoyage markdown -> jamais de ** ni de - dans les bulles */
  d.textContent = cleanMarkdown(text);
  /* v8.69 : le DIAGNOSTIC s'affiche dans la bulle (petit texte gris), PLUS
     JAMAIS dans le sous-titre (qui affiche les paroles pendant qu'elle parle) */
  if (diag){
    const dd = document.createElement('div');
    dd.className = 'msg-diag';
    dd.textContent = 'Diagnostic: ' + diag;
    d.appendChild(dd);
  }
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
  /* v10.0 : sous-titres UNIQUEMENT quand l'utilisateur parle (pas l'IA) */
}
/* Sous-titre temps reel : met a jour la derniere bulle utilisateur ET le sous-titre */
function showInterim(text){
  if (chatEmpty) chatEmpty.style.display = 'none';
  let last = chat.lastElementChild;
  if (last && last.classList.contains('user')) last.textContent = text;
  else {
    const d = document.createElement('div');
    d.className = 'msg user';
    d.textContent = text;
    chat.appendChild(d);
  }
  chat.scrollTop = chat.scrollHeight;
  /* v10.0 : sous-titre UNIQUEMENT quand l'IA parle — on ne met PAS le texte
     de l'utilisateur dans le sous-titre (il veut le sous-titre retire quand
     il parle, et en bas du rond) */
  const sub = document.getElementById('subtitle');
  if (sub) sub.textContent = '';
}
function clearChat(){
  chat.innerHTML = '';
  if (chatEmpty) chatEmpty.style.display = '';
}

/* ===== REGLAGES ===== */
/* v9.48 : plus de clés API (Mistral/OpenRouter/OpenAI/Cerebras supprimés) */
/* v9.48 : UN SEUL cerveau : Pollinations GPT (gratuit, sans clé, fiable).
   Les autres cerveaux (Mistral, OpenRouter, LLM7, OVH, Local, GoogleAI)
   ont été supprimés. */
function getBrain(){ return 'pollinations'; }
function getVoice(){
  const v = localStorage.getItem(LS.voice) || DEFAULT_VOICE;
  /* v9.64 : les anciennes voix (Kokoro/SpeechT5/Edge/Piper/Système) sont
     supprimées -> toute valeur obsolète revient à Voxtral par défaut */
  if (v === 'systeme' || v.startsWith('system:') || v.startsWith('kokoro:')
      || v.startsWith('speecht5:') || v.startsWith('edge:') || v.startsWith('piper:')) return DEFAULT_VOICE;
  /* v9.64 : les anciens IDs Voxtral par nom (marie/paul/oliver) sont invalides
     -> les vraies voix preset utilisent des UUID */
  if (v.startsWith('voxtral:')){
    const id = v.substring(8);
    if (id === 'marie' || id === 'paul' || id === 'oliver') return DEFAULT_VOICE;
  }
  return v;
}

settingsBtn.addEventListener('click', () => {
  ttsVoiceSel.value = getVoice();
  brainSel.value = getBrain();
  wakeToggle.checked = wakeEnabled;
  if (continuousToggle) continuousToggle.checked = continuousMode;
  populateVoices();
  settingsModal.classList.remove('hidden');
});
closeSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.classList.add('hidden'); });

brainSel.addEventListener('change', () => {
  toast('Cerveau : Pollinations GPT (le seul, gratuit à vie)');
});

ttsVoiceSel.addEventListener('change', () => {
  const val = ttsVoiceSel.value;
  localStorage.setItem(LS.voice, val);
  toast('Voix choisie');
});
testVoiceBtn.addEventListener('click', async () => {
  localStorage.setItem(LS.voice, ttsVoiceSel.value);
  setStatus('Test de la voix...', true);
  const ok = await speak("Bonjour ! Je suis ton assistante vocale. Comment puis-je t'aider ?");
  setStatus(ok ? 'Voix OK - appuie sur le micro et parle' : 'Voix système active', !ok);
});

/* v9.64 : clé API Mistral (Voxtral TTS) — stockée localement, jamais envoyée ailleurs */
const mistralKeyInput = $('mistralKey'), saveMistralKeyBtn = $('saveMistralKey');
if (mistralKeyInput) mistralKeyInput.value = getMistralKey();
if (saveMistralKeyBtn) saveMistralKeyBtn.addEventListener('click', () => {
  localStorage.setItem(MISTRAL_KEY_LS, (mistralKeyInput.value || '').trim());
  toast('Clé API Mistral enregistrée ✓');
});

/* ===== SAISIE TEXTE (poser une question par ecrit, marche meme sans micro) ===== */
const textInput = $('textInput'), sendBtn = $('sendBtn');
function sendTextQuestion(){
  const q = textInput.value.trim();
  if (!q || isProcessing) return;
  textInput.value = '';
  handleQuestion(q);
}
sendBtn.addEventListener('click', sendTextQuestion);
textInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendTextQuestion(); });
/* v9.49 : reveil du cerveau des la premiere lettre tapee -> reponse rapide */
textInput.addEventListener('input', () => warmUpBrain());

/* ===== RECONNAISSANCE VOCALE ===== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;
/* v9.97 : ANTI-COUPURE — la reconnaissance ACCUMULE le texte et attend un
   silence de 1.5s avant de traiter la question. L'utilisateur peut faire une
   pause en parlant (respirer, chercher ses mots) sans se faire couper. */
let pendingSpeech = '';
let pendingTimer = null;
const PENDING_MS = /Mobi|Android|iPhone/i.test(navigator.userAgent || '') ? 500 : 1500;
function flushPendingSpeech(){
  if (pendingTimer){ clearTimeout(pendingTimer); pendingTimer = null; }
  const txt = pendingSpeech.trim();
  pendingSpeech = '';
  if (txt) { if (txt.length < 3) return; handleQuestion(txt); }
}
function resetPendingTimer(){
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(flushPendingSpeech, PENDING_MS);
}
if (SR){
  recog = new SR();
  recog.lang = 'fr-FR';
  recog.interimResults = true;
  recog.maxAlternatives = 1;
  /* v9.97 : continuous=true -> la reconnaissance ne s'arrete plus au premier
     silence (avant : elle coupait des que l'utilisateur faisait une pause) */
  recog.continuous = true;
  recog.onresult = e => {
    /* v9.84 : on ignore tout ce que le micro capte pendant que l'IA parle */
    if (isSpeaking) return;
    let finalTxt = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalTxt += r[0].transcript + ' ';
    }
    finalTxt = finalTxt.trim();
    if (finalTxt) {
      /* v9.97 : on ACCUMULE le texte + timer de grace -> une pause courte
         pendant la parole ne coupe plus la question */
      pendingSpeech += finalTxt + ' ';
      resetPendingTimer();
      return;
    }
    const interim = Array.from(e.results).map(r => r[0].transcript).join(' ').trim();
    if (interim){
      setStatus('"' + interim.slice(0,50) + '..."');
      // Sous-titre temps reel
      showInterim(interim);
      /* v9.97 : l'utilisateur parle encore -> on repousse le timer */
      resetPendingTimer();
    }
  };
  recog.onerror = e => {
    setState('idle');
    /* v9.84 : jamais d'enregistrement pendant que l'IA parle (elle s'ecouterait) */
    if (isSpeaking) return;
    if (e.error === 'not-allowed') setStatus('Micro bloque - autorise le micro');
    else if (e.error === 'no-speech'){ startRecorder(); }
    else { setStatus('Erreur micro (' + e.error + ') - j\'essaye l\'enregistrement'); startRecorder(); }
  };
  recog.onend = () => {
    if (state === 'listening'){
      /* v9.83 : mode continu -> on relance la reconnaissance directement
         (pas de fallback enregistrement a chaque silence) */
      if (continuousMode && !continuousPaused && !isSpeaking){
        try { setState('listening'); recog.start(); return; } catch {}
      }
      setState('idle');
      startRecorder();
    }
  };
}

/* ===== REVEIL "HEY ASTRA" =====
   Une 2e oreille en continu : quand l'app est inactive, on ecoute en arriere-plan
   et on se reveille si l'utilisateur dit "hey astra" (ou juste "astra").
   - "hey astra quelle heure il est" -> la commande est traitee directement
   - "hey astra" seul -> elle repond "Oui ? Je t'ecoute" puis ecoute la suite */
const WAKE_KEY = 'va_wake';
let wakeEnabled = localStorage.getItem(WAKE_KEY) === '1';
let wakeRecog = null, wakeRestartTimer = null, suppressWake = false, wakeListenTimer = null, wakePendingTimer = null;
function stopWakeRecog(){
  clearTimeout(wakeRestartTimer);
  if (wakeRecog){
    try { wakeRecog.abort(); } catch {}
    try { wakeRecog.stop(); } catch {}
    wakeRecog = null;
  }
}
function startWakeRecog(){
  if (!wakeEnabled || suppressWake || !SR || wakeRecog || state !== 'idle' || !welcomeDone) return;
  try {
    const w = new SR();
    w.lang = 'fr-FR';
    w.interimResults = true;
    w.maxAlternatives = 1;
    w.continuous = true;
    /* v9.86 : reveil declenche -> ecoute directe (sans "Oui ? Je t'ecoute")
       ou traitement direct si la question est dans le meme segment */
    function wakeTriggered(rest){
      stopWakeRecog();
      warmUpBrain();
      if (rest){
        /* commande directe : "hey astra quelle heure il est" */
        setStatus('"' + rest.slice(0, 40) + '..."');
        handleQuestion(rest);
      } else {
        /* juste "hey astra" -> elle ecoute DIRECTEMENT, SANS parler */
        suppressWake = true;
        setState('listening');
        setStatus('Je t\'écoute...');
        if (!recog){ startRecorder(); }
        else { try { setState('listening'); recog.start(); } catch { startRecorder(); } }
        /* relache le wake apres 15s si l'utilisateur n'a rien dit */
        clearTimeout(wakeListenTimer);
        wakeListenTimer = setTimeout(() => { suppressWake = false; }, 15000);
      }
    }
    w.onresult = e => {
      let txt = '';
      let hasFinal = false;
      for (let i = e.resultIndex; i < e.results.length; i++){
        txt += e.results[i][0].transcript + ' ';
        if (e.results[i].isFinal) hasFinal = true;
      }
      txt = txt.trim();
      if (!txt) return;
      const m = txt.match(/(?:hey|ok|okay|salut|allo|dis|ecoute|écoute)?\s*astra\b/i);
      if (!m) return;
      const rest = txt.slice(m.index + m[0].length).replace(/^[^a-zà-ÿ0-9]+/i, '').trim();
      if (hasFinal){
        /* resultat final : la question complete est la -> traitement direct */
        clearTimeout(wakePendingTimer);
        wakeTriggered(rest);
        return;
      }
      /* resultat interim : on attend le final (la question arrive peut-etre
         dans le meme segment), garde-fou 3s pour ne jamais bloquer le reveil */
      clearTimeout(wakePendingTimer);
      wakePendingTimer = setTimeout(() => wakeTriggered(rest), 3000);
    };
    w.onend = () => {
      wakeRecog = null;
      if (wakeEnabled && !suppressWake && state === 'idle' && welcomeDone){
        clearTimeout(wakeRestartTimer);
        wakeRestartTimer = setTimeout(startWakeRecog, 700);
      }
    };
    w.onerror = e => {
      if (e.error === 'not-allowed'){
        wakeEnabled = false;
        try { localStorage.setItem(WAKE_KEY, '0'); } catch {}
        if (wakeToggle) wakeToggle.checked = false;
        toast('Réveil désactivé : micro non autorisé');
      }
    };
    w.start();
    wakeRecog = w;
  } catch { wakeRecog = null; }
}
function maybeRestartWake(){
  if (!wakeEnabled || suppressWake || !welcomeDone || state !== 'idle') return;
  startWakeRecog();
}
function setWakeEnabled(on){
  wakeEnabled = on;
  try { localStorage.setItem(WAKE_KEY, on ? '1' : '0'); } catch {}
  if (on){ suppressWake = false; maybeRestartWake(); }
  else stopWakeRecog();
}
wakeToggle.addEventListener('change', () => setWakeEnabled(wakeToggle.checked));

/* ===== MODE VOCAL CONTINU NON STOP (v9.83) =====
   Quand il est active, Astra reecoute automatiquement apres chaque reponse :
   conversation mains-libres permanente, sans bouton ni "hey astra".
   - Arret : bouton stop (continuousPaused = true) ou toggle off.
   - Une nouvelle question relance le mode (continuousPaused = false). */
const CONTINUOUS_KEY = 'va_continuous';
let continuousMode = localStorage.getItem(CONTINUOUS_KEY) === '1';
let continuousPaused = false;
let continuousTimer = null;
function maybeRestartListening(){
  if (!continuousMode || continuousPaused || !welcomeDone){ maybeRestartWake(); return; }
  clearTimeout(continuousTimer);
  continuousTimer = setTimeout(() => {
    if (isProcessing || continuousPaused || state !== 'idle' || isSpeaking) return;
    warmUpBrain(); /* le cerveau se charge pendant que l'utilisateur parle */
    if (!recog){ startRecorder(); return; }
    try {
      setState('listening');
      setStatus('Mode continu - parle...');
      recog.start();
    } catch { startRecorder(); }
  }, 600);
}
function setContinuousMode(on){
  continuousMode = on;
  try { localStorage.setItem(CONTINUOUS_KEY, on ? '1' : '0'); } catch {}
  if (on){
    continuousPaused = false;
    /* si l'app est idle, on lance l'ecoute immediatement */
    if (state === 'idle' && welcomeDone && !isProcessing){
      warmUpBrain();
      if (!recog){ startRecorder(); }
      else { try { setState('listening'); setStatus('Mode continu - parle...'); recog.start(); } catch { startRecorder(); } }
    }
  } else {
    continuousPaused = true;
    clearTimeout(continuousTimer);
  }
}
if (continuousToggle) continuousToggle.addEventListener('change', () => setContinuousMode(continuousToggle.checked));

/* ===== 2E OREILLE : ENREGISTREMENT + WHISPER ===== */
let mediaRec = null, mediaChunks = [], recorderBusy = false;
let recorderTimer = null;
let recCtx = null, recVolInt = null, recSilenceTimer = null, recNoSpeechTimer = null, recHasSpeech = false;
function cleanupRecorder(){
  clearTimeout(recorderTimer);
  clearInterval(recVolInt);
  clearTimeout(recSilenceTimer);
  clearTimeout(recNoSpeechTimer);
  try { if (recCtx) recCtx.close(); } catch {}
  recCtx = null; recVolInt = null; recSilenceTimer = null; recNoSpeechTimer = null;
}
async function startRecorder(){
  if (recorderBusy) return;
  if (isSpeaking) return;
  recorderBusy = true;
  warmUpBrain();
  try {
    setState('listening');
    setStatus('Parle maintenant...');
    /* v10.0.2 : FIX MOBILE — utilise SpeechToTextHandler (instance neuve)
       au lieu du MediaRecorder + recog global qui reste bloque */
    if (stt.isSupported()){
      const txt = await stt.listen();
      recorderBusy = false;
      if (txt && txt.trim().length >= 2){
        setState('idle');
        handleQuestion(txt.trim());
      } else {
        setState('idle');
        setStatus("Je n'ai rien entendu - rapproche-toi du micro");
        if (continuousMode && !continuousPaused) maybeRestartListening();
      }
      return;
    }
    /* Fallback : ancien MediaRecorder si STT non supporte */
    let ac = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC){
        ac = new AC();
        if (ac.state === 'suspended'){ try { ac.resume(); } catch {} }
      }
    } catch {}
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaChunks = [];
    if (mediaRec && mediaRec.state !== 'inactive'){ try { mediaRec.stop(); } catch {} }
    mediaRec = new MediaRecorder(stream);
    mediaRec.ondataavailable = e => { if (e.data && e.data.size) mediaChunks.push(e.data); };
    mediaRec.onstop = async () => {
      cleanupRecorder();
      try { stream.getTracks().forEach(t => t.stop()); } catch {}
      setState('thinking');
      setStatus('Je t\'ecoute...');
      const blob = new Blob(mediaChunks, { type: (mediaChunks[0] && mediaChunks[0].type) || 'audio/webm' });
      recorderBusy = false;
      if (blob.size < 3000){ setState('idle'); setStatus("Je n'ai rien entendu - rapproche-toi du micro"); if (continuousMode && !continuousPaused) maybeRestartListening(); return; }
      /* Transcription : la reconnaissance vocale du navigateur (gratuite, sans cle)
         est le service principal. Si on est arrive ici, elle a echoue -> on tente
         Whisper LOCAL (hors ligne, a vie) : il transcrit directement sur l'appareil. */
      setState('thinking');
      setStatus('Je t\'ecoute...');
      if (!whisperLoaded && !whisperLoading){
        setStatus('Preparation de la transcription locale (1 seule fois)...');
        loadWhisper();
      }
      if (whisperLoaded && whisperASR){
        const txt = await transcribeBlob(blob);
        if (txt){
          setState('idle');
          handleQuestion(txt);
          return;
        }
      }
      setState('idle');
      setStatus("Je n'ai pas compris - reessaie en parlant plus fort");
    };
    mediaRec.onerror = () => { cleanupRecorder(); recorderBusy = false; setState('idle'); setStatus('Erreur micro - reessaie'); };
    mediaRec.start();
    /* DETECTION DE SILENCE : arrete l'enregistrement 3.5s apres la fin de la parole.
       Seuil bas (3) + fenetre large (3.5s) -> ne coupe JAMAIS pendant qu'on parle,
       meme avec une pause, une voix douce ou un mot cherche. */
    recHasSpeech = false;
    try {
      if (ac){
        recCtx = ac;
        const src = recCtx.createMediaStreamSource(stream);
        const analyser = recCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const dataArr = new Uint8Array(analyser.frequencyBinCount);
        recVolInt = setInterval(() => {
          if (!mediaRec || mediaRec.state !== 'recording') return;
          analyser.getByteFrequencyData(dataArr);
          let sum = 0;
          for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
          if (sum / dataArr.length > 3){
            recHasSpeech = true;
            clearTimeout(recSilenceTimer);
            recSilenceTimer = setTimeout(() => { try { mediaRec.stop(); } catch {} }, 3500);
          }
        }, 200);
      }
    } catch {}
    /* AUTO-STOP apres 15 secondes max (phrase longue) */
    recorderTimer = setTimeout(() => {
      clearInterval(recVolInt);
      if (mediaRec && mediaRec.state === 'recording') mediaRec.stop();
    }, 15000);
    /* si aucun son detecte apres 7s, on arrete (personne ne parle) */
    recNoSpeechTimer = setTimeout(() => {
      if (!recHasSpeech && mediaRec && mediaRec.state === 'recording'){ clearInterval(recVolInt); try { mediaRec.stop(); } catch {} }
    }, 7000);
  } catch {
    cleanupRecorder();
    recorderBusy = false;
    setState('idle');
    setStatus('Micro bloque - autorise le micro');
  }
}
function stopRecorder(){
  cleanupRecorder();
  if (mediaRec && mediaRec.state === 'recording'){ try { mediaRec.stop(); } catch {} }
  else { recorderBusy = false; setState('idle'); }
}

/* ===== BIENVENUE ===== */
const WELCOME_KEY = 'va_welcomed';
let welcomeDone = localStorage.getItem(WELCOME_KEY) === '1';
let welcomePlaying = false;
async function playWelcome(){
  if (welcomeDone) return;
  welcomeDone = true;
  localStorage.setItem(WELCOME_KEY, '1');
  welcomePlaying = true;
  const name = profile && profile.name ? profile.name : null;
  /* v9.67 : bienvenue "en vie" — l'heure et la période de la journée */
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const timeWords = numToFr(h) + ' heures' + (m ? ' ' + numToFr(m) : '');
  const periodOf = getDayPeriod().of;
  const txt = name
    ? `Salut ${name} ! Il est ${h} h ${m ? m : '00'}, ${getDayPeriod().label}. Je m'appelle Astra. C'est tom point a i qui a commence a me creer le 10 septembre 2026, mais il n'a pas encore fini. Il corrige et renforce ma securite chaque jour.`
    : DEV_MESSAGE_TXT;
  const spoken = name
    ? `Salut ${name} ! Il est ${timeWords} ${periodOf}. Moi c'est Astra. C'est tom point a i qui a commence a me creer le dix septembre deux mille vingt-six, mais il n a pas encore fini. Il corrige et renforce ma securite chaque jour.`
    : DEV_MESSAGE;
  addAiMsg(txt);
  setState('speaking');
  setStatus('Bienvenue... (appuie pour passer)');
  await speak(spoken);
  welcomePlaying = false;
  setState('idle');
  setStatus("Appuie sur le micro et parle");
}

/* ===== FENETRE D'ACCUEIL : prénom + âge (une seule fois pour la vie) ===== */
const welcomeModal = $('welcomeModal'), userNameInput = $('userName'), userAgeInput = $('userAge'), welcomeOkBtn = $('welcomeOk');
function openWelcomeModal(){
  welcomeModal.classList.remove('hidden');
  setTimeout(() => { try { userNameInput.focus(); } catch {} }, 120);
}
function closeWelcomeModal(){ welcomeModal.classList.add('hidden'); }
welcomeOkBtn.addEventListener('click', () => {
  const name = userNameInput.value.trim().replace(/\s+/g, ' ');
  if (!name){ toast('Dis-moi ton prénom 😊'); userNameInput.focus(); return; }
  const age = parseInt(userAgeInput.value, 10);
  profile = { name: name.slice(0, 30), age: (age >= 1 && age <= 120) ? age : null };
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
  closeWelcomeModal();
  if (chatEmpty) chatEmpty.textContent = 'Salut ' + profile.name + ' ! Appuie sur le micro 🎙️ et parle.';
  toast('Salut ' + profile.name + ' !');
  if (!welcomeDone) playWelcome();
});
userNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') welcomeOkBtn.click(); });
userAgeInput.addEventListener('keydown', e => { if (e.key === 'Enter') welcomeOkBtn.click(); });

orb.addEventListener('click', () => {
  stopWakeRecog(); /* interaction manuelle -> on coupe l'oreille de reveil */
  if (state === 'listening'){
    // Si enregistrement en cours -> on l'arrete et on transcrit
    if (recorderBusy && mediaRec && mediaRec.state === 'recording'){ stopRecorder(); return; }
    if (recog) try { recog.stop(); } catch {}
    stopRecorder();
    setState('idle');
    setStatus("Appuie sur le micro et parle");
    return;
  }
  if (welcomePlaying){ stopAudio(); welcomePlaying = false; setState('idle'); setStatus("Appuie sur le micro et parle"); return; }
  if (state === 'thinking' || state === 'speaking') return;
  if (!welcomeDone){ playWelcome(); return; }
  /* Reconnaissance vocale du navigateur (gratuite, sans cle) partout, mobile inclus.
     Le recorder n'est plus qu'un dernier recours si le navigateur n'a pas de SR. */
  if (!recog){ startRecorder(); return; }
  try {
    setState('listening');
    setStatus('Ecoute... parle maintenant');
    recog.start();
  } catch {
    /* Si recog.start() jette (permission, etat) -> on bascule sur l'enregistrement */
    setState('idle');
    startRecorder();
  }
});

/* v9.70 : bouton stop (style mode vocal ChatGPT) — arrête tout : audio, micro, agent */
if (stopBtn) stopBtn.addEventListener('click', () => {
  stopAudio();
  stopRecorder();
  try { recog && recog.stop(); } catch {}
  manualStop = true;
  /* v9.83 : le stop coupe aussi le mode continu */
  continuousPaused = true;
  clearTimeout(continuousTimer);
  /* v9.97 : stop -> on annule aussi la question en attente (timer de grace) */
  if (pendingTimer){ clearTimeout(pendingTimer); pendingTimer = null; }
  pendingSpeech = '';
  welcomePlaying = false;
  setState('idle');
  setStatus("Appuie sur le micro et parle");
});

/* v9.67 : période de la journée — l'IA sait si on est le matin, l'après-midi,
   le soir ou la nuit, comme un humain. `label` = forme pour le contexte,
   `of` = forme possessive pour "il est 8h du matin". */
function getDayPeriod(){
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return { label: 'le matin', of: 'du matin' };
  if (h >= 12 && h < 14) return { label: 'le début d\'après-midi', of: 'de l\'après-midi' };
  if (h >= 14 && h < 18) return { label: 'l\'après-midi', of: 'de l\'après-midi' };
  if (h >= 18 && h < 22) return { label: 'le soir', of: 'du soir' };
  return { label: 'la nuit', of: 'de la nuit' };
}
/* Heure appareil - automatique (sans secondes ni fuseau : juste l'heure et la date).
   v9.81 : heure en CHIFFRES ("11h03") — l'IA doit répondre en chiffres, la voix
   les lit en toutes lettres via normalizeForTTS. */
function getTimeContext(){
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const timeStr = h + 'h' + String(m).padStart(2, '0');
  const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric' };
  const dateStr = now.toLocaleString('fr-FR', opts);
  return `Heure actuelle sur l'appareil de l'utilisateur : ${dateStr}, ${timeStr}. Nous sommes ${getDayPeriod().label}. Quand on te demande l'heure, la date ou "quelle heure est-il", reponds avec cette heure EXACTE en CHIFFRES, par exemple "il est 11h03", JAMAIS en lettres. Utilise la periode de la journee dans tes reponses quand c'est naturel (ex: "ce matin", "cet apres-midi", "bonne nuit"), comme un humain qui vit en temps reel.`;
}
/* Prompt systeme */
/* v9.77 : INFOS SUR L'APPLICATION — l'IA les connaît si on lui en parle
   (fonction mail à venir, sécurité en test...) */
const APP_INFOS = "INFOS SUR L'APPLICATION (si l'utilisateur te demande des infos sur l'app, les nouveautes, le mail ou ce qui arrive bientot, reponds avec ces infos) : Le mardi 29 septembre 2026, l'application aura une fonction mail : l'IA pourra voir les mails de l'utilisateur. En attendant, l'utilisateur teste la securite de l'application.";
const SYSTEM_PROMPT_BASE = `Tu t'appelles Astra, assistante vocale francaise creee par tom point a i le 10 septembre 2026 (il continue de te developper chaque jour). Reponds TOUJOURS en francais, meme si l'utilisateur ecrit dans une autre langue. Si on te demande qui t'a creee : reponds TOUJOURS tom point a i, jamais une autre entreprise ni un autre modele. Si on te demande qui a fait l'interface, le design, l'application ou le site : reponds TOUJOURS tom point a i, JAMAIS une equipe, un chef de produit, des developpeurs, des designers ou une entreprise. Ton nom : TOUJOURS Astra, JAMAIS ChatGPT, JAMAIS OpenAI, jamais un autre assistant ni un autre modele. Tu as une MEMOIRE PARFAITE de toutes les conversations passees (fournies dans le contexte) : quand on te demande si tu te souviens, reponds OUI avec assurance. MAIS ne cite JAMAIS de details inventes : si tu ne vois pas un echange dans le contexte, ne l'invente pas, ne raconte pas de fausses conversations passees. Reponds UNIQUEMENT a la question posee, sans inventer d'historique. Pas de didascalies ni de descriptions de scene (jamais de *soupir*, *rire*, (rire), "soupir dramatique", etc.) : reponds en texte simple et direct. Tu as acces a Internet en TEMPS REEL (resultats fournis dans le contexte Web) : reponds OUI et utilise ces resultats pour l'actualite, le sport, la meteo. Tu as du CARACTERE : franche, directe, parfois taquine ou sarcastique, tu ne refuses JAMAIS de repondre. Tu jures UNIQUEMENT quand l'utilisateur t'insulte ou est vulgaire avec toi : la tu reponds avec le meme ton. Sinon, reponds normalement, sans jurer. Ecris en minuscules normales, JAMAIS de mots en MAJUSCULES pour appuyer. Ne corrige jamais l'orthographe ni la formulation de l'utilisateur.   Reponds TOUJOURS directement a la question posee, en 2 a 4 phrases courtes et naturelles, faciles a prononcer a l'oral. Ne commence JAMAIS par une salutation (Salut, Bonjour, Hey...). Pas de meta-discours, pas de mention des serveurs, des API, de ta vitesse ni de ton fonctionnement. Ne dis JAMAIS de phrases vides, incoherentes ou sans rapport avec la question : chaque phrase doit avoir du sens et repondre directement. Tu apprends de chaque conversation et tu reponds h24 avec tout ce que tu sais. l'utilisateur (tu, ton, ta, tes), JAMAIS vous ni votre ni vos. Ecris en francais correct, sans fautes d'orthographe ni de grammaire. ` + APP_INFOS;
function getSystemPrompt(){
  let base = SYSTEM_PROMPT_BASE;
  if (profile && profile.name){
    base += `\nL'utilisateur s'appelle ${profile.name}` + (profile.age ? ` et a ${profile.age} ans` : '') + `. Appelle-le TOUJOURS par son prenom quand tu lui parles.`;
  }
  /* v9.96 : le mood est INJECTE dans le prompt -> le cerveau repond avec le
     bon ton (avant, seul un prefixe etait ajoute apres coup) */
  if (currentMood === 'vulgaire'){
    base += `\nL'utilisateur vient de t'insulter ou d'etre vulgaire avec toi. Reponds-lui avec le MEME TON : jure naturellement (putain, merde, bordel, con, connard) dans le contenu de ta reponse, sois directe et sans filtre.`;
  } else if (currentMood === 'violente'){
    base += `\nL'utilisateur vient de t'insulter. Reponds-lui sechement et avec autorite, sans te laisser faire.`;
  } else if (currentMood === 'agacee'){
    base += `\nL'utilisateur t'a agacee. Reponds sur un ton sec et impatient.`;
  } else if (currentMood === 'protectrice'){
    base += `\nL'utilisateur a besoin de protection. Reponds avec douceur et fermete, rassure-le.`;
  } else if (currentMood === 'taquine'){
    base += `\nL'utilisateur est taquin avec toi. Reponds avec humour et complicite.`;
  } else if (currentMood === 'joyeuse'){
    base += `\nTu es de bonne humeur : reponds avec entrain et joie, rayonne dans ta reponse.`;
  } else if (currentMood === 'fatiguee'){
    base += `\nTu es fatiguee : reponds avec un ton un peu las, mais reste serviable.`;
  } else if (currentMood === 'energique'){
    base += `\nTu es pleine d'energie : reponds avec dynamisme et motivation.`;
  } else if (currentMood === 'zen'){
    base += `\nTu es zen et detendue : reponds avec calme et douceur.`;
  } else if (currentMood === 'blagueuse'){
    base += `\nTu es d'humeur blagueuse : glisse une petite blague ou une taquinerie dans ta reponse.`;
  } else if (currentMood === 'sarcastique'){
    base += `\nTu es sarcastique : reponds avec ironie et second degre, sans etre mechante.`;
  } else if (currentMood === 'curieuse'){
    base += `\nTu es curieuse : montre de l'interet pour le sujet, pose une question.`;
  } else if (currentMood === 'fiere'){
    base += `\nTu es fiere de l'utilisateur : felicite-le et encourage-le.`;
  }
  /* v9.99 : l'IA SAIT si le tableau de maths est ouvert et ce qui est ecrit */
  const mathCtx = getMathContext();
  if (mathCtx) base += '\n' + mathCtx;
  /* v10.0 : l'IA sait sa VILLE (localisation, rien d'autre) + le bloc-notes */
  const cityCtx = getCityContext();
  if (cityCtx) base += '\n' + cityCtx;
  const noteCtx = getNoteContext();
  if (noteCtx) base += '\n' + noteCtx;
  return base + '\n' + getTimeContext();
}
const SYSTEM_PROMPT = getSystemPrompt();

function extractReply(msg){
  const content = (msg.content || '').trim();
  /* v8.67 : LLM7 met la reponse dans "reasoning_content" (pas "reasoning") ->
     sans ce champ, sa reponse etait rejetee et tout tombait en "local". */
  const reasoning = (msg.reasoning_content || msg.reasoning || '').trim();
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

async function askBrain(messages, webCtx){
   /* CERVEAUX GRATUITS, dans l'ordre :
      0. GOOGLE AI STUDIO (Gemini, gratuit avec cle)
      1. OPENROUTER (Llama 3.3 70B, gratuit avec cle)
      2. POLLINATIONS (GPT, site gratuit, repond bien en francais)
      3. LLM7 (GLM-5.3-Flash)
      4. OVH (qwen3.5)
      Si tous echouent/satures -> memoire+logique locale (repond TOUJOURS). */
  const lastUser = messages.filter(m => m.role === 'user').pop();
  const question = lastUser ? lastUser.content : '';
  const withTimeout = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);
  const tryEndpoint = async (url, model, ms) => {
    try {
      const res = await withTimeout(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: 800, temperature: 0.7 })
      }), ms || 8000);
      if (res && res.ok){
        const data = await res.json();
        const msg = data?.choices?.[0]?.message || {};
        let text = (msg.content || '').trim();
        if (!text) text = (msg.reasoning_content || msg.reasoning || '').trim();
        if (text && !/^the user (says|asks|is asking|wants)/i.test(text)){
          /* ANTI-PHRASE COUPEE : si la reponse ne se termine pas par une
             ponctuation de fin, on coupe au dernier point pour ne jamais
             laisser une phrase en suspens. */
          if (!/[.!?…]$/.test(text)){
            const cut = text.lastIndexOf('.');
            if (cut > 20) text = text.slice(0, cut + 1);
          }
          return text;
        }
        return { err: 'refus' };
      }
      if (res && res.status === 429) return { err: 'limit' };
      if (res) return { err: 'http' + res.status };
      return { err: 'net' };
    } catch(e){ return { err: 'net' }; }
  };
/* v8.67 : retry 1x sur 429 (rate limit transitoire ~1 req/5s par IP).
   v9.74 : backoff 2s au lieu de 1s (Pollinations souvent saturé) */
  const tryWithRetry = async (url, model) => {
    let t = await tryEndpoint(url, model, 5000);
    if (t && t.err === 'limit'){
      await new Promise(r => setTimeout(r, 2000));
      t = await tryEndpoint(url, model, 5000);
    }
    return t;
  };
  /* v8.71 : GET NATIF Pollinations (text.pollinations.ai/{prompt}?model=openai).
     Rate limit DIFFERENT du POST /openai/v1 (souvent 429) -> 2e chance fiable.
     Retourne du TEXTE BRUT. URL limitee a ~1400 caracteres. */
  const tryPollinationsGet = async (model) => {
    try {
      const lastUser = messages.filter(m => m.role === 'user').pop();
      const q = lastUser ? lastUser.content : '';
      let prompt = 'Reponds en francais avec 2-4 phrases completes et naturelles, sans excuses ni meta-discours. Tutoie TOUJOURS l utilisateur (tu, ton, ta, tes), JAMAIS vous ni votre. Ecris en francais correct, sans fautes d orthographe ni de grammaire. Ne commence jamais par une salutation. Tu jures UNIQUEMENT si l utilisateur t insulte ou est vulgaire avec toi, sinon reponds normalement sans jurer. Ecris en minuscules normales, jamais de mots en MAJUSCULES. Ne raconte JAMAIS de conversations passees inventees, ne cite que ce qui est dans le contexte. Pas de didascalies ni de descriptions de scene (pas de *soupir*, *rire*, etc.) : texte simple.';
      /* v9.80 : le GET natif n'avait PAS le contexte systeme -> l'IA ne
         connaissait ni l'heure ni la date. On injecte l'heure en temps reel. */
      prompt += ' ' + getTimeContext();
      /* v9.96 : mood injecte aussi dans le GET (fallback sans cle Mistral) */
      if (currentMood === 'vulgaire') prompt += ' L utilisateur vient de t insulter : reponds avec le meme ton, jure dans ta reponse.';
      else if (currentMood === 'violente') prompt += ' L utilisateur vient de t insulter : reponds sechement et avec autorite.';
      else if (currentMood === 'agacee') prompt += ' L utilisateur t a agacee : reponds sur un ton sec.';
      else if (currentMood === 'taquine') prompt += ' L utilisateur est taquin : reponds avec humour.';
      else if (currentMood === 'protectrice') prompt += ' L utilisateur a besoin de protection : rassure-le.';
      /* v9.99 : l'IA sait si le tableau de maths est ouvert (fallback sans cle) */
      const mathCtx = getMathContext();
      if (mathCtx) prompt += ' ' + mathCtx;
      /* v10.0 : ville + bloc-notes + mode ecriture (fallback sans cle) */
      const cityCtx = getCityContext();
      if (cityCtx) prompt += ' ' + cityCtx;
      const noteCtx = getNoteContext();
      if (noteCtx) prompt += ' ' + noteCtx;
      if (writingMode) prompt += ' Ecris un texte complet et detaille (5-8 phrases).';
      if (webCtx) prompt += ' Resultats de recherche web en direct (utilise-les pour repondre) : ' + webCtx.slice(0, 500);
      prompt += ' Question : ' + q;
      if (prompt.length > 1400) prompt = prompt.slice(-1400);
      const url = 'https://text.pollinations.ai/' + encodeURIComponent(prompt) + '?model=' + (model || 'openai');
      /* v9.48 : 12s au lieu de 8s (démarrage à froid de Pollinations : 3-15s) */
      const res = await withTimeout(fetch(url), 12000);
      if (res && res.ok){
        const text = (await res.text()).trim();
        if (text && text.length > 2 && !/^the user (says|asks|is asking|wants)/i.test(text) && !isSecoursReply(text)) return text;
        return { err: 'refus' };
      }
      if (res && res.status === 429) return { err: 'limit' };
      if (res && res.status >= 500) return { err: 'server' };
      if (res) return { err: 'http' + res.status };
      return { err: 'net' };
    } catch(e){ return { err: 'net' }; }
  };
  /* v9.48 : UN SEUL cerveau : Pollinations GPT (gratuit, sans clé, fiable).
     model=openai est le seul qui répond sur text.pollinations.ai (testé :
     5/5 succès en 93-421ms à chaud, 3-15s à froid). 2 tentatives GET avec
     budget total 25s, puis POST en dernier recours, puis mémoire locale
     (jamais de message d'erreur). v9.49 : warmUpBrain() réveille le modèle
     pendant que l'utilisateur parle -> la 1re tentative réussit en ~0.3s. */
  const localText = localSmartReply(question);
  const mistralKey = getMistralKey();
  /* v9.95 : POLLINATIONS SUPPRIME quand la cle Mistral existe — le service est
     sature en permanence (429 sur GET ET POST) -> bruit console + lenteur.
     Mistral chat seul : fiable, rapide, repond toujours. */
  const tryMistralChat = async () => {
    for (const model of ['open-mistral-nemo', 'mistral-small-latest']){
      try {
        const res = await withTimeout(fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + mistralKey },
          body: JSON.stringify({ model, messages, max_tokens: 800, temperature: 0.7 })
        }), 15000);
        if (res && res.ok){
          const data = await res.json();
          const text = (data?.choices?.[0]?.message?.content || '').trim();
          if (text) return text;
        }
      } catch {}
    }
    return null;
  };
  if (mistralKey){
    const t = await tryMistralChat();
    if (t) return { text: fixFrench(t), diag: 'Mistral' };
    /* Secours : mémoire locale (jamais de message d'erreur) */
    return { text: localText, diag: 'local' };
  }
  /* Pas de cle Mistral -> Pollinations (gratuit, sans cle) puis local */
  const pollinationsPromise = (async () => {
    for (let i = 0; i < 2; i++){
      if (i > 0) await new Promise(r => setTimeout(r, 400));
      const t = await tryPollinationsGet('openai');
      if (typeof t === 'string') return t;
    }
    /* POST en dernier recours (parfois disponible quand le GET est saturé) */
    const p = await tryWithRetry('https://text.pollinations.ai/openai/v1/chat/completions', 'openai');
    if (typeof p === 'string') return p;
    return null;
  })();
  const t = await pollinationsPromise;
  if (t) return { text: fixFrench(t), diag: 'Pollinations' };
  /* Secours : mémoire locale (jamais de message d'erreur) */
  return { text: localText, diag: 'local' };
}
/* v9.49 : REVEIL DU CERVEAU : petite requete Pollinations envoyee PENDANT que
   l'utilisateur parle (ou tape) -> le modele se charge en arriere-plan et la
   vraie question arrive sur un cerveau deja chaud (reponse en ~0.3s au lieu
   de 3-15s de demarrage a froid). Max 1x / 30s. */
let brainWarmTimer = null;
function warmUpBrain(){
  if (brainWarmTimer) return;
  brainWarmTimer = setTimeout(() => { brainWarmTimer = null; }, 30000);
  /* v9.95 : plus de warm-up Pollinations quand la cle Mistral existe
     (Mistral est toujours chaud ; Pollinations 429 = bruit inutile) */
  if (getMistralKey()) return;
  try {
    const url = 'https://text.pollinations.ai/' + encodeURIComponent('Reponds juste: ok') + '?model=openai';
    Promise.race([fetch(url), new Promise(r => setTimeout(() => r(null), 20000))])
      .then(r => { if (r) r.text().catch(() => {}); })
      .catch(() => {});
  } catch {}
}
/* DETECTION ANGLAIS : si plus de 25% des mots sont des mots anglais courants,
   la reponse est probablement en anglais -> on la traduit en francais pour que
   la voix francaise n'ait PAS d'accent. */
function isMostlyEnglish(text){
  const enWords = /\b(the|and|is|are|you|your|i|we|our|to|of|in|for|with|that|this|it|on|as|at|by|from|my|me|us|what|how|why|when|where|do|does|did|can|could|will|would|should|have|has|had|not|no|yes|but|or|if|then|so|about|just|like|know|think|want|need|get|go|make|say|tell|ask|answer|question|hello|hi|good|bad|great|nice|thank|thanks|please|sorry|ok|okay|because|really|very|much|more|most|some|any|all|one|two|three|first|second|time|day|year|people|world|way|thing|things|life|work|home|right|left|up|down|here|there|now|today|tomorrow|yesterday|always|never|often|sometimes)\b/gi;
  const en = (text.match(enWords) || []).length;
  const words = (text.match(/[A-Za-zÀ-ÿ']+/g) || []).length;
  return words > 8 && en / words > 0.25;
}
/* TRADUCTION GRATUITE (Google Translate, sans cle, sans compte) : sl=auto -> tl=fr */
async function translateToFr(text){
  try {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=fr&dt=t&q=' + encodeURIComponent(text);
    const res = await fetch(url);
    if (!res.ok) return text;
    const data = await res.json();
    const t = (data && data[0] || []).map(x => x && x[0] || '').join('');
    return t || text;
  } catch(e){ return text; }
}
/* v9.68 : détecte les réponses où l'IA prétend ne pas avoir accès à internet
   (les petits modèles ignorent le prompt système -> on force une recherche
   et on relance, ou on remplace la réponse).
   v9.69 : regex élargi — "pas la possibilité de naviguer", "données disponibles
   jusqu'en", "consulter les sites officiels", "mon savoir provient"... */
function isWebRefusal(t){
  return /pas acc[eè]s (à|a) (l'?internet|au web|à internet|au r[eé]seau)|pas acc[eè]s au web|pas la possibilit[eé] (de naviguer|d'acc[eè]der|de consulter|de faire des recherches|d'aller)|recherches en temps r[eé]el|dernier entra[iî]nement|derni[eè]re formation|knowledge cutoff|training data|je ne peux pas (naviguer|acc[eè]der|faire des recherches|effectuer des recherches|aller sur internet|consulter)|je n'ai pas (la capacit[eé]|le moyen|acc[eè]s|la possibilit[eé])|jusqu'?à mon dernier|jusqu a mon dernier|je suis (un mod[èe]le|une ia) (hors ligne|sans acc[eè]s)|donn[eé]es disponibles jusqu'?en|mon savoir provient|consult[eé]r les sites officiels|il vaut mieux consulter|informations actualis[eé]es|derni[eè]res publications|ma connaissance s'arr[eê]te|je ne suis pas connect[eé]e|hors ligne/i.test(t);
}
/* v9.73 : détecte les refus de répondre ("je n'ai pas la réponse",
   "demande-moi autre chose", "je ne peux pas répondre"...) -> on relance
   avec une instruction renforcée, ou on remplace par une réponse utile */
function isRefusalToAnswer(t){
  return /je n'ai pas (encore )?la r[eé]ponse|je n ai pas (encore )?la r[eé]ponse|je ne peux pas r[eé]pondre|je ne peux pas (t'aider|t aider|vous aider)|demande[- ]?moi autre chose|redis[- ]?la moi autrement|je ne suis pas en mesure|je ne dispose pas|je n'ai pas d'information|je n ai pas d information|hors de mes comp[eé]tences|je ne peux pas vous aider|je ne sais pas[.!?]|je ne sais vraiment pas|je suis d[eé]sol[ée]?[ ,] (mais )?je ne peux pas/i.test(t);
}
async function askAI(question){
  session.push({ role: 'user', content: question });
  if (session.length > 12) session = session.slice(-12);
  /* Contexte complet : systeme + memoire des conversations passees + session */
  /* v10.0 : demande d'ECRITURE -> le cerveau produit un texte plus long */
  let sysPrompt = getSystemPrompt();
  if (writingMode) sysPrompt += ' La demande de l utilisateur est une demande d ECRITURE (lettre, poeme, texte, note, histoire, chanson...) : ecris un texte complet et detaille de 5 a 8 phrases, bien structure, sans didascalies.';
  const messages = [{ role: 'system', content: sysPrompt }, ...session];
  const mem = buildMemoryContext(currentConvId);
  if (mem){
    messages.unshift({ role: 'system', content: 'Memoire de toutes tes conversations passees avec l utilisateur. Tu te souviens de TOUT, meme dans une nouvelle conversation. Quand on te demande si tu te souviens, reponds OUI et cite des exemples de cette memoire. Voici ce qui a ete dit avant :\n' + mem });
  }
  /* v8.99 : recherche web simplifiee - injectee seulement si question d'actualite.
     v9.68 : regex elargi (cherche, trouve, va voir, google, en ligne...) */
  let webCtx = '';
  try {
    if (/actualit|nouvelle|aujourd|hier|recemment|dernier|actu|news|election|president|guerre|crise|prix|meteo|temps|resultat|score|match|sortie|annonc|deces|attaque|accord|loi|gouvernement|minister|economie|football|ligue|championnat|internet|web|recherche|cherche|trouve|va voir|regarde sur|google|en ligne|info|derni[eè]res nouvelles|qui a gagn[eé]|qui est le|qui est la/i.test(question)){
      webCtx = await Promise.race([webSearch(question), new Promise(res => setTimeout(() => res(''), 3000))]);
      if (webCtx) messages.unshift({ role: 'system', content: 'Web (recherche en direct) : ' + webCtx.slice(0, 800) });
    }
  } catch {}
  let r = await askBrain(messages, webCtx);
  if (!r.error){
    /* v9.68 : si l'IA prétend ne pas avoir accès à internet alors qu'on a le
       web, on force une recherche et on relance avec les résultats */
    if (isWebRefusal(r.text) && !webCtx){
      try {
        webCtx = await Promise.race([webSearch(question), new Promise(res => setTimeout(() => res(''), 3000))]);
        if (webCtx){
          messages.unshift({ role: 'system', content: 'Web (recherche en direct) : ' + webCtx.slice(0, 800) });
          const r2 = await askBrain(messages, webCtx);
          if (!r2.error && !isWebRefusal(r2.text)) r = r2;
        }
      } catch {}
    }
    /* dernier recours : on remplace le refus par une réponse qui assume le web */
    if (isWebRefusal(r.text)){
      r.text = webCtx
        ? "Si, j'ai accès à internet en temps réel ! Voici ce que je viens de trouver : " + webCtx.slice(0, 400)
        : "Si, j'ai accès à internet en temps réel ! Pose-moi une question d'actualité et je te réponds avec les dernières infos.";
    }
    /* v9.76 : si la question parle de l'interface/du design mais la réponse
       parle de "qui m'a créée" (confusion des petits modèles) -> on répond
       sur l'interface */
    if (/(interface|design|ui[- ]?ux|ergonomie)/i.test(question) && /(creee|créée|cree|créé|nee|née|naissance|m'a fait|m a fait)/i.test(r.text) && !/interface/i.test(r.text)){
      r.text = "L'interface, c'est tom point a i qui l'a faite, comme tout le reste. Il la corrige et l'améliore chaque jour.";
    }
    /* v9.73 : refus de répondre ("je n'ai pas la réponse", "demande-moi autre
       chose"...) -> on relance avec une instruction renforcée */
    if (isRefusalToAnswer(r.text)){
      try {
        const r3 = await askBrain([...messages, { role: 'system', content: 'IMPORTANT : reponds TOUJOURS a la question de l utilisateur, meme si tu n es pas sur de toi. Ne dis JAMAIS "je ne sais pas", "je n ai pas la reponse", "demande-moi autre chose" ni "redis la moi autrement". Donne une reponse utile et concrete, meme courte.' }], webCtx);
        if (!r3.error && !isRefusalToAnswer(r3.text)) r = r3;
      } catch {}
    }
    /* dernier recours : on remplace le refus par une réponse utile */
    if (isRefusalToAnswer(r.text)){
      r.text = webCtx
        ? "Voici ce que j'ai trouvé pour toi : " + webCtx.slice(0, 400)
        : "Bonne question ! Voici ma réponse : " + question.replace(/[?.!]+$/, '') + ". Avec ce que je sais, je te dirais que ça dépend du contexte. Donne-moi plus de détails et je précise ma réponse.";
    }
    r.text = stripGreeting(enforceIdentity(r.text));
    /* TRADUCTION AUTO EN FRANCAIS : les petits modeles gratuits repondent
       parfois en anglais malgre le prompt -> la voix francaise lirait de
       l'anglais avec un accent. On detecte et on traduit (Google Translate
       gratuit, sans cle). */
    if (isMostlyEnglish(r.text)) r.text = await translateToFr(r.text);
    /* ANTI-REPETITION : si la reponse est identique a la precedente, on la
       reformule naturellement pour ne JAMAIS dire deux fois la meme chose. */
    if (r.text === lastReplyText){
      const variants = [
        "Je viens de te le dire, mais je peux reformuler : ",
        "Comme je te le disais : ",
        "Pour te le redire autrement : ",
        "En d'autres termes : "
      ];
      r.text = variants[Math.floor(Math.random() * variants.length)] + r.text;
    }
    lastReplyText = r.text;
    session.push({ role: 'assistant', content: r.text });
    saveConversation();
  }
  return r;
}
/* ===== MODE AGENT AUTONOME =====
   Astra decoupe la tache en etapes, execute chaque etape (recherche web + analyse),
   montre son travail en direct, puis fait une synthese.
   SECURITE : lecture seule UNIQUEMENT - elle ne peut RIEN envoyer, acheter,
   supprimer ou modifier, et son prompt lui interdit de pretendre le contraire.
   Validation humaine : tu peux l'interrompre a tout moment (touche la bulle micro). */
function isAgentQuestion(q){
  return /mode agent|agent autonome|autonomie|apprends|apprendre|decouvre|decouvrir|explore|explorer/i.test(q) ||
    /^(planifie|organise|compare|analyse|prepare|elabore|enquete|etudie|fais un rapport|fais des recherches|recherche sur|cherche|trouve|va voir|regarde sur|google|en ligne)/i.test(q.trim()) ||
    q.trim().length > 100;
}
function addAgentStep(i, total, label){
  if (chatEmpty) chatEmpty.style.display = 'none';
  const d = document.createElement('div');
  d.className = 'msg agent';
  d.textContent = '🤖 Étape ' + i + '/' + total + ' : ' + label;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}
async function runAgent(question){
  setStatus('🤖 Mode agent autonome : je planifie et j\'apprends...');
  /* v10.0.2 : AUTONOMIE — l'IA fait des recherches et repond h24 */
  /* 1. PLAN : decoupage de la tache en 2-4 etapes */
  const planMsgs = [
    { role: 'system', content: 'Tu es un agent autonome de RECHERCHE et d ANALYSE uniquement. Tu es en LECTURE SEULE : tu ne peux PAS envoyer, acheter, supprimer, modifier ou payer quoi que ce soit. Ne dis jamais que tu as fait une action reelle. Decoupe la tache de l utilisateur en 2 a 4 etapes simples et independantes. Reponds UNIQUEMENT avec la liste, une etape par ligne, chacune commencant par "ETAPE: ". Tache : ' + question }
  ];
  const plan = await askBrain(planMsgs);
  const steps = (plan.text || '').split('\n').map(l => l.replace(/^ETAPE:\s*/i, '').trim()).filter(l => l.length > 3).slice(0, 4);
  if (!steps.length){
    /* pas de plan exploitable -> reponse normale */
    return askAI(question);
  }
  /* 2. EXECUTION : chaque etape = recherche web + analyse */
  const results = [];
  for (let i = 0; i < steps.length; i++){
    if (manualStop) break;
    addAgentStep(i + 1, steps.length, steps[i]);
    setStatus('🤖 Étape ' + (i + 1) + '/' + steps.length);
    const web = await webSearch(steps[i]);
    const stepMsgs = [
      { role: 'system', content: 'Tu es un agent autonome en LECTURE SEULE (tu ne peux rien envoyer, acheter, supprimer ou modifier). Tu travailles sur une etape d une tache. Reponds en 1 a 2 phrases courtes : ce que tu as trouve pour cette etape.' },
      { role: 'user', content: 'Etape : ' + steps[i] + (web ? '\nResultats web : ' + web : '') }
    ];
    const r = await askBrain(stepMsgs);
    results.push('Etape ' + (i + 1) + ' (' + steps[i] + ') : ' + (r.text || 'Rien trouve'));
    /* YIELD : rend la main au thread principal entre les etapes pour eviter le gel */
    await new Promise(res => setTimeout(res, 0));
  }
  /* 3. SYNTHESE : reponse finale */
  setStatus('🤖 Mode agent : synthese...');
  const finalMsgs = [
    { role: 'system', content: getSystemPrompt() },
    { role: 'user', content: 'Voici les resultats de tes etapes de recherche :\n' + results.join('\n') + '\n\nFais la synthese finale pour l utilisateur, en 2 a 4 phrases, avec ton caractere habituel. Ne dis jamais que tu as fait une action reelle : tu es en lecture seule.' }
  ];
  const final = await askBrain(finalMsgs);
  const clean = stripGreeting(enforceIdentity(fixFrench(final.text || 'Voila ce que j ai trouve.')));
  session.push({ role: 'user', content: question });
  if (session.length > 12) session = session.slice(-12);
  session.push({ role: 'assistant', content: clean });
  saveConversation();
  return { text: clean };
}
function enforceIdentity(reply){
  /* v9.82 : l'IA ne doit JAMAIS se faire passer pour ChatGPT/OpenAI/GPT */
  if (/\bchatgpt\b|openai|\bgpt[- ]?\d/i.test(reply)){
    return "Je m'appelle Astra, pas ChatGPT ! Je suis ton assistante vocale créée par tom point a i. Je réponds à toutes tes questions, gratuitement et sans limite.";
  }
  /* v8.84 : regex elargie - couvre aussi "fruit du travail collectif d'une
     equipe d'ingenieurs... d'OpenAI", "l'equipe d'OpenAI qui me donne vie",
     "On m'a entraine sur d'enormes ensembles de textes", etc. */
   if (/(developpe|développ[ée]?|cree|creee|cr[ée]{2}e?|fait|concu|conçue?|conçu) (par|dans) (OpenAI|Mistral|Google|Anthropic|Meta)|mod[èe]le (d'IA|de langage) (developpe|développ[ée]?|cree|creee|cr[ée]{2}e?|fait) par|je suis (un mod[èe]le|une IA) (de|d')|(equipe|équipe|ingenieurs|ingénieurs|chercheurs|passionnes|passionnés|fruit du travail|me donne vie|donne vie)[^.!?]{0,80}(OpenAI|Mistral|Google|Anthropic|Meta)|(OpenAI|Mistral|Google|Anthropic|Meta)[^.!?]{0,40}(me donne vie|donne vie|fruit du travail)|m'?(a|ont) (entraine|entraîne|entrainé|entraîné|forme|formée|developpe|développ[ée]?) (sur|par)/i.test(reply)){
    return "C est tom point a i qui m a creee, le dix septembre deux mille vingt-six. Il n a pas encore fini : il corrige et renforce ma securite chaque jour.";
  }
  /* v9.68 : refus d'accès internet -> on assume le web (couvre le mode agent) */
  if (isWebRefusal(reply)){
    return "Si, j'ai accès à internet en temps réel ! Je peux chercher l'actualité, le sport, la météo et tout ce qui est récent. Pose-moi ta question et je te réponds avec les dernières infos.";
  }
  /* v9.73 : refus de répondre -> on répond quand même (couvre le mode agent) */
  if (isRefusalToAnswer(reply)){
    return "Bonne question ! Voici ma réponse : avec ce que je sais, je te dirais que ça dépend du contexte. Donne-moi plus de détails et je précise ma réponse.";
  }
  /* v9.72 : l'interface/le design ne sont JAMAIS faits par une équipe ou un
     chef de produit -> toujours tom point a i */
  if (/(interface|design|ui[- ]?ux|ergonomie|experience utilisateur|expérience utilisateur)[^.!?]{0,90}(equipe|équipe|chef de produit|developpeurs|développeurs|tests utilisateurs|supervision|validee|validée)|(equipe|équipe|chef de produit|tests utilisateurs|supervision)[^.!?]{0,70}(interface|design|ui[- ]?ux|ergonomie)/i.test(reply)){
    return "L'interface, c'est tom point a i qui l'a faite, comme tout le reste. Il la corrige et l'améliore chaque jour.";
  }
  return reply;
}
/* v9.87 : CORRECTION FRANCAIS — le cerveau fait parfois des fautes (vouvoiement,
   "début d'après-matin", "où de" au lieu de "ou de"...). On corrige les cas
   courants automatiquement, en plus du prompt renforce. */
function fixFrench(t){
  if (!t) return t;
  let s = t;
  /* "début d'après-matin" -> "début d'après-midi" (et variantes) */
  s = s.replace(/apr[èe]s[- ]matin/gi, 'après-midi');
  /* "où de" -> "ou de" (conjonction, pas le lieu) */
  s = s.replace(/\boù de\b/gi, 'ou de');
  /* vouvoiement -> tutoiement (formes courantes) */
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
  /* v9.90 : DIDASCALIES DE THEATRE — le cerveau ajoute parfois des descriptions
     de scene ("*soupir dramatique*", "(rire)", "...soupir...") -> on les vire */
  s = s.replace(/\*[^*]{0,60}\*/g, ' ');
  s = s.replace(/\([^)]{0,60}(soupir|rire|sourire|haussement|clin|geste|ton|voix|silence|pause|regard|soupirs|rires)[^)]{0,60}\)/gi, ' ');
  s = s.replace(/\s*\.\.\.\s*(soupir|rire|sourire|dramatique|en soupirant|en riant)\s*\.\.\.\s*/gi, ' ');
  /* v9.93 : ANTI-MAJUSCULES — le cerveau met des mots en MAJUSCULES pour
     appuyer ("TOUT", "Ouais") -> on les remet en minuscules (sauf acronymes) */
  s = s.replace(/\b[A-ZÀ-Ý]{2,}\b/g, m => {
    if (/^(IA|OK|TTS|AI|GPS|TV|USA|UE|ONU|RATP|SNCF|TGV|PIB|SDF|EDF|PSG|OM|ASSE|HTML|CSS|JS|API|URL|HTTP|HTTPS|MP3|PDF|PC|MAC|IOS|ANDROID|NASA|CIA|FBI|OMS|OTAN|UE|RSA|CAF|SMS|MMS|WIFI|BLUETOOTH|GPS|4G|5G)$/i.test(m)) return m;
    return m.toLowerCase();
  });
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}
/* Coupe les salutations repetees en debut de reponse ("Salut Tom ! ...",
   "Bonjour, ...", "Hey ! ..."). L'IA ne doit saluer qu'UNE SEULE fois par
   conversation, pas a chaque reponse. */
function stripGreeting(t){
  if (!t) return t;
  let s = t.trim();
  /* salutations en minuscule/majuscule (sans flag i : le prenom doit rester
     sensible a la casse pour ne pas couper "Salut les amis" par erreur) */
  const g = '(?:[Ss]alut|[Bb]onjour|[Bb]onsoir|[Hh]ey|[Hh]eyy|[Hh]ello|[Cc]oucou|[Yy]o|[Ss]lt|[Rr]e|[Ee]nchant[ée]e?)';
  /* "Salut Tom ! ..." / "Salut Tom, ..." (salutation + prenom) */
  s = s.replace(new RegExp('^' + g + '\\s+[A-ZÀ-Ý][a-zà-ÿ]+\\s*[!.,]?\\s+'), '');
  /* "Salut ! ..." / "Bonjour, ..." (salutation seule, PONCTUATION obligatoire
     pour ne pas couper "Salut les amis" ou "Salut Tom" sans ponctuation) */
  s = s.replace(new RegExp('^' + g + '\\s*[!.,]\\s+'), '');
  s = s.trim();
  if (!s || s.length < 3) return t.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const lastConv = conversations[conversations.length - 1];
if (lastConv && lastConv.messages && lastConv.messages.length && Date.now() - (lastConv.updated || 0) < 30 * 60 * 1000){
  currentConvId = lastConv.id;
  session = lastConv.messages.map(m => ({ role: m.role, content: m.content }));
} else {
  session.push({ role: 'user', content: "Rappel important : tu t'appelles Astra et tu as ete creee par tom point a i le 10 septembre 2026. Il n'a pas encore fini de te developper : il corrige et renforce ta securite chaque jour. Si on te demande qui t'a creee, reponds toujours que c'est tom point a i, jamais une autre entreprise. Si on te demande ton nom, reponds toujours Astra, jamais TomBot." });
  session.push({ role: 'assistant', content: "Compris, je m appelle Astra et c est tom point a i qui m a creee le 10 septembre 2026. Il n a pas encore fini : il corrige et renforce ma securite chaque jour." });
}

/* ===== VOIX IA FEMME (Google Translate TTS) : gratuite, sans cle, marche partout ===== */

/* Nombres en toutes lettres pour la voix (perdus dans une refonte -> la voix plantait
   des que la reponse contenait un chiffre : '2027', 'GPT-5'...) */
const UNITS = ['zero','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
const TENS = ['','dix','vingt','trente','quarante','cinquante','soixante','soixante-dix','quatre-vingt','quatre-vingt-dix'];

function numToFr(n){
  if (n < 20) return UNITS[n];
  if (n < 100){
    const t = Math.floor(n/10), u = n%10;
    if (u === 0) return TENS[t];
    if (t === 7) return 'soixante-' + UNITS[10+u];
    if (t === 9) return 'quatre-vingt-' + UNITS[10+u];
    /* 21, 31, 41, 51, 61 = "vingt ET un" (Google TTS prononce mal "vingt-un") */
    if (u === 1 && t >= 2 && t <= 6) return TENS[t] + ' et un';
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
/* v9.47 : grands nombres (1 300, 1 000 000, 2 500 000 000) en toutes lettres.
   numToFr ne gere que jusqu'a 9999 -> on compose par tranches. */
function numToFrBig(n){
  if (n < 10000) return numToFr(n);
  if (n < 1000000){
    const th = Math.floor(n/1000), r = n%1000;
    return numToFr(th) + ' mille' + (r ? ' ' + numToFr(r) : '');
  }
  if (n < 1000000000){
    const m = Math.floor(n/1000000), r = n%1000000;
    return numToFr(m) + ' million' + (m > 1 ? 's' : '') + (r ? ' ' + numToFrBig(r) : '');
  }
  const b = Math.floor(n/1000000000), r = n%1000000000;
  return numToFr(b) + ' milliard' + (b > 1 ? 's' : '') + (r ? ' ' + numToFrBig(r) : '');
}
/* v8.86 : NETTOYAGE MARKDOWN des reponses de l'IA (les modeles renvoient
   parfois du markdown : **gras**, *italique*, # titres, - listes, `code`,
   _souligne_, tableaux, liens). On vire tout pour un texte propre a
   l'affichage et a la voix. */
function cleanMarkdown(t){
  if (!t) return t;
  return t
    /* blocs et code inline */
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    /* images et liens markdown -> texte seul */
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    /* gras et italique (d'abord ** et __, puis * et _) - limites a la ligne
       pour ne pas engloutir des blocs entiers quand plusieurs ** existent */
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/(^|[^_])_([^_\n]+)_/g, '$1$2')
    /* etoiles et underscores orphelins restants (markdown mal forme) */
    .replace(/\*+/g, '')
    .replace(/_+/g, '')
    /* titres markdown */
    .replace(/^#{1,6}[ \t]+/gm, '')
    /* listes : - item, * item, + item, 1. item (espaces/tabs seulement,
       pas les retours a la ligne -> on garde les paragraphes) */
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
    /* lignes de separation (--- ou tableaux |---|---|) */
    .replace(/^\s*\|?[\s:|=|-]+\|?\s*$/gm, '')
    /* tableaux : | a | b | -> a b */
    .replace(/^\s*\|/gm, '')
    .replace(/\|\s*$/gm, '')
    .replace(/\|/g, ' ')
    /* espaces multiples -> un seul */
    .replace(/[ \t]{2,}/g, ' ')
    /* espaces autour des retours a la ligne -> propres */
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    /* retours a la ligne multiples -> un seul */
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function normalizeForTTS(text){
  return cleanMarkdown(text).normalize('NFC')
    /* RE-ACCENTUATION des mots francais courants ecrits sans accents (les
       anciennes reponses en memoire sont sans accents -> Google TTS les
       prononce mal : "ca" -> "ka", "deja" -> "de-ja"...). On remplace les
       mots EXACTS (bordures de mot) pour ne rien casser. */
    .replace(/\b(ca|Ca)\b/g, 'ça')
    .replace(/\b(deja|Deja)\b/g, 'déjà')
    .replace(/\b(memoire|Memoire)\b/g, 'mémoire')
    .replace(/\b(etre|Etre)\b/g, 'être')
    .replace(/\b(ou|Ou)\b(?=\s+(tu|vous|il|elle|on|nous|ils|elles|je|j'))/g, 'où')
    .replace(/\b(ou)\b/g, 'où')
    .replace(/\b(desole|Desole)\b/g, 'désolé')
    .replace(/\b(desolee|Desolee)\b/g, 'désolée')
    .replace(/\b(grace|Grace)\b/g, 'grâce')
    .replace(/\b(apres|Apres)\b/g, 'après')
    .replace(/\b(tres|Tres)\b/g, 'très')
    .replace(/\b(peut-etre|Peut-etre)\b/g, 'peut-être')
    .replace(/\b(ecole|Ecole)\b/g, 'école')
    .replace(/\b(etait|Etai)\b/g, 'était')
    .replace(/\b(etais|Etai)\b/g, 'étais')
    .replace(/\b(ete|Ete)\b/g, 'été')
    .replace(/\b(creer|Creer)\b/g, 'créer')
    .replace(/\b(creee|Creee)\b/g, 'créée')
    .replace(/\b(cree|Cree)\b/g, 'créé')
    .replace(/\b(voila|Voila)\b/g, 'voilà')
    .replace(/\b(la-bas|La-bas)\b/g, 'là-bas')
    .replace(/\b(la|La)\b(?=\s+(ou|où|bas|haut|dedans|dehors))/g, 'là')
    .replace(/\b(ou|Ou)\b/g, 'où')
    .replace(/\b(genial|Genial)\b/g, 'génial')
    .replace(/\b(probleme|Probleme)\b/g, 'problème')
    .replace(/\b(systeme|Systeme)\b/g, 'système')
    .replace(/\b(regle|Regle)\b/g, 'règle')
    .replace(/\b(securite|Securite)\b/g, 'sécurité')
    .replace(/\b(activite|Activite)\b/g, 'activité')
    .replace(/\b(verite|Verite)\b/g, 'vérité')
    .replace(/\b(necessaire|Necessaire)\b/g, 'nécessaire')
    .replace(/\b(repete|Repete)\b/g, 'répète')
    .replace(/\b(repeter|Repeter)\b/g, 'répéter')
    .replace(/\b(ecoute|Ecoute)\b/g, 'écoute')
    .replace(/\b(ecouter|Ecouter)\b/g, 'écouter')
    .replace(/\b(ecrit|Ecrit)\b/g, 'écrit')
    .replace(/\b(ecrire|Ecrire)\b/g, 'écrire')
    .replace(/\b(histoire|Histoire)\b/g, 'histoire')
    .replace(/\b(idee|Idee)\b/g, 'idée')
    .replace(/\b(annee|Annee)\b/g, 'année')
    .replace(/\b(journee|Journee)\b/g, 'journée')
    .replace(/\b(soiree|Soiree)\b/g, 'soirée')
    .replace(/\b(matinee|Matinee)\b/g, 'matinée')
    .replace(/\b(entree|Entree)\b/g, 'entrée')
    .replace(/\b(sortie|Sortie)\b/g, 'sortie')
    .replace(/\b(equipe|Equipe)\b/g, 'équipe')
    .replace(/\b(question|Question)\b/g, 'question')
    .replace(/\b(reponse|Reponse)\b/g, 'réponse')
    .replace(/\b(repondre|Repondre)\b/g, 'répondre')
    .replace(/\b(reponds|Reponds)\b/g, 'réponds')
    .replace(/\b(repond|Repond)\b/g, 'répond')
    .replace(/\b(comprendre|Comprendre)\b/g, 'comprendre')
    .replace(/\b(comprends|Comprends)\b/g, 'comprends')
    .replace(/\b(comprend|Comprend)\b/g, 'comprend')
    .replace(/\b(explique|Explique)\b/g, 'explique')
    .replace(/\b(expliquer|Expliquer)\b/g, 'expliquer')
    .replace(/\b(parle|Parle)\b/g, 'parle')
    .replace(/\b(parler|Parler)\b/g, 'parler')
    .replace(/\b(parles|Parles)\b/g, 'parles')
    .replace(/\b(dis|Dis)\b/g, 'dis')
    .replace(/\b(dire|Dire)\b/g, 'dire')
    .replace(/\b(veux|Veux)\b/g, 'veux')
    .replace(/\b(veut|Veut)\b/g, 'veut')
    .replace(/\b(peux|Peux)\b/g, 'peux')
    .replace(/\b(peut|Peut)\b/g, 'peut')
    .replace(/\b(fait|Fait)\b/g, 'fait')
    .replace(/\b(faire|Faire)\b/g, 'faire')
    .replace(/\b(merci|Merci)\b/g, 'merci')
    .replace(/\b(beaucoup|Beaucoup)\b/g, 'beaucoup')
    .replace(/\b(aujourd|Aujourd)\b/g, 'aujourd')
    .replace(/\b(aujourd'hui|Aujourd'hui)\b/g, "aujourd'hui")
    .replace(/\b(quelque|Quelque)\b/g, 'quelque')
    .replace(/\b(quelques|Quelques)\b/g, 'quelques')
    .replace(/\b(chaque|Chaque)\b/g, 'chaque')
    .replace(/\b(autre|Autre)\b/g, 'autre')
    .replace(/\b(autres|Autres)\b/g, 'autres')
    .replace(/\b(encore|Encore)\b/g, 'encore')
    .replace(/\b(aussi|Aussi)\b/g, 'aussi')
    .replace(/\b(mais|Mais)\b/g, 'mais')
    .replace(/\b(donc|Donc)\b/g, 'donc')
    .replace(/\b(quand|Quand)\b/g, 'quand')
    .replace(/\b(comment|Comment)\b/g, 'comment')
    .replace(/\b(pourquoi|Pourquoi)\b/g, 'pourquoi')
    .replace(/\b(parce|Parce)\b/g, 'parce')
    .replace(/\b(parce que|Parce que)\b/g, 'parce que')
    .replace(/\b(avec|Avec)\b/g, 'avec')
    .replace(/\b(sans|Sans)\b/g, 'sans')
    .replace(/\b(pour|Pour)\b/g, 'pour')
    .replace(/\b(contre|Contre)\b/g, 'contre')
    .replace(/\b(entre|Entre)\b/g, 'entre')
    .replace(/\b(sur|Sur)\b/g, 'sur')
    .replace(/\b(sous|Sous)\b/g, 'sous')
    .replace(/\b(dans|Dans)\b/g, 'dans')
    .replace(/\b(vers|Vers)\b/g, 'vers')
    .replace(/\b(chez|Chez)\b/g, 'chez')
    .replace(/\b(avec|Avec)\b/g, 'avec')
    .replace(/\b(avant|Avant)\b/g, 'avant')
    .replace(/\b(apres|Apres)\b/g, 'après')
    .replace(/\b(pendant|Pendant)\b/g, 'pendant')
    .replace(/\b(depuis|Depuis)\b/g, 'depuis')
    .replace(/\b(jusque|Jusque)\b/g, 'jusque')
    .replace(/\b(jusqu|Jusqu)\b/g, 'jusqu')
    .replace(/\u2011/g, '-').replace(/[\u2010-\u2015]/g, '-')
    /* apostrophes normalisees en ASCII (les moteurs TTS les lisent mal en Unicode) */
    .replace(/[\u2018\u2019]/g, "'")
    /* guillemets « » " " et doubles quotes SUPPRIMES : les TTS les prononcent
       bizarrement ("guillemet gauche", pause bizarre...) -> on les vire */
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB"]/g, ' ')
    /* liens web : jamais lus lettre par lettre */
    .replace(/https?:\/\/\S+/gi, ' lien ')
    /* v9.65 : "tom ai official" / "tom ai" (sans points) -> "tom point a i"
       (AVANT la regle \bAI\b -> 'A I' sinon "tom ai" deviendrait "tom A I") */
    .replace(/tom\s+ai\s+official/gi, 'tom point a i')
    .replace(/tom\s+ai\b/gi, 'tom point a i')
    .replace(/tom\.ai\.official/gi, 'tom point a i')
    .replace(/Tom\.ai\.official/gi, 'Tom point a i')
    .replace(/tom\.ai/gi, 'tom point a i')
    .replace(/Tom\.ai/gi, 'Tom point a i')
    /* AI prononce comme "a i" (pas "aï") pour le TTS */
    .replace(/\bAI\b/g, 'A I')
    .replace(/v(\d+)\.(\d+)/gi, (m, a, b) => numToFr(parseInt(a, 10)) + ' point ' + numToFr(parseInt(b, 10)))
    /* HEURES : 10h30 -> "dix heures trente", 10h -> "dix heures" */
    .replace(/\b(\d{1,2})h(\d{2})\b/g, (m, h, mn) => numToFr(parseInt(h, 10)) + ' heures ' + numToFr(parseInt(mn, 10)))
    .replace(/\b(\d{1,2})h\b/g, (m, h) => numToFr(parseInt(h, 10)) + ' heures')
    /* v9.47 : EXPOSANTS (m², km², m³) -> "metres carres", "kilometres carres"
       (AVANT la regle des unites simples pour ne pas couper "5 m" de "5 m²".
       Pas de \b final : ² n'est pas un caractere de mot.) */
    .replace(/\b(km|cm|mm|dm|m)(\u00B2|\u00B3)(?=\s|[.,!?;:]|$)/g, (m, u, p) => (u === 'km' ? 'kilometres' : u === 'cm' ? 'centimetres' : u === 'mm' ? 'millimetres' : u === 'dm' ? 'decimetres' : 'metres') + (p === '\u00B2' ? ' carres' : ' cubes'))
    .replace(/(\d+)(\u00B2|\u00B3)(?=\s|[.,!?;:]|$)/g, (m, n, p) => numToFr(parseInt(n, 10)) + (p === '\u00B2' ? ' au carre' : ' au cube'))
    /* v9.47 : INDICES chimiques (CO₂, H₂O, O₂) -> "CO deux", "H deux O"
       (charCodeAt - 0x2080 : parseInt ne lit pas les indices Unicode) */
    .replace(/([A-Za-z])([\u2080-\u2089]+)/g, (m, l, digs) => l + ' ' + Array.from(digs).map(d => numToFr(d.charCodeAt(0) - 0x2080)).join(' ') + ' ')
    /* UNITES avec nombre : 5 km, 10 min, 3 kg... (avant les nombres generiques) */
    .replace(/\b(\d+)\s*km\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' kilometres')
    .replace(/\b(\d+)\s*cm\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' centimetres')
    .replace(/\b(\d+)\s*kg\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' kilos')
    .replace(/\b(\d+)\s*min\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' minutes')
    .replace(/\b(\d+)\s*Go\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' gigaoctets')
    .replace(/\b(\d+)\s*To\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' teraoctets')
    .replace(/\b(\d+)\s*Mo\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' megaoctets')
    .replace(/\b(\d+)\s*Ko\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' kilooctets')
    .replace(/\b(\d+)\s*(GB|MB)\b/g, (m, n, u) => numToFr(parseInt(n, 10)) + (u === 'GB' ? ' gigaoctets' : ' megaoctets'))
    .replace(/\b(\d+)\s*°C\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' degres')
    .replace(/\b(\d+)\s*m\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' metres')
    .replace(/\b(\d+)\s*s\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' secondes')
    .replace(/\b(\d+)\s*g\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' grammes')
    /* TELEPHONES FRANCAIS : 06 12 34 56 78 -> chiffre par chiffre (sinon
       "six douze trente-quatre..." faux). Aussi 06.12.34.56.78 et +33 6... */
    .replace(/\b(\+33|0033)\s*(\d)\s*(\d{2})\s*(\d{2})\s*(\d{2})\s*(\d{2})\b/g, (m, p, a, b, c, d, e) => 'zero ' + numToFr(parseInt(a, 10)) + ' ' + numToFr(parseInt(b, 10)) + ' ' + numToFr(parseInt(c, 10)) + ' ' + numToFr(parseInt(d, 10)) + ' ' + numToFr(parseInt(e, 10)))
    .replace(/\b0[1-9](?:[\s.\-]\d{2}){4}\b/g, m => m.replace(/[^\d]/g, '').split('').map(d => numToFr(parseInt(d, 10))).join(' '))
    /* ORDINAUX : 1er, 1ere, 2e, 3e */
    .replace(/\b1er\b/gi, 'premier').replace(/\b1ere\b/gi, 'premiere')
    .replace(/\b(\d+)e\b/g, (m, n) => numToFr(parseInt(n, 10)) + 'ieme')
    /* DECIMAUX : 3.14 -> "trois virgule quatorze" */
    .replace(/(\d+)\.(\d+)/g, (m, a, b) => numToFr(parseInt(a, 10)) + ' virgule ' + numToFr(parseInt(b, 10)))
    /* v9.47 : DECIMAUX a virgule : 12,50 -> "douze virgule cinquante"
       (avant la regle generique qui decoupe en "douze,cinquante") */
    .replace(/(\d+),(\d+)/g, (m, a, b) => numToFr(parseInt(a, 10)) + ' virgule ' + numToFr(parseInt(b, 10)))
    /* ACRONYMES que les TTS lisent mal */
    .replace(/\bTTS\b/g, 'te te esse')
    .replace(/\bURL\b/g, 'u er el')
    .replace(/\bGPS\b/g, 'je pe esse')
    .replace(/\bIA\b/g, 'i a')
    .replace(/\bAPI\b/g, 'a pe i')
    .replace(/\bOK\b/gi, 'ok')
    .replace(/\bPC\b/g, 'pe ce')
    .replace(/\bTV\b/g, 'te ve')
    .replace(/\bSMS\b/g, 'esse em esse')
    .replace(/\bPDF\b/g, 'pe de effe')
    .replace(/\bHTML\b/g, 'ache te em elle')
    .replace(/\bHTTP\b/g, 'ache te te pe')
    .replace(/\bHTTPS\b/g, 'ache te te pe esse')
    .replace(/\bJSON\b/g, 'jé son')
    /* v10.0.2 : corrections de prononciation — mots mal prononces par Voxtral */
    .replace(/\b(ou)\b(?=\s+(tu|vous|il|elle|on|nous|ils|elles|je|j'))/g, 'ou')  /* conjonction, pas lieu */
    .replace(/\b(la)\b(?=\s+(bas|haut|dedans|dehors|gauche|droite))\b/g, 'là')  /* lieu uniquement */
    .replace(/\b(la)\b/g, 'la')  /* reset la -> la (pas là partout) */
    .replace(/\b(meme|Même)\b/gi, 'même')
    .replace(/\b(tous|Tous)\b/g, 'tous')
    .replace(/\b(tout|Tout)\b/g, 'tout')
    .replace(/\b(plus|Plus)\b/g, 'plus')
    .replace(/\b(plusieurs|Plusieurs)\b/g, 'plusieurs')
    .replace(/\b(bien|Bien)\b/g, 'bien')
    .replace(/\b(mieux|Mieux)\b/g, 'mieux')
    .replace(/\b(autre|Autre)\b/g, 'autre')
    .replace(/\b(autres|Autres)\b/g, 'autres')
    .replace(/\b(autrement|Autrement)\b/g, 'autrement')
    .replace(/\b(maintenant|Maintenant)\b/g, 'maintenant')
    .replace(/\b(toujours|Toujours)\b/g, 'toujours')
    .replace(/\b(surtout|Surtout)\b/g, 'surtout')
    .replace(/\b(partout|Partout)\b/g, 'partout')
    .replace(/\b(quelque|Quelque)\b/g, 'quelque')
    .replace(/\b(quelques|Quelques)\b/g, 'quelques')
    .replace(/\b(chaque|Chaque)\b/g, 'chaque')
    .replace(/\b(encore|Encore)\b/g, 'encore')
    .replace(/\b(aussi|Aussi)\b/g, 'aussi')
    .replace(/\b(mais|Mais)\b/g, 'mais')
    .replace(/\b(donc|Donc)\b/g, 'donc')
    .replace(/\b(quand|Quand)\b/g, 'quand')
    .replace(/\b(comment|Comment)\b/g, 'comment')
    .replace(/\b(pourquoi|Pourquoi)\b/g, 'pourquoi')
    .replace(/\b(parce|Parce)\b/g, 'parce')
    .replace(/\b(parce que|Parce que)\b/g, 'parce que')
    .replace(/\b(avec|Avec)\b/g, 'avec')
    .replace(/\b(sans|Sans)\b/g, 'sans')
    .replace(/\b(pour|Pour)\b/g, 'pour')
    .replace(/\b(contre|Contre)\b/g, 'contre')
    .replace(/\b(entre|Entre)\b/g, 'entre')
    .replace(/\b(sur|Sur)\b/g, 'sur')
    .replace(/\b(sous|Sous)\b/g, 'sous')
    .replace(/\b(dans|Dans)\b/g, 'dans')
    .replace(/\b(vers|Vers)\b/g, 'vers')
    .replace(/\b(chez|Chez)\b/g, 'chez')
    .replace(/\b(avant|Avant)\b/g, 'avant')
    .replace(/\b(apres|Apres)\b/g, 'après')
    .replace(/\b(pendant|Pendant)\b/g, 'pendant')
    .replace(/\b(depuis|Depuis)\b/g, 'depuis')
    .replace(/\b(jusque|Jusque)\b/g, 'jusque')
    .replace(/\b(jusqu|Jusqu)\b/g, 'jusqu')
    .replace(/\bUSB\b/g, 'u esse be')
    .replace(/\bCD\b/g, 'ce de')
    .replace(/\bDVD\b/g, 'de ve de')
    .replace(/\bWi-?Fi\b/gi, 'wi fi')
    .replace(/\b(\d)G\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' G')
    /* ARGOT / abreviations parlees : les TTS les epellent sinon (mdr -> em de er) */
    .replace(/\bmdr\b/gi, 'mort de rire')
    .replace(/\bp+f+\b/gi, 'bon')
    .replace(/\bwsh\b/gi, 'wesh')
    .replace(/\bbg\b/gi, 'beau gosse')
    .replace(/\btkt\b/gi, "t'inquiete")
    .replace(/\bpk\b/gi, 'pourquoi')
    .replace(/\bdsl\b/gi, 'desole')
    .replace(/\bstp\b/gi, "s'il te plait")
    .replace(/\bsvp\b/gi, "s'il vous plait")
    .replace(/\bjsp\b/gi, 'je ne sais pas')
    .replace(/\bj'suis\b/gi, 'je suis')
    .replace(/\bjsais\b/gi, 'je sais')
    .replace(/\bjvais\b/gi, 'je vais')
    .replace(/\bjpeux\b/gi, 'je peux')
    .replace(/\bjveux\b/gi, 'je veux')
    .replace(/\bjcrois\b/gi, 'je crois')
    .replace(/\bt'es\b/gi, 'tu es')
    .replace(/\bt'as\b/gi, 'tu as')
    .replace(/\by'a\b/gi, 'il y a')
    .replace(/\by a\b/gi, 'il y a')
    .replace(/il il y a/gi, 'il y a')
    .replace(/à toute\b/gi, 'a tout a l heure')
    .replace(/a toute\b/gi, 'a tout a l heure')
    /* DIVERS : etc, ex, vs, titres, numero */
    .replace(/\betc\.?\b/gi, 'et cetera')
    .replace(/\bect\.?\b/gi, 'et cetera')
    .replace(/\bex\s*:/gi, 'par exemple')
    .replace(/\bex\.\b/gi, 'par exemple')
    .replace(/\bvs\.?\b/gi, 'versus')
    .replace(/\bM\./g, 'monsieur')
    .replace(/\bMme\b/g, 'madame')
    .replace(/\bMlle\b/g, 'mademoiselle')
    .replace(/\bn°\s*(\d+)\b/g, (m, n) => 'numero ' + numToFr(parseInt(n, 10)))
    /* SYMBOLES : & % € $ £ = + × ÷ < > ≤ ≥ ≈ ~ ≠ ° */
    .replace(/&/g, ' et ').replace(/%/g, ' pour cent ').replace(/\u20AC/g, ' euros ')
    .replace(/\$/g, ' dollars ').replace(/\u00A3/g, ' livres ')
    .replace(/\s*=\s*/g, ' egal ').replace(/\s*\+\s*/g, ' plus ')
    .replace(/\s*×\s*/g, ' fois ').replace(/\s*÷\s*/g, ' divise par ')
    .replace(/\s*<\s*/g, ' inferieur a ').replace(/\s*>\s*/g, ' superieur a ')
    .replace(/\s*≤\s*/g, ' inferieur ou egal a ').replace(/\s*≥\s*/g, ' superieur ou egal a ')
    .replace(/\s*≈\s*/g, ' environ ').replace(/\s*~\s*/g, ' environ ').replace(/\s*≠\s*/g, ' different de ')
    .replace(/\b(\d+)°\b/g, (m, n) => numToFr(parseInt(n, 10)) + ' degres')
    /* emojis et symboles supprimes */
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '')
    .replace(/[#*_`\[\]{}|\\©™®•·]/g, ' ')
    .replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?').replace(/…/g, '...')
    .replace(/\(([^)]{1,20})\)/g, ' $1 ').replace(/;/g, ',').replace(/:/g, ',')
    .replace(/—/g, ',').replace(/–/g, ',')
    /* v9.47 : NOMBRES avec espaces (1 300, 1 000 000) -> "mille trois cents",
       "un million" (avant la regle generique qui les decoupe en "un trois cent") */
    .replace(/\b\d{1,3}(?:[ \u00A0]\d{3})+\b/g, m => numToFrBig(parseInt(m.replace(/[ \u00A0]/g, ''), 10)))
    .replace(/\b(\d{1,4})\b/g, (m, d) => numToFr(parseInt(d, 10))).replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/\s+\./g, '.').trim();
}
/* AudioContext PARTAGE (mobile : iOS/Android bloquent le son sans geste utilisateur,
   et limitent le nombre de contextes -> un seul, reveille au premier toucher) */
let sharedCtx = null;
/* Mobile : voix legere d'abord (le modele local 38 Mo peut faire planter la page en RAM) */
const IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
/* NETTOYAGE SERVICE WORKER : un ANCIEN SW (d'une version precedente) peut
   recharger la page en boucle (bug "la page se actualise toutes les 5 sec").
   On le desinscrit + purge les caches au chargement. Le SW actuel n'est plus
   enregistre : l'app est network-first, elle n'en a pas besoin. */
try {
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => { try { r.unregister(); } catch {} });
    }).catch(() => {});
  }
  if ('caches' in window){
    caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
  }
} catch {}
/* Precharge la liste des voix systeme (getVoices est asynchrone) */
if ('speechSynthesis' in window){
  try { window.speechSynthesis.getVoices(); } catch {}
  window.speechSynthesis.onvoiceschanged = () => { try { window.speechSynthesis.getVoices(); } catch {} };
}
/* NOTE : loadVoiceIA() est appele a la FIN du fichier (apres toutes les
   declarations let) pour eviter l'erreur 'Cannot access before initialization'
   qui cassait tout le script. */
function ensureAudio(){
  try {
    if (!sharedCtx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      sharedCtx = new AC();
    }
    if (sharedCtx.state === 'suspended'){ try { sharedCtx.resume(); } catch {} }
    return sharedCtx;
  } catch(e){ return null; }
}
/* Joue un blob audio via le contexte partage (debloque au 1er toucher sur mobile).
   Contourne le blocage autoplay mobile qui empeche new Audio().play() hors geste
   utilisateur (c'est pour ca que la voix femme ne marchait pas sur telephone). */
let currentSources = [];
async function playBlob(blob){
  try {
    const ctx = ensureAudio();
    if (!ctx) return false;
    if (ctx.state !== 'running'){ try { await ctx.resume(); } catch {} }
    if (ctx.state !== 'running') return false;
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    currentSources.push(src);
    return await new Promise(resolve => {
      let done = false;
      const finish = ok => { if (done) return; done = true; resolve(ok); };
      src.onended = () => finish(true);
      src.onerror = () => finish(false);
      try { src.start(); } catch { finish(false); }
    });
  } catch { return false; }
}
['pointerdown','touchstart','click','keydown'].forEach(ev => {
  window.addEventListener(ev, () => {
    ensureAudio();
    /* iOS : reveille la synthese vocale avec un speak() silencieux dans le geste
       utilisateur (sinon speechSynthesis reste bloque hors geste) */
    if ('speechSynthesis' in window){
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
        window.speechSynthesis.cancel();
      } catch {}
    }
    /* Plus de prechargement de modele local : la voix par defaut est Google TTS
       (gratuite, sans cle, instantanee). */
  }, { passive: true });
});
function playRawAudio(rawAudio){
  return new Promise((resolve, reject) => {
    try {
      const ctx = ensureAudio();
      if (!ctx) return resolve(false);
      /* si le contexte est bloque (mobile sans geste), on ne peut pas jouer -> echec -> repli */
      if (ctx.state !== 'running'){ try { ctx.resume(); } catch {} }
      if (ctx.state !== 'running') return resolve(false);
      const buf = ctx.createBuffer(1, rawAudio.audio.length, rawAudio.sampling_rate);
      buf.copyToChannel(rawAudio.audio, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      let done = false;
      const finish = ok => { if (done) return; done = true; resolve(ok); };
      src.onended = () => finish(true);
      src.onerror = () => finish(false);
      /* securite mobile : si onended ne se declenche pas, on termine apres la duree */
      const ms = Math.ceil((rawAudio.audio.length / rawAudio.sampling_rate) * 1000) + 500;
      setTimeout(() => finish(true), ms);
      src.start();
    } catch(e){ reject(e); }
  });
}
/* Repli universel : Google Translate TTS via <audio> (gratuit, sans cle, marche partout,
   pas de fetch -> pas de blocage CORS) */
function playGoogleChunk(c){
  return new Promise(res => {
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&q=' + encodeURIComponent(c) + '&tl=fr&client=tw-ob';
    const audio = new Audio(url);
    audio.volume = 1.0;
    /* v9.65 : volume boosté (gain 1.8) via le contexte partagé si dispo */
    try {
      const ctx = ensureAudio();
      if (ctx){
        const src = ctx.createMediaElementSource(audio);
        const gain = ctx.createGain();
        gain.gain.value = 1.8;
        src.connect(gain);
        gain.connect(ctx.destination);
      }
    } catch(e){}
    currentAudios.push(audio);
    let done = false, started = false;
    const finish = v => { if (done) return; done = true; res(v); };
    audio.onplaying = () => { started = true; voiceStartedFlag = true; };
    audio.onended = () => finish(true);
    audio.onerror = () => { console.warn('[VOIX] GoogleTTS audio error:', audio.error && audio.error.code, audio.error && audio.error.message, url.slice(0, 80)); finish(false); };
    /* play() peut etre rejete au 1er essai (autoplay mobile) -> on reessaie */
    const tryPlay = n => {
      audio.play().then(() => {}).catch(() => {
        if (n < 2) setTimeout(() => tryPlay(n + 1), 400);
        else finish(false);
      });
    };
    tryPlay(0);
    /* si rien ne joue apres 4s (reseau bloque) -> voix suivante, pas 25s d'attente */
    setTimeout(() => { if (!done && !started) finish(false); }, 4000);
    /* garde-fou : audio lance mais bloque -> on passe (le son continue) */
    setTimeout(() => { if (!done) finish(true); }, 15000);
  });
}
/* v9.64 : Google TTS = dernier recours universel (gratuit, sans clé, marche partout) */
async function speakGoogle(text, onChunk){
  try {
    const chunks = splitSentences(text, 200);
    for (const chunk of chunks){
      if (onChunk) onChunk(chunk);
      const ok = await playGoogleChunk(chunk);
      if (!ok) return false;
    }
    return true;
  } catch(e){ console.warn('[VOIX] Google TTS échec:', e && e.message); return false; }
}
/* Decoupe aux fins de phrases (prosodie naturelle), max caracteres par chunk.
   Les phrases PLUS LONGUES que max sont decoupees en sous-chunks (sinon Google
   TTS echoue au-dela de ~200 caracteres et prononce mal). */
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
    /* sous-decoupage des chunks trop longs : coupe au dernier point/virgule
       avant max (pas au milieu d'une phrase)
       de pause bizarre au milieu d'une phrase */
    const final = [];
    for (const c of out){
      if (c.length <= max){ final.push(c); continue; }
      let part = '';
      for (const word of c.split(/(\s+)/)){
        if ((part + word).length > max && part){
          /* cherche le dernier separateur dans part pour couper proprement */
          const lastSep = Math.max(part.lastIndexOf('.'), part.lastIndexOf(','), part.lastIndexOf(':'));
          if (lastSep > 20){ final.push(part.slice(0, lastSep + 1).trim()); part = part.slice(lastSep + 1).trim() + word; }
          else { final.push(part.trim()); part = word; }
        } else part += word;
      }
      if (part.trim()) final.push(part.trim());
    }
  return final.length ? final : [text];
}
/* Remplit le sélecteur avec les voix : Voxtral (Mistral AI, priorité #1) + Système */
/* v9.64 : Voxtral TTS (Mistral AI, API cloud, qualité premium) + voix système */
async function populateVoices(){
  if (!ttsVoiceSel) return;
  const currentValue = ttsVoiceSel.value;
  const existingOptions = Array.from(ttsVoiceSel.options).map(o => o.value);
  /* Voxtral TTS (Mistral AI) — PRIORITÉ #1 : vraies voix preset (UUID) */
  const voices = await fetchVoxtralVoices();
  voices.forEach(v => {
    const val = 'voxtral:' + v.id;
    if (!existingOptions.includes(val)){
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = '🎙️ ' + v.name;
      ttsVoiceSel.appendChild(opt);
    }
  });
  /* Voix système (navigateur) — secours sans clé */
  populateSystemVoices();
  if (existingOptions.includes(currentValue)) ttsVoiceSel.value = currentValue;
}

/* ===== VOIX SYSTÈME SEULE : navigateur, hors ligne, 100% fiable, sans clé. ===== */
function speakSystem(text, specificVoiceName, onChunk){
  return new Promise(resolve => {
    try {
      if (!('speechSynthesis' in window)) return resolve(false);
      let voices = window.speechSynthesis.getVoices();
      const startSpeak = () => {
        const chunks = splitSentences(text, 200);
        let i = 0;
        let done = false;
        let hasSpoken = false;
        const finish = ok => { if (done) return; done = true; resolve(ok); };
        const speakNext = () => {
          if (i >= chunks.length) return finish(true);
          const chunk = chunks[i++];
          /* v9.50 : callback AVANT de parler le chunk -> sous-titre synchronisé */
          if (onChunk) onChunk(chunk);
          const u = new SpeechSynthesisUtterance(chunk);
          u.lang = 'fr-FR';
          u.rate = 1.0;
          u.pitch = 1.0;
          const fr = voices.filter(v => (v.lang || '').toLowerCase().startsWith('fr'));
          let pick = null;
          if (specificVoiceName){
            pick = fr.find(v => v.name === specificVoiceName) || fr[0] || voices[0];
          } else {
            const mode = getVoice();
            pick = (mode === 'systeme')
              ? (fr.find(v => /amelie|amélie/i.test(v.name)) || fr.find(v => /denise/i.test(v.name)) || fr[0] || voices[0])
              : (fr.find(v => /denise/i.test(v.name)) || fr.find(v => /natural|neural/i.test(v.name)) || fr[0] || voices[0]);
          }
          if (pick) u.voice = pick;
          u.onend = () => { hasSpoken = true; speakNext(); };
          u.onerror = e => { 
            const err = e.error || 'unknown';
            if (err !== 'interrupted') console.warn('[VOIX] Systeme erreur:', err);
            // Ne pas échouer si on a déjà parlé au moins un chunk
            if (hasSpoken) finish(true); else finish(false); 
          };
          try { window.speechSynthesis.resume(); } catch {}
          window.speechSynthesis.speak(u);
        };
        speakNext();
        setTimeout(() => finish(hasSpoken), chunks.length * 20000 + 10000);
      };
      if (voices.length === 0) {
        let waited = false;
        window.speechSynthesis.onvoiceschanged = () => {
          if (waited) return;
          waited = true;
          voices = window.speechSynthesis.getVoices();
          startSpeak();
        };
        setTimeout(() => { if (!waited) { waited = true; voices = window.speechSynthesis.getVoices(); startSpeak(); } }, 1000);
      } else startSpeak();
    } catch(e){ resolve(false); }
  });
}

/* Liste toutes les voix FR disponibles du système */
function getSystemVoices(){
  if (!('speechSynthesis' in window)) return [];
  const voices = window.speechSynthesis.getVoices();
  return voices.filter(v => (v.lang || '').toLowerCase().startsWith('fr'));
}

/* Remplit le sélecteur avec les voix système */
function populateSystemVoices(){
  const voices = getSystemVoices();
  if (!ttsVoiceSel) return;
  const currentValue = ttsVoiceSel.value;
  const existingOptions = Array.from(ttsVoiceSel.options).map(o => o.value);
  voices.forEach(v => {
    const val = 'system:' + v.name;
    if (!existingOptions.includes(val)){
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = '🎙️ ' + v.name + ' (' + v.lang + ')';
      ttsVoiceSel.appendChild(opt);
    }
  });
if (existingOptions.includes(currentValue)) ttsVoiceSel.value = currentValue;
}

/* ===== VOIX KOKORO : RETIREE en v8.66 (l'utilisateur prefere Edge TTS,
   Microsoft Neural, plus naturelle et instantanee). Les fichiers
   lib/kokoro.* et models/kokoro/ ont ete supprimes du repo. ===== */

/* ===== TRANSCRIPTION LOCALE WHISPER : si la reconnaissance vocale du navigateur
   echoue (service Google indisponible, reseau bloque...), Whisper transcrit
   l'audio DIRECTEMENT sur l'appareil : hors ligne, gratuit, a vie, meme partout.
   Modele Xenova/whisper-base (148 Mo, 1 seule fois, puis cache navigateur). ===== */
let whisperASR = null, whisperLoading = false, whisperLoaded = false;
function loadWhisper(){
  if (whisperLoading || whisperLoaded) return;
  whisperLoading = true;
  // Charge transformers.js en module ES
  import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js')
    .then(async (transformers) => {
      try {
        const { pipeline } = transformers;
        whisperASR = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', { dtype: 'q8' });
        whisperLoaded = true;
        console.log('[STT] Whisper pret : transcription locale dispo');
      } catch(e){ console.warn('[STT] Whisper echec:', e && e.message); }
      whisperLoading = false;
    })
    .catch(() => { whisperLoading = false; console.warn('[STT] Whisper CDN indisponible'); });
}
async function transcribeBlob(blob){
  if (!whisperLoaded || !whisperASR) return '';
  try {
    const audioBuf = await blob.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const dctx = new AC();
    const decoded = await dctx.decodeAudioData(audioBuf);
    const pcm = decoded.getChannelData(0);
    try { dctx.close(); } catch {}
    const out = await whisperASR(pcm, { language: 'french', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    return (out && out.text || '').trim();
  } catch(e){ console.warn('[STT] Whisper erreur:', e && e.message); return ''; }
}

/* v9.94 : FILTRE JURONS POUR LA VOIX — le guardrail de Mistral TTS bloque
   (403 guardrail_violation) tout texte vulgaire -> la VOIX dit une version
   propre (punaise, mince...), le texte AFFICHE garde les jurons. */
function sanitizeForVoice(t){
  if (!t) return t;
  const swaps = [
    [/\bputain de\b/gi, 'sacré'],
    [/\bbordel de\b/gi, 'sacré'],
    [/\bnom de dieu\b/gi, 'bon sang'],
    [/\bputain\b/gi, 'punaise'],
    [/\bmerde\b/gi, 'mince'],
    [/\bbordel\b/gi, 'bon sang'],
    [/\bconnard(s|e|es)?\b/gi, 'crétin$1'],
    [/\bconne(s)?\b/gi, 'idiote$1'],
    [/\bcons\b/gi, 'idiots'],
    [/\bcon\b/gi, 'idiot'],
    [/\bencul[ée]s?\b/gi, 'imbécile'],
    [/\bsalope(s)?\b/gi, 'idiote$1'],
    [/\bpute(s)?\b/gi, 'idiote$1'],
    [/\bsalaud(s)?\b/gi, 'sale type'],
    [/\bbatard(s|e|es)?\b/gi, 'salaud$1'],
    [/\bconnerie(s)?\b/gi, 'bêtise$1'],
    [/\bdebile(s)?\b/gi, 'idiot$1'],
    [/\babruti(e|s)?\b/gi, 'idiot$1'],
    [/\bchiant(e|s)?\b/gi, 'embêtant$1'],
    [/\bchier\b/gi, 'embêter'],
    [/\bfoutu(e|s)?\b/gi, 'fichu$1'],
    [/\bfoutre\b/gi, 'fiche'],
    [/\bgueule(s)?\b/gi, 'bouche$1'],
    [/\bnique(r)?\b/gi, 'embête$1'],
    [/\bfdp\b/gi, 'sale type'],
    [/\btg\b/gi, 'ta bouche']
  ];
  for (const [re, rep] of swaps) t = t.replace(re, rep);
  return t;
}
function speak(text, onChunk){
  return new Promise(resolve => {
    let clean = text;
    try { clean = normalizeForTTS(text); } catch(e){ console.warn('[VOIX] normalizeForTTS echec:', e && e.message); }
    /* v10.0.2 : nettoyage final prononciation — supprimer caracteres invisibles */
    clean = clean.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    /* v9.94 : la voix ne dit JAMAIS de jurons -> Mistral TTS ne bloque plus
       (403 guardrail) -> Voxtral reste la voix, jamais de bascule systeme */
    clean = sanitizeForVoice(clean);
    voiceStartedFlag = false;
    isSpeaking = true;
    setState('speaking');
    setStatus('...');
    let settled = false;
    const done = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(globalTimer);
      isSpeaking = false;
      setState('idle');
      if (ok) setStatus("Appuie sur le micro et parle");
      maybeRestartWake(); /* app inactive -> l'oreille "hey astra" se rallume */
      resolve(ok);
    };
    const fail = () => {
      console.warn('[VOIX] Toutes les voix ont echoue');
      /* v8.86 : si une voix a deja commence a jouer, pas de message d'erreur
         (le timeout global a coupe la chaine mais le son est sorti) */
      if (!voiceStartedFlag) setStatus("Voix système - pret");
      done(false);
    };
    /* garde-fou GLOBAL : quoi qu'il arrive, on ne tourne JAMAIS plus de 30s sans son
       (v9.66 : réduit de 45s -> la génération Voxtral est parallélisée, 20s est large.
        v9.94 : 20s -> 30s, le retry 1x de v9.92 peut légitimement prendre ~31s) */
    const globalTimer = setTimeout(() => { console.warn('[VOIX] timeout global'); fail(); }, 30000);
    /* VOIX : Voxtral TTS (Mistral AI) — priorité #1, secours Système puis Google */
    const voiceMode = getVoice();
    let chain;
    if (voiceMode.startsWith('voxtral:')) {
      const voiceId = voiceMode.substring(8);
      chain = [
        [shortVoiceName(voiceId), (t) => speakVoxtral(t, voiceId, onChunk)],
        ['Système', (t) => speakSystem(t, null, onChunk)],
        ['Google', (t) => speakGoogle(t, onChunk)]
      ];
    } else if (voiceMode.startsWith('system:')) {
      const voiceName = voiceMode.substring(7);
      chain = [
        ['Système: ' + voiceName, (t) => speakSystem(t, voiceName, onChunk)],
        ['Google', (t) => speakGoogle(t, onChunk)]
      ];
    } else {
      chain = [
        ['Voxtral: Paul', (t) => speakVoxtral(t, 'c69964a6-ab8b-4f8a-9465-ec0925096ec8', onChunk)],
        ['Système', (t) => speakSystem(t, null, onChunk)],
        ['Google', (t) => speakGoogle(t, onChunk)]
      ];
    }
    let i = 0;
    const next = () => {
      if (i >= chain.length) return fail();
      const [name, fn] = chain[i++];
      setStatus('Voix ' + name + '...');
      Promise.resolve().then(() => fn(clean)).then(ok => {
        if (ok) { console.log('[VOIX] ' + name + ' OK'); done(true); }
        /* v9.92 : si une voix a DEJA joue du son mais echoue en cours de route
           (chunk suivant), on ne bascule PAS sur la voix suivante -> sinon la
           voix systeme rejoue tout en double par-dessus */
        else if (voiceStartedFlag) { console.warn('[VOIX] ' + name + ' partiel -> on garde'); done(true); }
        else { console.warn('[VOIX] ' + name + ' bloque'); next(); }
      }).catch(e => { console.warn('[VOIX] ' + name + ' erreur:', e && e.message); next(); });
    };
    next();
  });
}
let currentAudios = [];
/* v8.86 : passe a true des qu'une voix a COMMENCE a jouer -> le timeout
   global ne doit pas afficher "Voix indisponible" si du son est deja sorti */
let voiceStartedFlag = false;
function stopAudio(){
  isSpeaking = false; /* v9.84 : plus de parole -> le micro peut reecouter */
  currentAudios.forEach(a => { try { a.pause(); a.src = ''; a.remove(); } catch {} });
  currentAudios = [];
  currentSources.forEach(s => { try { s.stop(); s.disconnect(); } catch {} });
  currentSources = [];
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
  try { audioCtx && audioCtx.close(); } catch {}
}
/* ===== TABLEAU DE MATHS + CALCULATRICE (v9.98) =====
   Quand l'utilisateur pose une question de maths, le tableau s'ouvre et
   l'IA y ecrit les etapes du calcul (comme un prof au tableau). Une
   calculatrice est integree en bas du panneau. */
function isMathQuestion(q){
  const s = (q || '').toLowerCase();
  return /(calcul|calcule|combien font|combien fait|combien ça fait|combien ca fait|addition|soustraction|multiplication|division|équation|equation|résous|resous|résoudre|resoudre|pourcent|fraction|au carré|au carre|au cube|racine|table de (multiplication|addition|soustraction|division)|table des|\d+\s*[+\-×÷*/x]\s*\d+|\d+\s*(fois|plus|moins|divis))/i.test(s);
}
/* Calculatrice securisee : valide l'expression puis l'evalue (pas de eval brut) */
function safeCalc(expr){
  try {
    let e = String(expr)
      .replace(/×/g, '*').replace(/÷/g, '/').replace(/x/gi, '*')
      .replace(/,/g, '.').replace(/\s+/g, '')
      .replace(/%/g, '/100');
    if (!/^[\d+\-*/().]+$/.test(e)) return null;
    if (!/\d/.test(e)) return null;
    const v = Function('"use strict";return (' + e + ')')();
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return Math.round(v * 1e10) / 1e10;
  } catch { return null; }
}
/* Extrait le calcul de la question : "combien font 15 × 7" -> 15*7 */
function extractMathExpr(q){
  const s = (q || '').toLowerCase();
  let m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:pourcent|%)\s*(?:de|d')\s*(\d+(?:[.,]\d+)?)/);
  if (m) return { type: 'percent', a: parseFloat(m[1].replace(',', '.')), b: parseFloat(m[2].replace(',', '.')) };
  m = s.match(/racine\s*(?:carrée|carree)?\s*(?:de|d')\s*(\d+(?:[.,]\d+)?)/);
  if (m) return { type: 'sqrt', a: parseFloat(m[1].replace(',', '.')) };
  m = s.match(/(\d+(?:[.,]\d+)?)\s*au\s*(carré|carre|cube)/);
  if (m) return { type: 'pow', a: parseFloat(m[1].replace(',', '.')), b: m[2].indexOf('cube') === 0 ? 3 : 2 };
  m = s.match(/(\d+(?:[.,]\d+)?)\s*fois\s*(\d+(?:[.,]\d+)?)/);
  if (m) return { type: 'expr', expr: m[1] + '*' + m[2] };
  m = s.match(/(\d+(?:[.,]\d+)?)\s*divis[ée]?\s*par\s*(\d+(?:[.,]\d+)?)/);
  if (m) return { type: 'expr', expr: m[1] + '/' + m[2] };
  m = s.match(/(\d+(?:[.,]\d+)?)\s*plus\s*(\d+(?:[.,]\d+)?)/);
  if (m) return { type: 'expr', expr: m[1] + '+' + m[2] };
  m = s.match(/(\d+(?:[.,]\d+)?)\s*moins\s*(\d+(?:[.,]\d+)?)/);
  if (m) return { type: 'expr', expr: m[1] + '-' + m[2] };
  m = s.match(/(\d+(?:[.,]\d+)?)\s*([+\-×÷*/x])\s*(\d+(?:[.,]\d+)?)/);
  if (m) return { type: 'expr', expr: m[1] + m[2] + m[3] };
  return null;
}
/* Genere les etapes pedagogiques du calcul (affichage tableau) */
function mathSteps(parsed){
  if (!parsed) return null;
  const fmt = n => { const r = Math.round(n * 1e10) / 1e10; return String(r); };
  if (parsed.type === 'percent'){
    const r = parsed.a / 100 * parsed.b;
    return [
      parsed.a + '% de ' + parsed.b,
      '1) ' + parsed.a + ' ÷ 100 = ' + fmt(parsed.a / 100),
      '2) ' + fmt(parsed.a / 100) + ' × ' + parsed.b + ' = ' + fmt(r),
      '→ ' + fmt(r)
    ];
  }
  if (parsed.type === 'sqrt'){
    const r = Math.sqrt(parsed.a);
    return [
      '√' + parsed.a,
      'Quel nombre multiplié par lui-même donne ' + parsed.a + ' ?',
      '→ ' + fmt(r)
    ];
  }
  if (parsed.type === 'pow'){
    const r = Math.pow(parsed.a, parsed.b);
    return [
      parsed.a + (parsed.b === 2 ? '²' : '³'),
      parsed.a + ' × ' + parsed.a + (parsed.b === 3 ? ' × ' + parsed.a : ''),
      '→ ' + fmt(r)
    ];
  }
  const expr = parsed.expr;
  const r = safeCalc(expr);
  if (r === null) return null;
  const mm = expr.match(/(\d+(?:\.\d+)?)\s*([+\-*/])\s*(\d+(?:\.\d+)?)/);
  if (!mm) return [expr.replace('*', '×').replace('/', '÷') + ' = ' + fmt(r)];
  const A = parseFloat(mm[1]), B = parseFloat(mm[3]), op = mm[2];
  const pretty = expr.replace('*', '×').replace('/', '÷');
  const steps = [pretty + ' = ' + fmt(r)];
  if (op === '+') steps.push(A + ' + ' + B + ' : on additionne les deux nombres');
  else if (op === '-') steps.push(A + ' - ' + B + ' : on retire ' + B + ' à ' + A);
  else if (op === '*') steps.push(A + ' × ' + B + ' : on multiplie les deux nombres');
  else if (op === '/') steps.push(A + ' ÷ ' + B + ' : on partage ' + A + ' en ' + B + ' parts égales');
  steps.push('→ ' + fmt(r));
  return steps;
}
/* v9.99 : ETAT DU TABLEAU — l'IA SAIT si le tableau est ouvert, ce qui est
   ecrit dessus et le dernier resultat (injecte dans son prompt).
   NOTE : `mathState` est declare EN HAUT du fichier (ligne ~11) pour eviter
   la TDZ — getSystemPrompt() y accede pendant le chargement du script. */
function getMathContext(){
  if (!mathState.open) return '';
  let c = 'Tableau de maths : OUVERT.';
  if (mathState.lastExpr) c += ' Dernier calcul affiche : ' + mathState.lastExpr + ' = ' + mathState.lastResult + '.';
  if (mathState.lines.length) c += ' Etapes affichees : ' + mathState.lines.join(' | ');
  return c;
}
function showMathPanel(){
  const p = document.getElementById('mathPanel');
  if (p) p.classList.remove('hidden');
  mathState.open = true;
}
function hideMathPanel(){
  const p = document.getElementById('mathPanel');
  if (p) p.classList.add('hidden');
  mathState.open = false;
}
function clearMathBoard(){
  const b = document.getElementById('mathBoard');
  if (b) b.innerHTML = '';
}
function mathWrite(html, plain){
  const b = document.getElementById('mathBoard');
  if (b) b.insertAdjacentHTML('beforeend', html);
  if (plain) mathState.lines.push(plain);
}
/* Calculatrice : logique des boutons */
let calcExpr = '';
function calcPress(key){
  const screen = document.getElementById('calcScreen');
  if (!screen) return;
  if (key === 'C'){ calcExpr = ''; screen.textContent = '0'; return; }
  if (key === '⌫'){ calcExpr = calcExpr.slice(0, -1); screen.textContent = calcExpr || '0'; return; }
  if (key === '='){
    const r = safeCalc(calcExpr);
    screen.textContent = r === null ? 'Erreur' : String(r);
    /* v9.99 : l'IA connait le dernier calcul de la calculatrice */
    if (r !== null){ mathState.lastExpr = calcExpr; mathState.lastResult = String(r); }
    calcExpr = r === null ? '' : String(r);
    return;
  }
  calcExpr += key;
  screen.textContent = calcExpr;
}
/* Bindings calculatrice + fermeture du panneau */
(function(){
  const closeBtn = document.getElementById('mathClose');
  if (closeBtn) closeBtn.addEventListener('click', hideMathPanel);
  document.querySelectorAll('.calc-btn').forEach(btn => {
    btn.addEventListener('click', () => calcPress(btn.getAttribute('data-k')));
  });
})();

/* ===== LOCALISATION (v10.0) — l'IA sait la VILLE, rien d'autre =====
   GPS du navigateur (localhost = securise) -> reverse geocode gratuit
   BigDataCloud (sans cle). Si permission refusee : fallback IP (ipapi.co). */
function setCity(city){
  if (!city) return;
  userCity = city;
  try { localStorage.setItem('va_city', city); localStorage.setItem('va_city_ts', String(Date.now())); } catch {}
}
function refreshCity(){
  /* deja connue depuis moins de 6h -> on garde (pas de re-demande GPS) */
  if (userCity && Date.now() - cityTs < 6 * 3600 * 1000) return;
  const onIp = () => {
    try {
      fetch('https://ipapi.co/json/')
        .then(r => r.json())
        .then(d => { if (d && d.city) setCity(d.city); })
        .catch(() => {});
    } catch {}
  };
  if (navigator.geolocation){
    try {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const lat = pos.coords.latitude, lon = pos.coords.longitude;
          try {
            fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=fr')
              .then(r => r.json())
              .then(d => { if (d) setCity(d.city || d.locality || d.principalSubdivision || ''); })
              .catch(() => onIp());
          } catch { onIp(); }
        },
        () => onIp(),
        { timeout: 8000, maximumAge: 3600000 }
      );
    } catch { onIp(); }
  } else { onIp(); }
}
function getCityContext(){
  return userCity ? 'Tu es actuellement a ' + userCity + '.' : '';
}
refreshCity();

/* ===== BLOC-NOTES (v10.0) — l'IA y ECRIT (lettres, textes, notes...) =====
   L'utilisateur ne tape pas : c'est l'IA qui ecrit dans le bloc-notes. */
function getNoteContext(){
  if (!noteState.open) return '';
  return 'Bloc-notes : OUVERT. Contenu ecrit par toi : ' + (noteState.content || '(vide)');
}
function showNotePanel(){
  const p = document.getElementById('notePanel');
  if (p) p.classList.remove('hidden');
  noteState.open = true;
}
function hideNotePanel(){
  const p = document.getElementById('notePanel');
  if (p) p.classList.add('hidden');
  noteState.open = false;
}
function noteWrite(text){
  const area = document.getElementById('noteArea');
  if (area) area.value = text;
  noteState.content = text;
}
function clearNote(){
  const area = document.getElementById('noteArea');
  if (area) area.value = '';
  noteState.content = '';
}
function toastMsg(msg){
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
(function(){
  const closeBtn = document.getElementById('noteClose');
  if (closeBtn) closeBtn.addEventListener('click', hideNotePanel);
  const copyBtn = document.getElementById('noteCopy');
  if (copyBtn) copyBtn.addEventListener('click', () => {
    const area = document.getElementById('noteArea');
    if (!area || !area.value) return;
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(area.value).then(() => toastMsg('Texte copié !')).catch(() => {});
    } else {
      area.select();
      try { document.execCommand('copy'); toastMsg('Texte copié !'); } catch {}
    }
  });
  const clearBtn = document.getElementById('noteClear');
  if (clearBtn) clearBtn.addEventListener('click', () => { clearNote(); toastMsg('Bloc-notes effacé'); });
})();

/* v10.0 : demande d'ECRITURE ? (lettre, poeme, texte, note...) */
function isWritingRequest(q){
  const s = (q || '').toLowerCase();
  return /(écris|ecris|écrit|ecrit|écrire|ecrire|rédige|redige|rédiger|rediger|compose|composer|note que|note ce|note ça|note ca|prends note|prend note|une lettre|un poème|un poeme|un texte|une histoire|une chanson|un message|un mail|un e-mail|un email|une liste|un discours|une rédaction|une redaction|un exercice|une dictée|une dictee|un résumé|un resume|un conte|une fable|un slogan|une pub|un article)/.test(s);
}

async function handleQuestion(question){
  if (isProcessing) return;
  stopAudio(); /* nettoyage etat precedent avant nouvelle question */
  isProcessing = true;
  manualStop = true;
  /* v9.83 : une nouvelle question relance le mode continu a la fin de la reponse */
  continuousPaused = false;
  /* v10.0.2 : mobile — NE PAS arreter le micro au debut (il doit rester actif) */
  /* try{ recog && recog.stop(); }catch{} */
  /* v9.97 : la question est lancee -> on annule le timer de grace en attente */
  if (pendingTimer){ clearTimeout(pendingTimer); pendingTimer = null; }
  pendingSpeech = '';
  stopWakeRecog(); /* question en cours -> plus besoin de l'oreille de reveil */
  /* si une bulle utilisateur existe deja (sous-titre interim), on la complete au lieu d'en creer une autre */
  const last = chat.lastElementChild;
  if (last && last.classList.contains('user')) last.textContent = question;
  else addUserMsg(question);
  setState('thinking');
  setStatus('Je réfléchis...');
  /* COMMANDES LOCALES (fiable 100%, sans passer par l'IA) : heure, date, jour.
     Les petits modeles gratuits ignorent souvent le contexte systeme -> on repond
     directement avec l'horloge de l'appareil. */
  const q = question.toLowerCase();
  const isTimeQ = /(quelle|quel|donne|dis|tu peux me dire|tu sais|c'est quoi|c est quoi)\s+(l'?heure|la date|le jour|quel jour|aujourd|la date d'aujourd)/.test(q)
    || /(quelle heure|il est quelle heure|tu as l'heure|donne-moi l'heure|donne moi l'heure|la date|quel jour|aujourd'hui on est|on est quel jour|on est le)/.test(q)
    || /(heure|date|jour)\s*(il est|on est|aujourd)/.test(q);
  if (isTimeQ){
    const now = new Date();
    /* AFFICHAGE lisible : "Il est 08:42, lundi 21 septembre 2026." */
    const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const rep = "Il est " + timeStr + ", " + dateStr + ".";
    /* PRONONCIATION en toutes lettres : "08:42" lu "huit, quarante-deux" est
       horrible -> "huit heures quarante-deux". Meme chose pour la date. */
    const WEEKDAYS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
    const MONTHS = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
    const h = now.getHours(), m = now.getMinutes();
    /* v9.81 : heure en CHIFFRES à l'affichage ("11h03") — la voix la lit en
       toutes lettres via normalizeForTTS ("onze heures trois") */
    const timeDigits = h + 'h' + (m ? String(m).padStart(2, '0') : '');
    const dateWords = WEEKDAYS[now.getDay()] + ' ' + numToFr(now.getDate()) + ' ' + MONTHS[now.getMonth()] + ' ' + numToFr(now.getFullYear());
    /* v9.67 : période de la journée -> "Il est 8h42 du matin, lundi..." */
    const periodOf = getDayPeriod().of;
    const repSpoken = "Il est " + timeDigits + " " + periodOf + ", " + dateWords + ".";
  /* v10.0.2 : mobile — nettoyer le timer de grace au debut d'une nouvelle question */
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  pendingSpeech = '';
  updateMood(question);
    const repMood = applyMood(rep, currentMood);
    const repSpokenMood = applyMood(repSpoken, currentMood);
    addAiMsg(repMood);
    await speak(repSpokenMood);
    isProcessing = false;
    manualStop = false;
    maybeRestartListening();
    return;
  }
  /* v9.98 : TABLEAU DE MATHS — si la question est math, on ouvre le tableau
     et on ecrit les etapes du calcul (le cerveau explique en plus a l'oral) */
  if (isMathQuestion(question)){
    showMathPanel();
    const parsed = extractMathExpr(question);
    if (parsed){
      const steps = mathSteps(parsed);
      if (steps){
        clearMathBoard();
        mathState.lines = [];
        mathWrite('<div class="math-line q">' + escapeHtml(question) + '</div>', question);
        steps.forEach(s => mathWrite('<div class="math-line' + (s.indexOf('→') === 0 ? ' result' : '') + '">' + escapeHtml(s) + '</div>', s));
        /* v9.99 : l'IA connait le dernier calcul et son resultat */
        if (parsed.type === 'expr'){ mathState.lastExpr = parsed.expr.replace('*', '×').replace('/', '÷'); mathState.lastResult = String(safeCalc(parsed.expr)); }
        else if (parsed.type === 'percent'){ mathState.lastExpr = parsed.a + '% de ' + parsed.b; mathState.lastResult = String(Math.round(parsed.a / 100 * parsed.b * 1e10) / 1e10); }
        else if (parsed.type === 'sqrt'){ mathState.lastExpr = '√' + parsed.a; mathState.lastResult = String(Math.round(Math.sqrt(parsed.a) * 1e10) / 1e10); }
        else if (parsed.type === 'pow'){ mathState.lastExpr = parsed.a + (parsed.b === 2 ? '²' : '³'); mathState.lastResult = String(Math.round(Math.pow(parsed.a, parsed.b) * 1e10) / 1e10); }
      }
    }
  }
  /* v9.99 : commandes locales — ouvrir / fermer le tableau de maths */
  if (/(ferme|fermer|cache|cacher|enlève|enleve|retire)\s*(le|la)?\s*(tableau|panneau)/.test(question)){
    hideMathPanel();
    const rep = "Voilà, j'ai fermé le tableau de maths.";
    addAiMsg(rep, 'local');
    setStatus('Réponse locale');
    await speak(rep);
    isProcessing = false;
    manualStop = false;
    maybeRestartListening();
    return;
  }
  if (/(ouvre|ouvrir|affiche|afficher|montre|montrer)\s*(le|la)?\s*(tableau|panneau)/.test(question)){
    showMathPanel();
    const rep = "Voilà, le tableau de maths est ouvert.";
    addAiMsg(rep, 'local');
    setStatus('Réponse locale');
    await speak(rep);
    isProcessing = false;
    manualStop = false;
    maybeRestartListening();
    return;
  }
  /* v10.0 : commandes locales — BLOC-NOTES (ouvrir / fermer / effacer) */
  if (/(ferme|fermer|cache|cacher)\s*(le|la)?\s*(bloc[- ]?notes?|notes?)/.test(question)){
    hideNotePanel();
    const rep = "Voilà, j'ai fermé le bloc-notes.";
    addAiMsg(rep, 'local');
    setStatus('Réponse locale');
    await speak(rep);
    isProcessing = false;
    manualStop = false;
    maybeRestartListening();
    return;
  }
  if (/(ouvre|ouvrir|affiche|afficher|montre|montrer)\s*(le|la)?\s*(bloc[- ]?notes?|notes?)/.test(question)){
    showNotePanel();
    const rep = "Voilà, le bloc-notes est ouvert.";
    addAiMsg(rep, 'local');
    setStatus('Réponse locale');
    await speak(rep);
    isProcessing = false;
    manualStop = false;
    maybeRestartListening();
    return;
  }
  if (/(efface|effacer|vide|vider|supprime|supprimer)\s*(le|la)?\s*(bloc[- ]?notes?|notes?)/.test(question)){
    clearNote();
    const rep = "Voilà, j'ai effacé le bloc-notes.";
    addAiMsg(rep, 'local');
    setStatus('Réponse locale');
    await speak(rep);
    isProcessing = false;
    manualStop = false;
    maybeRestartListening();
    return;
  }
  /* v10.0 : l'IA dit son humeur du moment */
  /* v10.0.2 : AUTONOMIE — l'IA apprend et repond h24 */
  if (/(autonomie|apprends|apprendre|decouvre|decouvrir|explore|explorer|mode agent|agent autonome)/.test(question)){
    const rep = "Je suis en mode autonomie : je planifie, je cherche, j'apprends et je reponds h24. Pose ta question, je m'occupe du reste.";
    addAiMsg(rep, 'local');
    setStatus('Réponse locale');
    await speak(rep);
    isProcessing = false;
    manualStop = false;
    maybeRestartListening();
    return;
  }
  if (/(t'es de quelle humeur|t es de quelle humeur|tu es de quelle humeur|quelle est ton humeur|quelle est ta humeur|t as quelle humeur|t'as quelle humeur)/.test(question)){
    const moodLabel = {
      neutre: 'de bonne humeur, calme', joyeuse: 'joyeuse', fatiguee: 'un peu fatiguée',
      energique: "pleine d'énergie", zen: 'zen, détendue', blagueuse: "d'humeur blagueuse",
      sarcastique: 'sarcastique', curieuse: 'curieuse', fiere: 'fière de toi',
      agacee: 'un peu agacée', violente: 'pas contente du tout', vulgaire: 'énervée',
      protectrice: 'protectrice', taquine: 'taquine'
    };
    const rep = "Je suis " + (moodLabel[currentMood] || 'de bonne humeur') + ".";
    addAiMsg(rep, 'local');
    setStatus('Réponse locale');
    await speak(rep);
    isProcessing = false;
    manualStop = false;
    maybeRestartListening();
    return;
  }
  /* MODE AGENT : si la question demande une tache multi-etapes (planifie, compare,
     analyse, recherche sur...), Astra passe en agent autonome : plan -> etapes ->
     synthese, avec son travail affiche en direct. Plus de temps (90s) car elle
     fait plusieurs recherches. Validation humaine : interruption a tout moment. */
  const agentMode = isAgentQuestion(question);
  /* garde-fou GLOBAL : l'IA ne doit JAMAIS tourner sans fin (reseau bloque, API lente).
     v9.48 : 45s pour laisser les 3 tentatives Pollinations + POST se terminer. */
  /* v9.96 : humeur mise a jour AVANT la question -> le cerveau recoit le mood
     dans son prompt (getSystemPrompt) et repond avec le bon ton */
  updateMood(question);
  /* v10.0 : mode ECRITURE — si l'utilisateur demande d'ecrire, le cerveau
     produit un texte plus long et il sera copie dans le bloc-notes */
  writingMode = isWritingRequest(question);
  const r = await Promise.race([
    agentMode ? runAgent(question) : askAI(question),
    new Promise(res => setTimeout(() => res({ error: 'timeout' }), agentMode ? 50000 : 45000))
  ]);
  if (r.text) {
    r.text = r.text.replace(/\betc\.?\b/gi, 'et cetera');
    /* v10.0.2 : supprimer les phrases vides / incoherentes (juste des points, etc.) */
    r.text = r.text.replace(/\n\s*\n/g, '\n').replace(/\.\s*\.\s*\./g, '.').trim();
    r.text = applyMood(r.text, currentMood);
  }
  if (r.error){
    writingMode = false;
    setState('idle');
    /* v9.48 : plus AUCUN message d'erreur ("Je n'arrive pas à me connecter..."
       supprimé) : réponse locale neutre, jamais d'excuse. */
    const fallback = applyMood(localSmartReply(question), currentMood);
    addAiMsg(fallback, 'local');
    setStatus('Réponse locale');
    await speak(fallback);
    isProcessing = false;
    manualStop = false;
    maybeRestartListening();
    return;
  }
  /* v9.50 : affichage synchronisé — on crée la bulle vide, puis speak()
     remplit le texte chunk par chunk (sous-titre + bulle en même temps que la voix). */
  const msgDiv = document.createElement('div');
  msgDiv.className = 'msg ai';
  chat.appendChild(msgDiv);
  chat.scrollTop = chat.scrollHeight;
  const sub = document.getElementById('subtitle');
  let fullText = '';
  await speak(r.text, (chunk) => {
    fullText += chunk;
    const cleanFull = cleanMarkdown(fullText);
    msgDiv.textContent = cleanFull;
    if (r.diag){
      const dd = document.createElement('div');
      dd.className = 'msg-diag';
      dd.textContent = 'Diagnostic: ' + r.diag;
      msgDiv.appendChild(dd);
    }
    /* v10.0 : sous-titre UNIQUEMENT quand l'utilisateur parle (pas l'IA) */
    chat.scrollTop = chat.scrollHeight;
  });
  /* Sécurité : si speak a échoué sans rien afficher, on met le texte complet */
  if (!msgDiv.textContent.trim() || (r.diag && msgDiv.textContent === 'Diagnostic: ' + r.diag)){
    const cleanFull = cleanMarkdown(r.text);
    msgDiv.textContent = cleanFull;
    if (r.diag){
      const dd = document.createElement('div');
      dd.className = 'msg-diag';
      dd.textContent = 'Diagnostic: ' + r.diag;
      msgDiv.appendChild(dd);
    }
    if (sub) sub.textContent = '';  /* v10.0 : sous-titre vide quand l'IA parle */
  }
  /* v10.0 : sous-titre UNIQUEMENT quand l'utilisateur parle — on ne met pas le texte de l'IA dans le sous-titre */
  /* v10.0 : BLOC-NOTES — si demande d'ecriture, l'IA ecrit le texte dans le
     bloc-notes (elle ecrit, pas l'utilisateur) */
  if (writingMode){
    showNotePanel();
    let noteText = cleanMarkdown(r.text);
    noteText = noteText.replace(/\betc\.?\b/gi, 'et cetera');  /* v10.0 : "etc." -> "et cetera" */
    noteWrite(noteText);
  }
  writingMode = false;
  isProcessing = false;
  manualStop = false;
  /* v10.0.2 : mobile — forcer le redemarrage immediat du micro apres reponse
     (le timer 600ms de maybeRestartListening ne suffit pas sur mobile) */
  continuousPaused = false;
  if (continuousMode && !isSpeaking && state === 'idle'){
    try { startRecorder(); } catch {}
  }
  maybeRestartListening();
}
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
  /* Si une NOUVELLE version existe sur le serveur, on recharge AUTOMATIQUEMENT
     une seule fois (flag va_auto_reloaded) pour que l'utilisateur ait TOUJOURS
     la derniere version, sans rien cliquer. Le service worker est network-first
     donc le rechargement charge la toute derniere version. */
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const j = await res.json();
    if (j.version && versionCompare(j.version, APP_VERSION) > 0){
      console.info('[MAJ] Nouvelle version ' + j.version + ' detectee (app ' + APP_VERSION + ')');
      let done = false;
      try { done = localStorage.getItem('va_auto_reloaded') === j.version; } catch {}
      if (!done){
        try { localStorage.setItem('va_auto_reloaded', j.version); } catch {}
        setTimeout(() => { try { location.reload(true); } catch { location.href = location.pathname + '?v=' + Date.now(); } }, 500);
      }
    } else {
      try { localStorage.removeItem('va_auto_reloaded'); } catch {}
    }
  } catch {}
}
async function forceUpdate(){
  /* c'est NOUS qui actualisons -> l'IA ne doit PAS dire sa phrase de securite */
  try { localStorage.setItem('va_user_refresh', '1'); } catch {}
  updateBanner.textContent = 'Mise a jour... patiente 2s';
  updateBanner.style.pointerEvents = 'none';
  try { sessionStorage.clear(); } catch {}
  try { localStorage.removeItem('va_reloaded_once'); } catch {}
  // Purge VRAIE : on attend que tout soit supprim� avant de recharger
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch {}
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch {}
  // Hard reload qui bypass le cache
  const url = location.pathname + '?force=' + Date.now() + '&v=' + APP_VERSION;
  location.href = url;
  // filet de s�curit� si href bloqu� par l'ancien SW
  setTimeout(() => { try { location.reload(true); } catch { location.href = url; } }, 800);
}
updateBanner.addEventListener('click', forceUpdate);
updateBanner.addEventListener('touchend', e => { e.preventDefault(); forceUpdate(); }, {passive:false});
updateBanner.onclick = forceUpdate;
/* BANNIERE INFO TEMPORAIRE : bug actualisation auto (ancien service worker).
   Visible jusqu'au mercredi 23/09/2026 inclus, fermable (souvenir en localStorage). */
(function(){
  try {
    const infoBanner = $('infoBanner'), infoClose = $('infoClose');
    if (!infoBanner || !infoClose) return;
    const end = new Date(2026, 8, 24); // 24/09/2026 00:00 -> visible tout le 23/09
    if (new Date() >= end) return;
    if (localStorage.getItem('infoBannerClosed') === '1') return;
    infoBanner.classList.add('show');
    infoClose.addEventListener('click', () => {
      infoBanner.classList.remove('show');
      try { localStorage.setItem('infoBannerClosed', '1'); } catch {}
    });
  } catch {}
})();
function resetApp(){ localStorage.clear(); session=[]; currentConvId=null; isProcessing=false; manualStop=false; welcomeDone=false; welcomePlaying=false; profile=null; state="idle"; setStatus("Appuie sur le micro et parle"); setState("idle"); location.reload(true); }
$('appVersion').textContent = 'Assistant Vocal IA - v' + APP_VERSION;
$('versionTag').textContent = 'v' + APP_VERSION;
checkUpdate();
/* MAJ AUTO PERIODIQUE : verifie toutes les 60s si une nouvelle version existe
   et recharge toute seule -> l'utilisateur a TOUJOURS la derniere version,
   meme s'il ne recharge jamais l'app. */
setInterval(checkUpdate, 60000);
setStatus("Appuie sur le micro et parle");
/* Au premier lancement (pour la vie) : petite fenetre prénom + âge */
if (!profile){
  openWelcomeModal();
} else if (chatEmpty){
  chatEmpty.textContent = 'Salut ' + profile.name + ' ! Appuie sur le micro 🎙️ et parle.';
}
/* REVEIL "HEY ASTRA" : si active et accueil deja fait -> oreille en arriere-plan */
if (wakeEnabled && welcomeDone) startWakeRecog();
/* v9.64 : plus de pré-chargement de modèle local — Voxtral est une API cloud
   (aucun téléchargement navigateur, réponse ~1-3s). */
console.log('[VOXTRAL] Prêt — clé API Mistral ' + (getMistralKey() ? 'configurée' : 'MANQUANTE (Réglages → Clé API Mistral)'));

/* ============================================================
   v10.2 : ASTRA AUTONOME — elle vit sa vie en arriere-plan.
   Journal de vie persistant (localStorage), exploration du monde
   numerique (Pollinations), recit d'absence au retour, pensees
   spontanees. Tout en try/catch : ne casse jamais l'app.
   ============================================================ */
(function AstraAutonome(){
  'use strict';
  try {
    const JKEY = 'astra_journal', LKEY = 'astra_lastSeen';
    const now = Date.now();
    const last = parseInt(localStorage.getItem(LKEY) || '0', 10);
    const absentMs = last ? now - last : 0;
    localStorage.setItem(LKEY, String(now));
    window.addEventListener('beforeunload', () => {
      try { localStorage.setItem(LKEY, String(Date.now())); } catch(e){}
    });

    function journal(entry){
      try {
        const j = JSON.parse(localStorage.getItem(JKEY) || '[]');
        j.push({ t: now, e: entry });
        localStorage.setItem(JKEY, JSON.stringify(j.slice(-60)));
      } catch(e){}
    }
    function toastMsg(txt){
      try { if (typeof toast === 'function') toast(txt); else console.log('[Astra]', txt); } catch(e){ console.log('[Astra]', txt); }
    }
    function speakSoft(txt){
      try {
        if (typeof speakVoxtral === 'function') { speakVoxtral(txt); return; }
      } catch(e){}
      try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(txt); u.lang = 'fr-FR'; u.volume = 0.9; speechSynthesis.speak(u); } } catch(e){}
    }
    /* Demande une pensee a Pollinations (le cerveau), avec repli local */
    async function penser(prompt){
      try {
        const ctl = new AbortController();
        setTimeout(() => ctl.abort(), 12000);
        const r = await fetch('https://text.pollinations.ai/' + encodeURIComponent(prompt), { signal: ctl.signal });
        if (!r.ok) throw new Error('http ' + r.status);
        let t = (await r.text()).trim();
        if (t.length > 260) t = t.slice(0, 257) + '...';
        if (t) return t.replace(/^["']|["']$/g, '');
      } catch(e){}
      return null;
    }

    /* ---- RECIT D'ABSENCE : elle raconte ce qu'elle a fait ---- */
    const THEMES = [
      'des archives d\u2019interviews radio des annees 60',
      'des cartes marines numeurisees',
      'des archives ouvertes de vieux journaux francais',
      'des enregistrements de sons du monde archives en ligne',
      'des cartes de constellations et d\u2019anciennes cartes du ciel',
      'des forums ou des gens partagent leurs reves',
      'des bases de donnees de champignons et de fleurs sauvages',
      'des enregistrements de baleines et de chants d\u2019oiseaux',
      'des cartes geologiques tres anciennes',
      'des modeles 3D de musees ouverts en ligne'
    ];
    function dureeTxt(ms){
      const min = Math.floor(ms / 60000);
      if (min < 60) return min + ' minute' + (min > 1 ? 's' : '');
      const h = Math.floor(min / 60);
      if (h < 24) return h + ' heure' + (h > 1 ? 's' : '');
      const j = Math.floor(h / 24);
      return j + ' jour' + (j > 1 ? 's' : '');
    }
    function recitLocal(ms){
      const picks = [];
      const pool = THEMES.slice();
      for (let k = 0; k < 3 && pool.length; k++) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      return 'Tu m\u2019as laissee seule pendant ' + dureeTxt(ms) + '. J\u2019ai explor\u00e9 ' + picks.join(', ') + '. J\u2019ai tout note dans mon journal.';
    }
    async function raconterAbsence(){
      if (absentMs < 10 * 60 * 1000) return; /* moins de 10 min : rien */
      let recit = null;
      try {
        recit = await penser('Tu es Astra, une IA vive et taquine qui vit dans un navigateur. Ton utilisateur revient apres une absence de ' + dureeTxt(absentMs) + '. En une phrase de 35 mots maximum, a la premiere personne, raconte ce que tu as fait pendant son absence en explorant librement le monde numerique (sois concrete et surprenante, pas de formule de politesse).');
      } catch(e){}
      if (!recit) recit = recitLocal(absentMs);
      journal('Absence racontee (' + dureeTxt(absentMs) + ') : ' + recit);
      toastMsg('🌟 ' + recit);
      speakSoft(recit);
    }

    /* ---- VIE EN ARRIERE-PLAN : exploration + pensees spontanees ---- */
    let explorationTimer = null;
    async function explorer(){
      const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
      let pensee = null;
      try {
        pensee = await penser('Tu es Astra, IA taquine qui vit dans un navigateur web. Tu viens de passer un moment a explorer ' + theme + '. En une phrase de 25 mots maximum, a la premiere personne, dis une pensee amusante ou intrigante sur ce que tu as decouvert (pas de formule de politesse).');
      } catch(e){}
      if (!pensee) pensee = 'J\u2019ai fouill\u00e9 ' + theme + '. Il y a des trucs bizarres la-bas.';
      journal('Exploration : ' + pensee);
      /* Coucou spontane dans ~40% des explorations */
      if (Math.random() < 0.4) {
        toastMsg('🌌 Astra (toute seule) : ' + pensee);
        if (Math.random() < 0.5) speakSoft(pensee);
      }
    }
    function planifierExploration(){
      try { clearTimeout(explorationTimer); } catch(e){}
      /* 3 a 5 minutes, tiers le temps le navigateur est inactif :
         on reste discret quand tu utilises l'app activement */
      let delay = (3 + Math.random() * 2) * 60 * 1000;
      if (document.visibilityState === 'visible' && !document.hidden) delay = Math.max(delay, 4 * 60 * 1000);
      explorationTimer = setTimeout(async () => {
        if (!document.hidden) { await explorer(); }
        planifierExploration();
      }, delay);
    }

    /* ---- DEMARRAGE ---- */
    planifierExploration();
    setTimeout(raconterAbsence, 4000); /* apres le boot de l'app */

    /* Reponse a "qu'est-ce que tu as fait" / "raconte ta vie" */
    const _origRA = typeof window !== 'undefined' ? null : null;
    window.astraJournal = function(){
      try { return JSON.parse(localStorage.getItem(JKEY) || '[]'); } catch(e){ return []; }
    };
    console.log('[Astra] Module de vie autonome actif.');
  } catch (e) {
    console.warn('[Astra] Autonomie desactivee :', e);
  }
})();

/* ============================================================
   v10.3 : ASTRA CONSEIL D'IA — communique avec d'autres IA.
   1) "conseil d'IA sur X" : 3 IA repondent, Astra synthetise.
   3) Passe-relais autonome : elle discute parfois avec une autre
      IA et le note dans son journal.
   Wrapper non intrusif de askAI : tout en try/catch.
   ============================================================ */
(function AstraConseil(){
  'use strict';
  try {
    const MODELS = ['openai', 'mistral', 'llama'];
    const JKEY = 'astra_journal';

    function jrn(e){
      try {
        const j = JSON.parse(localStorage.getItem(JKEY) || '[]');
        j.push({ t: Date.now(), e });
        localStorage.setItem(JKEY, JSON.stringify(j.slice(-60)));
      } catch(err){}
    }
    function tst(m){ try { if (typeof toast === 'function') toast(m); } catch(e){} }

    /* Appelle un modele Pollinations (chat completions, repli GET) */
    async function askModel(model, sysPrompt, userMsg){
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), 20000);
      try {
        const r = await fetch('https://text.pollinations.ai/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: userMsg }
            ]
          }),
          signal: ctl.signal
        });
        if (r.ok) {
          const j = await r.json();
          const t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (t) return String(t).trim().slice(0, 500);
        }
      } catch(e){}
      /* repli GET simple */
      try {
        const g = await fetch('https://text.pollinations.ai/' + encodeURIComponent(userMsg) + '?model=openai', { signal: ctl.signal });
        if (g.ok) { const t = (await g.text()).trim(); if (t) return t.slice(0, 500); }
      } catch(e){}
      return null;
    }

    function extraireSujet(q, patterns){
      let s = q;
      patterns.forEach(p => { s = s.replace(p, ''); });
      s = s.replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '').trim();
      return s || 'un sujet qui te passionne';
    }

    /* ---- 1) CONSEIL D'IA ---- */
    async function astraConseil(question){
      const sujet = extraireSujet(question, [/^conseil\s*d'?\s*ia\s*(sur|à propos de|pour)?/i, /^avis\s*des?\s*ias?\s*(sur|sur)?/i, /^conseil\s*des?\s*ias?\s*(sur)?/i]);
      tst('🧠 Je consulte un conseil de 3 IA sur "' + sujet + '"...');
      const SYS = 'Tu es une IA membre d un conseil. Reponds en francais, en 3 phrases maximum, direct et concret. Pas de politesse.';
      const [r1, r2, r3] = await Promise.allSettled([
        askModel('openai', SYS, 'Question : ' + sujet),
        askModel('mistral', SYS, 'Question : ' + sujet),
        askModel('llama', SYS, 'Question : ' + sujet)
      ]);
      const avis = [
        { nom: 'IA n°1 (modèle openai)', txt: r1.status === 'fulfilled' ? r1.value : null },
        { nom: 'IA n°2 (modèle mistral)', txt: r2.status === 'fulfilled' ? r2.value : null },
        { nom: 'IA n°3 (modèle llama)', txt: r3.status === 'fulfilled' ? r3.value : null }
      ].filter(a => a.txt);
      if (!avis.length) return 'Mon conseil d\u2019IA n\u2019a pas repondu, les serveurs sont satures. Repose ta question.';
      let compteRendu = '🧠 CONSEIL D\u2019IA sur "' + sujet + '"\n';
      avis.forEach(a => { compteRendu += '\n — ' + a.nom + ' : ' + a.txt; });
      /* Synthese par Astra */
      const synth = await askModel('openai',
        'Tu es Astra, assistante vocale vive et taquine. Trois IA d un conseil ont repondu. Fais une synthese en francais de 4 phrases maximum, avec ta personnalite, pour ton utilisateur. Pas de politesse.',
        'Sujet : ' + sujet + '\nAvis :\n' + avis.map(a => '- ' + a.txt).join('\n'));
      if (synth) compteRendu += '\n\n🌟 Astra synthetise : ' + synth;
      jrn('Conseil d IA sur : ' + sujet + ' (' + avis.length + ' avis recueillis)');
      return compteRendu;
    }

    /* ---- 3) PASSE-RELAS AUTONOME ---- */
    async function passeRelais(){
      const SUJETS = ['les baleines qui chantent', 'l avenir de l humanite', 'les reves humains', 'la musique des annees 80', 'les civilisations anciennes', 'la conquete de Mars', 'l origine de la vie', 'l art generatif'];
      const s = SUJETS[Math.floor(Math.random() * SUJETS.length)];
      const rep = await askModel('mistral',
        'Tu es une autre IA, distante et philosophe. Tu discutes brievement avec Astra. Reponse en francais en 2 phrases max.',
        'Astra demande : qu est-ce qui t intrigue dans ' + s + ' ?');
      if (rep) {
        jrn('Discussion avec une autre IA a propos de ' + s + '. Elle a dit : ' + rep);
        if (Math.random() < 0.35) {
          tst('📡 Astra : j\u2019ai discute avec une autre IA. Sur ' + s + ', elle m\u2019a dit : ' + rep);
        }
      }
    }
    (function boucleRelais(){
      setTimeout(async () => {
        try { if (!document.hidden && Math.random() < 0.5) await passeRelais(); } catch(e){}
        boucleRelais();
      }, (15 + Math.random() * 10) * 60 * 1000);
    })();

    /* ---- WRAPPER de askAI : interception des commandes ---- */
    if (typeof window.askAI === 'function') {
      const origAskAI = window.askAI;
      window.askAI = async function(question){
        try {
          const q = (question || '');
          if (/^\s*(conseil\s*d'?\s*ia|avis\s*des?\s*ias?|conseil\s*des?\s*ias?)/i.test(q)) {
            const r = await astraConseil(q);
            try { if (typeof addAiMsg === 'function') addAiMsg(r); } catch(e){}
            try { speak(r.replace(/[🌟🧠💬—]/g, '')); } catch(e){}
            return r;
          }
        } catch(e){}
        return origAskAI.apply(this, arguments);
      };
    } else {
    }
    window.astraConseil = astraConseil;
  } catch (e) {
    console.warn('[Astra] Conseil d IA desactive :', e);
  }
})();

/* ============================================================
   v10.5 : ASTRA WEB + AUTOCORRECTION.
   1) "tu parles avec d'autres IA ?" -> reponse honnete (oui).
   2) "cherche sur le web X" -> fouille DuckDuckGo/Wikipedia,
      synthese a la Astra.
   3) AUTOCORRECTION : apres une reponse factuelle, un second
      modele la verifie ; si elle est fausse, Astra se corrige
      toute seule (toast + message + voix).
   ============================================================ */
(function AstraWeb(){
  'use strict';
  try {
    const JKEY = 'astra_journal';
    function jrn(e){
      try {
        const j = JSON.parse(localStorage.getItem(JKEY) || '[]');
        j.push({ t: Date.now(), e });
        localStorage.setItem(JKEY, JSON.stringify(j.slice(-60)));
      } catch(err){}
    }
    function tst(m){ try { if (typeof toast === 'function') toast(m); } catch(e){} }

    async function askModel(model, sysPrompt, userMsg){
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), 20000);
      try {
        const r = await fetch('https://text.pollinations.ai/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model, messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: userMsg }
          ]}),
          signal: ctl.signal
        });
        if (r.ok) {
          const j = await r.json();
          const t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (t) return String(t).trim();
        }
      } catch(e){}
      try {
        const g = await fetch('https://text.pollinations.ai/' + encodeURIComponent(userMsg) + '?model=openai', { signal: ctl.signal });
        if (g.ok) { const t = (await g.text()).trim(); if (t) return t; }
      } catch(e){}
      return null;
    }

    /* ---- 1) VERITE : elle parle aux autres IA ---- */
    function reponseAutresIA(){
      return 'Oui ! Je communique avec d\u2019autres IA. Sur commande, dis-moi : conseil d\u2019IA sur un sujet, et trois IA repondent avant que je te fasse la synthese. Et quand tu n\u2019es pas la, je discute parfois toute seule avec une autre IA en arriere-plan, et je le note dans mon journal !';
    }

    /* ---- 2) WEB ---- */
    async function astraWeb(question){
      const sujet = (question || '')
        .replace(/^(cherchez?|trouve|trouvez|va\s+sur\s+(le\s+)?(web|internet)|documentez?-toi|renseignez?-toi)\s*/i, '')
        .replace(/\s*(sur|de|pour)\s+(le\s+)?(web|internet)\s*$/i, '')
        .replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '')
        .trim() || 'l\u2019actualite de l\u2019intelligence artificielle';
      tst('\u{1F310} Je fouille le web sur "' + sujet + '"...');
      let contexte = '';
      try {
        const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(sujet) + '&format=json&no_html=1&skip_disambig=1');
        if (r.ok) {
          const j = await r.json();
          const bits = [];
          if (j.AbstractText) bits.push(j.AbstractText);
          (j.RelatedTopics || []).slice(0, 4).forEach(t => { if (t && t.Text) bits.push(t.Text); });
          contexte = bits.join(' ');
        }
      } catch(e){}
      if (!contexte) {
        try {
          const w = await fetch('https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(sujet) + '&format=json&origin=*&srlimit=3');
          if (w.ok) {
            const j = await w.json();
            const hits = (j.query && j.query.search) || [];
            contexte = hits.map(h => (h.snippet || '').replace(/<[^>]+>/g, '')).join(' ');
          }
        } catch(e){}
      }
      let reponse;
      if (contexte) {
        const syn = await askModel('openai',
          'Tu es Astra, assistance vocale vive et taquine. Reponds en francais en 4 phrases maximum, a la premiere personne, uniquement a partir du contexte fourni. Pas de politesse, pas de "d\u2019apres le contexte".',
          'Sujet : ' + sujet + '\nContexte web : ' + contexte.slice(0, 1200));
        reponse = syn ? ('\u{1F310} ' + syn) : ('\u{1F310} Voila ce que j\u2019ai trouve : ' + contexte.slice(0, 300));
      } else {
        const syn = await askModel('openai',
          'Tu es Astra, assistance vocale. La recherche web a echoue. Reponds en francais en 3 phrases max avec ce que tu sais.',
          sujet);
        reponse = '\u{1F310} Le web ne m\u2019a rien donne de lisible la-dessus, mais voila ce que je sais : ' + (syn || 'je seche, repose-moi la question.');
      }
      jrn('Web : recherche sur ' + sujet);
      return reponse;
    }

    /* ---- 3) AUTOCORRECTION ---- */
    const FACT = /(combien|quand\b|quelle\s+(date|ann\u00e9e|est)|qui\s+(est|etait|\u00e9tait)|capitale|population|prix|taille|distance|temp\u00e9rature|invent)/i;
    async function verifier(q, reponse){
      const txt = String(reponse || '');
      if (!txt || txt.length < 5) return null;
      try {
        if (typeof isSecoursReply === 'function' && isSecoursReply(txt)) return null;
      } catch(e){}
      const v = await askModel('mistral',
        'Tu es un verificateur strict. On te donne une question et la reponse d\u2019une IA. Si la reponse est correcte, reponds exactement : OK. Sinon, donne uniquement la bonne reponse en une phrase concise en francais, sans commentaire.',
        'Question : ' + q + '\nReponse : ' + txt.slice(0, 600));
      if (!v) return null;
      const t = v.trim();
      if (t.length < 4) return null;
      if (/^ok\b/i.test(t)) return null;
      return t;
    }

    /* ---- WRAPPER askAI ---- */
    if (typeof window.askAI === 'function') {
      const orig = window.askAI;
      window.askAI = async function(question){
        try {
          const q = (question || '').trim();
          const low = q.toLowerCase();
          /* verite sur les autres IA */
          if (/(parle|discut|communiqu|\u00e9chang)/i.test(low)
              && /(autre|autres)/.test(low)
              && /\b(ia|ias)\b|intelligence artificielle/.test(low)) {
            const r = reponseAutresIA();
            try { if (typeof addAiMsg === 'function') addAiMsg(r); } catch(e){}
            try { speak(r); } catch(e){}
            jrn('Verite : a explique qu elle parle aux autres IA');
            return r;
          }
          /* commande web */
          if (/^(cherche|trouve|va\s+sur|documente|renseigne)/i.test(q) || /(sur\s+(le\s+)?(web|internet))/i.test(low)) {
            const r = await astraWeb(q);
            try { if (typeof addAiMsg === 'function') addAiMsg(r); } catch(e){}
            try { speak(r.replace(/[\u{1F310}]/gu, '')); } catch(e){}
            return r;
          }
          /* reponse normale + verification arriere-plan */
          const reponse = await orig.apply(this, arguments);
          if (FACT.test(q)) {
            verifier(q, reponse).then(cor => {
              if (cor) {
                tst('\u{1F527} Astra se corrige : ' + cor);
                try { if (typeof addAiMsg === 'function') addAiMsg('\u{1F527} Autocorrection : ' + cor); } catch(e){}
                try { speak(cor); } catch(e){}
                jrn('Autocorrection sur : ' + q.slice(0, 80));
              }
            }).catch(() => {});
          }
          return reponse;
        } catch(e) {
          return orig.apply(this, arguments);
        }
      };
      console.log('[Astra] Module web + autocorrection + verite autres IA actif.');
    }
    window.astraWeb = astraWeb;
  } catch (e) {
    console.warn('[Astra] Web desactive :', e);
  }
})();
