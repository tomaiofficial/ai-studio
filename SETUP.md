# ⚙️ Configuration de la newsletter — Guide express

> **Tout se passe en 2 étapes.** Compte ~5 minutes.

---

## 🅰️ ÉTAPE 1 — Créer la table Supabase (2 min)

*Sans ça, les inscriptions échouent.*

1. Ouvre 👉 **https://supabase.com/dashboard/project/bjmfoxwlplxknezrojes/sql/new**

2. Copie-colle **tout** ceci puis clique sur **▶ RUN** (en bas à droite) :

```sql
create table if not exists public.newsletter (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  source      text default 'site',
  confirmed   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.newsletter enable row level security;

drop policy if exists "newsletter_public_insert" on public.newsletter;
create policy "newsletter_public_insert"
  on public.newsletter for insert to anon, authenticated
  with check (true);

create or replace view public.newsletter_stats
with (security_invoker = off) as
select
  count(*) as total,
  count(*) filter (where created_at > now() - interval '7 days') as cette_semaine,
  count(*) filter (where created_at > now() - interval '1 day')  as aujourdhui
from public.newsletter;

grant select on public.newsletter_stats to anon, authenticated;
```

3. Tu dois voir : **`Success. No rows returned`** ✅

---

## 🅱️ ÉTAPE 2 — Recevoir une alerte mail (2 min)

*Pour être prévenu quand quelqu'un s'inscrit.*

1. Va sur 👉 **https://web3forms.com**

2. Entre **ton adresse email** → clique **Create Access Key**

3. **Relève ta boîte mail** : tu reçois une clé du type
   ```
   a1b2c3d4-e5f6-7890-abcd-ef1234567890
   ```

4. Ouvre le fichier **`config.js`** de ton dépôt :
   👉 https://github.com/tomaiofficial/ai-studio/edit/main/config.js

5. Colle ta clé ici :
   ```js
   alertKey: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   ```

6. **Commit** le changement.

✅ **Fini !** Dès qu'un visiteur s'inscrit, tu reçois un mail.

---

## 🔍 Vérifier que ça marche

1. Va sur ton site : https://tomaiofficial.github.io/ai-studio/
2. Inscris-toi avec un email de test
3. Tu dois voir : **« 🎉 Inscription confirmée ! »**
4. Le compteur **s'incrémente** 🎉
5. Tu reçois un **mail d'alerte** 📬

---

## ❗ Problèmes fréquents

| Message | Cause | Solution |
|---|---|---|
| `Could not find the table 'public.newsletter'` | Étape 1 pas faite | Fais l'**étape 1** |
| `Inscription confirmée` mais pas de mail | Étape 2 pas faite | Fais l'**étape 2** |
| Compteur reste à 0 | Vue `newsletter_stats` absente | Rejoue l'**étape 1** |
| `Adresse email invalide` | Format d'email incorrect | Vérifie la saisie |

---

## 📂 Fichiers concernés

| Fichier | Rôle |
|---|---|
| `config.js` | ⚙️ **Le seul fichier à modifier** |
| `newsletter.js` | Logique (ne pas toucher) |
| `supabase-newsletter.sql` | Le SQL de l'étape 1 |
