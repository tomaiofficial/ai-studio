#!/usr/bin/env node
/**
 * IA DÉRAPE — Email de TEST
 * -------------------------------------------------
 * Envoie un message de vérification pour confirmer que
 * le système de newsletter fonctionne pour tout le monde.
 *
 * Deux modes :
 *   TEST_ALL      → envoie au premier abonné (vérif technique)
 *   TEST_TO=<mail>→ envoie à une adresse précise
 *
 * Variables : SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, MAIL_FROM
 */

const {
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  RESEND_API_KEY, MAIL_FROM,
  TEST_TO, SITE_URL = 'https://tomaiofficial.github.io/ai-studio/',
} = process.env;

if (!RESEND_API_KEY || !MAIL_FROM) {
  console.error('❌ RESEND_API_KEY et MAIL_FROM sont requis.');
  process.exit(1);
}

const SB = SUPABASE_URL?.replace(/\/$/, '');
const headers = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
};

/* ---------- Récupère les destinataires ---------- */
async function getRecipients() {
  if (TEST_TO) {
    console.log(`🎯 Envoi ciblé → ${TEST_TO}`);
    return [{ email: TEST_TO }];
  }

  if (!SB || !SUPABASE_SERVICE_KEY) {
    console.log('ℹ️ Pas de Supabase configuré — mode test local.');
    return [];
  }

  const r = await fetch(`${SB}/rest/v1/newsletter?select=email&order=created_at.asc`, { headers });
  if (!r.ok) throw new Error(`Supabase → ${r.status}`);
  const subs = await r.json();
  console.log(`👥 ${subs.length} abonné(s) en base`);
  return subs;
}

/* ---------- Contenu du mail de test ---------- */
function testHTML(email, total) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#0a0a12;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px">

    <div style="text-align:center;margin-bottom:26px">
      <div style="display:inline-block;background:linear-gradient(135deg,#ff3860,#22d3ee);color:#fff;font-weight:800;padding:11px 17px;border-radius:12px;font-size:15px">IA</div>
      <div style="color:#fff;font-weight:800;letter-spacing:1px;margin-top:10px">IA DÉRAPE</div>
      <div style="color:#8b8fa8;font-size:12px">L'actu IA sans filtre</div>
    </div>

    <div style="background:#161624;border:1px solid #22d3ee;border-radius:16px;padding:28px">
      <div style="color:#22d3ee;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;margin-bottom:14px">
        🧪 Email de test
      </div>

      <h1 style="color:#eef0f7;font-size:22px;line-height:1.3;margin:0 0 16px">
        Ceci est un email de <span style="color:#22d3ee">TEST</span>
      </h1>

      <p style="color:#cfd3e4;font-size:15px;line-height:1.7;margin:0 0 16px">
        Bonjour 👋
      </p>

      <p style="color:#cfd3e4;font-size:15px;line-height:1.7;margin:0 0 16px">
        Tu reçois ce message car tu t'es inscrit à la newsletter de
        <strong style="color:#fff">IA DÉRAPE</strong>.
        Nous vérifions simplement que le système d'envoi fonctionne
        <strong style="color:#fff">pour tout le monde</strong>.
      </p>

      <div style="background:rgba(34,211,238,.08);border-left:3px solid #22d3ee;border-radius:8px;padding:14px 16px;margin:0 0 22px">
        <p style="color:#cfd3e4;font-size:14px;line-height:1.6;margin:0">
          ✅ <strong style="color:#fff">Si tu lis ce message</strong>, c'est que tout est bien configuré :<br>
          tu recevras désormais les nouvelles actus IA directement ici.
        </p>
      </div>

      <p style="color:#8b8fa8;font-size:13px;line-height:1.6;margin:0 0 22px">
        Aucune action de ta part n'est nécessaire. Prochain mail : dès qu'une
        nouvelle actu sera publiée 🔥
      </p>

      <a href="${SITE_URL}" style="display:inline-block;background:#ff3860;color:#fff;text-decoration:none;padding:12px 24px;border-radius:11px;font-weight:600;font-size:14px">
        Visiter IA DÉRAPE →
      </a>
    </div>

    <p style="color:#666a80;font-size:11px;text-align:center;margin-top:24px;line-height:1.6">
      Email de test envoyé à ${email}<br>
      ${typeof total === 'number' ? `${total} abonné(s) au total · ` : ''}
      <a href="${SITE_URL}" style="color:#8b8fa8">IA DÉRAPE</a>
    </p>
  </div></body></html>`;
}

/* ---------- Envoi ---------- */
async function send(to, total) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [to],
      subject: '🧪 [TEST] Vérification de la newsletter IA DÉRAPE',
      html: testHTML(to, total),
    }),
  });
  if (!r.ok) {
    console.error(`   ✗ ${to} → ${r.status} ${(await r.text()).slice(0, 160)}`);
    return false;
  }
  console.log(`   ✓ ${to}`);
  return true;
}

async function main() {
  const subs = await getRecipients();

  if (!subs.length) {
    console.log('\n💤 Aucun abonné à tester. Inscris-toi d\'abord sur le site,');
    console.log('   ou lance avec TEST_TO=ton@email.com');
    return;
  }

  console.log(`\n🧪 Envoi du mail de test à ${subs.length} destinataire(s)…\n`);

  let ok = 0;
  for (const s of subs) {
    if (await send(s.email, subs.length)) ok++;
  }

  console.log(`\n${ok === subs.length ? '🎉' : '⚠️'} ${ok}/${subs.length} mail(s) de test envoyé(s).`);
  if (ok === subs.length) {
    console.log('✅ Le système fonctionne pour tout le monde.');
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
