"""Tests pour core/video/monitoring.py"""
import pytest
from core.video.monitoring import VideoMonitor, TaskMetrics, StageMetrics


def test_monitor_create_task():
    """Vérifie la création d'une tâche de monitoring."""
    monitor = VideoMonitor()
    task = monitor.create_task("task123")
    assert task.task_id == "task123"
    assert task.status == "pending"
    assert len(task.stages) == 0


def test_monitor_start_end_stage():
    """Test du chronométrage d'une étape."""
    monitor = VideoMonitor()
    monitor.create_task("task1")

    stage = monitor.start_stage("task1", "generation")
    assert stage.status == "running"
    assert stage.start_time > 0

    import time
    time.sleep(0.1)

    monitor.end_stage("task1", "generation", status="completed")
    task = monitor._tasks["task1"]
    assert task.stages["generation"].status == "completed"
    assert task.stages["generation"].duration > 0


def test_monitor_finalize():
    """Test de la finalisation d'une tâche."""
    monitor = VideoMonitor()
    monitor.create_task("task1")

    monitor.start_stage("task1", "step1")
    monitor.end_stage("task1", "step1", status="completed")

    monitor.start_stage("task1", "step2")
    monitor.end_stage("task1", "step2", status="completed")

    task = monitor.finalize_task("task1", status="completed")
    assert task.status == "completed"
    assert task.total_duration > 0


def test_monitor_get_metrics():
    """Test de la récupération des métriques."""
    monitor = VideoMonitor()
    monitor.create_task("task1")
    monitor.start_stage("task1", "step1")
    monitor.end_stage("task1", "step1", status="completed")
    monitor.finalize_task("task1", status="completed")

    metrics = monitor.get_metrics("task1")
    assert metrics is not None
    assert metrics["task_id"] == "task1"
    assert metrics["status"] == "completed"
    assert "step1" in metrics["stages"]


def test_monitor_track_context_manager():
    """Test du context manager track()."""
    monitor = VideoMonitor()
    monitor.create_task("task1")

    with monitor.track("task1", "test_stage"):
        pass

    task = monitor._tasks["task1"]
    assert "test_stage" in task.stages
    assert task.stages["test_stage"].status == "completed"


def test_monitor_sample_memory():
    """Test de l'échantillonnage mémoire."""
    monitor = VideoMonitor()
    mem = monitor.sample_memory()
    # psutil peut ne pas être installé → 0.0
    assert mem >= 0.0


def test_monitor_sample_gpu():
    """Test de l'échantillonnage GPU."""
    monitor = VideoMonitor()
    gpu = monitor.sample_gpu()
    # GPUtil peut ne pas être installé → 0.0
    assert gpu >= 0.0


def test_monitor_get_all_metrics():
    """Test de la récupération de toutes les métriques."""
    monitor = VideoMonitor()
    monitor.create_task("task1")
    monitor.create_task("task2")

    all_metrics = monitor.get_all_metrics()
    assert len(all_metrics) == 2
