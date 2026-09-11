/* IA DÉRAPE — Newsletter (Supabase) */
// Inscription des emails + compteur d'abonnés.
// La clé "publishable" est prévue pour le navigateur (RLS protège la table).

window.IADERAPE_SUPABASE = {
  url: 'https://bjmfoxwlplxknezrojes.supabase.co',
  anonKey: 'sb_publishable_v3neE9jNXUHn5plNgYSscA_klJXGoVH'
};

(function () {
  const cfg = window.IADERAPE_SUPABASE;
  const $ = id => document.getElementById(id);

  // Supabase JS est chargé via CDN dans index.html
  const client = (window.supabase && cfg.url)
    ? window.supabase.createClient(cfg.url, cfg.anonKey)
    : null;

  const note = () => $('nlNote');
  const btn  = () => $('nlBtn');

  function setNote(msg, type) {
    const n = note();
    if (!n) return;
    n.textContent = msg;
    n.className = 'nl-note' + (type ? ' ' + type : '');
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  async function subscribe(email) {
    if (!client) throw new Error('Service indisponible. Réessaie plus tard.');

    // On tente l'insertion. Si l'email existe déjà (contrainte unique),
    // Supabase renvoie une erreur 409 → on l'interprète comme "déjà inscrit".
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

  async function countSubscribers() {
    if (!client) return;
    try {
      const { count, error } = await client
        .from('newsletter')
        .select('*', { count: 'exact', head: true });
      if (!error && typeof count === 'number') {
        const el = $('nlCount');
        if (el) el.textContent = count;
      }
    } catch (_) { /* silencieux */ }
  }

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
        }
        localStorage.setItem('iaderape_sub', email);
        countSubscribers();
      } catch (err) {
        setNote('❌ ' + (err.message || 'Erreur, réessaie.'), 'err');
      } finally {
        b.disabled = false;
        b.textContent = "🔔 M'abonner";
      }
    });

    // Pré-remplit si déjà abonné dans ce navigateur
    const saved = localStorage.getItem('iaderape_sub');
    if (saved && $('nlEmail')) $('nlEmail').value = saved;

    countSubscribers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
