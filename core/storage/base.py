"""
core/storage/base.py — Interfaces de stockage persistant (galerie communautaire + métadonnées de tâches)

Deux backends implémentent ces interfaces :
- LocalCommunityStore / LocalTaskStore   → système de fichiers (mode développement, comportement historique)
- SupabaseCommunityStore / SupabaseTaskStore → Supabase (Stockage + Postgres, mode production Render)

Le contrat des réponses est volontairement identique à l'ancien code, afin que le
frontend (static/index.html / docs/index.html) continue de fonctionner sans changement
de format (seule la valeur de `video_url` peut devenir une URL publique directe).
"""

from abc import ABC, abstractmethod
from typing import List, Optional


class CommunityStore(ABC):
    """Stockage des vidéos publiées dans la galerie communautaire."""

    @abstractmethod
    def publish(
        self,
        task_id: str,
        author: str,
        prompt: str,
        duration: float,
        resolution: str,
        video_path: str,
        user_id: str = "",
    ) -> dict:
        """Publie une vidéo (upload du fichier + enregistrement des métadonnées).

        user_id : identifiant opaque du créateur ('' pour les publications
        héritées). Sert à réserver la suppression au créateur.

        Returns:
            {"video_id": str, "video_url": str}
        """

    @abstractmethod
    def list_videos(self, page: int = 1, per_page: int = 20) -> dict:
        """Liste les vidéos publiées (les plus récentes d'abord).

        Returns:
            {"videos": [dict], "total": int} — chaque dict contient
            id/title/author/prompt/duration/resolution/published_at/likes/comments_count/video_url/thumbnail
        """

    @abstractmethod
    def get_meta(self, video_id: str) -> Optional[dict]:
        """Retourne les métadonnées d'une vidéo, ou None si inconnue."""

    @abstractmethod
    def toggle_like(self, video_id: str, visitor_hash: str) -> dict:
        """Bascule le like d'un visiteur (identifié par hash).

        Returns:
            {"ok": True, "likes": int, "liked": bool}
        """

    @abstractmethod
    def get_comments(self, video_id: str) -> List[dict]:
        """Retourne les commentaires d'une vidéo (ordre chronologique)."""

    @abstractmethod
    def add_comment(self, video_id: str, author: str, text: str) -> dict:
        """Ajoute un commentaire.

        Returns:
            {"ok": True, "comment": dict, "comments_count": int}
        """

    @abstractmethod
    def get_video(self, video_id: str) -> Optional[str]:
        """Retourne l'URL publique (mode distant) ou le chemin local (mode local)
        du fichier vidéo, ou None si introuvable."""

    @abstractmethod
    def find_published(self, task_id: str) -> Optional[dict]:
        """Retourne la publication la plus récente d'une tâche, ou None.

        Permet de récupérer la vidéo publiée en galerie quand le fichier local
        de la tâche a disparu (système de fichiers éphémère après redéploiement).

        Returns:
            {"video_id": str, "video_url": str, "video_target": str} —
            video_target est l'URL publique (mode distant) ou le chemin local (mode local).
        """

    @abstractmethod
    def delete(self, video_id: str, user_id: str = "") -> None:
        """Supprime la vidéo (fichier + métadonnées + likes + commentaires).

        Seul le créateur de la publication (user_id) peut la supprimer :
        lève PermissionError si l'appelant n'est pas le propriétaire, ou si
        la publication n'a pas de user_id enregistré (créateur non vérifiable).
        """


class TaskStore(ABC):
    """Persistance des métadonnées de tâches (survit aux redéploiements)."""

    @abstractmethod
    def upsert_meta(self, meta: dict) -> None:
        """Écrit (ou met à jour) les métadonnées d'une tâche de façon asynchrone."""

    @abstractmethod
    def get_meta(self, task_id: str) -> Optional[dict]:
        """Retourne les métadonnées persistées d'une tâche, ou None."""

    @abstractmethod
    def list_meta(self) -> List[dict]:
        """Retourne toutes les métadonnées de tâches persistées."""

    @abstractmethod
    def delete_meta(self, task_id: str) -> None:
        """Supprime les métadonnées persistées d'une tâche."""

    @abstractmethod
    def mark_interrupted(self, message: str) -> int:
        """Marque les tâches running/queued comme interrompues après un redémarrage.

        Returns:
            Nombre de tâches mises à jour.
        """
