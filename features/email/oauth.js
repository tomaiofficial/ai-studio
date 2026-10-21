/* ============================================================
   features/email/oauth.js — FEATURE EMAIL v1
   ------------------------------------------------------------
   Regle 2 (FETCh ALLOWLIST) : toute URL sortante est verifiee
   contre la liste. Un domaine hors liste = throw, JAMAIS de fetch.
   Regle 4 (STOCKAGE) : tokens jamais en clair — chiffrement local
   XOR + base64 (v1). migration vers KV EMAIL_TOKENS quand un
   backend Workers sera branche (le site est statique aujourd'hui).
   Regle 5 (LOGS) : chaque action loggee via window.EmailLog.
   ============================================================ */
(function(){
'use strict';
const K = 'features_email_v1';

/* ---------- FETCH ALLOWLIST ---------- */
const ALLOW_HOSTS = [
  'gmail.googleapis.com', 'oauth2.googleapis.com', 'accounts.google.com',
  'graph.microsoft.com', 'login.microsoftonline.com',
  'api.pollinations.ai', 'text.pollinations.ai', 'api.mistral.ai',
  'cdn.jsdelivr.net' /* MSAL via CDN seulement */
];
window.EmailAllow = {
  allowed(u){
    try {
      const h = new URL(u, location.href).hostname;
      return ALLOW_HOSTS.some(d => h === d || h.endsWith('.' + d));
    } catch(e){ return false; }
  },
  hosts: ALLOW_HOSTS.slice()
};
function assertAllowed(url){
  if (!window.EmailAllow.allowed(url)) throw new Error('Domaine refuse par allowlist : ' + url);
}

/* ---------- STOCKAGE CHIFFRE (tokens obfusques, 1 h max) ---------- */
function ob(s){
  let r = '';
  for (let i = 0; i < s.length; i++) r += String.fromCharCode(s.charCodeAt(i) ^ 'AstraV1'.charCodeAt(i % 7));
  return btoa(unescape(encodeURIComponent(r)));
}
function un(s){
  try {
    const d = decodeURIComponent(escape(atob(s)));
    let r = '';
    for (let i = 0; i < d.length; i++) r += String.fromCharCode(d.charCodeAt(i) ^ 'AstraV1'.charCodeAt(i % 7));
    return r;
  } catch(e){ return ''; }
}
window.EmailAuth = {
  save(provider, token, expiresAt){
    /* duree de vie forcee a 1 h max : un token long reste revocable */
    const exp = Math.min(expiresAt || (Date.now() + 3600e3), Date.now() + 3600e3);
    localStorage.setItem(K + '.tok.' + provider, ob(JSON.stringify({ t: token, e: exp })));
  },
  get(provider){
    try {
      const d = JSON.parse(un(localStorage.getItem(K + '.tok.' + provider) || ''));
      return d && d.t && d.e > Date.now() ? d.t : null;
    } catch(e){ return null; }
  },
  clear(provider){ localStorage.removeItem(K + '.tok.' + provider); },
  connected(provider){ return !!this.get(provider); },
  clientId(provider){ return (localStorage.getItem(K + '.cid.' + provider) || '').trim(); },
  setClientId(provider, id){ localStorage.setItem(K + '.cid.' + provider, (id || '').trim()); }
};

/* ---------- LOGS (regle 5) ---------- */
window.EmailLog = {
  key: K + '.logs',
  list(){ try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch(e){ return []; } },
  add(action, mailsLus, brouillonsCrees){
    const l = this.list();
    l.push({ date: new Date().toISOString(), action, mailsLus: mailsLus || 0, brouillonsCrees: brouillonsCrees || 0 });
    while (l.length > 200) l.shift();
    localStorage.setItem(this.key, JSON.stringify(l));
    try { document.dispatchEvent(new CustomEvent('email-log')); } catch(e){}
  },
  export(){
    const blob = new Blob([JSON.stringify(this.list(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'logs.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
};

/* ---------- GMAIL (Google Identity Services, token client) ---------- */
function loadScript(src){
  if (!window.EmailAllow.allowed(src)) throw new Error('Script refuse par allowlist : ' + src);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res;
    s.onerror = () => rej(new Error('impossible de charger : ' + src));
    document.head.appendChild(s);
  });
}
async function ensureGIS(){
  if (window.google && google.accounts && google.accounts.oauth2) return;
  await loadScript('https://accounts.google.com/gsi/client');
}
async function connectGmail(){
  const cid = EmailAuth.clientId('google');
  if (!cid) throw new Error("Enregistre d'abord ton ID client Gmail en haut de la page");
  await ensureGIS();
  return new Promise((res, rej) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose',
      callback(t){
        if (t && t.access_token){
          EmailAuth.save('google', t.access_token, Date.now() + (t.expires_in || 3600) * 1000);
          EmailLog.add('connexion-gmail', 0, 0);
          res(t);
        } else rej(new Error('connexion Gmail annulee'));
      },
      error_callback(e){ rej(new Error(e && e.type ? e.type : 'erreur Google')); }
    });
    tc.requestAccessToken();
  });
}

/* ---------- OUTLOOK (MSAL v2 : Mail.Read + Mail.ReadWrite) ---------- */
async function ensureMSAL(){
  if (window.msalBrowser) return;
  await loadScript('https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.28.1/lib/msal-browser.min.js');
}
async function connectOutlook(){
  const cid = EmailAuth.clientId('outlook');
  if (!cid) throw new Error("Enregistre d'abord ton ID client Outlook en haut de la page");
  await ensureMSAL();
  const app = new msalBrowser.PublicClientApplication({
    auth: { clientId: cid, authority: 'https://login.microsoftonline.com/common' }
  });
  await app.initialize();
  const resp = await app.loginPopup({ scopes: ['Mail.Read', 'Mail.ReadWrite'] });
  const scopes = ['Mail.Read', 'Mail.ReadWrite'];
  let t;
  try { t = await app.acquireTokenSilent({ scopes, account: resp.account }); }
  catch(e){ t = await app.acquireTokenPopup({ scopes, account: resp.account }); }
  EmailAuth.save('outlook', t.accessToken, t.expiresOn ? new Date(t.expiresOn).getTime() : Date.now() + 3600e3);
  EmailLog.add('connexion-outlook', 0, 0);
  try { window.__emailMsal = app; } catch(e){}
  return t;
}

/* ---------- DECONNEXION ---------- */
async function logout(provider){
  if (provider === 'google'){
    const t = EmailAuth.get('google');
    if (t){
      assertAllowed('https://oauth2.googleapis.com/revoke');
      try { await fetch('https://oauth2.googleapis.com/revoke?token=' + t, { method: 'POST' }); } catch(e){}
    }
  } else if (provider === 'outlook'){
    try { if (window.__emailMsal) await window.__emailMsal.logoutPopup(); } catch(e){}
  }
  EmailAuth.clear(provider);
  EmailLog.add('deconnexion-' + provider, 0, 0);
}

window.EmailOAuth = { connectGmail, connectOutlook, logout };
})();
