/* ============================================================
 *  IA DÉRAPE — Newsletter
 * ============================================================
 *  Stockage    : Supabase (table "newsletter")
 *  Notification: Web3Forms (alerte mail quand un abonné arrive)
 *
 *  ⚠️ Ne modifie PAS ce fichier.
 *     Toute la configuration est dans config.js
 * ============================================================ */

(function () {
  const CFG = window.IADERAPE_CONFIG || {};
  const SB  = CFG.supabase || {};
  const ALERT_KEY = CFG.alertKey || '';
  const REFRESH   = (CFG.autoRefreshSeconds || 30) * 1000;

  const $ = id => document.getElementById(id);
  const note = () => $('nlNote');
  const btn  = () => $('nlBtn');
  const cnt  = () => $('nlCount');

  const client = (window.supabase && SB.url)
    ? window.supabase.createClient(SB.url, SB.anonKey)
    : null;

  function setNote(msg, type) {
    const n = note();
    if (!n) return;
    n.textContent = msg;
    n.className = 'nl-note' + (type ? ' ' + type : '');
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* ---------- Compteur temps réel ---------- */
  let lastCount = null;

  async function countSubscribers(bump = false) {
    const el = cnt();
    if (!el) return;

    // 1) Vue Supabase (nombre d'abonnés uniquement)
    if (client) {
      try {
        const { data, error } = await client
          .from('newsletter_stats')
          .select('total')
          .maybeSingle();

        if (!error && data) {
          let total = Number(data.total) || 0;
          if (bump && lastCount !== null) total = Math.max(total, lastCount + 1);
          if (total !== lastCount) { lastCount = total; animateCount(el, total); }
          return;
        }
      } catch (_) { /* fallback ci-dessous */ }
    }

    // 2) Fallback local : le compteur bouge au moins sur ce navigateur
    let local = parseInt(localStorage.getItem('iaderape_nl_local') || '0', 10) || 0;
    if (bump) {
      local++;
      localStorage.setItem('iaderape_nl_local', local);
    }
    if (local !== lastCount) { lastCount = local; animateCount(el, local); }
  }

  function animateCount(el, target) {
    const start = parseInt(el.textContent, 10) || 0;
    if (start === target) { el.textContent = target; return; }

    const frames = Math.min(Math.abs(target - start), 12);
    let i = 0;
    const timer = setInterval(() => {
      i++;
      el.textContent = Math.round(start + (target - start) * (i / frames));
      if (i >= frames) {
        clearInterval(timer);
        el.textContent = target;
        el.classList.add('bump');
        setTimeout(() => el.classList.remove('bump'), 600);
      }
    }, 40);
  }

  /* ---------- Stockage Supabase ---------- */
  async function saveToSupabase(email) {
    if (!client) return 'nodb';
    const { error } = await client
      .from('newsletter')
      .insert({ email: email.toLowerCase(), source: 'site' });

    if (error) {
      if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
        return 'already';
      }
      throw new Error(error.message || 'Erreur base de données');
    }
    return 'ok';
  }

  /* ---------- Alerte mail au propriétaire ---------- */
  async function notifyOwner(email) {
    if (!ALERT_KEY || CFG.notifyOnNewSubscriber === false) return false;
    try {
      const r = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: ALERT_KEY,
          subject: `📬 Nouvel abonné — ${CFG.siteName || 'Newsletter'}`,
          from_name: CFG.siteName || 'Newsletter',
          email: email,
          message: `Nouvel abonné : ${email}`,
        }),
      });
      return r.ok;
    } catch (_) { return false; }
  }

  /* ---------- Binding ---------- */
  function bind() {
    const form = $('nlForm');
    if (!form) return;

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email = ($('nlEmail').value || '').trim().toLowerCase();

      if (!EMAIL_RE.test(email)) {
        setNote('⚠️ Adresse email invalide.', 'err');
        return;
      }

      const b = btn();
      b.disabled = true;
      b.textContent = '⏳ Inscription…';
      setNote('Enregistrement en cours…');

      try {
        let res = 'ok';
        try { res = await saveToSupabase(email); } catch (_) { res = 'nodb'; }

        if (res === 'ok') notifyOwner(email);   // alerte mail (non bloquant)

        if (res === 'already') {
          setNote('✅ Tu es déjà abonné — rien à faire !', 'ok');
        } else {
          setNote('🎉 Inscription confirmée ! Tu recevras les prochaines actus.', 'ok');
          form.reset();
          countSubscribers(true);   // ⚡ incrément immédiat
        }

        localStorage.setItem('iaderape_sub', email);
        if (res !== 'already') setTimeout(() => countSubscribers(), 1500);

      } catch (err) {
        setNote('❌ ' + (err.message || 'Erreur, réessaie.'), 'err');
      } finally {
        b.disabled = false;
        b.textContent = "🔔 M'abonner";
      }
    });

    const saved = localStorage.getItem('iaderape_sub');
    if (saved && $('nlEmail')) $('nlEmail').value = saved;

    countSubscribers();
    setInterval(countSubscribers, REFRESH);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) countSubscribers();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
