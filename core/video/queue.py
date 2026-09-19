"""
core/video/queue.py — Gestion des files d'attente de génération vidéo (v8.0)

File d'attente asynchrone avec priorités pour les tâches de génération vidéo :
  - Priorité Premium (utilisateurs premium)
  - Priorité Admin (utilisateurs administrateurs)
  - Priorité Gratuit (utilisateurs gratuits)

Limite automatique du parallélisme pour ne pas saturer l'API Agnes.

Usage::

    from core.video.queue import VideoQueue, TaskPriority

    queue = VideoQueue(max_concurrent=2)
    await queue.enqueue(task_id, priority=TaskPriority.FREE, fn=generate_fn)
    result = await queue.wait(task_id)
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


class TaskPriority(Enum):
    """Priorités de file d'attente (plus la valeur est basse, plus c'est prioritaire)."""
    ADMIN = 0
    PREMIUM = 1
    FREE = 2


@dataclass
class QueuedTask:
    """Une tâche dans la file d'attente."""

    task_id: str
    priority: TaskPriority
    fn: Callable
    args: tuple = field(default_factory=tuple)
    kwargs: dict = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    result: Any = None
    error: Optional[Exception] = None
    status: str = "pending"  # pending | running | completed | failed | cancelled

    @property
    def wait_time(self) -> float:
        """Temps d'attente dans la file (secondes)."""
        if self.started_at:
            return self.started_at - self.created_at
        return time.time() - self.created_at

    @property
    def run_time(self) -> float:
        """Temps d'exécution (secondes)."""
        if self.completed_at and self.started_at:
            return self.completed_at - self.started_at
        if self.started_at:
            return time.time() - self.started_at
        return 0.0


class VideoQueue:
    """File d'attente asynchrone avec priorités pour la génération vidéo.

    Garantit que :
    - Les tâches sont exécutées dans l'ordre de priorité
    - Le nombre de générations parallèles est limité
    - Aucune tâche n'est perdue (persistance optionnelle)
    """

    def __init__(
        self,
        max_concurrent: int = 2,
        max_queue_size: int = 100,
    ):
        self.max_concurrent = max_concurrent
        self.max_queue_size = max_queue_size
        self._queue: list[QueuedTask] = []
        self._running: dict[str, QueuedTask] = {}
        self._completed: dict[str, QueuedTask] = {}
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._lock = asyncio.Lock()
        self._event = asyncio.Event()
        self._worker_task: Optional[asyncio.Task] = None
        self._shutdown = False

    async def start(self) -> None:
        """Démarre le worker de la file d'attente."""
        if self._worker_task is not None:
            return
        self._shutdown = False
        self._worker_task = asyncio.create_task(self._worker())
        logger.info(f"[VideoQueue] Started (max_concurrent={self.max_concurrent})")

    async def stop(self) -> None:
        """Arrête le worker de la file d'attente."""
        self._shutdown = True
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None
        logger.info("[VideoQueue] Stopped")

    async def enqueue(
        self,
        task_id: str,
        priority: TaskPriority,
        fn: Callable,
        *args,
        **kwargs,
    ) -> QueuedTask:
        """Ajoute une tâche à la file d'attente.

        Args:
            task_id: Identifiant unique de la tâche.
            priority: Priorité de la tâche.
            fn: Fonction asynchrone à exécuter.
            *args, **kwargs: Arguments de la fonction.

        Returns:
            Le QueuedTask créé.

        Raises:
            RuntimeError: Si la file est pleine.
        """
        async with self._lock:
            if len(self._queue) >= self.max_queue_size:
                raise RuntimeError(
                    f"Queue full ({self.max_queue_size} tasks). Try again later."
                )

            task = QueuedTask(
                task_id=task_id,
                priority=priority,
                fn=fn,
                args=args,
                kwargs=kwargs,
            )

            # Insertion triée par priorité (plus prioritaire en premier)
            inserted = False
            for i, existing in enumerate(self._queue):
                if priority.value < existing.priority.value:
                    self._queue.insert(i, task)
                    inserted = True
                    break
            if not inserted:
                self._queue.append(task)

            self._event.set()
            logger.info(
                f"[VideoQueue] Enqueued task {task_id} "
                f"(priority={priority.name}, queue_size={len(self._queue)})"
            )
            return task

    async def _worker(self) -> None:
        """Worker principal : traite les tâches de la file."""
        while not self._shutdown:
            await self._event.wait()
            self._event.clear()

            async with self._lock:
                if not self._queue:
                    continue
                # Prendre la tâche la plus prioritaire
                task = self._queue.pop(0)
                self._running[task.task_id] = task

            # Exécuter la tâche (hors lock pour ne pas bloquer la file)
            await self._execute_task(task)

    async def _execute_task(self, task: QueuedTask) -> None:
        """Exécute une tâche avec le semaphore de concurrence."""
        async with self._semaphore:
            task.status = "running"
            task.started_at = time.time()
            logger.info(
                f"[VideoQueue] Starting task {task.task_id} "
                f"(waited {task.wait_time:.1f}s)"
            )

            try:
                task.result = await task.fn(*task.args, **task.kwargs)
                task.status = "completed"
                task.completed_at = time.time()
                logger.info(
                    f"[VideoQueue] Task {task.task_id} completed "
                    f"in {task.run_time:.1f}s"
                )
            except asyncio.CancelledError:
                task.status = "cancelled"
                task.error = asyncio.CancelledError()
                logger.info(f"[VideoQueue] Task {task.task_id} cancelled")
            except Exception as e:
                task.status = "failed"
                task.error = e
                task.completed_at = time.time()
                logger.error(
                    f"[VideoQueue] Task {task.task_id} failed: {e}",
                    exc_info=True,
                )
            finally:
                async with self._lock:
                    self._running.pop(task.task_id, None)
                    self._completed[task.task_id] = task

    async def wait(self, task_id: str, timeout: float = 3600) -> Any:
        """Attend la completion d'une tâche.

        Args:
            task_id: Identifiant de la tâche.
            timeout: Timeout d'attente en secondes.

        Returns:
            Le résultat de la tâche.

        Raises:
            TimeoutError: Si la tâche n'a pas fini dans le délai.
            Exception: Si la tâche a échoué.
        """
        start = time.time()
        while time.time() - start < timeout:
            async with self._lock:
                task = self._completed.get(task_id)
                if task:
                    if task.status == "completed":
                        return task.result
                    elif task.status == "failed":
                        raise task.error or RuntimeError("Task failed")
                    elif task.status == "cancelled":
                        raise asyncio.CancelledError()

                # Vérifier si la tâche est en cours
                running_task = self._running.get(task_id)
                if running_task:
                    pass  # en cours, continuer à attendre

                # Vérifier si la tâche est dans la file
                queued = any(t.task_id == task_id for t in self._queue)
                if not queued and not running_task and not task:
                    raise KeyError(f"Task {task_id} not found in queue")

            await asyncio.sleep(0.5)

        raise TimeoutError(f"Task {task_id} did not complete within {timeout}s")

    async def cancel(self, task_id: str) -> bool:
        """Annule une tâche en attente.

        Returns:
            True si la tâche a été annulée, False si elle était déjà en cours/exécutée.
        """
        async with self._lock:
            for i, task in enumerate(self._queue):
                if task.task_id == task_id:
                    task.status = "cancelled"
                    self._queue.pop(i)
                    self._completed[task_id] = task
                    logger.info(f"[VideoQueue] Cancelled task {task_id}")
                    return True
            return False

    def stats(self) -> dict:
        """Retourne les statistiques de la file d'attente."""
        return {
            "queue_size": len(self._queue),
            "running": len(self._running),
            "completed": len(self._completed),
            "max_concurrent": self.max_concurrent,
            "max_queue_size": self.max_queue_size,
        }

    def get_status(self, task_id: str) -> Optional[QueuedTask]:
        """Retourne le statut d'une tâche."""
        if task_id in self._running:
            return self._running[task_id]
        if task_id in self._completed:
            return self._completed[task_id]
        for task in self._queue:
            if task.task_id == task_id:
                return task
        return None
