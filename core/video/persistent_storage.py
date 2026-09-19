"""
core/video/persistent_storage.py — Stockage persistant renforcé (v8.0)

Garantit que toutes les vidéos et images générées sont stockées dans un
stockage persistant (Supabase Storage / S3) et jamais perdues après un
redéploiement Render.

Fonctionnalités :
  - Upload systématique des vidéos vers le stockage persistant
  - Vérification d'existence du fichier avant traitement
  - Récupération automatique depuis le stockage si le fichier local est manquant
  - Cache local pour les accès fréquents

Usage::

    from core.video.persistent_storage import PersistentStorage

    storage = PersistentStorage()
    url = await storage.upload_video("task123", "/path/to/video.mp4")
    path = await storage.ensure_local_copy("task123", url)
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
from typing import Optional

from core.storage import get_community_store, is_persistent_storage
from core.storage.supabase_backend import SUPABASE_STORAGE_BUCKET, _get_client

logger = logging.getLogger(__name__)


class PersistentStorage:
    """Gestionnaire de stockage persistant pour vidéos et images.

    Wrapper autour du backend Supabase existant avec :
    - Vérification d'existence avant traitement
    - Upload systématique
    - Récupération automatique
    """

    def __init__(self):
        self._local_cache_dir = os.path.join(
            os.environ.get("AGNES_WORKING_DIR", ".working_dir"),
            "persistent_cache"
        )
        os.makedirs(self._local_cache_dir, exist_ok=True)

    @property
    def is_persistent(self) -> bool:
        """True si un backend persistant (Supabase) est configuré."""
        return is_persistent_storage()

    async def upload_video(
        self,
        task_id: str,
        video_path: str,
        prompt: str = "",
        duration: float = 0,
        resolution: str = "",
        user_id: str = "",
    ) -> str:
        """Upload une vidéo vers le stockage persistant.

        Args:
            task_id: ID de la tâche.
            video_path: Chemin local de la vidéo.
            prompt: Prompt associé.
            duration: Durée en secondes.
            resolution: Résolution.
            user_id: ID utilisateur.

        Returns:
            URL publique de la vidéo.
        """
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video not found: {video_path}")

        if not self.is_persistent:
            logger.warning("[PersistentStorage] No persistent backend, keeping local file")
            return video_path

        try:
            store = get_community_store()
            result = store.publish(
                task_id=task_id,
                author="Agnes IA",
                prompt=prompt,
                duration=duration,
                resolution=resolution,
                video_path=video_path,
                user_id=user_id,
            )
            url = result.get("video_url", "")
            logger.info(f"[PersistentStorage] Video uploaded: {url[:80]}...")
            return url
        except Exception as e:
            logger.error(f"[PersistentStorage] Upload failed: {e}")
            # En cas d'échec, conserver le fichier local
            return video_path

    async def ensure_local_copy(self, task_id: str, video_url: str) -> Optional[str]:
        """S'assure qu'une copie locale de la vidéo existe.

        Si le fichier local est manquant mais l'URL est disponible,
        télécharge depuis le stockage persistant.

        Args:
            task_id: ID de la tâche.
            video_url: URL publique de la vidéo.

        Returns:
            Chemin local du fichier, ou None si introuvable.
        """
        # Vérifier le cache local
        cache_path = os.path.join(self._local_cache_dir, f"{task_id}.mp4")
        if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
            return cache_path

        # Vérifier le working_dir classique
        working_dir = os.environ.get("AGNES_WORKING_DIR", ".working_dir")
        local_path = os.path.join(working_dir, task_id, "final_video.mp4")
        if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
            # Copier vers le cache
            try:
                shutil.copy2(local_path, cache_path)
            except Exception:
                pass
            return local_path

        # Télécharger depuis l'URL persistante
        if video_url and video_url.startswith(("http://", "https://")):
            try:
                import urllib.request
                logger.info(f"[PersistentStorage] Downloading video from {video_url[:80]}...")
                urllib.request.urlretrieve(video_url, cache_path)
                if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
                    return cache_path
            except Exception as e:
                logger.error(f"[PersistentStorage] Download failed: {e}")

        return None

    async def verify_file_exists(self, file_path: str) -> bool:
        """Vérifie qu'un fichier existe et n'est pas vide.

        Args:
            file_path: Chemin du fichier à vérifier.

        Returns:
            True si le fichier existe et a une taille > 0.
        """
        if not file_path:
            return False
        if os.path.exists(file_path):
            return os.path.getsize(file_path) > 0
        return False

    def get_file_hash(self, file_path: str) -> Optional[str]:
        """Calcule le hash SHA256 d'un fichier (pour déduplication)."""
        if not os.path.exists(file_path):
            return None
        h = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    h.update(chunk)
            return h.hexdigest()
        except Exception:
            return None

    async def cleanup_local(self, task_id: str, keep_days: int = 7) -> int:
        """Nettoie les fichiers locaux anciens (garde le cache persistant).

        Args:
            task_id: ID de la tâche.
            keep_days: Nombre de jours à garder les fichiers locaux.

        Returns:
            Nombre de fichiers supprimés.
        """
        if not self.is_persistent:
            return 0  # Ne pas nettoyer si pas de stockage persistant

        working_dir = os.environ.get("AGNES_WORKING_DIR", ".working_dir")
        task_dir = os.path.join(working_dir, task_id)
        if not os.path.exists(task_dir):
            return 0

        removed = 0
        cutoff = os.path.getmtime(task_dir)  # garder le dossier de la tâche
        import time
        cutoff_time = time.time() - (keep_days * 86400)

        for root, dirs, files in os.walk(task_dir):
            for f in files:
                if f in ("final_video.mp4", "task_state.json"):
                    continue  # toujours garder
                filepath = os.path.join(root, f)
                try:
                    if os.path.getmtime(filepath) < cutoff_time:
                        os.remove(filepath)
                        removed += 1
                except Exception:
                    pass

        return removed
