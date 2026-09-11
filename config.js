/* ============================================================
 *  ⚙️  IA DÉRAPE — CONFIGURATION
 * ============================================================
 *  C'est LE SEUL fichier que tu dois modifier.
 *  Tu changes une valeur, tu commit, c'est tout.
 * ============================================================ */

window.IADERAPE_CONFIG = {

  /* ----------------------------------------------------------
   *  1. TES INFOS
   * ---------------------------------------------------------- */
  siteName: 'IA DÉRAPE',
  siteUrl:  'https://tomaiofficial.github.io/ai-studio/',

  /* ----------------------------------------------------------
   *  2. TON EMAIL (pour recevoir les notifications d'abonnés)
   * ---------------------------------------------------------- */
  ownerEmail: 'tom@example.com',   // ← mets ton vrai email ici

  /* ----------------------------------------------------------
   *  3. CLÉ D'ALERTE (recommandé — 30 secondes à obtenir)
   * ----------------------------------------------------------
   *  Va sur  https://web3forms.com
   *  → entre ton email → tu reçois une "Access Key" par mail
   *  → colle-la ci-dessous entre les guillemets
   *
   *  Sans clé : le formulaire fonctionne quand même,
   *  mais tu ne reçois pas de mail de notification.
   * ---------------------------------------------------------- */
  alertKey: '',   // ← colle ta clé Web3Forms ici

  /* ----------------------------------------------------------
   *  4. SUPABASE (ne pas modifier si déjà configuré)
   * ---------------------------------------------------------- */
  supabase: {
    url:     'https://bjmfoxwlplxknezrojes.supabase.co',
    anonKey: 'sb_publishable_v3neE9jNXUHn5plNgYSscA_klJXGoVH',
  },

  /* ----------------------------------------------------------
   *  5. RÉGLAGES
   * ---------------------------------------------------------- */
  autoRefreshSeconds: 30,   // rafraîchissement du compteur
  notifyOnNewSubscriber: true,
};
