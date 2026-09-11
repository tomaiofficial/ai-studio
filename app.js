/* Assistant Vocal IA — app.js */
'use strict';

/* ============ ÉTAT ============ */
const LS = {
  reminders: 'va_reminders',
  events:    'va_events',
  notes:     'va_notes',
  theme:     'va_theme',
  voice:     'va_voice'
};
let reminders = load(LS.reminders, []);
let events    = load(LS.events, []);
let notes     = load(LS.notes, []);
let timers    = [];
let listening = false;
let voices    = [];

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

/* ============ SYNTHÈSE VOCALE (voix naturelle) ============ */
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
  // Meilleure voix française dispo : Google / Neural / Premium d'abord
  const fr = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('fr'));
  return fr.find(v => /google|neural|premium|enhanced|natural/i.test(v.name)) || fr[0] || null;
}

function speak(text){
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  const v = getVoice();
  if (v) u.voice = v;
  u.rate = 1.0;   // débit naturel
  u.pitch = 1.0;
  u.volume = 1.0;
  speechSynthesis.speak(u);
}

function respond(html, cls = ''){
  $('response').innerHTML = `<p class="${cls}">${html}</p>`;
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
    $('status').textContent = '🎧 Je t\'écoute…';
    $('heard').hidden = true;
  };
  rec.onresult = e => {
    const text = e.results[0][0].transcript.trim();
    $('heard').textContent = '🗣️ « ' + text + ' »';
    $('heard').hidden = false;
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
    $('status').textContent = 'Prêt · dis quelque chose';
  };
  try { rec.start(); } catch {}
}

$('orb').addEventListener('click', startListening);

/* ============ PARSEUR DE TEMPS (français) ============ */
const JOURS = { lundi:1, mardi:2, mercredi:3, jeudi:4, vendredi:5, samedi:6, dimanche:0 };

function parseTime(text){
  /* Retourne {ts, label} ou null */
  const t = text.toLowerCase();

  // "dans X secondes/minutes/heures/jours"
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

  // Jour + heure : "demain à 10h", "lundi à 9h", "après-demain à 14h30"
  // (vérifié AVANT l'heure seule pour que "demain à 10h" = demain, pas aujourd'hui)
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

  // "à 15h30" / "à 15:30" / "à 15h" / "à 9h30"
  m = t.match(/(?:à|pour)\s*(\d{1,2})\s*h\s*(\d{2})?/);
  if (m){
    const h = parseInt(m[1], 10), min = m[2] ? parseInt(m[2], 10) : 0;
    const d = new Date(); d.setHours(h, min, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return { ts: d.getTime(), label: 'à ' + h + 'h' + (m[2] ? m[2] : '00') };
  }

  // "à midi" / "à minuit"
  if (t.includes('midi')){
    const d = new Date(); d.setHours(12, 0, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return { ts: d.getTime(), label: 'à midi' };
  }
  if (t.includes('minuit')){
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
    return { ts: d.getTime(), label: 'à minuit' };
  }

  // "ce soir" / "ce matin" / "cet après-midi" sans heure
  if (t.includes('soir')){ const d = new Date(); d.setHours(19,0,0,0); if (d.getTime()<Date.now()) d.setDate(d.getDate()+1); return { ts:d.getTime(), label:'ce soir à 19h' }; }
  if (t.includes('après-midi') || t.includes('apres-midi')){ const d = new Date(); d.setHours(14,0,0,0); if (d.getTime()<Date.now()) d.setDate(d.getDate()+1); return { ts:d.getTime(), label:'cet après-midi à 14h' }; }
  if (t.includes('matin')){ const d = new Date(); d.setHours(9,0,0,0); if (d.getTime()<Date.now()) d.setDate(d.getDate()+1); return { ts:d.getTime(), label:'ce matin à 9h' }; }

  return null;
}

/* Nettoyage du texte de tâche (retire les mentions de temps) */
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

/* ============ COMMANDES ============ */
function handleCommand(raw){
  const text = raw.toLowerCase();
  const norm = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // --- AIDE ---
  if (text.includes('aide') || text.includes('que sais-tu faire') || text.includes('help') || text.includes('commandes')){
    respond('Je peux :<br>⏰ <b>Rappels</b> — « rappelle-moi de X dans 2 heures »<br>📅 <b>Calendrier</b> — « ajoute un événement X demain à 14h »<br>📍 <b>Position</b> — « où suis-je »<br>🌤️ <b>Météo</b> — « quel temps fait-il »<br>⏱️ <b>Minuteur</b> — « minuteur de 5 minutes »<br>🧮 <b>Calculs</b> — « combien font 15 + 27 »<br>📝 <b>Notes</b> — « note que X »<br>🎲 <b>Pile ou face / dé / choix</b><br>🕐 <b>Heure/date</b> — « quelle heure est-il »', 'info');
    speak('Je peux gérer tes rappels, ton calendrier, ta position, la météo, des minuteurs, des calculs, des notes, et bien plus. Dis aide à tout moment.');
    return;
  }

  // --- POSITION ---
  if (text.includes('où suis-je') || text.includes('ou suis-je') || text.includes('ma position') || text.includes('localisation') || text.includes('position gps') || text.includes('où je suis') || text.includes('ou je suis')){
    getLocation();
    return;
  }

  // --- MÉTÉO ---
  if (text.includes('météo') || text.includes('meteo') || text.includes('quel temps') || text.includes('il fait quel temps') || text.includes('temps qu\'il fait') || text.includes('il pleut') || text.includes('il fait froid') || text.includes('il fait chaud') || text.includes('demain il')){
    getWeather(text.includes('demain'));
    return;
  }

  // --- HEURE / DATE ---
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

  // --- CALCULS ---
  const calc = tryCalc(text);
  if (calc !== null){
    respond(`🧮 <b>${esc(calc.expr)}</b> = <b>${calc.result}</b>`, 'ok');
    speak(`${calc.expr} égale ${calc.result}.`);
    return;
  }

  // --- CONVERSIONS ---
  const conv = tryConvert(text);
  if (conv){
    respond(`🔄 <b>${conv.from}</b> = <b>${conv.to}</b>`, 'ok');
    speak(`${conv.from} équivaut à ${conv.to}.`);
    return;
  }

  // --- PILE OU FACE / DÉ / CHOIX ---
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

  // --- BLAGUES ---
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

  // --- ÉPELLER ---
  if (text.includes('épelle') || text.includes('epelle') || text.includes('épeler') || text.includes('epeler')){
    const w = raw.replace(/^(épelle|epelle|épeler|epeler)\s+/i, '').trim();
    if (w){
      const spelled = w.split('').join(' ');
      respond(`🔤 <b>${esc(w)}</b> → ${esc(spelled)}`, 'ok');
      speak(spelled);
      return;
    }
  }

  // --- RECHERCHE WEB / OUVRIR UN SITE ---
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

  // --- SALUTATIONS / IDENTITÉ ---
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

  // --- MINUTEUR ---
  if (text.includes('minuteur') || text.includes('compte à rebours') || text.includes('compte a rebours')){
    let m = text.match(/(\d+)\s*(secondes?|minutes?|heures?|s|min|h)/);
    if (m){
      const n = parseInt(m[1], 10);
      const unit = m[2].replace(/s$/, '');
      const mult = { seconde:1000, minute:60000, heure:3600000, s:1000, min:60000, h:3600000 }[unit];
      startTimer(n * mult, `Minuteur de ${n} ${unit}${n>1?'s':''}`);
      return;
    }
    respond('⏱️ Dis par exemple : « minuteur de 5 minutes ».', 'err');
    return;
  }

  // --- ALARME / RÉVEIL ---
  if (text.includes('réveille-moi') || text.includes('reveille-moi') || text.includes('réveil') || text.includes('reveil') || text.includes('alarme')){
    const time = parseTime(text);
    if (time){
      const task = '⏰ Réveil';
      const r = { id: Date.now().toString(36), task, ts: time.ts, done:false, createdAt: Date.now() };
      reminders.push(r);
      save(LS.reminders, reminders);
      renderReminders();
      scheduleReminder(r);
      respond(`⏰ Alarme programmée : <b>${esc(task)}</b><br><span class="muted">${time.label}</span>`, 'ok');
      speak(`Alarme programmée ${time.label}.`);
      return;
    }
    respond('⏰ Dis par exemple : « réveille-moi à 7h » ou « alarme demain à 6h30 ».', 'err');
    return;
  }

  // --- NOTES ---
  if (text.includes('note que') || text.includes('prends une note') || text.includes('prend une note') || text.includes('note ') || text.includes('écris que') || text.includes('ecris que')){
    let content = raw.replace(/^(note|prends? une note|écris|ecris)\s+(que\s+)?/i, '').trim();
    if (content){
      const n = { id: Date.now().toString(36), content, createdAt: Date.now() };
      notes.push(n);
      save(LS.notes, notes);
      renderNotes();
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

  // --- RAPPEL ---
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
    const r = { id: Date.now().toString(36), task, ts, done:false, createdAt: Date.now() };
    reminders.push(r);
    save(LS.reminders, reminders);
    renderReminders();
    scheduleReminder(r);
    respond(`⏰ Rappel programmé : <b>${esc(task)}</b><br><span class="muted">${label}</span>`, 'ok');
    speak(`C'est noté. Je te rappellerai ${label} : ${task}.`);
    return;
  }

  // --- CALENDRIER ---
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
    const ev = { id: Date.now().toString(36), task, ts, createdAt: Date.now() };
    events.push(ev);
    save(LS.events, events);
    renderEvents();
    respond(`📅 Événement ajouté : <b>${esc(task)}</b><br><span class="muted">${label}</span>`, 'ok');
    speak(`Événement ajouté au calendrier : ${task}, ${label}.`);
    return;
  }

  // --- INCONNU ---
  respond(`🤖 Je n'ai pas compris « <b>${esc(raw)}</b> ». Dis « aide » pour voir ce que je sais faire.`, 'err');
  speak('Je n\'ai pas compris. Dis aide pour voir ce que je sais faire.');
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

/* ============ OUVRIR UN SITE ============ */
const SITES = {
  youtube:['youtube','yt'], google:['google'], gmail:['gmail','mail'], maps:['maps','plan','carte'],
  facebook:['facebook','fb'], instagram:['instagram','insta'], twitter:['twitter','x'],
  wikipedia:['wikipedia','wiki'], amazon:['amazon'], netflix:['netflix'], spotify:['spotify'],
  whatsapp:['whatsapp'], github:['github'], chatgpt:['chatgpt','openai'], claude:['claude','anthropic'],
  deepseek:['deepseek'], mistral:['mistral','le chat'], tiktok:['tiktok'], snapchat:['snapchat']
};
const SITE_URLS = {
  youtube:'https://youtube.com', google:'https://google.com', gmail:'https://mail.google.com',
  maps:'https://maps.google.com', facebook:'https://facebook.com', instagram:'https://instagram.com',
  twitter:'https://x.com', wikipedia:'https://fr.wikipedia.org', amazon:'https://amazon.fr',
  netflix:'https://netflix.com', spotify:'https://open.spotify.com', whatsapp:'https://web.whatsapp.com',
  github:'https://github.com', chatgpt:'https://chatgpt.com', claude:'https://claude.ai',
  deepseek:'https://chat.deepseek.com', mistral:'https://chat.mistral.ai', tiktok:'https://tiktok.com',
  snapchat:'https://snapchat.com'
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

/* ============ MÉTÉO (Open-Meteo, gratuit, sans clé) ============ */
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
function wmoLabel(code){
  return WMO[code] || 'conditions inconnues';
}
function getWeather(tomorrow){
  if (!navigator.geolocation){
    respond('❌ Géolocalisation non supportée pour la météo.', 'err');
    return;
  }
  respond('🌤️ Je cherche la météo…', 'info');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=2`)
        .then(r => r.json())
        .then(d => {
          if (tomorrow){
            const t = d.daily;
            const label = wmoLabel(t.weather_code[1]);
            respond(`🌤️ <b>Demain</b> : ${label}<br><span class="muted">Max ${Math.round(t.temperature_2m_max[1])}° · Min ${Math.round(t.temperature_2m_min[1])}°</span>`, 'ok');
            speak(`Demain, ${label}. Températures entre ${Math.round(t.temperature_2m_min[1])} et ${Math.round(t.temperature_2m_max[1])} degrés.`);
          } else {
            const c = d.current;
            respond(`🌤️ Actuellement : <b>${Math.round(c.temperature_2m)}°C</b>, ${wmoLabel(c.weather_code)}<br><span class="muted">Vent ${Math.round(c.wind_speed_10m)} km/h · Auj. max ${Math.round(d.daily.temperature_2m_max[0])}° / min ${Math.round(d.daily.temperature_2m_min[0])}°</span>`, 'ok');
            speak(`Actuellement ${Math.round(c.temperature_2m)} degrés, ${wmoLabel(c.weather_code)}. Vent à ${Math.round(c.wind_speed_10m)} kilomètres heure. Maximum aujourd'hui ${Math.round(d.daily.temperature_2m_max[0])} degrés.`);
          }
        })
        .catch(() => respond('❌ Impossible de récupérer la météo. Vérifie ta connexion.', 'err'));
    },
    () => respond('❌ Impossible d\'obtenir ta position pour la météo. Autorise la localisation.', 'err'),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
  );
}

/* ============ RAPPELS ============ */
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

/* ============ CALENDRIER ============ */
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

/* ============ NOTES ============ */
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

/* ============ MINUTEURS ============ */
function startTimer(ms, label){
  const id = Date.now().toString(36);
  const end = Date.now() + ms;
  timers.push({ id, end });
  respond(`⏱️ ${esc(label)} lancé !<br><span class="muted">Je te préviendrai à la fin.</span>`, 'ok');
  speak(`${label} lancé.`);
  setTimeout(() => {
    timers = timers.filter(t => t.id !== id);
    notify('⏱️ Minuteur terminé', label);
    speak(`${label} est terminé.`);
    toast('⏱️ ' + label + ' terminé !');
  }, ms);
}

/* ============ POSITION ============ */
function getLocation(){
  if (!navigator.geolocation){
    respond('❌ Géolocalisation non supportée sur ce navigateur.', 'err');
    return;
  }
  respond('📍 Je cherche ta position…', 'info');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      const prec = Math.round(pos.coords.accuracy);
      showMap(lat, lon, prec);
      respond(`📍 Position trouvée : <b>${lat.toFixed(5)}, ${lon.toFixed(5)}</b><br><span class="muted">Précision ±${prec} m</span>`, 'ok');
      speak(`Voici ta position. Précision d'environ ${prec} mètres.`);
    },
    err => {
      respond('❌ Impossible d\'obtenir ta position. Autorise l\'accès à la localisation dans les réglages.', 'err');
      speak('Je n\'arrive pas à obtenir ta position. Vérifie les permissions de localisation.');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

function showMap(lat, lon, prec){
  const bbox = `${lon-0.004},${lat-0.003},${lon+0.004},${lat+0.003}`;
  $('mapFrame').innerHTML = `<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}" loading="lazy"></iframe>`;
  $('mapCoords').textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)} · ±${prec} m`;
  $('openMaps').href = `https://www.google.com/maps?q=${lat},${lon}`;
  $('shareLoc').onclick = () => {
    const data = { title:'Ma position', text:`Ma position : ${lat.toFixed(6)}, ${lon.toFixed(6)}`, url:`https://www.google.com/maps?q=${lat},${lon}` };
    if (navigator.share){ navigator.share(data).catch(()=>{}); }
    else { navigator.clipboard?.writeText(data.url).then(()=>toast('Lien copié !')).catch(()=>{}); }
  };
  $('mapModal').classList.remove('hidden');
}
function closeMap(){ $('mapModal').classList.add('hidden'); }

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
    $('heard').textContent = '🗣️ « ' + b.dataset.cmd + ' »';
    $('heard').hidden = false;
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
$('settingsBtn').addEventListener('click', () => {
  loadVoices();
  $('settingsModal').classList.remove('hidden');
});
$('testVoice').addEventListener('click', () => {
  speak('Bonjour ! Voici ma voix. Est-ce que ça te plaît ?');
});
$('closeSettings').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
$('settingsBg').addEventListener('click', () => $('settingsModal').classList.add('hidden'));

if (localStorage.getItem(LS.theme) === 'light') document.body.classList.add('light');

/* ============ INIT ============ */
renderReminders();
renderEvents();
renderNotes();

// Re-planifier les rappels non déclenchés (après rechargement)
reminders.filter(r => !r.done && r.ts > Date.now()).forEach(scheduleReminder);

// Service worker (PWA)
if ('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}