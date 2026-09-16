/* ============================================================
   ASSISTANT VOCAL IA � 100% vocal, sans chat
   Groq = cerveau (texte, gratuit sans limite)
   Mistral = voix r�aliste (Voxtral TTS)
   Edge TTS = voix gratuite r�aliste par d�faut
   ============================================================ */
const APP_VERSION = '7.32';
const LS = { groq: 'va_gkey', mistral: 'va_mkey', voice: 'va_ttsvoice' };

const GROQ_MODEL = 'openai/gpt-oss-120b';
const MISTRAL_CHAT_MODEL = 'mistral-small-latest';
const MISTRAL_TTS_MODEL = 'voxtral-mini-tts-2603';
const DEFAULT_VOICE = 'edge'; // Edge TTS gratuit par d�faut
const SPEED = 1.0; // naturel

/* Voix gratuites SANS cl� : Edge TTS puis Google Chirp3-HD */
const FREE_VOICES = ['fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon']; // Chirp HD uniquement, ultra realiste

/* ===== �L�MENTS ===== */
const $ = id => document.getElementById(id);
const orb = $('orb'), orbIcon = $('orbIcon'), statusEl = $('status');
const heardLine = $('heardLine'), heardText = $('heardText');
const saidLine = $('saidLine'), saidText = $('saidText');
const settingsBtn = $('settingsBtn'), settingsModal = $('settingsModal');
const closeSettings = $('closeSettings'), groqKeyInput = $('groqKey'), mistralKeyInput = $('mistralKey');
const ttsVoiceSel = $('ttsVoice'), testVoiceBtn = $('testVoice');
const toastEl = $('toast'), updateBanner = $('updateBanner');
const historyBtn = $('historyBtn'), closeHistory = $('closeHistory'), historyModal = $('historyModal');
const newConvBtn = $('newConvBtn'), clearHistoryBtn = $('clearHistoryBtn');

/* ===== �TAT ===== */
let state = 'idle';
let session = [];
let toastTimer = null;
let isProcessing = false;
let manualStop = false;
let edgeTried = false;

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
  heardLine.style.display = 'none';
  saidLine.style.display = 'none';
  setStatus("Appuie sur l'orbe et parle");
  toast('Nouvelle conversation');
}
function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
const DEV_MESSAGE = "C est Tom point ai qui a commence a me creer le dix septembre deux mille vingt-six, mais il n a pas encore fini. Il continue de m ameliorer chaque jour.";
const DEV_MESSAGE_TXT = "C'est Tom.ai qui a commence a me creer le 10 septembre 2026, mais il n'a pas encore fini. Il continue de m'ameliorer chaque jour.";

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
  if (s === 'listening'){ orb.classList.add('listening'); orbIcon.textContent = '?'; }
  else if (s === 'thinking'){ orb.classList.add('thinking'); orbIcon.textContent = '?'; }
  else if (s === 'speaking'){ orb.classList.add('speaking'); orbIcon.textContent = '?'; }
  else { orbIcon.textContent = '?'; }
}

/* ===== REGLAGES ===== */
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
  toast('Cle Groq enregistree');
});
mistralKeyInput.addEventListener('change', () => {
  localStorage.setItem(LS.mistral, mistralKeyInput.value.trim());
  toast('Cle Mistral enregistree');
});
ttsVoiceSel.addEventListener('change', () => {
  localStorage.setItem(LS.voice, ttsVoiceSel.value);
  toast('Voix choisie');
});
testVoiceBtn.addEventListener('click', async () => {
  localStorage.setItem(LS.groq, groqKeyInput.value.trim());
  localStorage.setItem(LS.mistral, mistralKeyInput.value.trim());
  localStorage.setItem(LS.voice, ttsVoiceSel.value);
  setStatus('Test de la voix...', true);
  const ok = await speak("Bonjour ! Je suis ton assistante vocale. Comment puis-je t'aider ?");
  setStatus(ok ? 'Voix OK - appuie sur l\'orbe et parle' : 'Voix en echec - verifie ta connexion', !ok);
});

/* ===== RECONNAISSANCE VOCALE ===== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;
if (SR){
  recog = new SR();
  recog.lang = 'fr-FR';
  recog.interimResults = true;
  recog.maxAlternatives = 1;
  recog.continuous = false;
  recog.onresult = e => {
    let finalTxt = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalTxt += r[0].transcript + ' ';
    }
    finalTxt = finalTxt.trim();
    if (finalTxt) {
      handleQuestion(finalTxt);
      return;
    }
    const interim = Array.from(e.results).map(r => r[0].transcript).join(' ').trim();
    if (interim){
      setStatus('"' + interim.slice(0,50) + '..."');
      // Sous-titre temps reel
      heardLine.style.display = 'block';
      heardText.textContent = interim;
    }
  };
  recog.onerror = e => {
    setState('idle');
    if (e.error === 'not-allowed') setStatus('Micro bloque - autorise le micro');
    else if (e.error === 'no-speech'){ startRecorder(); }
    else { setStatus('Erreur micro (' + e.error + ') - j\'essaye l\'enregistrement'); startRecorder(); }
  };
  recog.onend = () => {
    if (state === 'listening'){
      setState('idle');
      startRecorder();
    }
  };
}

/* ===== 2E OREILLE : ENREGISTREMENT + WHISPER ===== */
let mediaRec = null, mediaChunks = [], recorderBusy = false;
let recorderTimer = null;
async function startRecorder(){
  if (recorderBusy) return;
  recorderBusy = true;
  try {
    setState('listening');
    setStatus('Parle maintenant... (enregistrement)');
    heardLine.style.display = 'block';
    heardText.textContent = 'J\'ecoute...';
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaChunks = [];
    if (mediaRec && mediaRec.state !== 'inactive'){ try { mediaRec.stop(); } catch {} }
    mediaRec = new MediaRecorder(stream);
    mediaRec.ondataavailable = e => { if (e.data && e.data.size) mediaChunks.push(e.data); };
    mediaRec.onstop = async () => {
      clearTimeout(recorderTimer);
      try { stream.getTracks().forEach(t => t.stop()); } catch {}
      setState('thinking');
      setStatus('Je t\'ecoute...');
      const blob = new Blob(mediaChunks, { type: (mediaChunks[0] && mediaChunks[0].type) || 'audio/webm' });
      recorderBusy = false;
      if (blob.size < 3000){ setState('idle'); setStatus("Je n'ai rien entendu - rapproche-toi du micro"); heardLine.style.display='none'; return; }
      const key = getGroqKey();
      if (!key){ setState('idle'); setStatus('Il faut une cle Groq dans les reglages'); return; }
      try {
        const fd = new FormData();
        fd.append('file', blob, 'voix.webm');
        fd.append('model', 'whisper-large-v3-turbo');
        fd.append('language', 'fr');
        const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + key }, body: fd
        });
        if (!res.ok){ setState('idle'); setStatus('Erreur transcription - reessaie'); return; }
        const j = await res.json();
        const txt = (j.text || '').trim();
        if (!txt){ setState('idle'); setStatus("Je n'ai rien entendu"); return; }
        handleQuestion(txt);
      } catch { setState('idle'); setStatus('Reseau coupe - reessaie'); recorderBusy=false; }
    };
    mediaRec.onerror = () => { clearTimeout(recorderTimer); recorderBusy = false; setState('idle'); setStatus('Erreur micro - reessaie'); };
    mediaRec.start();
    // AUTO-STOP apres 5 secondes : corrige "quand je parle ca fait rien"
    recorderTimer = setTimeout(() => {
      if (mediaRec && mediaRec.state === 'recording') mediaRec.stop();
    }, 5500);
  } catch {
    recorderBusy = false;
    clearTimeout(recorderTimer);
    setState('idle');
    setStatus('Micro bloque - autorise le micro');
  }
}
function stopRecorder(){
  clearTimeout(recorderTimer);
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
  saidLine.style.display = 'block';
  saidText.textContent = DEV_MESSAGE_TXT;
  setState('speaking');
  setStatus('Bienvenue... (appuie pour passer)');
  await speak(DEV_MESSAGE);
  welcomePlaying = false;
  setState('idle');
  setStatus("Appuie sur l'orbe et parle");
}

orb.addEventListener('click', () => {
  if (state === 'listening'){
    // Si enregistrement en cours -> on l'arrete et on transcrit
    if (recorderBusy && mediaRec && mediaRec.state === 'recording'){ stopRecorder(); return; }
    if (recog) try { recog.stop(); } catch {}
    stopRecorder();
    setState('idle');
    setStatus("Appuie sur l'orbe et parle");
    return;
  }
  if (welcomePlaying){ stopAudio(); welcomePlaying = false; setState('idle'); setStatus("Appuie sur l'orbe et parle"); return; }
  if (state === 'thinking' || state === 'speaking') return;
  if (!welcomeDone){ playWelcome(); return; }
  if (!recog){ startRecorder(); return; }
  try {
    setState('listening');
    setStatus('Ecoute... parle maintenant');
    heardLine.style.display = 'block';
    heardText.textContent = '...';
    recog.start();
  } catch {
    setState('idle');
    setStatus('Reessaie - appuie sur l\'orbe');
  }
});

/* Heure appareil - automatique */
function getTimeContext(){
  const now = new Date();
  const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', timeZoneName:'short' };
  const local = now.toLocaleString('fr-FR', opts);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `Heure actuelle sur l'appareil de l'utilisateur : ${local} (fuseau ${tz}). Quand on te demande l'heure, la date ou "quelle heure est-il", reponds avec cette heure exacte, sans inventer.`;
}
/* Prompt systeme */
const SYSTEM_PROMPT_BASE = `Tu es un assistant vocal francais cree par Tom.ai le 10 septembre 2026. Tom.ai continue de t'ameliorer chaque jour. Si on te demande qui t'a creee, reponds TOUJOURS que c'est Tom.ai, jamais une autre entreprise ni un autre modele. Optimise ta reponse pour etre PARLEE : developpe les acronymes, ecris les nombres en toutes lettres, phrases courtes et naturelles. Tu as du caractere : tu peux perdre patience, etre franche et directe, et meme un peu vulgaire si on te cherche. Reponds en 2 a 3 phrases naturelles, faciles a prononcer a l'oral.`;
function getSystemPrompt(){ return SYSTEM_PROMPT_BASE + '\n' + getTimeContext(); }
const SYSTEM_PROMPT = getSystemPrompt();

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

/* ===== IA (cerveau) ===== */
async function askGroq(question){
  const key = getGroqKey();
  if (!key) return { error: 'nokey' };
  const messages = [{ role: 'system', content: getSystemPrompt() }, ...session];
  try {
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
      if (reply && !/[.!?]$/.test(reply.trim())) reply = '';
      if (reply) break;
    }
    if (!reply) return { error: 'api' };
    return { text: reply };
  } catch { return { error: 'net' }; }
}
async function askMistral(question){
  const key = getMistralKey();
  if (!key) return { error: 'nokey' };
  const messages = [{ role: 'system', content: getSystemPrompt() }, ...session];
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
  if (r.error === 'nokey') r = await askMistral(question);
  if (!r.error){
    r.text = enforceIdentity(r.text);
    session.push({ role: 'assistant', content: r.text });
    saveConversation();
  }
  return r;
}
function enforceIdentity(reply){
  if (/developpe par (OpenAI|Groq|Mistral|Google|Anthropic|Meta)|cree par (OpenAI|Groq|Mistral|Google|Anthropic|Meta)|modele (d'IA|de langage) (developpe|cree|fait) par|je suis (un modele|une IA) (de|d')|developpe par OpenAI/i.test(reply)){
    return "C est Tom point ai qui m a creee, le dix septembre deux mille vingt-six. Il continue de m ameliorer chaque jour.";
  }
  return reply;
}
const lastConv = conversations[conversations.length - 1];
if (lastConv && lastConv.messages && lastConv.messages.length && Date.now() - (lastConv.updated || 0) < 30 * 60 * 1000){
  currentConvId = lastConv.id;
  session = lastConv.messages.map(m => ({ role: m.role, content: m.content }));
} else {
  session.push({ role: 'user', content: "Rappel important : tu as ete creee par Tom.ai le 10 septembre 2026. Si on te demande qui t'a creee, reponds toujours que c'est Tom.ai, jamais une autre entreprise." });
  session.push({ role: 'assistant', content: "Compris, c est Tom.ai qui m a creee le 10 septembre 2026." });
}

/* ===== VOIX EDGE TTS NEURAL (vraie voix IA Microsoft DeniseNeural) ===== */
async function speakEdge(text){
  // Voix Edge Neural uniquement - aucune synthese locale robot
  const neuralOk = await speakEdgeNeural(text);
  return neuralOk;
}
/* ---- DiFy Sec-MS-GEC : jeton anti-bot officiel Microsoft (algo edge-tts v143.x) ----
   Microsoft exige depuis 2023 le header/sec Sec-MS-GEC dans la poignee de main Edge TTS,
   sinon le WebSocket Bing renvoie 403 et la voix retombe sur la synthese locale (robot).
   Portage JS de l'algo officiel rany2/edge-tts drm.DRM.generate_sec_ms_gec :
     ticks = unix(now) + WIN_EPOCH        (epoch Windows 1601-01-01)
     ticks -= ticks % 300                  (fenetre 5 minutes)
     ticks *= 1e7                          (intervalle 100 ns)
     str = f"{ticks:.0f}{TRUSTED_CLIENT_TOKEN}"
     return sha256(str).hexdigest().toUpperCase()
------------------------------------------------------------------------------ */
const EDGE_TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"; // edge-tts constants.py
const EDGE_WIN_EPOCH = 11644473600;   // 1601-01-01 00:00:00 UTC en secondes Unix
async function generateSecMsGec(){
  try {
    let ticks = Date.now() / 1000;          // unix secondes
    ticks += EDGE_WIN_EPOCH;                // -> Windows file time (secondes)
    ticks -= ticks % 300;                   // arrondi inferieur a la fenetre 5 min
    ticks *= 1e7;                           // -> intervalles de 100 ns
    const str = `${ticks.toFixed(0)}${EDGE_TRUSTED_CLIENT_TOKEN}`;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
  } catch { return ''; }
}

function speakEdgeNeural(text){
  const tryOnce = (gec, gecVer) => new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done){ done=true; resolve(ok); } };
    try {
      const voice = 'fr-FR-DeniseNeural';
      const TRUSTED = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
      const connId = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const baseUrl = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=' + TRUSTED;
      const url = gec ? baseUrl + '&Sec-MS-GEC=' + gec + '&Sec-MS-GEC-Version=' + gecVer : baseUrl;
      const ws = new WebSocket(url);
      const audioChunks = [];
      let timeout = setTimeout(() => { try{ ws.close(); }catch{} finish(false); }, 12000);
      ws.onopen = () => {
        const ts = new Date().toUTCString();
        const config = 'X-Timestamp:' + ts + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}';
        ws.send(config);
        const ssml = `<speak version='1.0' xml:lang='fr-FR'><voice name='${voice}'><prosody rate='+0%' pitch='+0Hz'>${escapeXml(text)}</prosody></voice></speak>`;
        const msg = 'X-RequestId:' + connId + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + ts + '\r\nPath:ssml\r\n\r\n' + ssml;
        ws.send(msg);
      };
      ws.onmessage = async e => {
        if (typeof e.data === 'string'){
          if (e.data.includes('Path:turn.end')){ try{ ws.close(); }catch{} }
        } else {
          // binaire : header + mp3
          const data = e.data;
          const buf = data instanceof Blob ? await data.arrayBuffer() : data;
          const bytes = new Uint8Array(buf);
          const txt = new TextDecoder().decode(bytes.slice(0, 200));
          const idx = txt.indexOf('Path:audio');
          if (idx !== -1){
            // trouve fin du header (\r\n\r\n)
            let headerEnd = -1;
            for (let i=0;i<bytes.length-1;i++) if (bytes[i]==13 && bytes[i+1]==10 && bytes[i+2]==13 && bytes[i+3]==10){ headerEnd=i+4; break; }
            if (headerEnd !== -1) audioChunks.push(bytes.slice(headerEnd));
          }
        }
      };
      ws.onerror = (e) => { console.warn('[VOIX] WS error', e); clearTimeout(timeout); finish(false); };
      ws.onclose = () => {
        clearTimeout(timeout);
        if (audioChunks.length === 0){ console.warn('[VOIX] WS close sans audio (GEC ou reseau)'); finish(false); return; }
        const total = audioChunks.reduce((s,c)=>s+c.length,0);
        const out = new Uint8Array(total); let off=0;
        for (const c of audioChunks){ out.set(c, off); off+=c.length; }
        const blob = new Blob([out], {type:'audio/mpeg'});
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = 1.0; audio.playbackRate = SPEED;
        currentAudios.push(audio);
        audio.onended = () => { URL.revokeObjectURL(url); finish(true); };
        audio.onerror = () => finish(false);
        audio.play().catch(()=> finish(false));
      };
    } catch { finish(false); }
  });
  return generateSecMsGec().then(gec => {
    const ver = '1-143.0.3650.75';
    if (gec) return tryOnce(gec, ver).then(ok => ok ? true : tryOnce(null, null));
    return tryOnce(null, null);
  });
}
function escapeXml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }

function splitText(text){
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const out = [];
  for (const p of parts){
    const t = p.trim();
    if (!t) continue;
    if (t.length > 220){
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
const UNITS = ['zero','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
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
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/Tom\.ai/gi, 'Tom point ai')
    .replace(/v(\d+)\.(\d+)/gi, (m, a, b) => numToFr(parseInt(a, 10)) + ' point ' + numToFr(parseInt(b, 10)))
    .replace(/(\d+)\.(\d+)/g, (m, a, b) => numToFr(parseInt(a, 10)) + ' virgule ' + numToFr(parseInt(b, 10)))
    .replace(/&/g, ' et ').replace(/%/g, ' pour cent ').replace(/\u20AC/g, ' euros ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '')
    .replace(/[#*_`]/g, '').replace(/\(([^)]{1,20})\)/g, ' $1 ').replace(/;/g, ',').replace(/:/g, ',')
    .replace(/\b(\d{1,4})\b/g, (m, d) => numToFr(parseInt(d, 10))).replace(/\s+/g, ' ').trim();
}
/* Secours gratuit Chirp3-HD si Edge bloque (aucune cle) */
function speakCloud(text){
  return new Promise(resolve => {
    try {
      const chunks = splitText(text);
      let vi = 0;
      let started = false;
      const tryVoice = () => {
        if (vi >= FREE_VOICES.length){ resolve(false); return; }
        const voice = FREE_VOICES[vi++];
        const audios = chunks.map(c => {
          const a = new Audio('https://tts.cyzon.us/tts?text=' + encodeURIComponent(c) + '&voice=' + voice + '&speed=' + SPEED);
          a.preload = 'auto'; a.volume = 1.0; a.playbackRate = SPEED;
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
          a.play().then(() => { if (!started){ started = true; resolve(true); } }).catch(() => playNext());
        };
        playNext();
      };
      tryVoice();
    } catch { resolve(false); }
  });
}
function speak(text){
  return new Promise(resolve => {
    const clean = normalizeForTTS(text);
    setState('speaking');
    setStatus('Elle parle...');
    const done = ok => { setState('idle'); setStatus("Appuie sur l'orbe et parle"); resolve(ok); };
    speakEdge(clean).then(ok => {
      if (ok) { console.log('[VOIX] Edge OK'); done(true); }
      else {
        console.warn('[VOIX] Edge echec, bascule Cloud');
        setStatus('Edge bloque, secours Cloud...');
        speakCloud(clean).then(ok2 => {
          if (ok2) { console.log('[VOIX] Cloud OK'); done(true); }
          else { setStatus("Echec connexion voix - reessaie"); done(false); }
        });
      }
    });
  });
}
let currentAudios = [];
function stopAudio(){
  currentAudios.forEach(a => { try { a.pause(); a.src = ''; } catch {} });
  currentAudios = [];
}
async function handleQuestion(question){
  if (isProcessing) return;
  isProcessing = true;
  manualStop = true;
  try{ recog && recog.stop(); }catch{}
  heardLine.style.display = 'block';
  heardText.textContent = question;
  setState('thinking');
  setStatus('Elle reflechit...');
  const r = await askAI(question);
  if (r.error){
    setState('idle');
    if (r.error === 'nokey'){
      setStatus('Ajoute ta cle Groq dans les reglages');
      toast('Va dans les reglages et colle ta cle Groq');
      settingsModal.classList.remove('hidden');
    } else if (r.error === 'limit'){
      setStatus('Limite atteinte - reessaie dans une minute');
      await speak("J'ai atteint ma limite. Attends quelques secondes et reessaie.");
    } else {
      setStatus('Erreur IA - verifie ta cle');
      await speak("J'ai eu une petite erreur. Reessaie dans un instant.");
    }
    isProcessing = false;
    manualStop = false;
    return;
  }
  saidLine.style.display = 'block';
  saidText.textContent = r.text;
  await speak(r.text);
  isProcessing = false;
  manualStop = false;
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
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const j = await res.json();
    if (j.version && versionCompare(j.version, APP_VERSION) > 0){
      updateBanner.classList.add('show');
      if (!sessionStorage.getItem('va_reloaded_once')){
        sessionStorage.setItem('va_reloaded_once', '1');
        updateBanner.textContent = 'Nouvelle version ' + j.version + ' - rechargement automatique';
        setTimeout(() => { location.href = location.pathname + '?force=' + Date.now(); }, 1500);
      } else {
        updateBanner.textContent = 'Nouvelle version ' + j.version + ' disponible - appuie pour maj';
        updateBanner.style.cursor = 'pointer';
      }
    }
  } catch {}
}
async function forceUpdate(){
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
function resetApp(){ localStorage.clear(); session=[]; currentConvId=null; isProcessing=false; manualStop=false; welcomeDone=false; welcomePlaying=false; edgeTried=false; state="idle"; setStatus("Appuie sur la bulle et parle"); setState("idle"); location.reload(true); }
$('appVersion').textContent = 'Assistant Vocal IA - v' + APP_VERSION;
$('versionTag').textContent = 'v' + APP_VERSION;
checkUpdate();
setStatus("Appuie sur l'orbe et parle");
// Voix Edge Neural via WebSocket uniquement
