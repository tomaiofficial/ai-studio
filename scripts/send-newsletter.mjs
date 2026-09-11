#!/usr/bin/env node
/**
 * IA DÉRAPE — Envoi automatique de la newsletter
 * -------------------------------------------------
 * Détecte les actus non encore notifiées (news.json vs table newsletter_sent),
 * puis envoie un email à tous les abonnés via Resend.
 *
 * Variables d'environnement requises :
 *   SUPABASE_URL          URL du projet (ex: https://xxx.supabase.co)
 *   SUPABASE_SERVICE_KEY  clé service_role (SECRÈTE — jamais dans le site)
 *   RESEND_API_KEY        clé API Resend
 *   MAIL_FROM             expéditeur vérifié (ex: "IA DÉRAPE <news@tondomaine.fr>")
 *   SITE_URL              URL du site (ex: https://tomaiofficial.github.io/ai-studio/)
 */

import { readFileSync } from 'node:fs';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  RESEND_API_KEY,
  MAIL_FROM,
  SITE_URL = 'https://tomaiofficial.github.io/ai-studio/',
  FORCE_NEWS_ID,        // optionnel : forcer l'envoi d'une actu précise
  DRY_RUN = 'false',    // 'true' = n'envoie rien, affiche seulement
} = process.env;

const DRY = DRY_RUN === 'true';

function need(name, val) {
  if (!val && !DRY) {
    console.error(`❌ Variable manquante : ${name}`);
    process.exit(1);
  }
}
need('SUPABASE_URL', SUPABASE_URL);
need('SUPABASE_SERVICE_KEY', SUPABASE_SERVICE_KEY);
need('RESEND_API_KEY', RESEND_API_KEY);
need('MAIL_FROM', MAIL_FROM);

const SB = SUPABASE_URL?.replace(/\/$/, '');
const headers = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

/* ---------- Supabase helpers ---------- */
async function sbGet(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers });
  if (!r.ok) throw new Error(`Supabase GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbPost(path, body) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Supabase POST ${path} → ${r.status} ${await r.text()}`);
}

/* ---------- Email ---------- */
const CAT_LABEL = {
  derape: '🔥 Dérapage',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  securite: 'Sécurité',
  regulation: 'Régulation',
};

function frDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function emailHTML(n, unsubUrl) {
  const link = `${SITE_URL}#${n.id}`;
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#0a0a12;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px">
    <div style="text-align:center;margin-bottom:26px">
      <div style="display:inline-block;background:linear-gradient(135deg,#ff3860,#22d3ee);color:#fff;font-weight:800;padding:11px 17px;border-radius:12px;font-size:15px">IA</div>
      <div style="color:#fff;font-weight:800;letter-spacing:1px;margin-top:10px">IA DÉRAPE</div>
      <div style="color:#8b8fa8;font-size:12px">L'actu IA sans filtre</div>
    </div>
    <div style="background:#161624;border:1px solid #25253a;border-radius:16px;padding:28px">
      <div style="color:#22d3ee;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;margin-bottom:12px">
        ${CAT_LABEL[n.cat] || n.cat} · ${frDate(n.date)}
      </div>
      <h1 style="color:#eef0f7;font-size:22px;line-height:1.3;margin:0 0 14px">${n.title}</h1>
      <p style="color:#8b8fa8;font-size:15px;line-height:1.6;margin:0 0 22px">${n.excerpt}</p>
      <p style="color:#cfd3e4;font-size:14px;line-height:1.7;margin:0 0 24px">${(n.body || '').split('\n\n')[0]}</p>
      <a href="${link}" style="display:inline-block;background:#ff3860;color:#fff;text-decoration:none;padding:12px 24px;border-radius:11px;font-weight:600;font-size:14px">
        Lire l'article complet →
      </a>
    </div>
    <p style="color:#666a80;font-size:11px;text-align:center;margin-top:24px;line-height:1.6">
      Tu reçois cet email car tu t'es inscrit sur IA DÉRAPE.<br>
      <a href="${unsubUrl}" style="color:#8b8fa8">Se désinscrire</a> ·
      Source : ${n.source}
    </p>
  </div></body></html>`;
}

async function sendOne(to, n, unsub) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [to],
      subject: `${CAT_LABEL[n.cat] || 'Actu IA'} — ${n.title}`,
      html: emailHTML(n, unsub),
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error(`   ✗ ${to} → ${r.status} ${t.slice(0, 120)}`);
    return false;
  }
  return true;
}

/* ---------- Programme principal ---------- */
async function main() {
  const news = JSON.parse(readFileSync(new URL('../news.json', import.meta.url), 'utf8'));
  console.log(`📰 ${news.length} actus dans news.json`);

  const sent = await sbGet('newsletter_sent?select=news_id');
  const sentIds = new Set(sent.map(s => s.news_id));
  console.log(`✅ ${sentIds.size} actus déjà notifiées`);

  let toSend = news.filter(n => !sentIds.has(n.id));
  if (FORCE_NEWS_ID) toSend = news.filter(n => n.id === FORCE_NEWS_ID);

  if (!toSend.length) {
    console.log('💤 Aucune nouvelle actu. Rien à envoyer.');
    return;
  }

  const subs = await sbGet('newsletter?select=email&confirmed=eq.true');
  console.log(`👥 ${subs.length} abonnés`);
  if (!subs.length) {
    console.log('💤 Aucun abonné. Rien à envoyer.');
    return;
  }

  for (const n of toSend) {
    console.log(`\n📨 Envoi : « ${n.title} »`);
    let ok = 0;
    if (DRY) {
      console.log('   (DRY RUN — aucun email envoyé)');
      ok = subs.length;
    } else {
      for (const s of subs) {
        const unsub = `${SB}/functions/v1/unsubscribe?email=${encodeURIComponent(s.email)}`;
        if (await sendOne(s.email, n, unsub)) ok++;
      }
    }
    console.log(`   ✓ ${ok}/${subs.length} envoyés`);

    if (!DRY && !FORCE_NEWS_ID) {
      await sbPost('newsletter_sent', [{ news_id: n.id, recipients: ok }]);
    }
  }
  console.log('\n🎉 Terminé.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
