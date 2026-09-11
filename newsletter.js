/* IA DÉRAPE — Newsletter (Supabase) */
// Inscription des emails + compteur d'abonnés en temps réel.

window.IADERAPE_SUPABASE = {
  url: 'https://bjmfoxwlplxknezrojes.supabase.co',
  anonKey: 'sb_publishable_v3neE9jNXUHn5plNgYSscA_klJXGoVH'
};

(function () {
  const cfg = window.IADERAPE_SUPABASE;
  const $ = id => document.getElementById(id);

  const client = (window.supabase && cfg.url)
    ? window.supabase.createClient(cfg.url, cfg.anonKey)
    : null;

  const note = () => $('nlNote');
  const btn  = () => $('nlBtn');
  const cnt  = () => $('nlCount');

  function setNote(msg, type) {
    const n = note();
    if (!n) return;
    n.textContent = msg;
    n.className = 'nl-note' + (type ? ' ' + type : '');
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* ---------- Compteur ---------- */
  // On lit la VUE newsletter_stats : elle n'expose que des nombres,
  // jamais les adresses email. Aucune fuite de données.
  let lastCount = null;

  async function countSubscribers(bump = false) {
    const el = cnt();
    if (!el || !client) return;

    try {
      const { data, error } = await client
        .from('newsletter_stats')
        .select('total')
        .maybeSingle();

      if (error) throw error;

      let total = (data && Number(data.total)) || 0;

      // Optimistic UI : si on vient de s'inscrire, on incrémente direct
      // (le temps que la vue se mette à jour côté Supabase).
      if (bump && lastCount !== null) total = Math.max(total, lastCount + 1);

      if (total !== lastCount) {
        lastCount = total;
        animateCount(el, total);
      }
    } catch (_) {
      // Vue absente ou RLS : on laisse la valeur actuelle, pas d'erreur visible.
    }
  }

  // Petite animation quand le chiffre grimpe
  function animateCount(el, target) {
    const start = parseInt(el.textContent, 10) || 0;
    if (start === target) { el.textContent = target; return; }

    const step = target > start ? 1 : -1;
    const frames = Math.min(Math.abs(target - start), 12);
    let i = 0;

    el.textContent = start + step * 0; // point de départ
    const timer = setInterval(() => {
      i++;
      const val = start + Math.round((target - start) * (i / frames));
      el.textContent = val;
      if (i >= frames) {
        clearInterval(timer);
        el.textContent = target;
        el.classList.add('bump');
        setTimeout(() => el.classList.remove('bump'), 600);
      }
    }, 40);
  }

  /* ---------- Inscription ---------- */
  async function subscribe(email) {
    if (!client) throw new Error('Service indisponible. Réessaie plus tard.');

    const { error } = await client
      .from('newsletter')
      .insert({ email: email.toLowerCase(), source: 'site' });

    if (error) {
      if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
        return 'already';
      }
      throw new Error(error.message || 'Erreur inconnue');
    }
    return 'ok';
  }

  /* ---------- Binding ---------- */
  function bind() {
    const form = $('nlForm');
    if (!form) return;

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email = ($('nlEmail').value || '').trim();

      if (!EMAIL_RE.test(email)) {
        setNote('⚠️ Adresse email invalide.', 'err');
        return;
      }

      const b = btn();
      b.disabled = true;
      b.textContent = '⏳ Inscription…';
      setNote('Enregistrement en cours…');

      try {
        const res = await subscribe(email);

        if (res === 'already') {
          setNote('✅ Tu es déjà abonné — rien à faire !', 'ok');
        } else {
          setNote('🎉 Inscription confirmée ! Tu recevras les prochaines actus.', 'ok');
          form.reset();
          countSubscribers(true);   // ⚡ incrément immédiat
        }
        localStorage.setItem('iaderape_sub', email);

        // Re-vérifie un peu plus tard pour être sûr d'avoir la vraie valeur
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

    // Valeur initiale
    countSubscribers();

    // Rafraîchit régulièrement (30 s) + quand on revient sur l'onglet
    setInterval(countSubscribers, 30000);
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
