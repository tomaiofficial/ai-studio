"""
core/storage/supabase_backend.py — Backend de stockage persistant Supabase

Fournit deux stores résilients au redéploiement Render :
- SupabaseCommunityStore : vidéos → Supabase Storage (bucket public), métadonnées
  (prompt, auteur, likes, commentaires) → tables Postgres.
- SupabaseTaskStore : métadonnées de tâches → table Postgres (survit aux redémarrages).

Configuration (variables d'environnement) :
- SUPABASE_URL                 (obligatoire) ex. https://abcd.supabase.co
- SUPABASE_SERVICE_ROLE_KEY    (obligatoire) clé service (bypass RLS, serveur uniquement)
- SUPABASE_DATABASE_URL        (conseillé) chaîne Postgres pour la création auto du schéma
- SUPABASE_STORAGE_BUCKET      (optionnel) nom du bucket, défaut "agnes-community"

Schéma : voir supabase/schema.sql dans le dépôt (création auto au démarrage si
SUPABASE_DATABASE_URL est fournie, sinon à exécuter manuellement dans le SQL Editor).
"""

import json
import logging
import os
import re
import threading
import time
from datetime import datetime
from typing import List, Optional

from .base import CommunityStore, TaskStore

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "") or ""
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or ""
SUPABASE_DATABASE_URL = os.environ.get("SUPABASE_DATABASE_URL", "") or ""
SUPABASE_STORAGE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "") or "agnes-community"

DEFAULT_VIDEO_MIME = "video/mp4"

SCHEMA_DDL = """
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

CREATE TABLE IF NOT EXISTS community_likes (
    video_id     TEXT NOT NULL REFERENCES community_videos(id) ON DELETE CASCADE,
    visitor_hash TEXT NOT NULL,
    created_at   DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (video_id, visitor_hash)
);

CREATE TABLE IF NOT EXISTS community_comments (
    id         TEXT PRIMARY KEY,
    video_id   TEXT NOT NULL REFERENCES community_videos(id) ON DELETE CASCADE,
    author     TEXT NOT NULL DEFAULT 'Anonyme',
    text       TEXT NOT NULL,
    created_at DOUBLE PRECISION NOT NULL
);

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

CREATE INDEX IF NOT EXISTS idx_community_likes_video   ON community_likes(video_id);
CREATE INDEX IF NOT EXISTS idx_community_comments_video ON community_comments(video_id);
CREATE INDEX IF NOT EXISTS idx_tasks_updated           ON tasks(updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user             ON tasks(user_id);

-- RLS activé sur toutes les tables (idempotent) : seules les clés de rôle
-- service/postgres y accèdent (l'application n'utilise jamais la clé anon).
ALTER TABLE community_videos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_likes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config         ENABLE ROW LEVEL SECURITY;
"""


def is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def ensure_schema() -> None:
    """Crée les tables (idempotent) via la chaîne Postgres fournie.

    Sans SUPABASE_DATABASE_URL, on laisse l'opérateur exécuter supabase/schema.sql
    manuellement (un warning est émis).
    """
    if not is_configured():
        return
    if not SUPABASE_DATABASE_URL:
        logger.warning(
            "[Storage] SUPABASE_DATABASE_URL absent : exécuter supabase/schema.sql "
            "dans le SQL Editor Supabase pour créer les tables."
        )
        return
    import psycopg2

    conn = None
    try:
        conn = psycopg2.connect(SUPABASE_DATABASE_URL, connect_timeout=15)
        with conn.cursor() as cur:
            cur.execute(SCHEMA_DDL)
        conn.commit()
        logger.info("[Storage] Schéma Supabase vérifié (tables prêtes).")
    except Exception as e:
        logger.error(f"[Storage] Échec de l'initialisation du schéma: {e}")
        raise
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def ensure_bucket(client) -> None:
    """Crée le bucket public (idempotent) si nécessaire."""
    try:
        client.storage.get_bucket(SUPABASE_STORAGE_BUCKET)
        logger.info(f"[Storage] Bucket '{SUPABASE_STORAGE_BUCKET}' déjà présent.")
        return
    except Exception:
        pass
    try:
        client.storage.create_bucket(SUPABASE_STORAGE_BUCKET, options={"public": True})
        logger.info(f"[Storage] Bucket public '{SUPABASE_STORAGE_BUCKET}' créé.")
    except Exception as e:
        logger.warning(f"[Storage] Création du bucket impossible (créer manuellement): {e}")


_client_cache = None


def _get_client():
    """Client Supabase paresseux (service role key — côté serveur uniquement)."""
    global _client_cache
    if _client_cache is None:
        from supabase import create_client

        _client_cache = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _client_cache


# ═══════════════════════════════════════════════════
# Configuration applicative persistante (app_config)
# ═══════════════════════════════════════════════════

APP_CONFIG_ROW = "main"


def mirror_config(config: dict) -> None:
    """Persiste la configuration applicative (clé API, filigrane, modèles, domaine…)
    dans la table app_config. Best-effort : un échec ne casse jamais la sauvegarde locale."""
    if not is_configured():
        return
    try:
        _get_client().table("app_config").upsert(
            {
                "key": APP_CONFIG_ROW,
                "value": json.dumps(config or {}, ensure_ascii=False),
                "updated_at": time.time(),
            },
            on_conflict="key",
        ).execute()
    except Exception as e:
        logger.warning(f"[Storage] Échec du miroir de configuration Supabase: {e}")


def restore_config() -> Optional[dict]:
    """Recharge la configuration persistée depuis app_config (ou None si absente).

    Utilisée au démarrage : après un redéploiement Render, le fichier local
    n'existe plus mais la config est restituée depuis la base."""
    if not is_configured():
        return None
    try:
        res = (
            _get_client()
            .table("app_config")
            .select("value")
            .eq("key", APP_CONFIG_ROW)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.warning(f"[Storage] Lecture de la configuration Supabase impossible: {e}")
        return None
    rows = res.data or []
    if not rows:
        return None
    try:
        value = json.loads(rows[0].get("value") or "{}")
    except Exception:
        logger.warning("[Storage] Configuration Supabase illisible (JSON invalide).")
        return None
    return value if isinstance(value, dict) else None


def _dir_name_to_ts(dir_name: str) -> Optional[float]:
    """Extrait un timestamp depuis un nom de dossier 'YYYYMMDD_HHMMSS_xxx'."""
    m = re.match(r"(\d{8})_(\d{6})", dir_name or "")
    if not m:
        return None
    try:
        dt = datetime.strptime(f"{m.group(1)}{m.group(2)}", "%Y%m%d%H%M%S")
        return dt.timestamp()
    except ValueError:
        return None


class SupabaseCommunityStore(CommunityStore):
    """Galerie communautaire persistante (Storage + Postgres)."""

    def _storage(self):
        return _get_client().storage.from_(SUPABASE_STORAGE_BUCKET)

    def _public_url(self, storage_path: str) -> str:
        try:
            return self._storage().get_public_url(storage_path)
        except Exception:
            return f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{SUPABASE_STORAGE_BUCKET}/{storage_path}"

    def publish(self, task_id, author, prompt, duration, resolution, video_path,
                user_id: str = "") -> dict:
        import uuid

        client = _get_client()
        video_id = uuid.uuid4().hex[:12]
        storage_path = f"videos/{video_id}.mp4"
        with open(video_path, "rb") as f:
            data = f.read()
        self._storage().upload(storage_path, data, {"content-type": DEFAULT_VIDEO_MIME})
        now = time.time()
        client.table("community_videos").insert({
            "id": video_id,
            "task_id": task_id,
            "author": author or "Anonyme",
            "prompt": prompt,
            "duration": duration,
            "resolution": resolution,
            "published_at": now,
            "storage_path": storage_path,
            "created_at": now,
            "user_id": user_id or "",
        }).execute()
        logger.info(
            f"[CommunityStore] Published {video_id} -> supabase storage "
            f"({len(data)} octets, bucket={SUPABASE_STORAGE_BUCKET})"
        )
        return {"video_id": video_id, "video_url": self._public_url(storage_path)}

    def _row_to_video(self, row: dict, like_counts: dict, comment_counts: dict) -> dict:
        vid = row["id"]
        prompt = row.get("prompt", "") or ""
        return {
            "id": vid,
            "title": prompt[:80] if prompt else "Untitled",
            "author": row.get("author") or "Anonyme",
            "prompt": prompt,
            "duration": row.get("duration", 0) or 0,
            "resolution": row.get("resolution", "") or "",
            "published_at": row.get("published_at", 0) or 0,
            "user_id": row.get("user_id", "") or "",
            "likes": like_counts.get(vid, 0),
            "comments_count": comment_counts.get(vid, 0),
            "video_url": self._public_url(row.get("storage_path") or f"videos/{vid}.mp4"),
            "thumbnail": self._public_url(row.get("storage_path") or f"videos/{vid}.mp4"),
        }

    def list_videos(self, page=1, per_page=20) -> dict:
        client = _get_client()
        start = (page - 1) * per_page
        res = (
            client.table("community_videos")
            .select("*")
            .order("published_at", desc=True)
            .limit(per_page)
            .offset(start)
            .execute()
        )
        rows = res.data or []
        total = 0
        try:
            total_res = (
                client.table("community_videos").select("id", count="exact").limit(1).execute()
            )
            total = total_res.count or 0
        except Exception:
            total = len(rows)
        ids = [r["id"] for r in rows]
        like_counts: dict = {}
        comment_counts: dict = {}
        if ids:
            try:
                likes_res = (
                    client.table("community_likes").select("video_id").in_("video_id", ids).execute()
                )
                for like in likes_res.data or []:
                    like_counts[like["video_id"]] = like_counts.get(like["video_id"], 0) + 1
            except Exception as e:
                logger.warning(f"[CommunityStore] Lecture des likes impossible: {e}")
            try:
                comments_res = (
                    client.table("community_comments").select("video_id").in_("video_id", ids).execute()
                )
                for c in comments_res.data or []:
                    comment_counts[c["video_id"]] = comment_counts.get(c["video_id"], 0) + 1
            except Exception as e:
                logger.warning(f"[CommunityStore] Lecture des commentaires impossible: {e}")
        return {
            "videos": [self._row_to_video(r, like_counts, comment_counts) for r in rows],
            "total": total,
        }

    def get_meta(self, video_id: str) -> Optional[dict]:
        res = (
            _get_client().table("community_videos")
            .select("*").eq("id", video_id).limit(1).execute()
        )
        rows = res.data or []
        return rows[0] if rows else None

    def toggle_like(self, video_id: str, visitor_hash: str) -> dict:
        client = _get_client()
        if not self.get_meta(video_id):
            raise KeyError(video_id)
        existing = (
            client.table("community_likes")
            .select("visitor_hash")
            .eq("video_id", video_id)
            .eq("visitor_hash", visitor_hash)
            .limit(1)
            .execute()
        )
        liked = bool(existing.data)
        if liked:
            (
                client.table("community_likes")
                .delete().eq("video_id", video_id).eq("visitor_hash", visitor_hash)
                .execute()
            )
        else:
            client.table("community_likes").insert({
                "video_id": video_id,
                "visitor_hash": visitor_hash,
                "created_at": time.time(),
            }).execute()
        count_res = (
            client.table("community_likes")
            .select("visitor_hash", count="exact").eq("video_id", video_id).execute()
        )
        return {"ok": True, "likes": count_res.count or 0, "liked": not liked}

    def get_comments(self, video_id: str) -> List[dict]:
        if not self.get_meta(video_id):
            raise KeyError(video_id)
        res = (
            _get_client().table("community_comments")
            .select("id", "author", "text", "created_at")
            .eq("video_id", video_id)
            .order("created_at", desc=False)
            .execute()
        )
        return [dict(c) for c in (res.data or [])]

    def add_comment(self, video_id: str, author: str, text: str) -> dict:
        import uuid

        client = _get_client()
        if not self.get_meta(video_id):
            raise KeyError(video_id)
        comment = {
            "id": uuid.uuid4().hex[:8],
            "author": author or "Anonyme",
            "text": text,
            "created_at": time.time(),
        }
        client.table("community_comments").insert({
            "id": comment["id"],
            "video_id": video_id,
            "author": comment["author"],
            "text": comment["text"],
            "created_at": comment["created_at"],
        }).execute()
        count_res = (
            client.table("community_comments")
            .select("id", count="exact").eq("video_id", video_id).execute()
        )
        return {
            "ok": True,
            "comment": comment,
            "comments_count": count_res.count or 0,
        }

    def get_video(self, video_id: str) -> Optional[str]:
        meta = self.get_meta(video_id)
        if not meta:
            return None
        return self._public_url(meta.get("storage_path") or f"videos/{video_id}.mp4")

    def find_published(self, task_id: str) -> Optional[dict]:
        res = (
            _get_client().table("community_videos")
            .select("*").eq("task_id", task_id)
            .order("published_at", desc=True).limit(1).execute()
        )
        rows = res.data or []
        if not rows:
            return None
        row = rows[0]
        storage_path = row.get("storage_path") or f"videos/{row['id']}.mp4"
        url = self._public_url(storage_path)
        return {"video_id": row["id"], "video_url": url, "video_target": url}

    def delete(self, video_id: str, user_id: str = "") -> None:
        meta = self.get_meta(video_id)
        if not meta:
            raise KeyError(video_id)
        owner = (meta.get("user_id") or "").strip()
        if owner and user_id != owner:
            raise PermissionError("Cette vidéo appartient à un autre créateur : seule la suppression par son créateur est autorisée")
        if not owner:
            raise PermissionError("Créateur non identifiable sur cette publication : suppression par API impossible")
        client = _get_client()
        storage_path = meta.get("storage_path") or f"videos/{video_id}.mp4"
        try:
            self._storage().remove([storage_path])
        except Exception as e:
            logger.warning(f"[CommunityStore] Suppression objet storage {storage_path}: {e}")
        client.table("community_comments").delete().eq("video_id", video_id).execute()
        client.table("community_likes").delete().eq("video_id", video_id).execute()
        client.table("community_videos").delete().eq("id", video_id).execute()


class _CoalescingWriter:
    """Écrit les métadonnées de tâches en arrière-plan, une seule fois par
    tâche par cycle (les écritures successives sont coalescées), dans l'ordre.
    Les erreurs ne remontent jamais dans le pipeline de génération vidéo."""

    def __init__(self, client):
        self._client = client
        self._pending: dict = {}
        self._lock = threading.Lock()
        self._event = threading.Event()
        self._thread = threading.Thread(
            target=self._run, name="task-meta-writer", daemon=True
        )
        self._thread.start()

    def submit(self, meta: dict):
        task_id = meta.get("task_id")
        if not task_id:
            return
        with self._lock:
            self._pending[task_id] = meta
        self._event.set()

    def _run(self):
        while True:
            self._event.wait(timeout=0.5)
            self._event.clear()
            with self._lock:
                batch = dict(self._pending)
                self._pending.clear()
            for meta in batch.values():
                try:
                    self._upsert(meta)
                except Exception as e:
                    logger.warning(
                        f"[TaskStore] Écriture métadonnées {meta.get('task_id')} impossible: {e}"
                    )

    def _upsert(self, meta: dict):
        self._client.table("tasks").upsert({
            "task_id": meta["task_id"],
            "dir_name": meta.get("dir_name", ""),
            "task_type": meta.get("task_type", ""),
            "creative_name": meta.get("creative_name", ""),
            "user_id": meta.get("user_id", ""),
            "status": meta.get("status", "pending"),
            "prompt": meta.get("prompt", ""),
            "current_message": meta.get("current_message", ""),
            "final_video_file": meta.get("final_video_file", ""),
            "created_at": meta.get("created_at"),
            "updated_at": meta.get("updated_at", time.time()),
        }, on_conflict="task_id").execute()


class SupabaseTaskStore(TaskStore):
    """Métadonnées de tâches persistées dans Postgres (mode Render)."""

    def __init__(self):
        self._writer = _CoalescingWriter(_get_client())

    def upsert_meta(self, meta: dict) -> None:
        self._writer.submit(meta)

    def get_meta(self, task_id: str) -> Optional[dict]:
        res = (
            _get_client().table("tasks")
            .select("*").eq("task_id", task_id).limit(1).execute()
        )
        rows = res.data or []
        return rows[0] if rows else None

    def list_meta(self) -> List[dict]:
        res = (
            _get_client().table("tasks")
            .select("*").order("updated_at", desc=True).execute()
        )
        return [dict(r) for r in (res.data or [])]

    def delete_meta(self, task_id: str) -> None:
        try:
            _get_client().table("tasks").delete().eq("task_id", task_id).execute()
        except Exception as e:
            logger.warning(f"[TaskStore] Suppression {task_id} impossible: {e}")

    def mark_interrupted(self, message: str) -> int:
        res = (
            _get_client().table("tasks")
            .update({"status": "failed", "current_message": message})
            .in_("status", ["running", "queued"])
            .execute()
        )
        return len(res.data or [])
