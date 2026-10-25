/* ============================================================
   SALLE DE DEBAT IA (v10.8) — interface du moteur partage
   Affiche le debat en direct (meme s'il tourne en arriere-plan
   dans l'app principale). Si le moteur est mort (app fermee),
   cette page reprend la main automatiquement.
   ============================================================ */
'use strict';

const E = window.DebateEngine;
const $ = id => document.getElementById(id);

/* ===== RENDU ===== */
function buildCards(){
  const stage = $('stage');
  if (!stage) return;
  stage.innerHTML = '';
  E.PERSONAS.forEach(p => {
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
function setVoiceLabel(id, label){
  const v = $('voice-' + id);
  if (v) v.textContent = label;
}
function setCount(id, n){
  const c = $('count-' + id);
  if (c) c.textContent = n + (n > 1 ? ' interventions' : ' intervention');
}
function escapeHtml(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderTranscript(){
  const t = $('transcript');
  if (!t) return;
  const s = E.state;
  let html = '';
  if (s.memory){
    html += '<div class="t-line"><span class="t-name" style="color:#ffd27c">🧠 Mémoire</span><span class="t-mem">' + escapeHtml(s.memory) + '</span></div>';
  }
  s.history.forEach(h => {
    const m = h.content.match(/^([^:]+) : ([\s\S]*)$/);
    if (m){
      const persona = E.PERSONAS.find(p => p.name === m[1].trim());
      const color = persona ? persona.color : '#8a8aa5';
      const emoji = persona ? persona.emoji : '💬';
      html += '<div class="t-line"><span class="t-name" style="color:' + color + '">' + emoji + ' ' + m[1].trim() + '</span><span class="t-text">' + escapeHtml(m[2]) + '</span></div>';
    } else {
      html += '<div class="t-line"><span class="t-text">' + escapeHtml(h.content) + '</span></div>';
    }
  });
  t.innerHTML = html;
  t.scrollTop = t.scrollHeight;
}
function render(){
  const s = E.state;
  E.PERSONAS.forEach(p => {
    const last = s.lastByPersona[p.id];
    const count = s.counts[p.id] || 0;
    setCount(p.id, count);
    if (last){
      setCard(p.id, s.running ? 'intervention terminée' : 'arrêté', last, false);
    } else {
      setCard(p.id, s.running ? 'en attente...' : 'en attente', '', false);
    }
    if (p.voice) setVoiceLabel(p.id, 'Voix : ' + (p.voiceName || 'Mistral'));
  });
  renderTranscript();
  const running = E.isRunning();
  $('startBtn').disabled = running;
  $('stopBtn').disabled = !running;
  $('muteBtn').textContent = s.muted ? '🔇 Son coupé' : '🔊 Son actif';
  $('muteBtn').classList.toggle('stop', !!s.muted);
  $('statusBar').textContent = running
    ? '🟢 Débat en cours (tourne même si tu quittes cette page)'
    : '⚪ Débat arrêté — clique sur ▶ Lancer';
  const tb = $('topicBar');
  if (tb) tb.textContent = s.topic ? '🎯 Thème : ' + s.topic : '';
}

/* ===== WIRING MOTEUR ===== */
E.hooks.onCard = setCard;
E.hooks.onLine = () => {}; /* le journal est reconstruit depuis l'etat */
E.hooks.getSpeed = () => parseInt($('speedSel').value || '800', 10);

/* ===== BOUTONS ===== */
$('startBtn').addEventListener('click', () => {
  const key = (localStorage.getItem('va_mistral_key') || '').trim();
  if (!key){
    $('notice').style.display = 'block';
    $('notice').textContent = '⚠️ Pas de clé Mistral : le débat tournera en TEXTE seul (pas de voix). Ajoute ta clé dans l\'app principale (Réglages) pour les voix Voxtral.';
  } else {
    $('notice').style.display = 'none';
  }
  E.start();
  render();
});
$('stopBtn').addEventListener('click', () => {
  E.stop();
  render();
});
$('muteBtn').addEventListener('click', () => {
  E.setMuted(!E.state.muted);
  render();
});

/* ===== MISE A JOUR EN DIRECT ===== */
let lastHeartbeat = E.state.heartbeat;
/* BroadcastChannel : mise a jour instantanee quand le moteur tourne ailleurs */
try {
  const bc = new BroadcastChannel('debat-channel');
  bc.onmessage = (ev) => {
    if (ev && ev.data && ev.data.type === 'state') render();
  };
} catch(e){}
/* Secours : poll localStorage toutes les secondes */
setInterval(() => {
  const fresh = E.reload();
  if (fresh.heartbeat !== lastHeartbeat){
    lastHeartbeat = fresh.heartbeat;
    render();
  }
}, 1000);

/* ===== DEMARRAGE ===== */
buildCards();
render();
/* v10.9 : le debat doit tourner H24 sans bouton — il demarre tout seul */
E.start();
/* si un debat tournait et que son runner est mort, on reprend la main */
E.autoResume();
setTimeout(render, 1500);