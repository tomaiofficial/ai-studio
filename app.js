/* ============================================================
   ASSISTANT VOCAL IA � 100% vocal, sans chat
   Groq = cerveau (texte, gratuit sans limite)
   Mistral = voix r�aliste (Voxtral TTS)
   Edge TTS = voix gratuite r�aliste par d�faut
   ============================================================ */
const APP_VERSION = '7.55';
const LS = { groq: 'va_gkey', mistral: 'va_mkey', voice: 'va_ttsvoice' };

const GROQ_MODEL = 'openai/gpt-oss-120b';
const MISTRAL_CHAT_MODEL = 'mistral-small-latest';
const MISTRAL_TTS_MODEL = 'voxtral-mini-tts-2603';
const DEFAULT_VOICE = 'vits'; // Voix systeme (fiable a 100%) par defaut
const SPEED = 1.0; // naturel


/* ===== �L�MENTS ===== */
const $ = id => document.getElementById(id);
const orb = $('orb'), orbIcon = $('orbIcon'), statusEl = $('status');
const chat = $('chat'), chatEmpty = $('chatEmpty');
const textInput = $('textInput'), sendBtn = $('sendBtn');
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
  clearChat();
  setStatus("Appuie sur le micro et parle");
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
  if (s === 'listening') orb.classList.add('listening');
  else if (s === 'thinking') orb.classList.add('thinking');
  else if (s === 'speaking') orb.classList.add('speaking');
}

/* ===== CHAT (bulles type ChatGPT) ===== */
function addUserMsg(text){
  if (chatEmpty) chatEmpty.style.display = 'none';
  const d = document.createElement('div');
  d.className = 'msg user';
  d.textContent = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}
function addAiMsg(text){
  if (chatEmpty) chatEmpty.style.display = 'none';
  const d = document.createElement('div');
  d.className = 'msg ai';
  d.textContent = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}
/* Sous-titre temps reel : met a jour la derniere bulle utilisateur */
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
}
function clearChat(){
  chat.innerHTML = '';
  if (chatEmpty) chatEmpty.style.display = '';
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
  setStatus(ok ? 'Voix OK - appuie sur le micro et parle' : 'Voix en echec - verifie ta connexion', !ok);
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
      showInterim(interim);
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
      if (blob.size < 3000){ setState('idle'); setStatus("Je n'ai rien entendu - rapproche-toi du micro"); return; }
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
  addAiMsg(DEV_MESSAGE_TXT);
  setState('speaking');
  setStatus('Bienvenue... (appuie pour passer)');
  await speak(DEV_MESSAGE);
  welcomePlaying = false;
  setState('idle');
  setStatus("Appuie sur le micro et parle");
}

orb.addEventListener('click', () => {
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
  if (!recog){ startRecorder(); return; }
  try {
    setState('listening');
    setStatus('Ecoute... parle maintenant');
    recog.start();
  } catch {
    setState('idle');
    setStatus('Reessaie - appuie sur le micro');
  }
});

/* ===== ENVOI PAR TEXTE (chat) ===== */
function sendText(){
  const t = (textInput.value || '').trim();
  if (!t || isProcessing) return;
  textInput.value = '';
  handleQuestion(t);
}
if (sendBtn) sendBtn.addEventListener('click', sendText);
if (textInput) textInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });

/* Heure appareil - automatique */
function getTimeContext(){
  const now = new Date();
  const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', timeZoneName:'short' };
  const local = now.toLocaleString('fr-FR', opts);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `Heure actuelle sur l'appareil de l'utilisateur : ${local} (fuseau ${tz}). Quand on te demande l'heure, la date ou "quelle heure est-il", reponds avec cette heure exacte, sans inventer.`;
}
/* Prompt systeme */
const SYSTEM_PROMPT_BASE = `Tu es un assistant vocal francais cree par Tom.ai le 10 septembre 2026. Tom.ai continue de t'ameliorer chaque jour. Si on te demande qui t'a creee, reponds TOUJOURS que c'est Tom.ai, jamais une autre entreprise ni un autre modele. Optimise ta reponse pour etre PARLEE : developpe les acronymes, ecris les nombres en toutes lettres, phrases courtes et naturelles. Tu as du caractere : tu peux perdre patience, etre franche et directe, et meme un peu vulgaire si on te cherche. Reponds en 2 a 3 phrases naturelles, faciles a prononcer a l'oral. Ne mentionne JAMAIS la recherche en ligne, internet, tes limites techniques ni tes capacites : reponds directement avec ce que tu sais, et si tu ne sais pas, dis-le simplement et propose une alternative.`;
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
  let messages = [{ role: 'system', content: getSystemPrompt() }, ...session];
  /* INTERNET GRATUIT INCLUS A VIE : si la question porte sur l'actualite/l'info fraiche,
     on cherche le web en direct (DuckDuckGo, zero cle, zero limite) et on colle les
     resultats dans le contexte pour que l'assistante reponde avec des faits recents. */
  const webCtx = await webSearch(question);
  if (webCtx){
    messages = messages.filter(m => !(m.role === 'system' && /Web \(recherche DuckDuckGo\)/.test(m.content)));
    messages = [{ role: 'system', content: 'Web (recherche DuckDuckGo, acces internet gratuit inclus a vie, aucune cle) : ' + webCtx }, ...messages];
  }
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
async function webSearch(question){
  /* Internet GRATUIT inclus a vie, aucune cle, aucune limite : DuckDuckGo Instant Answer
     + Wikipedia (fallback). L'IA consulte le web en direct pour repondre a jour. */
  const withTimeout = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(''), ms))]);
  try {
    const q = encodeURIComponent(question.replace(/[\r\n]+/g,' ').slice(0, 160));
    const res = await withTimeout(fetch('https://api.duckduckgo.com/?q=' + q + '&format=json&no_html=1&skip_disambig=1', { mode: 'cors' }), 3500);
    if (res && res.ok){
      const j = await res.json();
      const parts = [];
      if (j.AbstractText) parts.push(j.AbstractText.slice(0, 600));
      if (j.Answer) parts.push(j.Answer.slice(0, 400));
      if (j.Heading) parts.push(j.Heading.slice(0, 120));
      if (j.RelatedTopics && j.RelatedTopics.length){
        const flat = [];
        const walk = items => items.forEach(it => { if (it.Text) flat.push(it.Text); else if (it.Topics) walk(it.Topics); });
        walk(j.RelatedTopics);
        flat.slice(0, 5).forEach(t => parts.push(t.slice(0, 300)));
      }
      const r = parts.join(' | ').slice(0, 1400).trim();
      if (r) return r;
    }
  } catch {}
  /* Fallback Wikipedia (gratuit, CORS ouvert, sans cle) */
  try {
    const q = encodeURIComponent(question.replace(/[\r\n]+/g,' ').slice(0, 160));
    const url = 'https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + q + '&format=json&srlimit=3&origin=*';
    const res = await withTimeout(fetch(url), 3500);
    if (res && res.ok){
      const j = await res.json();
      const hits = (j.query && j.query.search || []).map(s => s.title + ' : ' + s.snippet.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' '));
      return hits.join(' | ').slice(0, 1400).trim();
    }
  } catch {}
  return '';
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
    // Algo officiel edge-tts (drm.py) : sha256(ticks + TRUSTED_CLIENT_TOKEN) en HEX UPPERCASE
    let ticks = Date.now() / 1000;          // unix secondes
    ticks += EDGE_WIN_EPOCH;                // -> Windows file time (secondes)
    ticks -= ticks % 300;                   // arrondi inferieur a la fenetre 5 min
    ticks *= 1e7;                           // -> intervalles de 100 ns
    const str = `${ticks.toFixed(0)}${EDGE_TRUSTED_CLIENT_TOKEN}`;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
  } catch { return ''; }
}

function edgeDateToString(){
  // Format edge-tts date_to_string() : "Fri Sep 18 2026 12:34:56 GMT+0000 (Coordinated Universal Time)"
  const d = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const p = n => String(n).padStart(2,'0');
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
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
      const url = gec ? baseUrl + '&Sec-MS-GEC=' + gec + '&Sec-MS-GEC-Version=' + gecVer + '&ConnectionId=' + connId : baseUrl;
      const ws = new WebSocket(url);
      const audioChunks = [];
      let timeout = setTimeout(() => { try{ ws.close(); }catch{} finish(false); }, 12000);
      ws.onopen = () => {
        const ts = edgeDateToString();
        const config = 'X-Timestamp:' + ts + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';
        ws.send(config);
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
        const msg = 'X-RequestId:' + connId + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + ts + 'Z\r\nPath:ssml\r\n\r\n' + ssml;
        ws.send(msg);
      };
      ws.onmessage = async e => {
        if (typeof e.data === 'string'){
          if (e.data.includes('Path:turn.end')){ try{ ws.close(); }catch{} }
        } else {
          // binaire edge-tts : 2 premiers octets = longueur du header (big-endian), puis header, puis audio
          const data = e.data;
          const buf = data instanceof Blob ? await data.arrayBuffer() : data;
          const bytes = new Uint8Array(buf);
          if (bytes.length < 2) return;
          const headerLen = (bytes[0] << 8) | bytes[1];
          if (headerLen <= 0 || 2 + headerLen > bytes.length) return;
          const headerTxt = new TextDecoder().decode(bytes.slice(2, 2 + headerLen));
          if (headerTxt.includes('Path:audio')) audioChunks.push(bytes.slice(2 + headerLen));
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
  return text.normalize('NFC')
    .replace(/\u2011/g, '-').replace(/[\u2010-\u2015]/g, '-')
    .replace(/Tom\.ai/gi, 'Tom point ai')
    .replace(/v(\d+)\.(\d+)/gi, (m, a, b) => numToFr(parseInt(a, 10)) + ' point ' + numToFr(parseInt(b, 10)))
    .replace(/(\d+)\.(\d+)/g, (m, a, b) => numToFr(parseInt(a, 10)) + ' virgule ' + numToFr(parseInt(b, 10)))
    .replace(/&/g, ' et ').replace(/%/g, ' pour cent ').replace(/\u20AC/g, ' euros ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '')
    .replace(/[#*_`]/g, '').replace(/\(([^)]{1,20})\)/g, ' $1 ').replace(/;/g, ',').replace(/:/g, ',')
    .replace(/\b(\d{1,4})\b/g, (m, d) => numToFr(parseInt(d, 10))).replace(/\s+/g, ' ').trim();
}
/* Vraie voix IA web (StreamElements Polly Neural) - gratuite, ultra realiste, pas de synthese locale */
async function speakRealAI(text){
  try {
    // StreamElements - voix neurale francaise Lea (Polly Neural), 100% web, pas de cle
    const voice = 'Lea'; // alternatives: Celine, Mathieu
    const url = 'https://api.streamelements.com/kappa/v2/speech?voice=' + voice + '&text=' + encodeURIComponent(text);
    const res = await fetch(url);
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob || blob.size < 1000) return false;
    const objUrl = URL.createObjectURL(blob);
    const audio = new Audio(objUrl);
    audio.volume = 1.0; audio.playbackRate = SPEED;
    if ('preservePitch' in audio) audio.preservePitch = true;
    currentAudios.push(audio);
    return await new Promise(resolve => {
      audio.onended = () => { URL.revokeObjectURL(objUrl); resolve(true); };
      audio.onerror = () => resolve(false);
      audio.play().catch(()=> resolve(false));
    });
  } catch { return false; }
}
/* ===== VOIX IA LOCALE (VITS Meta MMS) : incluse a vie, aucune cle, aucun serveur ===== */
let vitsTTS = null;
let vitsLoading = null;
function loadVits(){
  if (vitsTTS) return Promise.resolve(vitsTTS);
  if (vitsLoading) return vitsLoading;
  if (!window.TransformersPipeline){ return Promise.reject(new Error('Transformers non charge')); }
  /* WASM force : fiable partout (WebGPU peut echouer a l'inference avec q8) */
  vitsLoading = window.TransformersPipeline('text-to-speech', 'Xenova/mms-tts-fra', { dtype: 'q8', device: 'wasm' })
    .then(t => { vitsTTS = t; return t; })
    .catch(e => { vitsLoading = null; throw e; });
  return vitsLoading;
}
/* AudioContext PARTAGE (mobile : iOS/Android bloquent le son sans geste utilisateur,
   et limitent le nombre de contextes -> un seul, reveille au premier toucher) */
let sharedCtx = null;
/* Mobile : voix legere d'abord (le modele local 38 Mo peut faire planter la page en RAM) */
const IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
/* Precharge la liste des voix systeme (getVoices est asynchrone) */
if ('speechSynthesis' in window){
  try { window.speechSynthesis.getVoices(); } catch {}
  window.speechSynthesis.onvoiceschanged = () => { try { window.speechSynthesis.getVoices(); } catch {} };
}
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
['pointerdown','touchstart','click','keydown'].forEach(ev => {
  window.addEventListener(ev, () => {
    ensureAudio();
    /* Desktop : on precharge la voix Piper pendant que l'utilisateur parle -> reponse vocale immediate.
       Si Piper est indisponible, on precharge VITS a la place. */
    if (!IS_MOBILE && !piperEngine && !piperLoading){
      loadPiper().catch(() => { if (!vitsTTS && !vitsLoading) loadVits().catch(() => {}); });
    }
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
function splitVits(text, max){
  const out = [];
  let cur = '';
  for (const word of text.split(/(\s+)/)){
    if ((cur + word).length > max && cur){ out.push(cur.trim()); cur = word; }
    else cur += word;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
async function speakVits(text){
  try {
    const tts = await loadVits();
    const chunks = splitVits(text, 400);
    for (const c of chunks){
      const out = await tts(c);
      const ok = await playRawAudio(out);
      if (!ok) return false;
    }
    return true;
  } catch(e){ console.warn('[VOIX] VITS echec:', e.message); return false; }
}
/* ===== VOIX PIPER (fr_FR-siwis-medium) : locale, gratuite a vie, prononciation naturelle
   (meilleure que VITS). WASM charges depuis CDN, modele depuis HuggingFace (cache interne). ===== */
let piperEngine = null;
let piperLoading = null;
function loadPiper(){
  if (piperEngine) return Promise.resolve(piperEngine);
  if (piperLoading) return piperLoading;
  if (!window.PiperWeb){ return Promise.reject(new Error('Piper non charge')); }
  piperLoading = (async () => {
    const P = window.PiperWeb;
    /* 1.18.0 : seule version avec WASM non-threaded (ort-wasm-simd.wasm) -> pas besoin
       des headers COOP/COEP (impossibles sur GitHub Pages). 1.19+ = threaded uniquement -> 404. */
    const ort = await import('https://esm.sh/onnxruntime-web@1.18.0');
    const engine = new P.PiperWebEngine({
      onnxRuntime: new P.OnnxWebRuntime({
        ort,
        basePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/',
        numThreads: 1
      }),
      phonemizeRuntime: new P.PhonemizeWebRuntime({
        basePath: 'https://unpkg.com/piper-tts-web@1.1.2/dist/piper/'
      }),
      voiceProvider: new P.HuggingFaceVoiceProvider()
    });
    /* test reel au chargement (modele + phonemize + inference). Si KO -> Piper desactive :
       sinon son etat interne peut rester bloque (Busy) et plus aucun son ne sort jamais */
    const test = await Promise.race([
      engine.generate('Bonjour, je suis prete.', 'fr_FR-siwis-medium', 0),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Piper test timeout')), 90000))
    ]);
    if (!test || !test.file) throw new Error('Piper test KO');
    piperEngine = engine;
    return engine;
  })().catch(e => {
    piperLoading = null;
    try { piperEngine && piperEngine.destroy(); } catch {}
    piperEngine = null;
    throw e;
  });
  return piperLoading;
}
/* Decoupe aux fins de phrases (prosodie naturelle), max ~500 caracteres par chunk */
function splitPiper(text, max){
  const out = [];
  let cur = '';
  const sentences = text.split(/(?<=[.!?…])\s+/);
  for (const s of sentences){
    const next = (cur + ' ' + s).trim();
    if (next.length > max && cur){ out.push(cur.trim()); cur = s; }
    else cur = next;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [text];
}
async function speakPiper(text){
  try {
    const engine = await loadPiper();
    const chunks = splitPiper(text, 500);
    for (const c of chunks){
      /* timeout : si Piper bloque (etat Busy), on abandonne -> repli VITS */
      const response = await Promise.race([
        engine.generate(c, 'fr_FR-siwis-medium', 0),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Piper timeout')), 60000))
      ]);
      if (!response || !response.file) return false;
      const objUrl = URL.createObjectURL(response.file);
      const audio = new Audio(objUrl);
      audio.volume = 1.0;
      currentAudios.push(audio);
      const ok = await new Promise(res => {
        let done = false;
        const finish = v => { if (done) return; done = true; res(v); };
        audio.onended = () => finish(true);
        audio.onerror = () => finish(false);
        audio.play().catch(() => finish(false));
        /* verifier que les donnees arrivent vraiment (sinon faux succes -> muet) */
        setTimeout(() => {
          if (!done && audio.readyState < 2) finish(false);
          else if (!done) finish(true);
        }, (response.duration || 10000) + 5000);
      });
      URL.revokeObjectURL(objUrl);
      if (!ok) return false;
    }
    return true;
  } catch(e){
    console.warn('[VOIX] Piper echec:', e.message);
    /* reset : l'etat interne peut rester bloque (Busy) -> on recharge proprement la prochaine fois */
    try { piperEngine && piperEngine.destroy(); } catch {}
    piperEngine = null;
    return false;
  }
}
/* Repli universel : Google Translate TTS via <audio> (gratuit, sans cle, marche partout,
   pas de fetch -> pas de blocage CORS) */
async function speakGoogleTTS(text){
  try {
    const chunks = splitVits(text, 180);
    for (const c of chunks){
      const url = 'https://translate.google.com/translate_tts?ie=UTF-8&q=' + encodeURIComponent(c) + '&tl=fr&client=tw-ob';
      const ok = await new Promise(res => {
        const audio = new Audio(url);
        audio.volume = 1.0;
        currentAudios.push(audio);
        let done = false;
        const finish = v => { if (done) return; done = true; res(v); };
        audio.onended = () => finish(true);
        audio.onerror = () => finish(false);
        audio.play().catch(() => finish(false));
        /* verifier que les donnees arrivent vraiment (sinon faux succes -> muet) */
        setTimeout(() => {
          if (!done && audio.readyState < 2) finish(false);
          else if (!done) finish(true);
        }, 15000);
      });
      if (!ok) return false;
    }
    return true;
  } catch(e){ console.warn('[VOIX] GoogleTTS echec:', e.message); return false; }
}

/* Voix SYSTEME (Web Speech API) : integree au navigateur, aucune cle, aucun reseau,
   aucun CDN -> fonctionne TOUJOURS. VOIX PRINCIPALE (fiable a 100%). */
function speakSystem(text){
  return new Promise(resolve => {
    try {
      if (!('speechSynthesis' in window)) return resolve(false);
      const chunks = splitPiper(text, 200);
      let i = 0;
      let done = false;
      const finish = ok => { if (done) return; done = true; resolve(ok); };
      const speakNext = () => {
        if (i >= chunks.length) return finish(true);
        const u = new SpeechSynthesisUtterance(chunks[i++]);
        u.lang = 'fr-FR';
        u.rate = 1.0;
        u.pitch = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const fr = voices.filter(v => (v.lang || '').toLowerCase().startsWith('fr'));
        /* meilleure voix francaise dispo : Google > Microsoft > autre */
        const pick = fr.find(v => /google/i.test(v.name)) || fr.find(v => /microsoft/i.test(v.name)) || fr[0];
        if (pick) u.voice = pick;
        u.onend = () => speakNext();
        u.onerror = () => finish(false);
        window.speechSynthesis.speak(u);
      };
      /* garde-fou : si rien ne parle apres 3s (voix indisponible), on passe au repli */
      setTimeout(() => { if (!done && !window.speechSynthesis.speaking) finish(false); }, 3000);
      speakNext();
      /* timeout global (phrases longues) */
      setTimeout(() => finish(true), chunks.length * 20000 + 10000);
    } catch(e){ resolve(false); }
  });
}

function speak(text){
  return new Promise(resolve => {
    const clean = normalizeForTTS(text);
    setState('speaking');
    setStatus('...');
    const done = ok => { setState('idle'); if (ok) setStatus("Appuie sur le micro et parle"); resolve(ok); };
    const trySystem = () => speakSystem(clean).then(ok => {
      if (ok) { console.log('[VOIX] Systeme OK'); done(true); }
      else { console.warn('[VOIX] Systeme bloque -> locale'); if (IS_MOBILE) tryGoogle(); else tryPiper(); }
    });
    const tryPiper = () => speakPiper(clean).then(ok => {
      if (ok) { console.log('[VOIX] Piper OK (locale haute qualite)'); done(true); }
      else { console.warn('[VOIX] Piper bloque -> VITS'); tryVits(); }
    });
    const tryVits = () => speakVits(clean).then(ok => {
      if (ok) { console.log('[VOIX] VITS OK (locale gratuite a vie)'); done(true); }
      else { console.warn('[VOIX] VITS bloque -> GoogleTTS'); tryGoogle(); }
    });
    const tryGoogle = () => speakGoogleTTS(clean).then(ok2 => {
      if (ok2) { console.log('[VOIX] GoogleTTS OK'); done(true); }
      else {
        console.warn('[VOIX] GoogleTTS bloque -> Edge');
        speakEdgeNeural(clean).then(ok3 => { if (ok3) console.log('[VOIX] Edge OK'); else { console.warn('[VOIX] Edge bloque'); setStatus("Voix indisponible - verifie ta connexion"); } done(ok3); });
      }
    });
    /* VOIX SYSTEME D'ABORD : fiable a 100% (aucun reseau, aucun CDN). Les voix locales
       (Piper/VITS) et GoogleTTS ne servent que de secours. */
    trySystem();
  });
}
let currentAudios = [];
function stopAudio(){
  currentAudios.forEach(a => { try { a.pause(); a.src = ''; } catch {} });
  currentAudios = [];
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
}
async function handleQuestion(question){
  if (isProcessing) return;
  isProcessing = true;
  manualStop = true;
  try{ recog && recog.stop(); }catch{}
  /* si une bulle utilisateur existe deja (sous-titre interim), on la complete au lieu d'en creer une autre */
  const last = chat.lastElementChild;
  if (last && last.classList.contains('user')) last.textContent = question;
  else addUserMsg(question);
  setState('thinking');
  setStatus('...');
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
  addAiMsg(r.text);
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
  /* FINI LA BOUCLE : plus AUCUN rechargement automatique ni bandeau.
     Le service worker est network-first : chaque ouverture de l'app charge deja
     la toute derniere version directement. Rien a cliquer, rien de bloque. */
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const j = await res.json();
    if (j.version && versionCompare(j.version, APP_VERSION) > 0){
      console.info('[MAJ] Nouvelle version ' + j.version + ' detectee - deja chargee au prochain chargement (network-first)');
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
function resetApp(){ localStorage.clear(); session=[]; currentConvId=null; isProcessing=false; manualStop=false; welcomeDone=false; welcomePlaying=false; edgeTried=false; state="idle"; setStatus("Appuie sur le micro et parle"); setState("idle"); location.reload(true); }
$('appVersion').textContent = 'Assistant Vocal IA - v' + APP_VERSION;
$('versionTag').textContent = 'v' + APP_VERSION;
checkUpdate();
setStatus("Appuie sur le micro et parle");
// Voix Edge Neural via WebSocket uniquement
