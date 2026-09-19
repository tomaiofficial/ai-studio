"""
core/storage/local_backend.py — Backend de stockage local (système de fichiers)

Reprend exactement le comportement historique de server.py (dossier community/
avec index.json + fichiers .mp4). Utilisé uniquement en développement local,
quand les variables d'environnement Supabase ne sont pas configurées.

⚠️ Sur Render, ce backend est VOLATILE : le disque est éphémère et tout est
perdu à chaque redéploiement. C'est pourquoi le backend Supabase existe.
"""

import json
import logging
import os
import shutil
import time
from typing import List, Optional

from core.config import get_working_dir

from .base import CommunityStore, TaskStore

logger = logging.getLogger(__name__)


class LocalCommunityStore(CommunityStore):
    """Galerie communautaire sur système de fichiers (comportement historique)."""

    def _get_community_dir(self) -> str:
        d = os.path.join(get_working_dir(), "community")
        os.makedirs(d, exist_ok=True)
        return d

    def _load_index(self) -> dict:
        path = os.path.join(self._get_community_dir(), "index.json")
        if not os.path.exists(path):
            return {"videos": {}}
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"[CommunityStore] index.json illisible: {e}")
            return {"videos": {}}

    def _save_index(self, index: dict) -> None:
        path = os.path.join(self._get_community_dir(), "index.json")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)

    def publish(self, task_id, author, prompt, duration, resolution, video_path,
                user_id: str = "") -> dict:
        import uuid

        video_id = uuid.uuid4().hex[:12]
        dest = os.path.join(self._get_community_dir(), f"{video_id}.mp4")
        shutil.copy2(video_path, dest)
        index = self._load_index()
        index.setdefault("videos", {})[video_id] = {
            "task_id": task_id,
            "author": author or "Anonyme",
            "prompt": prompt,
            "duration": duration,
            "resolution": resolution,
            "published_at": time.time(),
            "user_id": user_id or "",
            "likes": [],
            "comments": [],
        }
        self._save_index(index)
        logger.info(f"[CommunityStore] Published {video_id} (local fs)")
        return {"video_id": video_id, "video_url": f"/api/community/videos/{video_id}/video"}

    def list_videos(self, page=1, per_page=20) -> dict:
        index = self._load_index()
        videos = []
        for vid, meta in (index.get("videos") or {}).items():
            videos.append({
                "id": vid,
                "title": meta["prompt"][:80] if meta.get("prompt") else "Untitled",
                "author": meta.get("author", "Anonyme"),
                "prompt": meta.get("prompt", ""),
                "duration": meta.get("duration", 0),
                "resolution": meta.get("resolution", ""),
                "published_at": meta.get("published_at", 0),
                "user_id": meta.get("user_id", ""),
                "likes": len(meta.get("likes", [])),
                "comments_count": len(meta.get("comments", [])),
                "video_url": f"/api/community/videos/{vid}/video",
                "thumbnail": f"/api/community/videos/{vid}/video",
            })
        videos.sort(key=lambda v: v["published_at"], reverse=True)
        start = (page - 1) * per_page
        end = start + per_page
        return {"videos": videos[start:end], "total": len(videos)}

    def get_meta(self, video_id: str) -> Optional[dict]:
        index = self._load_index()
        return index.get("videos", {}).get(video_id)

    def toggle_like(self, video_id: str, visitor_hash: str) -> dict:
        index = self._load_index()
        videos = index.get("videos", {})
        if video_id not in videos:
            raise KeyError(video_id)
        likes = videos[video_id].setdefault("likes", [])
        already_liked = visitor_hash in likes
        if already_liked:
            likes.remove(visitor_hash)
        else:
            likes.append(visitor_hash)
        self._save_index(index)
        return {"ok": True, "likes": len(likes), "liked": not already_liked}

    def get_comments(self, video_id: str) -> List[dict]:
        index = self._load_index()
        videos = index.get("videos", {})
        if video_id not in videos:
            raise KeyError(video_id)
        return list(videos[video_id].get("comments", []))

    def add_comment(self, video_id: str, author: str, text: str) -> dict:
        import uuid

        index = self._load_index()
        videos = index.get("videos", {})
        if video_id not in videos:
            raise KeyError(video_id)
        comment = {
            "id": uuid.uuid4().hex[:8],
            "author": author or "Anonyme",
            "text": text,
            "created_at": time.time(),
        }
        videos[video_id].setdefault("comments", []).append(comment)
        self._save_index(index)
        return {"ok": True, "comment": comment, "comments_count": len(videos[video_id]["comments"])}

    def get_video(self, video_id: str) -> Optional[str]:
        video_path = os.path.join(self._get_community_dir(), f"{video_id}.mp4")
        if not os.path.exists(video_path):
            return None
        return video_path

    def find_published(self, task_id: str) -> Optional[dict]:
        index = self._load_index()
        for vid, meta in (index.get("videos") or {}).items():
            if meta.get("task_id") != task_id:
                continue
            video_path = os.path.join(self._get_community_dir(), f"{vid}.mp4")
            if not os.path.exists(video_path):
                return None
            return {
                "video_id": vid,
                "video_url": f"/api/community/videos/{vid}/video",
                "video_target": video_path,
            }
        return None

    def delete(self, video_id: str, user_id: str = "") -> None:
        index = self._load_index()
        videos = index.get("videos", {})
        if video_id not in videos:
            raise KeyError(video_id)
        owner = (videos[video_id].get("user_id") or "").strip()
        if owner and user_id != owner:
            raise PermissionError("Cette vidéo appartient à un autre créateur : seule la suppression par son créateur est autorisée")
        if not owner:
            raise PermissionError("Créateur non identifiable sur cette publication : suppression par API impossible")
        video_path = os.path.join(self._get_community_dir(), f"{video_id}.mp4")
        if os.path.exists(video_path):
            os.remove(video_path)
        del videos[video_id]
        self._save_index(index)


class LocalTaskStore(TaskStore):
    """Les métadonnées de tâches sont déjà sur le disque local : backend no-op."""

    def upsert_meta(self, meta: dict) -> None:
        pass

    def get_meta(self, task_id: str) -> Optional[dict]:
        return None

    def list_meta(self) -> List[dict]:
        return []

    def delete_meta(self, task_id: str) -> None:
        pass

    def mark_interrupted(self, message: str) -> int:
        return 0
