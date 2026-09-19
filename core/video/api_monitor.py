"""
core/video/api_monitor.py — Monitoring API et métriques (v8.0)

Collecte des métriques d'API pour le monitoring complet :
  - Temps de génération
  - Temps d'upload
  - Temps d'API
  - Temps d'IA
  - Consommation mémoire
  - Consommation GPU
  - Logs complets

Usage::

    from core.video.api_monitor import APIMonitor

    monitor = APIMonitor()
    with monitor.track_api_call("submit_video"):
        ...
    metrics = monitor.get_summary()
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class APICallMetrics:
    """Métriques pour un appel API."""
    name: str
    start_time: float = 0.0
    end_time: float = 0.0
    duration: float = 0.0
    status: str = "pending"  # pending | success | failed
    error: Optional[str] = None
    request_size: int = 0
    response_size: int = 0


@dataclass
class GenerationMetrics:
    """Métriques complètes pour une génération."""
    task_id: str
    created_at: float = field(default_factory=time.time)
    api_calls: dict[str, APICallMetrics] = field(default_factory=dict)
    total_duration: float = 0.0
    memory_peak_mb: float = 0.0
    gpu_util_peak: float = 0.0
    status: str = "pending"
    stages: dict = field(default_factory=dict)


class APIMonitor:
    """Moniteur d'API pour la collecte de métriques complètes.

    Conçu pour être léger et non bloquant.
    """

    def __init__(self, log_dir: str = "error_logs"):
        self._tasks: dict[str, GenerationMetrics] = {}
        self._log_dir = log_dir

    def create_task(self, task_id: str) -> GenerationMetrics:
        """Crée un suivi de métriques pour une nouvelle tâche."""
        metrics = GenerationMetrics(task_id=task_id)
        self._tasks[task_id] = metrics
        return metrics

    def start_api_call(self, task_id: str, call_name: str) -> APICallMetrics:
        """Démarre le chronométrage d'un appel API."""
        task = self._tasks.get(task_id)
        if not task:
            task = self.create_task(task_id)

        call = APICallMetrics(name=call_name, start_time=time.time(), status="running")
        task.api_calls[call_name] = call
        logger.info(f"[APIMonitor] API call '{call_name}' started for task {task_id}")
        return call

    def end_api_call(
        self, task_id: str, call_name: str,
        status: str = "success", error: Optional[str] = None,
        request_size: int = 0, response_size: int = 0,
    ) -> None:
        """Termine le chronométrage d'un appel API."""
        task = self._tasks.get(task_id)
        if not task:
            return

        call = task.api_calls.get(call_name)
        if not call:
            return

        call.end_time = time.time()
        call.duration = call.end_time - call.start_time
        call.status = status
        call.error = error
        call.request_size = request_size
        call.response_size = response_size

        logger.info(
            f"[APIMonitor] API call '{call_name}' {status} in {call.duration:.2f}s "
            f"(req={request_size}B, resp={response_size}B)"
        )

    def record_stage(self, task_id: str, stage_name: str, duration: float,
                     status: str = "completed", extra: Optional[dict] = None) -> None:
        """Enregistre les métriques d'une étape du pipeline."""
        task = self._tasks.get(task_id)
        if not task:
            task = self.create_task(task_id)

        task.stages[stage_name] = {
            "duration": duration,
            "status": status,
            "extra": extra or {},
        }

    def sample_memory(self) -> float:
        """Échantillonne l'utilisation mémoire (MB)."""
        try:
            import psutil
            process = psutil.Process(os.getpid())
            return process.memory_info().rss / (1024 * 1024)
        except ImportError:
            return 0.0

    def sample_gpu(self) -> float:
        """Échantillonne l'utilisation GPU (%)."""
        try:
            import GPUtil
            gpus = GPUtil.getGPUs()
            if gpus:
                return gpus[0].load * 100
        except ImportError:
            pass
        return 0.0

    def finalize_task(self, task_id: str, status: str = "completed") -> GenerationMetrics:
        """Finalise les métriques d'une tâche."""
        task = self._tasks.get(task_id)
        if not task:
            return None

        task.status = status
        task.total_duration = sum(c.duration for c in task.api_calls.values())
        task.memory_peak_mb = self.sample_memory()
        task.gpu_util_peak = self.sample_gpu()

        logger.info(
            f"[APIMonitor] Task {task_id} {status} in {task.total_duration:.2f}s "
            f"(mem={task.memory_peak_mb:.0f}MB, gpu={task.gpu_util_peak:.0f}%)"
        )

        self._save_metrics(task)
        return task

    def _save_metrics(self, task: GenerationMetrics) -> None:
        """Sauvegarde les métriques dans un fichier JSON."""
        try:
            os.makedirs(self._log_dir, exist_ok=True)
            filepath = os.path.join(self._log_dir, f"api_metrics_{task.task_id}.json")
            data = {
                "task_id": task.task_id,
                "created_at": task.created_at,
                "total_duration": task.total_duration,
                "memory_peak_mb": task.memory_peak_mb,
                "gpu_util_peak": task.gpu_util_peak,
                "status": task.status,
                "api_calls": {
                    name: {
                        "duration": c.duration,
                        "status": c.status,
                        "error": c.error,
                        "request_size": c.request_size,
                        "response_size": c.response_size,
                    }
                    for name, c in task.api_calls.items()
                },
                "stages": task.stages,
            }
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.debug(f"[APIMonitor] Failed to save metrics: {e}")

    def get_summary(self) -> dict:
        """Retourne un résumé de toutes les métriques."""
        return {
            "total_tasks": len(self._tasks),
            "completed": sum(1 for t in self._tasks.values() if t.status == "completed"),
            "failed": sum(1 for t in self._tasks.values() if t.status == "failed"),
            "avg_duration": sum(t.total_duration for t in self._tasks.values()) / len(self._tasks) if self._tasks else 0,
            "tasks": [t.to_dict() if hasattr(t, 'to_dict') else {} for t in self._tasks.values()],
        }

    def track_api_call(self, task_id: str, call_name: str):
        """Context manager pour chronométrer un appel API.

        Usage::

            with monitor.track_api_call("task_123", "submit_video"):
                ...
        """
        return _APICallTracker(self, task_id, call_name)


class _APICallTracker:
    """Context manager pour le chronométrage d'un appel API."""

    def __init__(self, monitor: APIMonitor, task_id: str, call_name: str):
        self.monitor = monitor
        self.task_id = task_id
        self.call_name = call_name

    def __enter__(self):
        self.monitor.start_api_call(self.task_id, self.call_name)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        status = "failed" if exc_type else "success"
        error = str(exc_val) if exc_val else None
        self.monitor.end_api_call(self.task_id, self.call_name, status, error)
        return False
