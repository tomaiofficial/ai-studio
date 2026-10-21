/* ============================================================
   RECHERCHE WEB PARTAGEE (v10.11)
   ------------------------------------------------------------
   Un seul point d'entree pour tout le monde : le moteur de debat
   ET les agents autonomes l'utilisent.

   POURQUOI ce fichier existe :
   api.duckduckgo.com peut etre bloque CORS depuis un navigateur
   ( bloqueur de pub, VPN, DNS, reseau d'entreprise ) -> plus aucune
   recherche. On ne depend donc JAMAIS d'un seul site.

   On essaie plusieurs sources, dans l'ordre, et on s'arrete a la
   premiere qui repond :
     1. Wikipedia FR   (api CORS garantie, tres fiable, vrai contenu)
     2. Wikipedia EN
     3. DuckDuckGo API (si le reseau ne la bloque pas)
     4. Passerelles CORS pour une vraie recherche web

   Si TOUT echoue, on ne casse rien : la recherche est simplement
   marquee "hors direct" et l'agent utilise ses connaissances.
   ============================================================ */
(function(){
'use strict';

const WIKI = 'https://fr.wikipedia.org/w/api.php';
const WIKI_EN = 'https://en.wikipedia.org/w/api.php';
const DDG = 'https://api.duckduckgo.com/';

/* ---------- cache + anti rate-limit (429) ---------- */
const CACHE = new Map();          /* requete -> { t, res } */
const CACHE_MS = 5 * 60 * 1000;   /* 5 min : evite de re-requeter la meme chose */
const COOLDOWN = new Map();       /* source -> timestamp jusqu'a laquelle on l'evite */
const COOLDOWN_MS = 10 * 60 * 1000;

function cached(key){
  const c = CACHE.get(key);
  if (c && (Date.now() - c.t) < CACHE_MS) return c.res;
  return null;
}
function putCache(key, res){
  CACHE.set(key, { t: Date.now(), res });
  /* on borne la taille du cache pour ne pas grossir indefiniment */
  if (CACHE.size > 60){
    const first = CACHE.keys().next().value;
    CACHE.delete(first);
  }
}
function cooling(key){
  const until = COOLDOWN.get(key);
  return !!until && Date.now() < until;
}
function coolDown(key){
  COOLDOWN.set(key, Date.now() + COOLDOWN_MS);
  console.warn('[WEBSEARCH] ' + key + ' limite (429) -> pause ' + Math.round(COOLDOWN_MS / 60000) + ' min');
}

function to(ms){
  try { if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms); } catch(e){}
  const c = new AbortController();
  setTimeout(() => { try { c.abort(); } catch(e){} }, ms);
  return c.signal;
}
/* Retourne { data, status }. status 429 -> on met la source en pause. */
async function getJSON(url, ms, key){
  try {
    const res = await fetch(url, { signal: to(ms || 9000) });
    if (res && res.status === 429 && key) coolDown(key);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch(e){ return null; }
}
function clean(t){
  return String(t == null ? '' : t)
    .replace(/\s+/g, ' ')
    .replace(/\[\d+\]/g, '')
    .trim();
}

/* ---------- 1 & 2 : WIKIPEDIA (recherche + extrait) ---------- */
async function wikipedia(query, api, lang, key){
  if (cooling(key)) return null;
  const s = await getJSON(api + '?action=query&list=search&srsearch=' + encodeURIComponent(query) +
    '&format=json&origin=*&srlimit=3', 9000, key);
  if (!s || !s.query || !Array.isArray(s.query.search) || !s.query.search.length) return null;

  const titles = s.query.search.map(x => x.title).filter(Boolean).slice(0, 2);
  if (!titles.length) return null;

  const e = await getJSON(api + '?action=query&prop=extracts&exintro&explaintext&redirects=1&format=json&origin=*&titles=' +
    encodeURIComponent(titles.join('|')), 9000, key);
  /* "pages" peut etre un objet { "-1": {...} } ou un tableau selon la
     version de l'API : on lit les deux formes avec Object.keys, sans
     dependre d'une propriete specifique a un moteur JS. */
  let pages = [];
  const raw = e && e.query ? e.query.pages : null;
  if (Array.isArray(raw)) pages = raw;
  else if (raw && typeof raw === 'object'){
    for (const k of Object.keys(raw)){
      if (raw[k] && typeof raw[k] === 'object') pages.push(raw[k]);
    }
  }
  const out = [];
  for (const p of pages){
    const ex = clean(p.extract);
    if (ex && ex.length > 40){
      out.push((p.title || 'Wikipédia') + ' : ' + ex.slice(0, 420));
    } else {
      const sn = clean(p.snippet);
      if (sn && sn.length > 30) out.push((p.title || 'Wikipédia') + ' : ' + sn);
    }
  }
  if (!out.length) return null;
  return { text: out.join(' || '), source: 'wikipedia-' + lang, live: true };
}

/* ---------- 3 : DUCKDUCKGO API ---------- */
async function duckduckgo(query){
  const key = 'duckduckgo';
  if (cooling(key)) return null;
  const urls = [
    DDG + '?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1',
    DDG + '?q=' + encodeURIComponent(query) + '&format=json&no_html=1'
  ];
  for (const u of urls){
    const data = await getJSON(u, 9000, key);
    if (!data) continue;
    const out = [];
    if (data.AbstractText) out.push(clean(data.AbstractText));
    if (data.Definition) out.push(clean(data.Definition));
    const walk = (arr, d) => {
      if (!Array.isArray(arr) || d > 2) return;
      for (const it of arr){
        if (!it) continue;
        if (typeof it.Text === 'string' && clean(it.Text).length > 20) out.push(clean(it.Text));
        if (Array.isArray(it.Topics)) walk(it.Topics, d + 1);
        if (out.length > 7) return;
      }
    };
    walk(data.RelatedTopics, 0);
    if (Array.isArray(data.Results)){
      for (const r of data.Results){
        if (r && typeof r.Text === 'string' && clean(r.Text).length > 20) out.push(clean(r.Text));
        if (out.length > 8) break;
      }
    }
    const uniq = [];
    for (const t of out){
      if (t.length > 20 && uniq.indexOf(t) === -1) uniq.push(t);
      if (uniq.length >= 6) break;
    }
    if (uniq.length) return { text: uniq.join(' - '), source: 'duckduckgo', live: true };
  }
  return null;
}

/* ---------- 4 : PASSERELLES CORS (vraie recherche web) ---------- */
const PROXIES = [
  q => 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q)),
  q => 'https://corsproxy.io/?url=' + encodeURIComponent('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q))
];
function parseDDGHtml(html){
  const out = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 5){
    const t = clean(m[1].replace(/<[^>]+>/g, ''));
    if (t.length > 12) out.push(t);
  }
  return out;
}
async function viaProxy(query){
  for (const make of PROXIES){
    try {
      const res = await fetch(make(query), { signal: to(11000) });
      if (!res || !res.ok) continue;
      const html = await res.text();
      const titles = parseDDGHtml(html);
      if (titles.length) return { text: titles.join(' - '), source: 'web (passerelle)', live: true };
    } catch(e){}
  }
  return null;
}

/* ---------- LECTURE D'UNE PAGE WEB (v10.87) ----------
   OUTIL "agir comme Claude" : Astra peut ouvrir N'IMPORTE QUELLE page
   (un article, un profil, une doc, un site...) et en lire le texte.
   Plusieurs passerelles, la premiere qui marche gagne :
     1. r.jina.ai/URL       -> markdown propre, CORS ouvert
     2. allorigins/raw      -> HTML brut qu'on nettoie
     3. corsproxy.io        -> HTML brut qu'on nettoie
   Lecture seule : on ne POST jamais, on ne se "connecte" nulle part. */
function stripHtml(h){
  return String(h || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
async function readUrlPage(url){
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, text: '', reason: "URL invalide (http/https requis)" };
  const norm = u.replace(/^https?:\/\//i, '');
  /* 1) r.jina.ai — le plus propre et fiable pour la lecture */
  try {
    const r = await fetch('https://r.jina.ai/https://' + norm, { signal: to(15000) });
    if (r.ok){
      const t = (await r.text()).trim();
      if (t && t.length > 40) return { ok: true, text: t.slice(0, 6000), source: 'r.jina.ai ' + norm };
    }
  } catch(e){}
  /* 2) allorigins raw */
  try {
    const r = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(u), { signal: to(15000) });
    if (r.ok){
      const t = stripHtml(await r.text());
      if (t && t.length > 40) return { ok: true, text: t.slice(0, 6000), source: 'allorigins ' + norm };
    }
  } catch(e){}
  /* 3) corsproxy */
  try {
    const r = await fetch('https://corsproxy.io/?url=' + encodeURIComponent(u), { signal: to(15000) });
    if (r.ok){
      const t = stripHtml(await r.text());
      if (t && t.length > 40) return { ok: true, text: t.slice(0, 6000), source: 'corsproxy ' + norm };
    }
  } catch(e){}
  return { ok: false, text: '', reason: 'page inaccessible depuis ce reseau' };
}

/* ---------- API publique ---------- */
/* Renvoie ALWAYS un objet, jamais une exception :
     { ok, text, source, live }  live=false = pas de web, l'IAreflectit seule */
async function search(query, kind){
  const q = (query || '').trim();
  if (!q) return { ok: false, text: '', source: '', live: false, reason: 'requete vide' };

  const key = 'q:' + q.toLowerCase();
  const hit = cached(key);
  if (hit) return hit;

  /* Pour une recherche d'entites (un nom d'entreprise, un modele...), la
     syntaxe "wikipedia:" force les encyclopédies : resultats bien plus
     propres que la recherche web brute. */
  const wikiFirst = kind === 'wiki' || /^wikipedia:/i.test(q);
  const plain = q.replace(/^wikipedia:\s*/i, '');
  let res = null;

  if (wikiFirst){
    res = (await wikipedia(plain, WIKI, 'fr', 'wiki-fr')) || (await wikipedia(plain, WIKI_EN, 'en', 'wiki-en'));
  }
  if (!res){
    /* recherche generale : on tente le web d'abord (plus riche),
       les encyclopédies servent de filet de securite. */
    res = (await duckduckgo(plain)) || (await viaProxy(plain));
  }
  if (!res){
    res = (await wikipedia(plain, WIKI, 'fr', 'wiki-fr')) || (await wikipedia(plain, WIKI_EN, 'en', 'wiki-en'));
  }

  const out = res
    ? { ok: true, text: res.text, source: res.source, live: true }
    : { ok: false, text: '', source: '', live: false, reason: 'aucune source accessible depuis ce reseau' };
  putCache(key, out);
  return out;
}

/* Test rapide : quelle source fonctionne la ? (affiche dans le panneau) */
async function probe(){
  const res = await search('intelligence artificielle');
  return { live: !!res.live, source: res.source || 'aucune', reason: res.reason || '' };
}

window.WebSearch = { search, probe, read: readUrlPage };
})();
