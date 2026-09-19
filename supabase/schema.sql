-- ============================================================
-- Agnes Video Generator — Schéma Supabase (Postgres)
-- ------------------------------------------------------------
-- À exécuter une seule fois dans : Supabase Dashboard > SQL Editor
-- (ou automatiquement au démarrage si SUPABASE_DATABASE_URL est définie)
-- Idempotent : peut être relancé sans risque.
-- ============================================================

-- Vidéos publiées dans la galerie communautaire
CREATE TABLE IF NOT EXISTS community_videos (
    id            TEXT PRIMARY KEY,
    task_id       TEXT NOT NULL DEFAULT '',
    author        TEXT NOT NULL DEFAULT 'Anonyme',
    prompt        TEXT NOT NULL DEFAULT '',
    duration      DOUBLE PRECISION NOT NULL DEFAULT 0,
    resolution    TEXT NOT NULL DEFAULT '',
    published_at  DOUBLE PRECISION NOT NULL,
    storage_path  TEXT NOT NULL DEFAULT '',
    created_at    DOUBLE PRECISION NOT NULL
);

-- Likes (un visiteur = un like par vidéo, identifié par hash)
CREATE TABLE IF NOT EXISTS community_likes (
    video_id     TEXT NOT NULL REFERENCES community_videos(id) ON DELETE CASCADE,
    visitor_hash TEXT NOT NULL,
    created_at   DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (video_id, visitor_hash)
);

-- Commentaires
CREATE TABLE IF NOT EXISTS community_comments (
    id         TEXT PRIMARY KEY,
    video_id   TEXT NOT NULL REFERENCES community_videos(id) ON DELETE CASCADE,
    author     TEXT NOT NULL DEFAULT 'Anonyme',
    text       TEXT NOT NULL,
    created_at DOUBLE PRECISION NOT NULL
);

-- Métadonnées de tâches (survit aux redéploiements Render)
-- user_id : propriétaire de la tâche ('' = tâche héritée, créée avant l'isolation)
CREATE TABLE IF NOT EXISTS tasks (
    task_id          TEXT PRIMARY KEY,
    dir_name         TEXT NOT NULL DEFAULT '',
    task_type        TEXT NOT NULL DEFAULT '',
    creative_name    TEXT NOT NULL DEFAULT '',
    user_id          TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'pending',
    prompt           TEXT NOT NULL DEFAULT '',
    current_message  TEXT NOT NULL DEFAULT '',
    final_video_file TEXT NOT NULL DEFAULT '',
    created_at       DOUBLE PRECISION,
    updated_at       DOUBLE PRECISION
);

-- Migration idempotente (table déjà créée avant l'ajout de user_id) :
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT '';

-- Migration idempotente : user_id du créateur d'une publication galerie
-- ('' = publication héritée, créée avant l'isolation par créateur).
ALTER TABLE community_videos ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT '';

-- Configuration applicative (clé API, filigrane, modèles, domaine, workspaces…)
-- : survit aux redéploiements Render (miroir + restauration au démarrage)
CREATE TABLE IF NOT EXISTS app_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '{}',
    updated_at DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_community_likes_video    ON community_likes(video_id);
CREATE INDEX IF NOT EXISTS idx_community_comments_video ON community_comments(video_id);
CREATE INDEX IF NOT EXISTS idx_tasks_updated            ON tasks(updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user              ON tasks(user_id);

-- RLS activé sur toutes les tables (idempotent) : seules les clés de rôle
-- service/postgres y accèdent (l'application n'utilise jamais la clé anon).
ALTER TABLE community_videos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_likes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config         ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- Bucket de stockage (à créer dans Storage > New bucket)
-- Nom suggéré : agnes-community  (Public bucket : OUI)
-- Le serveur le crée automatiquement au démarrage sinon.
-- ------------------------------------------------------------
