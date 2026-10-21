export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/api/ig/exchange' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const code = String(b.code || '');
      const redirect = String(b.redirect_uri || new URL('features/instagram/index.html', u.origin).href);
      if (!code) return json({ error: 'code manquant' }, 400);
      if (!env.IG_CLIENT_ID || !env.IG_CLIENT_SECRET)
        return json({ error: 'Worker non configure : IG_CLIENT_ID / IG_CLIENT_SECRET manquants (npx wrangler secret put IG_CLIENT_SECRET)' }, 400);
      const f = new URLSearchParams({
        client_id: env.IG_CLIENT_ID,
        client_secret: env.IG_CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: redirect,
        code
      });
      let short = null;
      try {
        const r = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: f });
        short = await r.json().catch(() => null);
      } catch (e) {
        return json({ error: 'echec echange token Instagram' }, 502);
      }
      if (!short || !short.access_token) return json({ error: (short && short.error_message) || 'token refuse par Instagram' }, 400);
      let expiresIn = 3600;
      try {
        const lr = await fetch('https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=' + env.IG_CLIENT_SECRET + '&access_token=' + encodeURIComponent(short.access_token));
        const lj = await lr.json().catch(() => null);
        if (lj && lj.access_token) {
          short.access_token = lj.access_token;
          expiresIn = lj.expires_in || expiresIn;
        }
      } catch (e) {}
      const uid = short.user_id && typeof short.user_id === 'object' ? (short.user_id.id || '') : (short.user_id || '');
      const uname = short.user_id && typeof short.user_id === 'object' ? (short.user_id.username || '') : (short.username || '');
      return json({ access_token: short.access_token, user_id: uid, username: uname, expires_in: expiresIn });
    }
    if (u.pathname === '/api/ig/me' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const t = String(b.access_token || '');
      if (!t) return json({ error: 'token manquant' }, 400);
      try {
        const me = await fetch('https://graph.instagram.com/v23.0/me?fields=id,user_id,username,profile_picture_url&access_token=' + encodeURIComponent(t));
        const j = await me.json().catch(() => null);
        if (!j || j.error) return json({ error: (j && j.error ? j.error.message : '') || 'profil indisponible — token expire ? reconnecte-toi' }, 400);
        return json(j);
      } catch (e) {
        return json({ error: 'graph.instagram.com injoignable' }, 502);
      }
    }
    return env.ASSETS.fetch(req);
  }
};

function json(o, s) {
  return new Response(JSON.stringify(o), { status: s || 200, headers: { 'Content-Type': 'application/json' } });
}
