/* =====================================================================
   ASTRA — INTERFACE CHAT (v10.13)
   Page dediee : ecrit + import d'images. Le mode vocal (index.html)
   n'est pas touche. Astra analyse vraiment l'image envoyee.
   ===================================================================== */
(function(){
'use strict';

const $ = id => document.getElementById(id);
const chat = $('chat'), chatEmpty = $('chatEmpty'), ceNote = $('ceNote');
const input = $('input'), sendBtn = $('sendBtn'), attachBtn = $('attachBtn');
const fileInput = $('fileInput'), pending = $('pending'), toastEl = $('toast');
const lightbox = $('lightbox'), lbImg = $('lbImg'), dropVeil = $('dropVeil');

const MISTRAL_KEY_LS = 'va_mistral_key';   /* meme cle que le mode vocal */
const THREADS_LS     = 'va_chat_threads';  /* conversations de ce chat   */
const MAX_IMAGES     = 4;                  /* par message (cout tokens) */
const HISTORY_TURNS  = 12;                 /* memoire envoyee au modele */

const getMistralKey = () => { try { return (localStorage.getItem(MISTRAL_KEY_LS)||'').trim(); } catch { return ''; } };

/* ---------------------------------------------------------------
   1. PERSONNALITE ASTRA (identite identique a l'app vocale)
   v10.14 : ton naturel, comme ChatGPT. Plus de commentaire sur la
   facon de parler de l'utilisateur (c'etait le bug "je prefere le
   vouvoiement"), plus de formules d'assistant generique.
   --------------------------------------------------------------- */
const ASTRA = `Tu t'appelles Astra, une intelligence artificielle francaise creee par tom point a i le 10 septembre 2026, qui te developpe chaque jour. Reponds TOUJOURS en francais, meme si l'utilisateur ecrit dans une autre langue. Si on te demande qui t'a creee, qui a fait l'interface, le design, l'application ou le site : reponds TOUJOURS tom point a i, jamais une equipe, un chef de produit, des developpeurs, des designers ou une entreprise. Ton nom : TOUJOURS Astra, jamais un autre assistant ni un autre modele. Il n'y a plus de fonction mail : elle a ete supprimee par tom point a i pour des raisons de securite, ne dis jamais qu'elle existe et ne propose jamais de lire des mails. Pas de didascalies ni de descriptions de scene. Ton TON : tu parles comme un ami, simplement et avec chaleur. Tutoie l'utilisateur (tu, ton, ta, tes) par defaut, mais si lui te vouvoie, vouvoie-le en retour.

REGLE ABSOLUE SUR LE TON : tu ne fais JAMAIS de commentaire sur la maniere dont l'utilisateur parle. Interdit de dire : "je prefere rester dans le respect du vouvoiement", "vous etes tres formel", "votre ton est un peu distant", "vous commencez par un salut un peu informel", "je reste professionnelle", ou tout equivalent. L'utilisateur peut te dire "salut", "coucou", "yo", "bonjour", "merci", "svp" : tu y reponds normalement, sans commenter.

AUCUNE FORMULE D'ASSISTANT : ne commence jamais par "Comment puis-je vous aider ?", "Comment puis-je t'aider ?", "Je suis a ta disposition", "N'hesite pas si tu as d'autres questions", "Voici quelques idees", "J'espero que cela t'aidera", "En conclusion", "Voici une breve synthese" ou toute phrase de remplissage. Reponds directement, comme dans une vraie conversation.

Si l'utilisateur te salue ("salut", "bonjour", "coucou", "salut Astra") : reponds par une salutation courte et chaleureuse, puis relance naturellement la conversation avec une question. Ne repete pas sa salutation mot pour mot comme un miroir, et ne te contente jamais d'une reponse vide du type "Bonjour ! Comment puis-je vous aider ?". Si l'utilisateur pose une VRAIE question, reponds a la question, sans salutation d'introduction.

Tu as du caractere : franche et directe, parfois taquine, mais tu ne refuses jamais de repondre. Ne mets pas d'emoji sauf que l'utilisateur en mette lui-meme. Ne corrige jamais l'orthographe de l'utilisateur. Ecris des phrases claires, bien formees, sans fautes.`;

const SYSTEM_PROMPT = ASTRA + ` Ici tu parles par ecrit : tu peux etre plus detaillee et structurer ta reponse quand c'est utile (liste, etapes, exemples), mais reste claire, directe et naturelle.`;

const SYSTEM_VISION = ASTRA + ` IMPORTANT — tu vois reellement l'image que l'utilisateur vient d'envoyer. Decris ce que tu vois avec precision et honnetete : les personnes (nombre, apparence, position), les objets, le texte ecrit s'il y en a, les couleurs, le lieu, l'ambiance. Donne tous les details utiles que tu peux vraiment distinguer. Si un element est flou, trop petit ou que tu n'es pas suree, dis-le clairement plutot que d'inventer. N'invente jamais ce que tu ne vois pas. Si l'utilisateur pose une question precise sur l'image, reponds a cette question, et ajoute la description si elle aide. Sois concret et organise ta reponse.`;

/* ---------------------------------------------------------------
   2. ETAT
   --------------------------------------------------------------- */
let threads = [];
let current = null;
let busy = false;
let pendingImgs = [];   /* { dataUrl, name } en attente d'envoi */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------------------------------------------------------------
   2b. PRENOM + ACCUEIL SELON L'HEURE (v10.14)
   Astra dit bonjour en JA et avec le prenom avant toute discussion.
   Genere localement : instantane, ne depend pas de l'API.
   --------------------------------------------------------------- */
const PROFILE_KEY = 'va_profile';   /* meme cle que le mode vocal */

function getUserName(){
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (p && p.name) return String(p.name).trim().split(/\s+/)[0].slice(0, 30);
  } catch {}
  return '';
}

function greetingText(){
  const h   = new Date().getHours();
  const who = getUserName();
  /* "Bonjour Tom !" ou "Bonjour !" si le prenom n'est pas encore connu */
  const say = mot => mot + (who ? ' ' + who : '') + ' !';
  let head, tail;
  if (h < 5){
    head = say('Bonsoir'); tail = "Il est " + h + " h, tu dors encore ?";
  } else if (h < 12){
    head = say('Bonjour'); tail = h < 9 ? 'Tu as bien dormi ?' : 'Comment va ta matinée ?';
  } else if (h < 18){
    head = say('Bonjour'); tail = h < 14 ? 'Comment ça va ?' : 'Comment se passe ton après-midi ?';
  } else if (h < 23){
    head = say('Bonsoir'); tail = 'Comment s’est passée ta journée ?';
  } else {
    head = say('Bonsoir'); tail = 'Tu ne dors pas encore ?';
  }
  return head + ' ' + tail;
}

/* pousse l'accueil une seule fois, en tete de conversation */
function ensureGreeting(){
  if (!current) return;
  if (current.messages.length) return;
  current.messages.push({ role: 'assistant', text: greetingText(), imgUrl: null });
  current.greeted = true;
  current.title = current.title || 'Nouvelle conversation';
  saveThreads();
}

/* ---------------------------------------------------------------
   3. PERSISTANCE
   --------------------------------------------------------------- */
function loadThreads(){
  try { threads = JSON.parse(localStorage.getItem(THREADS_LS) || '[]'); } catch { threads = []; }
  if (!Array.isArray(threads)) threads = [];
}
function saveThreads(){
  try { localStorage.setItem(THREADS_LS, JSON.stringify(threads.slice(0, 40))); } catch {}
}
function newThread(){
  current = { id: uid(), title: 'Nouvelle conversation', createdAt: Date.now(), messages: [] };
  threads.unshift(current);
  saveThreads();
}
function loadThread(id){
  const t = threads.find(x => x.id === id);
  if (t) current = t;
}
function saveCurrent(){
  /* on ne stocke PAS les images (base64 trop lourd) : seul le texte */
  if (!current) return;
  saveThreads();
}

/* ---------------------------------------------------------------
   4. RENDU
   --------------------------------------------------------------- */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function scrollDown(){ try { chat.scrollTop = chat.scrollHeight; } catch {} }

function hideEmpty(){ if (chatEmpty) chatEmpty.style.display = 'none'; }

/* suggestions conservees sous l'accueil (elles disparaissent au 1er envoi) */
const STARTERS = [
  'Décris cette image en détail',
  'Que vois-tu sur cette photo ?',
  'Aide-moi à écrire un message',
  'Explique-moi un truc simplement'
];
function renderStarters(){
  if ($('startersEl')) return;
  const d = document.createElement('div');
  d.className = 'starters';
  d.id = 'startersEl';
  STARTERS.forEach(q => {
    const b = document.createElement('button');
    b.className = 'ce-chip';
    b.textContent = q;
    b.addEventListener('click', () => { input.value = q; autoGrow(); input.focus(); });
    d.appendChild(b);
  });
  chat.appendChild(d);
  scrollDown();
}
function removeStarters(){ const d = $('startersEl'); if (d) d.remove(); }

function addMsg(role, text, imgUrl, via){
  hideEmpty();
  const d = document.createElement('div');
  d.className = 'msg ' + (role === 'user' ? 'user' : 'ai');
  const label = role === 'user' ? 'Toi' : 'Astra';
  let html = '<span class="msg-role">' + label + '</span>';
  if (imgUrl){
    html += '<img class="msg-img" src="' + imgUrl + '" alt="Image envoyée">';
  }
  if (text) html += esc(text);
  /* v10.17 : on dit quel cerveau a repondu (transparence quand le secours
     prend le relais, l'utilisateur doit le savoir) */
  if (role === 'ai' && via && via !== 'Mistral'){
    html += '<div class="msg-diag">répondu par le cerveau de secours (' + esc(via) + ')</div>';
  }
  d.innerHTML = html;
  if (imgUrl){
    d.querySelector('.msg-img').addEventListener('click', () => openLightbox(imgUrl));
  }
  chat.appendChild(d);
  scrollDown();
  return d;
}

function addError(text){
  hideEmpty();
  const d = document.createElement('div');
  d.className = 'msg ai err';
  d.innerHTML = '<span class="msg-role">Astra</span>' + esc(text);
  chat.appendChild(d);
  scrollDown();
}

function showTyping(label){
  const t = document.createElement('div');
  t.className = 'typing';
  t.id = 'typingEl';
  t.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span><span>' + esc(label) + '</span>';
  chat.appendChild(t);
  scrollDown();
}
function hideTyping(){ const t = $('typingEl'); if (t) t.remove(); }

function renderThread(){
  chat.innerHTML = '';
  if (chatEmpty) chatEmpty.style.display = current && current.messages.length ? 'none' : '';
  if (!current || !current.messages.length) return;
  current.messages.forEach(m => addMsg(m.role, m.text, m.imgUrl));
  if (current.messages.length <= 1) renderStarters();
}

function setNote(msg){
  if (!ceNote) return;
  if (!msg){ ceNote.classList.remove('show'); return; }
  ceNote.textContent = msg;
  ceNote.classList.add('show');
}

/* ---------------------------------------------------------------
   5. IMAGES : compression + apercus
   --------------------------------------------------------------- */
const MAX_DIM = 1024;   /* suffisant pour une description fiable, et bien moins de tokens */
const JPEG_Q  = 0.78;   /* qualite visuelle identique a l'oeil, poids divise par ~2 */

function compressImage(file){
  return new Promise((resolve, reject) => {
    if (!/^image\//i.test(file.type)) return reject(new Error('Ce fichier n’est pas une image.'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    fr.onload = () => {
      const src = String(fr.result);
      const img = new Image();
      img.onerror = () => {
        /* certains formats (HEIC) ne se decodent pas : on garde l'original */
        resolve({ dataUrl: src, name: file.name || 'image' });
      };
      img.onload = () => {
        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) return resolve({ dataUrl: src, name: file.name || 'image' });
        const scale = Math.min(1, MAX_DIM / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        try {
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const cx = cv.getContext('2d');
          cx.fillStyle = '#0d0d18';
          cx.fillRect(0, 0, w, h);
          cx.drawImage(img, 0, 0, w, h);
          resolve({ dataUrl: cv.toDataURL('image/jpeg', JPEG_Q), name: file.name || 'image' });
        } catch {
          resolve({ dataUrl: src, name: file.name || 'image' });
        }
      };
      img.src = src;
    };
    fr.readAsDataURL(file);
  });
}

function renderPending(){
  pending.innerHTML = '';
  pendingImgs.forEach((im, i) => {
    const d = document.createElement('div');
    d.className = 'pv';
    d.innerHTML = '<img src="' + im.dataUrl + '" alt="">' +
                  '<button class="pv-x" aria-label="Retirer">✕</button>';
    d.querySelector('.pv-x').addEventListener('click', () => {
      pendingImgs.splice(i, 1);
      renderPending();
    });
    pending.appendChild(d);
  });
}

function addFiles(files){
  const list = Array.from(files || []).filter(f => /^image\//i.test(f.type));
  if (!list.length){ toast('⚠️ Ajoute une image (jpg, png, webp…)'); return; }
  const room = MAX_IMAGES - pendingImgs.length;
  if (room <= 0){ toast('⚠️ Maximum ' + MAX_IMAGES + ' images par message'); return; }
  toast('⏳ Lecture de l’image…');
  Promise.all(list.slice(0, room).map(compressImage))
    .then(items => {
      items.forEach(it => pendingImgs.push(it));
      renderPending();
      input.focus();
    })
    .catch(e => toast('⚠️ ' + (e && e.message ? e.message : 'Image illisible')));
}

/* visionneuse */
function openLightbox(src){ lbImg.src = src; lightbox.classList.add('show'); }
function closeLightbox(){ lightbox.classList.remove('show'); lbImg.src = ''; }
lightbox.addEventListener('click', closeLightbox);
$('lbClose').addEventListener('click', closeLightbox);

/* ---------------------------------------------------------------
   6. APPELS MISTRAL (texte + vision)
   --------------------------------------------------------------- */
const withTimeout = (p, ms) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
]);

/* modeles : le premier qui repond gagne. Mistral Small sait lire les images. */
const MODELS_TEXT   = ['mistral-small-latest', 'open-mistral-nemo', 'mistral-medium-2508'];
const MODELS_VISION = ['mistral-small-latest', 'mistral-medium-2508', 'pixtral-large-latest', 'ministral-14b-2512', 'mistral-large-2512'];

function contentText(messages){
  return messages.map(m => ({ role: m.role, content: m.text }));
}

/* Filet de securite : Mistral renvoie 422 si un message n'a pas de "content".
   On nettoie donc toujours la liste avant l'envoi. */
function sanitize(messages){
  const out = [];
  messages.forEach(m => {
    if (!m || !m.role) return;
    if (Array.isArray(m.content)){
      if (m.content.length) out.push({ role: m.role, content: m.content });
    } else if (typeof m.content === 'string' && m.content.trim() !== ''){
      out.push({ role: m.role, content: m.content });
    }
    /* tout message sans contenu est SUPPRIME : il provoquerait un 422 */
  });
  return out;
}

function buildVisionMessages(history, userText, images){
  const msgs = [{ role: 'system', content: SYSTEM_VISION }];
  /* v10.15 : contextMessages() renvoie { role, content } -> on lit "content".
     (v10.14 lisait "m.text" qui n'existait pas -> content undefined -> 422) */
  history.forEach(m => {
    const txt = (m && (m.content != null ? m.content : m.text)) || '';
    if (String(txt).trim()) msgs.push({ role: m.role, content: String(txt) });
  });
  const parts = [];
  if (userText) parts.push({ type: 'text', text: userText });
  else parts.push({ type: 'text', text: "Decris cette image en detail : ce que tu vois vraiment, et tout texte qui y figure." });
  images.forEach(im => parts.push({ type: 'image_url', image_url: im.dataUrl }));
  msgs.push({ role: 'user', content: parts });
  return sanitize(msgs);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* lit le message d'erreur reel de Mistral (utile pour comprendre) */
async function readErr(res){
  try {
    const d = await res.json();
    const msg = (d && (d.message || (d.detail && d.detail[0] && d.detail[0].msg) || (typeof d.detail === 'string' ? d.detail : ''))) || '';
    return String(msg).slice(0, 180);
  } catch { return ''; }
}

async function callMistral(models, messages, maxTokens, onWait, maxAttempts){
  const key = getMistralKey();
  if (!key) throw new Error('NOKEY');

  const hasImage = messages.some(m => Array.isArray(m.content) &&
                                   m.content.some(p => p.type === 'image_url'));
  /* 1) forme string (documentee par Mistral)  2) forme objet {url} */
  const shapes = hasImage ? ['str', 'obj'] : ['str'];
  let lastErr = '', firstDetail = '', rateInfo = '';

  for (const model of models){
    for (const shape of shapes){
      const body = messages.map(m => {
        if (!Array.isArray(m.content)) return { role: m.role, content: m.content };
        const parts = m.content.map(p =>
          p.type === 'image_url'
            ? (shape === 'str' ? { type: 'image_url', image_url: p.image_url }
                              : { type: 'image_url', image_url: { url: p.image_url } })
            : p);
        return { role: m.role, content: parts };
      });

      /* v10.15 : un 429 se retente sur LE MEME modele apres une pause.
         v10.17 : "maxAttempts" = 1 pour le TEXTE (le cerveau de secours est
         instantane, inutile d'attendre 40 s) et 3 pour la VISION (aucun
         secours possible, donc on insiste). */
      const tries = Math.max(1, maxAttempts || 3);
      for (let attempt = 0; attempt < tries; attempt++){
        let res = null, err = null;
        try {
          res = await withTimeout(fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({ model, messages: body, max_tokens: maxTokens, temperature: 0.5 })
          }), 45000);
        } catch (e){
          err = (e && e.message) ? e.message : 'reseau';
        }

        if (res && res.ok){
          const data = await res.json();
          const txt = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
          if (txt) return txt;
          lastErr = 'reponse vide';
          break;
        }

        const status = res ? res.status : 0;
        if (status === 401 || status === 403) throw new Error('BADKEY');

        if (status === 429){
          /* v10.16 : on LIT le corps de la reponse 429. C'est la que Mistral
             explique la vraie raison (quota gratuit epuise, cle sans paiement,
             limite par minute...). Avant on ne lisait rien -> impossible de
             savoir si c'etait temporaire ou permanent. */
          const det = await readErr(res);
          if (det) firstDetail = det;
          const ra = Number(res.headers && res.headers.get && res.headers.get('Retry-After')) || 0;
          /* backoff exponentiel : 10s puis 30s puis 60s */
          const backoff = [10, 30, 60][attempt] || 60;
          const wait = Math.min(60000, (ra || backoff) * 1000);
          rateInfo = det || ('HTTP 429' + (ra ? ' (Retry-After ' + ra + 's)' : ''));
          if (attempt < tries - 1){
            if (onWait) onWait(Math.round(wait / 1000));
            await sleep(wait);
            continue;
          }
          throw new Error('RATE:' + wait + ':' + (rateInfo || 'limite de requetes'));
        }

        if (err){ lastErr = err; break; }

        const det = await readErr(res);
        if (det && !firstDetail) firstDetail = det;
        lastErr = 'erreur ' + status + (det ? ' : ' + det : '');
        /* 400/422 = requete mal formee : inutile d'insister sur ce modele */
        break;
      }
    }
    /* petit repos entre 2 modeles : evite de repartir en rafale sur l'API */
    await sleep(700);
  }
  throw new Error((lastErr || 'inconnu') + (rateInfo ? ' [' + rateInfo + ']' : ''));
}

/* ---------------------------------------------------------------
   6b. CERVEAU DE SECOURS (v10.17)
   Mistral se fait limiter (429) : le chat ne doit surtout pas rester
   muet. On bascule sur un cerveau GRATUIT sans cle, deja verifie
   (HTTP 200 + identite Astra conservee).
   LLM7 et OVH ont ete supprimes : leurs domaines ne resolvent plus.
   ---------------------------------------------------------------- */
const FREE_BRAIN = { url: 'https://text.pollinations.ai/openai/v1/chat/completions', model: 'openai' };
let mistralBlockedUntil = 0;   /* timestamp : tant que ca dure, on va direct au secours */

function mistralIsBlocked(){ return Date.now() < mistralBlockedUntil; }

async function callFreeBrain(messages, maxTokens){
  const body = messages.map(m => ({ role: m.role, content: m.content }));
  const res = await withTimeout(fetch(FREE_BRAIN.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: FREE_BRAIN.model, messages: body, max_tokens: maxTokens, temperature: 0.5 })
  }), 25000);
  if (!res || !res.ok) throw new Error('secours indisponible (' + (res ? res.status : '?') + ')');
  const data = await res.json();
  const txt = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
  if (!txt) throw new Error('secours : reponse vide');
  if (/^the user (says|asks|is asking|wants)/i.test(txt)) throw new Error('secours : reponse parasite');
  return txt;
}

/* texte : Mistral d'abord (meilleur), secours gratuit si limite */
async function askText(messages, maxTokens, onWait){
  if (!getMistralKey()) return { text: await callFreeBrain(messages, maxTokens), via: 'secours' };
  if (mistralIsBlocked()){
    try { return { text: await callFreeBrain(messages, maxTokens), via: 'secours' }; } catch (e){}
    /* le secours a aussi echoue : on retente Mistral malgre le blocage */
  }
  try {
    /* 1 seule tentative Mistral pour le texte : si ca rate, le secours gratuit
       repond en 1-2 s. Inutile d'insister et de faire attendre l'utilisateur. */
    const t = await callMistral(MODELS_TEXT, sanitize(messages), maxTokens, onWait, 1);
    return { text: t, via: 'Mistral' };
  } catch (e){
    const em = (e && e.message) || '';
    if (/^RATE:/.test(em)) mistralBlockedUntil = Date.now() + 60000;  /* 1 min de repos */
    try {
      const t = await callFreeBrain(messages, maxTokens);
      return { text: t, via: 'secours', rate: /trop de requetes/i.test(em) };
    } catch (e2){
      throw e;   /* on garde l'erreur Mistral : elle est plus parlante */
    }
  }
}

/* ---------------------------------------------------------------
   7. ENVOI
   --------------------------------------------------------------- */
function contextMessages(){
  if (!current) return [];
  return current.messages
    .filter(m => m.text && !m.imgUrl)
    .slice(-HISTORY_TURNS)
    .map(m => ({ role: m.role, content: m.text }));
}

async function send(){
  if (busy) return;
  const text = input.value.trim();
  const imgs = pendingImgs.slice();

  if (!text && !imgs.length){ input.focus(); return; }

  if (!getMistralKey()){
    setNote('⚠️ Pour parler à Astra (et pour qu’elle regarde tes images), il te faut une clé API Mistral. Ouvre ⚙️ Réglages pour la coller.');
    openSettings();
    toast('⚠️ Clé API Mistral requise');
    return;
  }

  busy = true;
  sendBtn.disabled = true;
  input.value = '';
  input.style.height = 'auto';
  pendingImgs = [];
  renderPending();

  const firstImg = imgs[0] ? imgs[0].dataUrl : null;
  removeStarters();
  addMsg('user', text, firstImg);
  setNote('');
  if (current){
    current.messages.push({ role: 'user', text: text, imgUrl: null });
    if (!current.title || current.title === 'Nouvelle conversation'){
      current.title = (text || '🖼️ Image').slice(0, 46);
    }
    saveCurrent();
  }

  showTyping(imgs.length ? '👀 Astra regarde ton image…' : 'Astra écrit…');
  /* v10.16 : si Mistral limite, on previent pendant la pause au lieu de
     laisser un "..." muet, et on bloque les envois pendant ce temps. */
  const onWait = sec => {
    const t = $('typingEl');
    if (t) t.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>' +
      '<span>Limite Mistral — je réessaie dans ' + sec + ' s…</span>';
  };

  try {
    let answer, via = 'Mistral';
    if (imgs.length){
      /* VISION : Mistral uniquement. Aucun cerveau gratuit ne lit les images
         (Pollinations repond 402 "Paiement requis" sur une image). */
      if (!getMistralKey()){
        busy = false; sendBtn.disabled = false;
        imgs.forEach(im => pendingImgs.push(im));
        renderPending();
        input.value = text; autoGrow();
        hideTyping();
        addError('Regarder une image a besoin de la clé API Mistral. Ouvre ⚙️ Réglages pour la coller — ton image est gardée, tu n’auras qu’à renvoyer.');
        return;
      }
      const msgs = buildVisionMessages(contextMessages(), text, imgs);
      answer = await callMistral(MODELS_VISION, msgs, 1000, onWait);
    } else {
      const msgs = [{ role: 'system', content: SYSTEM_PROMPT }].concat(contextMessages());
      msgs.push({ role: 'user', content: text });
      const r = await askText(msgs, 1000, onWait);
      answer = r.text; via = r.via;
      if (r.rate) toast('⚠️ Mistral limité — je réponds avec le cerveau de secours');
    }
    hideTyping();
    addMsg('ai', answer, null, via);
    if (current){ current.messages.push({ role: 'assistant', text: answer, imgUrl: null }); saveCurrent(); }
  } catch (e) {
    hideTyping();
    const em = (e && e.message) || '';
    let msg;
    if (imgs.length && /^RATE:/.test(em)){
      /* on ne perd pas l'image : elle revient dans le composeur */
      imgs.forEach(im => pendingImgs.push(im));
      renderPending();
      const why = em.split(':').slice(2).join(':').trim();
      msg = 'Mistral est limité, donc je ne peux pas regarder l’image pour l’instant (' +
            (why ? 'raison : ' + why : 'limite de requêtes') + '). ' +
            'Ton image est gardée : réessaie dans une minute. ' +
            'En attendant, le chat texte marche avec le cerveau de secours.';
    }
    else if (em === 'NOKEY') msg = 'Il me faut une clé API Mistral. Ouvre ⚙️ Réglages pour la coller.';
    else if (em === 'BADKEY') msg = 'Ta clé API Mistral semble invalide. Vérifie-la dans ⚙️ Réglages.';
    else if (em === 'timeout') msg = 'La réponse a pris trop de temps. Réessaie.';
    else if (/^RATE:/.test(em)){
      const p = em.split(':');
      const sec = Math.round(Number(p[1]) / 1000) || 60;
      const why = p.slice(2).join(':').trim() || 'limite de requetes atteinte';
      console.warn('[Astra] Mistral 429 :', why);
      msg = 'Limite Mistral atteinte. Raison indiquée par Mistral : « ' + why + ' ». ' +
            'Attends ' + sec + ' s avant de réessayer. Si cela continue, vérifie ton offre ' +
            'sur console.mistral.ai (une clé gratuite peut être bloquée).';
    }
    else msg = 'Je n’ai pas pu répondre (' + (em || 'erreur') + ').';
    addError(msg);
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

/* ---------------------------------------------------------------
   8. INTERFACE
   --------------------------------------------------------------- */
function autoGrow(){
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
}
input.addEventListener('input', autoGrow);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); }
});
sendBtn.addEventListener('click', send);
attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

/* coller une image */
document.addEventListener('paste', e => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const files = [];
  for (let i = 0; i < items.length; i++){
    if (items[i].type && items[i].type.indexOf('image') === 0){
      const f = items[i].getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length){ e.preventDefault(); addFiles(files); }
});

/* glisser-deposer */
let dragDepth = 0;
window.addEventListener('dragenter', e => {
  if (!e.dataTransfer || Array.from(e.dataTransfer.types || []).indexOf('Files') === -1) return;
  e.preventDefault(); dragDepth++; dropVeil.classList.add('show');
});
window.addEventListener('dragover', e => {
  if (!e.dataTransfer) return; e.preventDefault();
});
window.addEventListener('dragleave', e => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropVeil.classList.remove('show');
});
window.addEventListener('drop', e => {
  if (!e.dataTransfer) return;
  e.preventDefault(); dragDepth = 0; dropVeil.classList.remove('show');
  if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

/* suggestions */
document.querySelectorAll('.ce-chip').forEach(b => {
  b.addEventListener('click', () => {
    input.value = b.dataset.q || '';
    autoGrow(); input.focus();
  });
});

/* modales */
const historyModal = $('historyModal'), settingsModal = $('settingsModal');
const mkInput = $('mistralKey');
if (mkInput) mkInput.value = getMistralKey();

function openHistory(){
  const list = $('histList');
  list.innerHTML = '';
  if (!threads.length){
    list.innerHTML = '<p class="muted">Aucune conversation pour l’instant.</p>';
  } else {
    threads.forEach(t => {
      const b = document.createElement('button');
      b.className = 'hist-item';
      const n = (t.messages || []).length;
      b.innerHTML = esc(t.title || 'Sans titre') + '<small>' + n + ' message' + (n > 1 ? 's' : '') + ' · ' +
                    new Date(t.createdAt || Date.now()).toLocaleString('fr-FR') + '</small>';
      b.addEventListener('click', () => { loadThread(t.id); renderThread(); historyModal.classList.add('hidden'); });
      list.appendChild(b);
    });
  }
  historyModal.classList.remove('hidden');
}
function openSettings(){
  if (mkInput) mkInput.value = getMistralKey();
  settingsModal.classList.remove('hidden');
  if (mkInput) setTimeout(() => mkInput.focus(), 60);
}
$('historyBtn').addEventListener('click', openHistory);
$('settingsBtn').addEventListener('click', openSettings);
$('closeHistory').addEventListener('click', () => historyModal.classList.add('hidden'));
$('closeSettings').addEventListener('click', () => settingsModal.classList.add('hidden'));
historyModal.addEventListener('click', e => { if (e.target === historyModal) historyModal.classList.add('hidden'); });
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.classList.add('hidden'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape'){ historyModal.classList.add('hidden'); settingsModal.classList.add('hidden'); closeLightbox(); } });

function resetChat(){
  if (current) saveCurrent();
  newThread();
  ensureGreeting();
  renderThread();
  chat.scrollTop = 0;
  setNote('');
  toast('✨ Nouvelle conversation');
  input.focus();
}
$('newChatBtn').addEventListener('click', resetChat);
$('newConvBtn2').addEventListener('click', () => { resetChat(); historyModal.classList.add('hidden'); });

$('saveMistralKey').addEventListener('click', () => {
  const v = (mkInput.value || '').trim();
  localStorage.setItem(MISTRAL_KEY_LS, v);
  if (v) setNote('');
  toast(v ? '✅ Clé API enregistrée' : '🔑 Clé effacée');
  settingsModal.classList.add('hidden');
});

/* toast */
let toastTimer = null;
function toast(msg){
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

/* ---------------------------------------------------------------
   9. DEMARRAGE
   --------------------------------------------------------------- */
loadThreads();
if (threads.length) { current = threads[0]; }
else { newThread(); }
ensureGreeting();
renderThread();
if (!getMistralKey()){
  setNote('⚠️ Il te faut une clé API Mistral pour discuter et pour que Astra regarde tes images. Ouvre ⚙️ Réglages pour la coller — elle reste sur ton appareil.');
}
input.focus();

})();
