/* ============================================================
   features/email/manage.js — FEATURE EMAIL v1
   ------------------------------------------------------------
   FONCTIONS REQUISES PAR LE PROMPT :
     a) listUnread()  — 10 derniers non lus (Gmail OU Outlook)
     b) summarize()   — resume IA des mails (brain via allowlist)
     c) createDraft() — cree un brouillon, retourne draftId,
                        NE L'ENVOIE JAMAIS (interdit gmail.send /
                        /me/sendMail : aucun appel n'est code)
     d) sort()        — propoSE un tri (Important/Factures/Spam)
   ------------------------------------------------------------
   Regle 1 : ce fichier ne touche QUE le compte mail de
   l'utilisateur connecte via la page /features/email/.
   Regle 3 : lecture + brouillons uniquement. Aucun envoi.
   ============================================================ */
(function(){
'use strict';
const G_MAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const G_OUT  = 'https://graph.microsoft.com/v1.0/me';

/* fetch securise : allowlist + Bearer automatique + timeout 15 s */
async function efetch(url, provider, opts){
  opts = opts || {};
  if (!window.EmailAllow.allowed(url)) throw new Error('Domaine refuse par allowlist : ' + url);
  const tok = window.EmailAuth.get(provider);
  if (!tok) throw new Error('Non connecte : ' + provider);
  const abort = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: Object.assign({ 'Authorization': 'Bearer ' + tok }, opts.body ? { 'Content-Type': 'application/json' } : {}),
    body: opts.body,
    signal: abort
  });
  if (!res.ok) throw new Error('API ' + provider + ' HTTP ' + res.status + ' : ' + (await res.text().catch(() => '')).slice(0, 140));
  return res.json();
}

/* ---------- a) listUnread() — 10 derniers non lus ---------- */
async function listUnread(n){
  n = Math.min(n || 10, 25);
  const mails = [];
  if (window.EmailAuth.connected('google')){
    try {
      const j = await efetch(G_MAIL + '/messages?maxResults=' + n + '&labelIds=UNREAD', 'google');
      const ids = (j.messages || []).slice(0, n);
      for (const m of ids){
        try {
          const full = await efetch(G_MAIL + '/messages/' + m.id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From', 'google');
          const h = {};
          (full.payload && full.payload.headers || []).forEach(x => { h[x.name.toLowerCase()] = x.value; });
          mails.push({ provider: 'gmail', id: m.id, from: (h.from || '').trim(), subject: (h.subject || '(sans objet)').trim(), snippet: (full.snippet || '').slice(0, 220) });
        } catch(e){}
      }
    } catch(e){ console.warn('[EMAIL] Gmail listUnread:', e && e.message); }
  }
  if (window.EmailAuth.connected('outlook')){
    try {
      const j = await efetch(G_OUT + '/messages?$top=' + n + '&$filter=isRead%20eq%20false&$select=id,subject,from,bodyPreview,receivedDateTime&$orderby=receivedDateTime%20desc', 'outlook');
      (j.value || []).forEach(x => mails.push({ provider: 'outlook', id: x.id, from: (x.from && x.from.emailAddress && x.from.emailAddress.address) || '', subject: x.subject || '(sans objet)', snippet: (x.bodyPreview || '').slice(0, 220) }));
    } catch(e){ console.warn('[EMAIL] Outlook listUnread:', e && e.message); }
  }
  window.EmailLog.add('liste-non-lus', mails.length, 0);
  return mails;
}

/* ---------- b) summarize() — resume IA des mails ---------- */
async function summarize(mails){
  const items = Array.isArray(mails) && mails.length ? mails : await listUnread();
  if (!items.length) return "Ta boîte est à jour : Aucun mail non lu trouvé.";
  const listing = items.map((m, i) => (i + 1) + '. [" + m.from + "] ' + m.subject + ' — ' + m.snippet).join('\n');
  const prompt = 'Voici une liste de mails recus d un utilisateur.' +
    ' Redige un resume en 3 a 5 puces courtes en francais : possibilites les plus importantes, celles qui semblent urgentes, propose une action de tri.' +
    ' Pas de formules de politesse du mail, pas de phrase d introduction. Liste des mails :\n' + listing;
  /* lecture email -> IA : cerveau autorise sur allowlist (Mistral ou Pollinations) */
  try {
    const mk = (localStorage.getItem('va_mistral_key') || '').trim();
    if (mk){
      const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + mk },
        body: JSON.stringify({ model: 'mistral-small-latest', messages: [{ role: 'user', content: prompt }], max_tokens: 300 })
      });
      if (r.ok){
        const j = await r.json();
        const t = (j?.choices?.[0]?.message?.content || '').trim();
        if (t){ window.EmailLog.add('resume-ia', items.length, 0); return t; }
      }
    }
    const r2 = await fetch('https://text.pollinations.ai/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai', messages: [{ role: 'user', content: prompt }], max_tokens: 300 })
    });
    if (r2.ok){
      const j2 = await r2.json();
      const t2 = (j2?.choices?.[0]?.message?.content || '').trim();
      if (t2){ window.EmailLog.add('resume-ia', items.length, 0); return t2; }
    }
  } catch(e){ console.warn('[EMAIL] summarize:', e && e.message); }
  /* pas d'IA disponible : extrait brut tri ? non — liste simple + note */
  window.EmailLog.add('resume-ia-echec', items.length, 0);
  return 'Voici tes ' + Math.min(items.length, 10) + ' mails non lus (resume IA indisponible) :\n' + listing;
}

/* ---------- c) createDraft() — brouillon, JAMAIS d envoi ---------- */
function b64url(str){
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//
, '_').replace(/=+$/, '');
}
async function createDraft(to, subject, body, providerHint){
  let provider = providerHint || (EmailAuth.connected('google') ? 'google' : 'outlook');
  let draftId = '';
  if (provider === 'google'){
    const raw = b64url(
      'To: ' + to + '\r\n' +
      'Subject: ' + (subject || '(sans objet)') + '\r\n' +
      'Content-Type: text/plain; charset=UTF-8\r\n\r\n' + body);
    const j = await efetch(G_MAIL + '/drafts', 'google', { method: 'POST', body: JSON.stringify({ message: { raw: raw } }) });
    draftId = j.id || (j.message && j.message.id) || '';
  } else {
    const j = await efetch(G_OUT + '/messages', 'outlook', { method: 'POST', body: JSON.stringify({
      subject: subject || '(sans objet)',
      body: { contentType: 'Text', content: body },
      toRecipients: [{ emailAddress: { address: to } }]
    }) });
    draftId = j.id || '';
  }
  window.EmailLog.add('brouillon-cree', 0, 1);
  return { draftId, provider, sent: false };
}

/* ---------- d) sort() — tri propose (Important/Factures/Spam) ---------- */
function classify(m){
  const s = ((m.subject || '') + ' ' + (m.from || '')).toLowerCase();
  if (/no-?reply|newsletter|promo|offre mascara|soldes|deal|casino|lotto|congrats tu as gagne|pharm|prize|winner/i.test(s)) return 'spam';
  if (/facture|invoice|paiement|payment|receipt|montant|echeance|eb\b|prleve|redevis|frais/i.test(s)) return 'factures';
  return 'important';
}
function sort(mails){
  const items = Array.isArray(mails) && mails.length ? mails : null;
  return items ? group(items) : listUnread(25).then(group);
}
function group(items){
  const out = { important: [], factures: [], spam: [] };
  items.forEach(m => out[classify(m)].push(m));
  window.EmailLog.add('tri-proposé', items.length, 0);
  return out;
}

window.EmailManage = { listUnread, summarize, createDraft, sort };
})();
