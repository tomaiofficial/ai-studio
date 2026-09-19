# Supabase — Configuration du stockage persistant

La galerie communautaire (vidéos, likes, commentaires) et les métadonnées des
tâches sont désormais stockées **hors du disque éphémère de Render**, dans
Supabase (Stockage + Postgres). Elles survivent donc aux redéploiements.

## 1. Créer le projet Supabase (gratuit)

1. Rendez-vous sur <https://supabase.com> → **Start your project**
2. Choisissez une organisation, un nom de projet (ex. `agnes-community`) et un mot de passe base de données
3. Notez le **Project URL** (ex. `https://abcdxyz.supabase.co`) et le **Project Reference** (ex. `abcdxyz`)

## 2. Récupérer les clés

Dans le dashboard : **Project Settings → API**

| Variable | Où la trouver | Exemple |
|---|---|---|
| `SUPABASE_URL` | Project URL | `https://abcdxyz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Project API keys → `service_role` (secret) | `eyJhbGciOi...` |
| `SUPABASE_DATABASE_URL` | Project Settings → Database → **Connection string** (mode *Direct* ou *Transaction pooler*) | `postgresql://postgres.abcdxyz:********@aws-0-eu-west-1.pooler.supabase.com:6543/postgres` |

> ⚠️ La `service_role` key contourne la sécurité RLS : elle ne doit **jamais**
> être exposée au navigateur. Elle ne vit que dans les variables d'environnement
> de Render (côté serveur).

## 3. Créer les tables et le bucket

Option A — automatique (recommandé) : définissez `SUPABASE_DATABASE_URL` dans
Render. Au démarrage, le serveur crée les tables (`supabase/schema.sql`) et le
bucket public `agnes-community` tout seul.

Option B — manuel : dans le dashboard → **SQL Editor**, collez le contenu de
`supabase/schema.sql` puis exécutez. Dans **Storage → New bucket**, créez un
bucket **public** nommé `agnes-community`.

## 4. Configurer Render

Dans Render → votre service `agnes-ia` → **Environment** → **New Environment Variable** :

| Clé | Valeur | Visible |
|---|---|---|
| `SUPABASE_URL` | votre Project URL | oui |
| `SUPABASE_SERVICE_ROLE_KEY` | votre clé `service_role` | non |
| `SUPABASE_DATABASE_URL` | votre chaîne Postgres | non |
| `SUPABASE_STORAGE_BUCKET` | `agnes-community` | oui |

Redéployez. Le mode **Supabase** est actif : les publications, likes et
commentaires de la galerie survivent désormais à chaque redéploiement/redémarrage.

## 5. Vérification

- `GET /api/community/videos` renvoie des `video_url` commençant par `https://...supabase.co/storage/v1/object/public/...`
- Publiez une vidéo → redéployez Render → la galerie contient toujours la vidéo
- La vue « Tâches » affiche l'historique des tâches restauré depuis la base

## Mode local (développement)

Sans variables `SUPABASE_*`, le serveur conserve l'ancien comportement : stockage
sur le disque local (`.working_dir/community/`). Aucune modification nécessaire.
