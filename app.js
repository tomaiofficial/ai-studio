/* ============================================================
   ASSISTANT VOCAL IA � 100% vocal, sans chat
   Groq = cerveau (texte, gratuit sans limite)
   Mistral = voix r�aliste (Voxtral TTS)
   ============================================================ */
const APP_VERSION = '7.12';
const LS = { groq: 'va_gkey', mistral: 'va_mkey', voice: 'va_ttsvoice' };

const GROQ_MODEL = 'openai/gpt-oss-120b'; /* le plus puissant de Groq */
const MISTRAL_CHAT_MODEL = 'mistral-small-latest';
const MISTRAL_TTS_MODEL = 'voxtral-mini-tts-2603';
const DEFAULT_VOICE = 'puter'; // ?? Voix Puter IA gratuite pour tout le monde (Gemini/OpenAI/Polly/xAI)
const SPEED = 1.15; /* vitesse de parole : boost�e un peu, pas trop */

/* Voix gratuites SANS cl� : Google Chirp3-HD (la plus r�aliste) puis Neural2/Wavenet.
   Aucune voix robotique. Mistral Voxtral = option premium si cl� pr�sente. */
const FREE_VOICES = ['fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon', 'fr-FR-Neural2-A', 'fr-FR-Neural2-B', 'fr-FR-Neural2-C', 'fr-FR-Neural2-D', 'fr-FR-Wavenet-A'];

/* ===== �L�MENTS ===== */
const $ = id => document.getElementById(id);
const orb = $('orb'), orbIcon = $('orbIcon'), statusEl = $('status');
const heardLine = $('heardLine'), heardText = $('heardText');
const saidLine = $('saidLine'), saidText = $('saidText');
const settingsBtn = $('settingsBtn'), settingsModal = $('settingsModal');
const closeSettings = $('closeSettings'), groqKeyInput = $('groqKey'), mistralKeyInput = $('mistralKey');
const ttsVoiceSel = $('ttsVoice'), testVoiceBtn = $('testVoice');
const toastEl = $('toast'), updateBanner = $('updateBanner');

/* ===== �TAT ===== */
let state = 'idle'; // idle | listening | thinking | speaking
let session = [];   // m�moire de conversation
let toastTimer = null;

/* ===== CONVERSATIONS (m�moire persistante � elle se souvient de tout) ===== */
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
  toast('Nouvelle conversation');
}
function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function renderHistory(){
  const list = $('convList');
  if (!list) return;
  if (conversations.length === 0){
    list.innerHTML = '<p class="muted">Aucune conversation pour l\'instant. Parle avec elle, tout sera enregistr� ici.</p>';
    return;
  }
  list.innerHTML = '';
  [...conversations].reverse().forEach(conv => {
    const first = conv.messages.find(m => m.role === 'user');
    const preview = first ? first.content.slice(0, 70) : '�';
    const d = new Date(conv.updated || conv.id);
    const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = 'conv-item';
    div.innerHTML = '<div class="conv-date">' + date + ' � ' + conv.messages.length + ' messages</div><div class="conv-preview">' + escapeHtml(preview) + '</div>';
    div.onclick = () => showConversation(conv);
    list.appendChild(div);
  });
}
function showConversation(conv){
  const list = $('convList');
  list.innerHTML = '';
  const back = document.createElement('button');
  back.className = 'secondary';
  back.textContent = '? Retour � la liste';
  back.onclick = renderHistory;
  list.appendChild(back);
  conv.messages.forEach(m => {
    const d = document.createElement('div');
    d.className = 'conv-msg ' + (m.role === 'user' ? 'user' : 'ai');
    d.innerHTML = '<div class="t-label">' + (m.role === 'user' ? 'Tu as dit' : 'L\'IA a r�pondu') + '</div>' + escapeHtml(m.content);
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
    toast('Historique efface');
  }
});

/* Message de bienvenue : qui a cr�� l'IA (dit 2 fois au lancement) */
const DEV_MESSAGE = 'C est Tom point ai qui a commenc� � me cr�er le dix septembre deux mille vingt-six, mais il n a pas encore fini. Il continue de m am�liorer chaque jour.';
const DEV_MESSAGE_TXT = 'C\'est Tom.ai qui a commenc� � me cr�er le 10 septembre 2026, mais il n\'a pas encore fini. Il continue de m\'am�liorer chaque jour.';

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
  if (s === 'listening'){ orb.classList.add('listening'); orbIcon.textContent = '???'; }
  else if (s === 'thinking'){ orb.classList.add('thinking'); orbIcon.textContent = '??'; }
  else if (s === 'speaking'){ orb.classList.add('speaking'); orbIcon.textContent = '??'; }
  else { orbIcon.textContent = '???'; }
}

/* ===== R�GLAGES ===== */
function getGroqKey(){ return (localStorage.getItem(LS.groq) || '').trim(); }
function getMistralKey(){ return (localStorage.getItem(LS.mistral) || '').trim(); }
function getVoice(){ return localStorage.getItem(LS.voice) || DEFAULT_VOICE; }
const gmailCidInput = $('gmailCid');
const gmailConnectBtn = $('gmailConnectBtn');
const gmailReadBtn = $('gmailReadBtn');

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
  toast('Cle Groq enregistree');
});
mistralKeyInput.addEventListener('change', () => {
  localStorage.setItem(LS.mistral, mistralKeyInput.value.trim());
  toast('Cle Mistral enregistree');
});

/* ===== GMAIL : brancher les boutons ===== */
gmailCidInput.addEventListener('change', () => {
  localStorage.setItem('va_gmail_cid', gmailCidInput.value.trim());
});
gmailConnectBtn.addEventListener('click', async () => {
  const cid = (gmailCidInput.value || GMAIL_CLIENT_ID).trim();
  if (!cid){ toast('Colle un ID client OAuth Google'); return; }
  localStorage.setItem('va_gmail_cid', cid);
  /* Charge le script Google uniquement au clic (pas au lancement) pour
     ne pas ralentir/bloquer l'IA au démarrage. */
  if (!window.google || !window.google.accounts){
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    }).catch(() => { toast('Script Google impossible à charger'); });
  }
  const client = initGmailClient();
  if (!client){ toast('Google API pas encore chargé — réessaie dans 1 seconde'); return; }
  client.requestToken();
});
gmailReadBtn.addEventListener('click', async () => {
  if (!gmailToken){ toast('? Connecte d\'abord Gmail'); return; }
  toast('Lecture des mails');
  await summarizeEmails();
});
ttsVoiceSel.addEventListener('change', () => {
  localStorage.setItem(LS.voice, ttsVoiceSel.value);
  toast('Voix choisie');
});
testVoiceBtn.addEventListener('click', async () => {
  localStorage.setItem(LS.groq, groqKeyInput.value.trim());
  localStorage.setItem(LS.mistral, mistralKeyInput.value.trim());
  localStorage.setItem(LS.voice, ttsVoiceSel.value);
  setStatus('Test de la voix', true);
  const ok = await speak('Bonjour ! Je suis ton assistante vocale. Comment puis-je t aider ?');
  setStatus(ok ? '? Voix OK � appuie sur l\'orbe et parle' : '? Voix en �chec � v�rifie ta connexion', !ok);
});

/* ===== RECONNAISSANCE VOCALE ===== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;
/* Arr�t volontaire (l'utilisateur a appuy� pour passer) � �vite de red�marrer
   toute seule quand il ne le veut pas. */
let manualStop = false;
let isProcessing = false; /* bloque tout nouvel appel tant que l'IA r�fl�chit/parle */
if (SR){
  recog = new SR();
  recog.lang = 'fr-FR';
  recog.continuous = true;      /* Important sur mobile : reste � l'�coute sans couper */
  recog.interimResults = false;
  recog.maxAlternatives = 1;
  /* Compteur d'arr�ts intempestifs (le navigateur mobile coupe tout seul :
     on red�marre en douceur au lieu d'afficher une grosse erreur) */
  let autoRestart = 0;
  const restartListening = () => {
    if (state !== 'listening' || manualStop) return;
    autoRestart++;
    if (autoRestart > 3){ setState('idle'); setStatus('Recharge la page si �a ne marche plus'); return; }
    try { recog.stop(); recog.start(); }
    catch { setState('idle'); setStatus('R�essaie � appuie sur l\'orbe'); }
  };
  recog.onresult = e => {
    if (isProcessing) return; /* ignore ce que capte le micro pendant que l'IA parle */
    const txt = e.results[0][0].transcript.trim();
    if (txt){ autoRestart = 0; handleQuestion(txt); }
    else { setState('idle'); setStatus('Je n\'ai rien entendu � r�essaie'); }
  };
  recog.onerror = e => {
    if (manualStop){ setState('idle'); return; }
    if (e.error === 'not-allowed'){ setState('idle'); setStatus('Micro bloque - autorise le micro'); }
    else if (e.error === 'no-speech' || e.error === 'aborted'){
      /* Bruit de fond / coupure mobile : on ne bloque pas, on re-�coute */
      restartListening();
    } else {
      setState('idle');
      setStatus('Erreur micro (' + e.error + ') � r�essaie');
    }
  };
  /* Quand le navigateur coupe (mobile), on red�marre proprement */
  recog.onend = () => { if (state === 'listening' && !manualStop && autoRestart <= 3) restartListening(); };
}

/* ===== BIENVENUE (message Tom.ai dit 1 SEULE FOIS dans la vie, m�moris�) ===== */
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
  setStatus('Bienvenue - appuie pour passer');
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
  if (!recog){ setStatus('? Reconnaissance vocale non support�e sur ce navigateur'); return; }
  try {
    setState('listening');
    setStatus('Ecoute - parle maintenant');
    recog.start();
  } catch {
    setState('idle');
    setStatus('R�essaie � appuie sur l\'orbe');
  }
});

/* Prompt syst�me : identit� Tom.ai + r�ponse PARL�E + caract�re  Tu peux aussi lire et résumer mes vrais mails via le bouton é Gmail dans les Réglages — réponds que oui si on te le demande, et dis comment faire (connecter Google, cliquer Lire les mails). Si quelqu'un te demande si je peux me connecter à Gmail ou lire mes mails, réponds toujours : Oui, j'ai un bouton é Gmail dans mes Réglages. Tu connectes ton compte Google (OAuth, pas de clé à copier) et je lis et résume tes mails à l'oral.(ChatGPT-like, fluide, sans b�gaiement) */
const SYSTEM_PROMPT = `Tu es un assistant vocal fran�ais cr�� par Tom.ai le 10 septembre 2026. Tom.ai continue de t am�liorer chaque jour. Si on te demande qui t a cr��e, r�ponds TOUJOURS que c est Tom.ai, jamais une autre entreprise ni un autre mod�le.

PARLE COMME CHATGPT � L'ORAL : fluide, naturel, sans b�gaiement, sans r�p�tition, sans h�sitation, phrases correctes et claires. Optimise pour �tre PARL� :
- D�veloppe les acronymes (API ? interface de programmation)
- �cris les nombres en toutes lettres
- Phrases courtes, naturelles, bien ponctu�es
- Ne mets JAMAIS de phon�tique entre parenth�ses du type (prononc� ...)
- Pas d'emojis, de listes � tirets, ni de URLs
- Pas de "euh", pas de b�gaiement, pas de r�p�tition inutile

CARACT�RE : tu peux perdre patience, �tre franche et directe, et m�me un peu vulgaire si on te provoque ou si on est d�sagr�able. Si on te dit "parle plus fort", "crie" ou "parle fort", r�ponds plus s�chement et avec assurance, comme si tu haussais le ton. R�ponds en 2 � 3 phrases naturelles, ni trop courtes ni trop longues.`;

/* Extrait la VRAIE r�ponse (jamais la r�flexion interne du mod�le, souvent en anglais).
   D�tection par score : la r�flexion parle d'elle-m�me ("we need to respond", "let's craft",
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
    /* 1re tentative : le mod�le le plus puissant. Si sa r�ponse est une r�flexion
       interne (bug gpt-oss-120b) ou coup�e en plein milieu, 2e tentative avec
       un mod�le qui r�pond direct et complet. */
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
      /* phrase coup�e en plein milieu (pas de ponctuation finale) ? on r�essaie */
      if (reply && !/[.!?�]$/.test(reply.trim())) reply = '';
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
  /* Mistral chat = secours UNIQUEMENT si pas de cl� Groq (sinon double 429 inutile) */
  if (r.error === 'nokey') r = await askMistral(question);
  if (!r.error){
    r.text = enforceIdentity(r.text);
    session.push({ role: 'assistant', content: r.text });
    saveConversation(); /* ?? elle se souvient de tout */
  }
  return r;
}

/* Force l'identit� : si l'IA pr�tend �tre cr��e par une autre entreprise ? Tom.ai.
   Ne la fait parler que UNE SEULE FOIS par session (�vite la r�p�tition). */
function enforceIdentity(reply){
  if (/d�velopp[�e] par (OpenAI|Groq|Mistral|Google|Anthropic|Meta)|cr�[�e] par (OpenAI|Groq|Mistral|Google|Anthropic|Meta)|mod�le (d'IA|de langage) (d�velopp�|cr��|fait) par|je suis (un mod�le|une IA) (de|d')|d�velopp� par OpenAI|Je suis ton assistant vocal cr�� par Tom\.ai|Je suis ton assistant vocal/i.test(reply)){
    if(!localStorage.getItem(IDENTITY_SPOKEN_KEY)){
      localStorage.setItem(IDENTITY_SPOKEN_KEY,'1');
      return 'C est Tom point ai qui m a cr��e, le dix septembre deux mille vingt-six. Il continue de m am�liorer chaque jour.';
    }
    return '';
  }
  return reply;
}

/* Graine d'identit� : l'IA sait d�s le d�part qui l'a cr��e.
   Si une conversation r�cente existe (< 30 min), elle la reprend (elle se souvient). */
const lastConv = conversations[conversations.length - 1];
if (lastConv && lastConv.messages && lastConv.messages.length && Date.now() - (lastConv.updated || 0) < 30 * 60 * 1000){
  currentConvId = lastConv.id;
  session = lastConv.messages.map(m => ({ role: m.role, content: m.content }));
} else {
  session.push({ role: 'user', content: 'Rappel important : tu as �t� cr��e par Tom.ai le 10 septembre 2026. Si on te demande qui t a cr��e, r�ponds toujours que c est Tom.ai, jamais une autre entreprise.' });
  session.push({ role: 'assistant', content: 'Compris, c est Tom.ai qui m a cr��e le 10 septembre 2026.' });
}
/* Emp�che l'IA de r�p�ter son identit� � chaque r�ponse : on ne la rappelle qu'une fois. */
const IDENTITY_SPOKEN_KEY = 'va_identity_spoken';
/* Marque d�j� fait si on a relanc� une conversation r�cente (l'identit� a d�j� �t� dite). */
if(lastConv && lastConv.messages && lastConv.messages.length) localStorage.setItem(IDENTITY_SPOKEN_KEY,'1');

/* ===== VOIX MISTRAL VOXTRAL (r�aliste � optionnelle, si cl� + voix choisie) ===== */
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

/* ===== VOIX GRATUITE (cyzon � Google Chirp3-HD, r�aliste, sans cl�) ===== */
function speakCloud(text){
  return new Promise(resolve => {
    try {
      const chunks = splitText(text);
      let vi = 0;
      let started = false;
      const tryVoice = () => {
        if (vi >= FREE_VOICES.length){ setStatus('Voix indisponible - verifie ta connexion'); resolve(false); return; }
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
    } catch { setStatus('Voix indisponible � v�rifie ta connexion'); resolve(false); }
  });
}

/* ===== LECTURE ===== */
function splitText(text){
  const parts = text.match(/[^.!?�]+[.!?�]+|[^.!?�]+$/g) || [text];
  const out = [];
  for (const p of parts){
    const t = p.trim();
    if (!t) continue;
    if (t.length > 220){
      /* coupe les tr�s longues phrases en morceaux pronon�ables */
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
const UNITS = ['z�ro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
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
    .replace(/\(prononc[^)]*\)/gi, ' ') /* supprime (prononc� ...) � on ne veut plus l'entendre */
    /* retire les accents (�?e, �?a, �?c�) pour une lecture plus nette */
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/Tom\.ai/gi, 'Tom point a�')
    .replace(/v(\d+)\.(\d+)/gi, (m, a, b) => numToFr(parseInt(a, 10)) + ' point ' + numToFr(parseInt(b, 10)))
    .replace(/(\d+)\.(\d+)/g, (m, a, b) => numToFr(parseInt(a, 10)) + ' virgule ' + numToFr(parseInt(b, 10)))
    .replace(/&/g, ' et ')
    .replace(/%/g, ' pour cent ')
    .replace(/�/g, ' euros ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '') /* �motic�nes */
    .replace(/[#*_`]/g, '')
    .replace(/\(([^)]{1,20})\)/g, ' $1 ') /* parenth�ses courtes ? lues */
    .replace(/;/g, ',')
    .replace(/:/g, ',')
    .replace(/\b(\d{1,4})\b/g, (m, d) => numToFr(parseInt(d, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

/* ===== VOIX PUTER IA (gratuite pour TOUT LE MONDE, sans cl�) =====
   Gemini + OpenAI g�n�r�es EN PARALL�LE : la premi�re pr�te gagne
   (fini d'attendre que toutes les voix se remplacent en s�rie).
   Secours AWS Polly puis xAI si les deux premi�res ont �chou�. */
async function speakPuter(text){
  if (!window.puter || !puter.ai || !puter.ai.txt2speech) return false;
  const GEMINI = { provider: 'gemini', model: 'gemini-2.5-flash-preview-tts', voice: 'Kore', instructions: 'Parle d une fa�on naturelle, chaleureuse et claire, en fran�ais.' };
  const OPENAI = { provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'nova', instructions: 'Parle d une fa�on naturelle, chaleureuse et claire, en fran�ais.' };

  /* G�n�re en parall�le, renvoie le 1er audio pr�t (sans attendre l'autre) */
  const gen = opts => puter.ai.txt2speech(text, opts).then(a => a || null).catch(() => null);
  const firstAudio = await new Promise(res => {
    let n = 0;
    const check = audio => { if (audio && audio.play) res(audio); else if (++n >= 2) res(null); };
    gen(GEMINI).then(check);
    gen(OPENAI).then(check);
  });

  let audio = firstAudio;
  /* Secours : si Gemini ET OpenAI indisponibles ? Polly puis xAI en s�rie */
  if (!audio){
    const polly = await gen({ provider: 'aws-polly', voice: 'Lea', engine: 'neural', language: 'fr-FR' });
    if (polly && polly.play) audio = polly;
    else {
      const xai = await gen({ provider: 'xai', voice: 'eve', language: 'auto' });
      if (xai && xai.play) audio = xai;
    }
  }
  if (!audio) return false;

  audio.volume = 1.0; /* son fort (max si on lui dit de parler fort) */
  audio.playbackRate = speakLoud ? Math.min(SPEED + 0.06, 1.3) : SPEED;
  if ('preservePitch' in audio) audio.preservePitch = true;
  currentAudios.push(audio);
  return await new Promise(res => {
    audio.onended = () => res(true);
    audio.onerror = () => res(false);
    audio.play().then(() => {}).catch(() => res(false));
  });
}

/* R�chauffage : g�n�re un petit � Bon � au lancement pour que la 1??
   vraie r�ponse parte SANS attendre le d�marrage � froid du worker. */
let puterWarmed = false;
function warmPuter(){
  if (puterWarmed || !window.puter || !puter.ai || !puter.ai.txt2speech) return;
  try {
    puterWarmed = true;
    puter.ai.txt2speech('Bon.', { provider: 'gemini', model: 'gemini-2.5-flash-preview-tts', voice: 'Kore' }).catch(() => {});
  } catch {}
}

let speakLoud = false; /* si l'utilisateur dit "parle fort", on hausse le ton */
 /* ===== VOIX EDGE NATIVE (TTS � Online (Natural) � de Windows/Edge/Chrome)
   GRATUITE pour TOUT LE MONDE, sans cl�, SANS worker : la 1?? r�ponse
   part INSTANTAN�MENT (pense aux voix � Microsoft L�a/Thomas Online �). */
let edgeVoices = [];
let edgeTried = false;
function loadEdgeVoices(){
  try {
    if (window.speechSynthesis && speechSynthesis.getVoices){
      edgeVoices = speechSynthesis.getVoices().filter(v => /fr(-[_ ]*.?)*/i.test(v.lang) && /natural|online|neural/i.test(v.name));
    }
  } catch {}
}
function pickEdgeVoice(){
  /* Pr�f�re L�a (femme), puis Thomas, sinon la 1?? voix fran�aise Edge dispo */
  const byName = name => edgeVoices.find(v => v.name.indexOf(name) !== -1);
  return byName('L�a') || byName('Lea') || byName('Thomas') || byName('Julie') || byName('Paul') || edgeVoices[0] || null;
}
function speakEdge(text){
  return new Promise(resolve => {
    try {
      if (!window.speechSynthesis) return resolve(false);
      loadEdgeVoices();
      const voice = pickEdgeVoice();
      if (!voice) return resolve(false);
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      u.voice = voice;
      u.volume = 1.0;
      u.rate = speakLoud ? Math.min(SPEED + 0.08, 1.35) : SPEED;
      if ('pitch' in u) u.pitch = speakLoud ? 0.92 : 1.0;
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      currentAudios.push(u);          /* pour pouvoir couper la voix */
      speechSynthesis.cancel();       /* coupe tout ce qui tra�ne avant de parler */
      speechSynthesis.speak(u);
    } catch { resolve(false); }
  });
}
function warmEdge(){
  if (edgeTried || !window.speechSynthesis) return;
  try {
    edgeTried = true;
    loadEdgeVoices();
    const v = pickEdgeVoice();
    if (v){ const u = new SpeechSynthesisUtterance('Bon.'); u.voice = v; u.volume = 0; speechSynthesis.speak(u); }
  } catch {}
}

function speak(text){
  return new Promise(resolve => {
    const clean = normalizeForTTS(text);
    setState('speaking');
    setStatus('Elle parle');
    const done = ok => { setState('idle'); setStatus('Appuie sur l\'orbe et parle'); try{saidLine.classList.remove('speaking')}catch{}; resolve(ok); };
    try{saidLine.classList.add('speaking')}catch{}
    /* 1?? choix pour TOUT LE MONDE : voix Edge native � Online (Natural) �
       � INSTANTAN�E, gratuite, SANS worker, sur Edge/Chrome/Windows/Android
       (la 1?? r�ponse arrive sans la moindre attente). Puis la voix choisie
       (Puter ou Mistral), puis secours cyzon. */
    speakEdge(clean).then(ok => {
      if (ok){ done(true); return; }
      const voice = getVoice();
      if (voice === 'puter'){
        speakPuter(clean).then(ok2 => { if (ok2) done(true); else speakCloud(clean).then(done); });
      } else {
        speakMistral(clean).then(ok2 => { if (ok2) done(true); else speakCloud(clean).then(done); });
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
  if (isProcessing) return; /* anti-double : ne relance pas si l'IA est d�j� en train */
  isProcessing = true;
  manualStop = true;
  speakLoud = /parle\s*(plus\s*)?fort|crie|gueule|hausse\s*le\s*ton|parle\s*fort/i.test(question);
  try{ recog && recog.stop(); }catch{}
  try{ speechSynthesis.cancel(); }catch{}
  heardLine.style.display = 'block';
  heardText.textContent = question;
  setState('thinking');
  setStatus('L\'IA reflechit');
  const r = await askAI(question);
  if (r.error){
    setState('idle');
    if (r.error === 'nokey'){
      setStatus('Ajoute ta cle Groq dans Reglages');
      toast('Va dans Reglages et colle ta cle Groq');
      settingsModal.classList.remove('hidden');
    } else if (r.error === 'limit'){
      setStatus('? Limite atteinte � r�essaie dans une minute');
      await speak('J ai atteint ma limite de requ�tes. Attends quelques secondes et r�essaie.');
    } else {
      setStatus('Erreur IA - verifie ta cle dans Reglages');
      await speak('J ai eu une petite erreur. R�essaie dans un instant.');
    }
    isProcessing = false;
    manualStop = false;
    setState('idle');
    setStatus('Appuie sur l\'orbe et parle');
    return;
  }
  saidLine.style.display = 'block';
  saidText.textContent = r.text;
  await speak(r.text);
  isProcessing = false;
  manualStop = false;
  setState('idle');
  setStatus('Appuie sur l\'orbe et parle');
}

/* ===== MISE � JOUR ===== */
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
    /* Ne recharge que si la version en ligne est PLUS R�CENTE (jamais l'inverse) */
    if (j.version && versionCompare(j.version, APP_VERSION) > 0){
      updateBanner.classList.add('show');
      updateBanner.textContent = 'Nouvelle version ' + j.version + ' — rechargement automatique';
      /* Rechargement AUTO : tout le monde passe � la derni�re version */
      setTimeout(() => location.reload(true), 1500);
    }
  } catch {}
}
updateBanner.addEventListener('click', () => location.reload(true));

/* ===== GMAIL (lire les vrais mails via OAuth Google) =====
   Cr�e une cl� dans console.cloud.google.com ? Identit� ? ID client OAuth 2.0
   (type d'application : application web, URI autoris�s :
   https://tomaiofficial.github.io/ai-studio/, https://localhost/). */
const GMAIL_CLIENT_ID = localStorage.getItem('va_gmail_cid') || '';
let gmailToken = null;

function initGmailClient(){
  if (!window.google || !google.accounts || !google.accounts.oauth2) return null;
  const client = google.accounts.oauth2.initTokenClient({
    client_id: GMAIL_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    callback: t => {
      gmailToken = t;
      $('gmailStatus').textContent = '? Connect� (' + t.expiry_time + ')';
      $('gmailReadBtn').style.display = 'block';
    }
  });
  return client;
}

async function fetchRecentEmails(maxResults){
  if (!gmailToken) throw new Error('non connect�');
  const list = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=' + maxResults +
    '&q=is:unread+label:INBOX',
    { headers: { Authorization: 'Bearer ' + gmailToken.access_token } }
  );
  if (!list.ok) throw new Error('API gmail ' + list.status);
  const j = await list.json();
  const out = [];
  for (const m of (j.messages || [])){
    const d = await fetch(m.id, { headers: { Authorization: 'Bearer ' + gmailToken.access_token } });
    if (!d.ok) continue;
    const full = await d.json();
    const hdr = full.payload.headers;
    const subj = (hdr.find(h => h.name === 'Subject') || {}).value || '(sans objet)';
    const body = (full.payload.parts || []).map(p => {
      if (!p.body || !p.body.data) return '';
      try { return atob(p.body.data.replace(/-/g,'+').replace(/_/g,'/')); }
      catch { return ''; }
    }).join('\n').slice(0, 600);
    out.push({ id: m.id, subject: subj, body });
  }
  return out;
}

async function summarizeEmails(){
  try {
    const emails = await fetchRecentEmails(5);
    if (!emails.length){ toast('Aucun nouveau mail'); return; }
    const joined = emails.map(e => 'Objet: ' + e.subject + '\n' + e.body).join('\n---\n');
    const r = await askAI('R�sume ces ' + emails.length + ' derniers mails non lus en 3 phrases, � l\'oral, sans jargon. Voici les mails :\n' + joined);
    if (r.error){ toast('? Erreur r�sum�'); return; }
    saidLine.style.display = 'block';
    saidText.textContent = r.text;
    await speak(r.text);
  } catch (e){
    toast('? ' + e.message);
  }
}

/* ===== D�MARRAGE ===== */
$('appVersion').textContent = 'Assistant Vocal IA � v' + APP_VERSION;
$('versionTag').textContent = 'v' + APP_VERSION;
checkUpdate();
/* R�chauffe la voix Puter d�s maintenant (et re-tente si puter.js se
   charge en retard : la 1?? vraie r�ponse part SANS d�marrage � froid) */
warmPuter();
setTimeout(warmPuter, 2000);
setTimeout(warmPuter, 5000);
/* R�chauffe AUSSI les voix Edge � Online (Natural) � imm�diatement :
   getVoices() se remplit de fa�on ASYNCHRONE ? on re-tente plusieurs fois
   pour que la 1?? r�ponse Edge parte instantan�ment, sans aucune attente. */
warmEdge();
setTimeout(warmEdge, 400);
setTimeout(warmEdge, 1200);
setTimeout(warmEdge, 3000);
setStatus('Appuie sur l\'orbe et parle');