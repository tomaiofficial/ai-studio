"""
core/video/monitoring.py — Monitoring et métriques (v8.0)

Collecte des métriques de performance pour la génération vidéo :
  - Temps de génération (API, upscaling, audio, compression)
  - Temps d'upload
  - Consommation mémoire
  - Consommation GPU (si disponible)
  - Logs structurés

Usage::

    from core.video.monitoring import VideoMonitor

    monitor = VideoMonitor()
    with monitor.track("video_generation"):
        ...
    metrics = monitor.get_metrics()
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class StageMetrics:
    """Métriques pour une étape du pipeline."""

    name: str
    start_time: float = 0.0
    end_time: float = 0.0
    duration: float = 0.0
    status: str = "pending"  # pending | running | completed | failed
    error: Optional[str] = None
    extra: dict = field(default_factory=dict)


@dataclass
class TaskMetrics:
    """Métriques complètes pour une tâche de génération."""

    task_id: str
    created_at: float = field(default_factory=time.time)
    stages: dict[str, StageMetrics] = field(default_factory=dict)
    total_duration: float = 0.0
    memory_peak_mb: float = 0.0
    gpu_util_peak: float = 0.0
    status: str = "pending"

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "created_at": self.created_at,
            "total_duration": self.total_duration,
            "memory_peak_mb": self.memory_peak_mb,
            "gpu_util_peak": self.gpu_util_peak,
            "status": self.status,
            "stages": {
                name: {
                    "duration": s.duration,
                    "status": s.status,
                    "error": s.error,
                    "extra": s.extra,
                }
                for name, s in self.stages.items()
            },
        }


class VideoMonitor:
    """Collecteur de métriques pour la génération vidéo.

    Conçu pour être léger et non bloquant. Les métriques sont stockées
    en mémoire et peuvent être exportées vers un backend (Prometheus, etc.).
    """

    def __init__(self, log_dir: str = "error_logs"):
        self._tasks: dict[str, TaskMetrics] = {}
        self._log_dir = log_dir
        self._memory_samples: list[float] = []
        self._gpu_samples: list[float] = []

    def create_task(self, task_id: str) -> TaskMetrics:
        """Crée un suivi de métriques pour une nouvelle tâche."""
        metrics = TaskMetrics(task_id=task_id)
        self._tasks[task_id] = metrics
        return metrics

    def start_stage(self, task_id: str, stage_name: str) -> StageMetrics:
        """Démarre le chronométrage d'une étape."""
        task = self._tasks.get(task_id)
        if not task:
            task = self.create_task(task_id)

        stage = StageMetrics(name=stage_name, start_time=time.time(), status="running")
        task.stages[stage_name] = stage
        logger.info(f"[Monitor] Stage '{stage_name}' started for task {task_id}")
        return stage

    def end_stage(self, task_id: str, stage_name: str, status: str = "completed",
                  error: Optional[str] = None, extra: Optional[dict] = None) -> None:
        """Termine le chronométrage d'une étape."""
        task = self._tasks.get(task_id)
        if not task:
            return

        stage = task.stages.get(stage_name)
        if not stage:
            return

        stage.end_time = time.time()
        stage.duration = stage.end_time - stage.start_time
        stage.status = status
        stage.error = error
        if extra:
            stage.extra.update(extra)

        logger.info(
            f"[Monitor] Stage '{stage_name}' {status} in {stage.duration:.2f}s "
            f"for task {task_id}"
        )

    def sample_memory(self) -> float:
        """Échantillonne l'utilisation mémoire actuelle (MB)."""
        try:
            import psutil
            process = psutil.Process(os.getpid())
            mem_mb = process.memory_info().rss / (1024 * 1024)
            self._memory_samples.append(mem_mb)
            return mem_mb
        except ImportError:
            return 0.0

    def sample_gpu(self) -> float:
        """Échantillonne l'utilisation GPU (pourcentage)."""
        try:
            import GPUtil
            gpus = GPUtil.getGPUs()
            if gpus:
                util = gpus[0].load * 100
                self._gpu_samples.append(util)
                return util
        except ImportError:
            pass
        return 0.0

    def finalize_task(self, task_id: str, status: str = "completed") -> TaskMetrics:
        """Finalise les métriques d'une tâche."""
        task = self._tasks.get(task_id)
        if not task:
            return None

        task.status = status
        task.total_duration = sum(s.duration for s in task.stages.values())
        task.memory_peak_mb = max(self._memory_samples) if self._memory_samples else 0.0
        task.gpu_util_peak = max(self._gpu_samples) if self._gpu_samples else 0.0

        # Log structuré
        logger.info(
            f"[Monitor] Task {task_id} {status} in {task.total_duration:.2f}s "
            f"(peak_mem={task.memory_peak_mb:.0f}MB, peak_gpu={task.gpu_util_peak:.0f}%)"
        )

        # Sauvegarder les métriques
        self._save_metrics(task)

        return task

    def _save_metrics(self, task: TaskMetrics) -> None:
        """Sauvegarde les métriques dans un fichier JSON."""
        try:
            os.makedirs(self._log_dir, exist_ok=True)
            filepath = os.path.join(self._log_dir, f"metrics_{task.task_id}.json")
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(task.to_dict(), f, indent=2)
        except Exception as e:
            logger.debug(f"[Monitor] Failed to save metrics: {e}")

    def get_metrics(self, task_id: str) -> Optional[dict]:
        """Retourne les métriques d'une tâche."""
        task = self._tasks.get(task_id)
        return task.to_dict() if task else None

    def get_all_metrics(self) -> list[dict]:
        """Retourne les métriques de toutes les tâches."""
        return [t.to_dict() for t in self._tasks.values()]

    def track(self, task_id: str, stage_name: str):
        """Context manager pour chronométrer une étape.

        Usage::

            with monitor.track("task_123", "upscaling"):
                ...
        """
        return _StageTracker(self, task_id, stage_name)


class _StageTracker:
    """Context manager pour le chronométrage d'une étape."""

    def __init__(self, monitor: VideoMonitor, task_id: str, stage_name: str):
        self.monitor = monitor
        self.task_id = task_id
        self.stage_name = stage_name

    def __enter__(self):
        self.monitor.start_stage(self.task_id, self.stage_name)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        status = "failed" if exc_type else "completed"
        error = str(exc_val) if exc_val else None
        self.monitor.end_stage(self.task_id, self.stage_name, status, error)
        return False  # ne pas supprimer l'exception
