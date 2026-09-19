"""
core/video/gpu_optimizer.py — Optimisation GPU (v8.0)

Gestion intelligente des ressources GPU :
  - Surveillance VRAM
  - Optimisation de batch
  - Réutilisation des modèles (cache)
  - Gestion de la mémoire

Usage::

    from core.video.gpu_optimizer import GPUOptimizer

    opt = GPUOptimizer()
    batch_size = opt.recommend_batch_size(model_size="7B")
    if opt.should_reload_model():
        model = load_model()
"""

from __future__ import annotations

import gc
import logging
import os
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class GPUInfo:
    """Informations sur le GPU."""
    total_vram_mb: float = 0.0
    used_vram_mb: float = 0.0
    free_vram_mb: float = 0.0
    utilization: float = 0.0  # pourcentage
    temperature: float = 0.0  # degrés Celsius


class GPUOptimizer:
    """Optimiseur de ressources GPU.

    Conçu pour fonctionner avec ou sans GPU dédié (CPU fallback).
    """

    def __init__(self):
        self._model_cache: dict[str, object] = {}
        self._last_gpu_info: Optional[GPUInfo] = None

    def get_gpu_info(self) -> Optional[GPUInfo]:
        """Récupère les informations du GPU.

        Returns:
            GPUInfo ou None si pas de GPU disponible.
        """
        try:
            import GPUtil
            gpus = GPUtil.getGPUs()
            if not gpus:
                return None
            gpu = gpus[0]
            info = GPUInfo(
                total_vram_mb=gpu.memoryTotal,
                used_vram_mb=gpu.memoryUsed,
                free_vram_mb=gpu.memoryFree,
                utilization=gpu.load * 100,
                temperature=gpu.temperature,
            )
            self._last_gpu_info = info
            return info
        except ImportError:
            logger.debug("[GPUOptimizer] GPUtil not available")
            return None
        except Exception as e:
            logger.debug(f"[GPUOptimizer] GPU info failed: {e}")
            return None

    def recommend_batch_size(self, model_size: str = "7B") -> int:
        """Recommande une taille de batch selon le modèle et la VRAM disponible.

        Args:
            model_size: Taille du modèle (1B, 3B, 7B, 13B, 30B, 70B).

        Returns:
            Taille de batch recommandée.
        """
        info = self.get_gpu_info()
        if not info:
            # CPU fallback : batch de 1
            return 1

        # Estimation de la VRAM nécessaire par modèle (en MB)
        model_vram = {
            "1B": 2048,
            "3B": 4096,
            "7B": 8192,
            "13B": 16384,
            "30B": 32768,
            "70B": 81920,
        }
        required = model_vram.get(model_size, 8192)
        available = info.free_vram_mb

        if available < required:
            return 1  # pas assez de VRAM

        # Calculer le batch size : (VRAM disponible - modèle) / overhead par batch
        overhead_per_batch = 512  # MB estimé
        batch = max(1, int((available - required) / overhead_per_batch))
        return min(batch, 8)  # plafond à 8

    def should_reload_model(self, model_name: str, force: bool = False) -> bool:
        """Détermine s'il faut recharger un modèle.

        Args:
            model_name: Nom du modèle.
            force: Forcer le rechargement.

        Returns:
            True si le modèle doit être rechargé.
        """
        if force:
            self._model_cache.pop(model_name, None)
            return True

        # Vérifier si le modèle est en cache
        if model_name not in self._model_cache:
            return True

        # Vérifier la VRAM disponible
        info = self.get_gpu_info()
        if info and info.free_vram_mb < 2048:
            # Pas assez de VRAM : libérer le cache
            self.clear_cache()
            return True

        return False

    def cache_model(self, model_name: str, model: object) -> None:
        """Met en cache un modèle chargé.

        Args:
            model_name: Nom du modèle.
            model: Instance du modèle.
        """
        self._model_cache[model_name] = model
        logger.info(f"[GPUOptimizer] Model cached: {model_name}")

    def get_cached_model(self, model_name: str) -> Optional[object]:
        """Récupère un modèle du cache.

        Args:
            model_name: Nom du modèle.

        Returns:
            Le modèle ou None si absent.
        """
        return self._model_cache.get(model_name)

    def clear_cache(self) -> int:
        """Vide le cache des modèles.

        Returns:
            Nombre de modèles libérés.
        """
        count = len(self._model_cache)
        self._model_cache.clear()
        gc.collect()
        logger.info(f"[GPUOptimizer] Cache cleared ({count} models freed)")
        return count

    def optimize_memory(self) -> dict:
        """Optimise l'utilisation mémoire.

        Returns:
            Statistiques d'optimisation.
        """
        info = self.get_gpu_info()
        freed = self.clear_cache()

        return {
            "models_freed": freed,
            "gpu_info": info.__dict__ if info else None,
            "memory_reclaimed": "cache cleared",
        }

    def get_stats(self) -> dict:
        """Retourne les statistiques d'utilisation GPU."""
        info = self.get_gpu_info()
        return {
            "gpu_available": info is not None,
            "cached_models": len(self._model_cache),
            "gpu_info": info.__dict__ if info else None,
        }
