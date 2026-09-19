"""
core/storage — Couche de stockage persistant (galerie communautaire + métadonnées de tâches)

Sélection automatique du backend selon l'environnement :
- variables SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY définies → Supabase (persistant, Render)
- sinon → système de fichiers local (développement, comportement historique)

Usage (server.py) :
    from core.storage import get_community_store, get_task_store, init_persistent_storage
    store = get_community_store()
    result = store.publish(...)
"""

import logging
import time
from typing import Optional

from .base import CommunityStore, TaskStore
from . import local_backend, supabase_backend

logger = logging.getLogger(__name__)

_community_store: Optional[CommunityStore] = None
_task_store: Optional[TaskStore] = None


def storage_mode() -> str:
    """'supabase' si le stockage persistant est configuré, sinon 'local'."""
    return "supabase" if supabase_backend.is_configured() else "local"


def is_persistent_storage() -> bool:
    return storage_mode() == "supabase"


def init_persistent_storage() -> None:
    """Initialise le backend persistant (schéma + bucket). Best-effort : les
    erreurs sont loguées sans bloquer le démarrage du serveur."""
    if not is_persistent_storage():
        logger.info("[Storage] Mode local (aucune config Supabase détectée).")
        return
    try:
        supabase_backend.ensure_schema()
    except Exception as e:
        logger.error(f"[Storage] Initialisation du schéma impossible: {e}")
    try:
        supabase_backend.ensure_bucket(supabase_backend._get_client())
    except Exception as e:
        logger.error(f"[Storage] Initialisation du bucket impossible: {e}")
    try:
        n = get_task_store().mark_interrupted(
            "Interrompu: le serveur a redémarré (état restauré depuis la base)"
        )
        if n:
            logger.info(f"[Storage] {n} tâche(s) marquée(s) interrompue(s).")
    except Exception as e:
        logger.warning(f"[Storage] Marquage des tâches interrompues impossible: {e}")
    try:
        from core.config import restore_config_from_storage

        restore_config_from_storage()
    except Exception as e:
        logger.warning(f"[Storage] Restauration de la configuration impossible: {e}")


def get_community_store() -> CommunityStore:
    global _community_store
    if _community_store is None:
        if is_persistent_storage():
            _community_store = supabase_backend.SupabaseCommunityStore()
        else:
            _community_store = local_backend.LocalCommunityStore()
        logger.info(f"[Storage] CommunityStore initialisé (mode={storage_mode()}).")
    return _community_store


def get_task_store() -> TaskStore:
    global _task_store
    if _task_store is None:
        if is_persistent_storage():
            _task_store = supabase_backend.SupabaseTaskStore()
        else:
            _task_store = local_backend.LocalTaskStore()
    return _task_store


def export_meta(state, dir_name: str) -> dict:
    """Extrait les métadonnées persistables d'un état de tâche (BaseTaskState)."""
    task_type = getattr(state, "task_type", None)
    status = getattr(state, "status", None)
    prompt = ""
    if hasattr(state, "prompt"):
        prompt = state.prompt or ""
    elif hasattr(state, "idea"):
        prompt = state.idea or ""
    elif hasattr(state, "manuscript_text"):
        prompt = state.manuscript_text or ""
    elif hasattr(state, "script_text"):
        prompt = state.script_text or ""
    elif hasattr(state, "poem_text"):
        prompt = state.poem_text or ""
    now = time.time()
    return {
        "task_id": getattr(state, "task_id", "") or "",
        "dir_name": dir_name or "",
        "task_type": task_type.value if hasattr(task_type, "value") else str(task_type or ""),
        "creative_name": getattr(state, "creative_name", "") or "",
        "user_id": getattr(state, "user_id", "") or "",
        "status": status.value if hasattr(status, "value") else str(status or "pending"),
        "prompt": (prompt or "")[:500],
        "current_message": getattr(state, "current_message", "") or "",
        "final_video_file": getattr(state, "final_video_file", "") or "",
        "created_at": _created_at_from_dir(dir_name),
        "updated_at": now,
    }


def _created_at_from_dir(dir_name: str) -> Optional[float]:
    """Timestamp de création estimé depuis 'YYYYMMDD_HHMMSS_xxx' (ou None)."""
    from .supabase_backend import _dir_name_to_ts

    return _dir_name_to_ts(dir_name)
