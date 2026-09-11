/* IA DÉRAPE — app.js */
let NEWS = [];
let CURRENT = 'all';

const CATS = {
  derape:     '🔥 Dérapage',
  claude:     'Claude',
  chatgpt:    'ChatGPT',
  securite:   'Sécurité',
  regulation: 'Régulation'
};

const $  = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));

function toast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._tt);
  window._tt = setTimeout(() => t.classList.remove('show'), 2300);
}

function frDate(iso){
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' });
}

/* ---------- RENDU ---------- */
function cardHTML(n){
  return `<article class="card" onclick="openArticle('${n.id}')">
    <div class="card-top">
      <span class="tag ${n.cat}">${esc(CATS[n.cat] || n.cat)}</span>
      ${n.hot ? '<span class="hot">🔥 Chaud</span>' : ''}
    </div>
    <h3>${esc(n.title)}</h3>
    <p>${esc(n.excerpt)}</p>
    <div class="card-foot">
      <span>${esc(n.source)}</span>
      <span>${frDate(n.date)}</span>
    </div>
  </article>`;
}

function renderFeed(){
  const q = ($('search').value || '').trim().toLowerCase();
  let list = NEWS.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (CURRENT !== 'all') list = list.filter(n => n.cat === CURRENT);
  if (q) list = list.filter(n =>
    (n.title + ' ' + n.excerpt + ' ' + n.body + ' ' + n.source).toLowerCase().includes(q)
  );

  const box = $('feed');
  box.innerHTML = list.length
    ? list.map(cardHTML).join('')
    : `<div class="empty"><div class="big">🔍</div>
       <h3>Aucune actu trouvée</h3>
       <p class="muted">Essaie un autre mot-clé ou change de rubrique.</p></div>`;

  $('resultCount').textContent = list.length + ' actu' + (list.length > 1 ? 's' : '');
  $('feedEyebrow').textContent = CURRENT === 'all' ? 'TOUT' : (CATS[CURRENT] || '').replace(/^\S+\s/, '');
  $('feedTitle').textContent = CURRENT === 'all'
    ? "Le fil de l'actu IA"
    : (CATS[CURRENT] || '');
}

function renderHot(){
  const hot = NEWS.filter(n => n.hot)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 4);
  $('hotGrid').innerHTML = hot.map((n, i) => `
    <div class="hot-card" onclick="openArticle('${n.id}')">
      <div class="num">#${i + 1} · ${esc(CATS[n.cat])}</div>
      <h4>${esc(n.title)}</h4>
      <small>${esc(n.source)} · ${frDate(n.date)}</small>
    </div>`).join('');
}

function renderTicker(){
  const items = NEWS.slice(0, 8)
    .map(n => `<span><b>${esc(CATS[n.cat])}</b> · ${esc(n.title)}</span>`)
    .join('');
  $('ticker').innerHTML = items + items;
}

function renderAll(){
  $('heroCount').textContent = NEWS.length;
  renderFeed();
  renderHot();
  renderTicker();
}

/* ---------- ARTICLE ---------- */
function openArticle(id){
  const n = NEWS.find(x => x.id === id);
  if (!n) return;
  $('mCat').textContent = CATS[n.cat] || n.cat;
  $('mTitle').textContent = n.title;
  $('mMeta').innerHTML = `<span>📰 ${esc(n.source)}</span><span>📅 ${frDate(n.date)}</span>`;
  $('mBody').innerHTML = String(n.body || '').split('\n\n').map(p => `<p>${esc(p)}</p>`).join('');
  $('mSource').href = n.url;
  $('modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(){
  $('modal').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ---------- NAV ---------- */
function go(cat){
  CURRENT = cat;
  document.querySelectorAll('.mainnav .nav').forEach(b =>
    b.classList.toggle('active', b.dataset.cat === cat));
  renderFeed();
  const target = (cat === 'derape') ? 'derapeSection' : 'feed';
  $(target).scrollIntoView({ behavior:'smooth', block:'start' });
}

function scrollToFeed(){
  $('feed').scrollIntoView({ behavior:'smooth', block:'start' });
}

/* ---------- INIT ---------- */
document.querySelectorAll('.mainnav .nav').forEach(b => {
  b.onclick = () => go(b.dataset.cat);
});

$('search').addEventListener('input', () => {
  clearTimeout(window._st);
  window._st = setTimeout(renderFeed, 180);
});

$('theme').onclick = () => {
  document.body.classList.toggle('light');
  localStorage.setItem('iaderape_theme', document.body.classList.contains('light') ? 'light' : 'dark');
};

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

if (localStorage.getItem('iaderape_theme') === 'light') {
  document.body.classList.add('light');
}

fetch('news.json')
  .then(r => r.json())
  .then(data => { NEWS = data; renderAll(); })
  .catch(() => {
    $('feed').innerHTML = `<div class="empty"><div class="big">⚠️</div>
      <h3>Impossible de charger les actus</h3>
      <p class="muted">Vérifie que news.json est bien accessible.</p></div>`;
  });
