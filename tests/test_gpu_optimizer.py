"""Tests pour core/video/gpu_optimizer.py"""
import pytest
from core.video.gpu_optimizer import GPUOptimizer, GPUInfo


@pytest.fixture
def optimizer():
    return GPUOptimizer()


def test_gpu_optimizer_init(optimizer):
    """Vérifie l'initialisation."""
    assert optimizer._model_cache == {}
    assert optimizer._last_gpu_info is None


def test_gpu_info_dataclass():
    """Vérifie le dataclass GPUInfo."""
    info = GPUInfo(
        total_vram_mb=8192,
        used_vram_mb=4096,
        free_vram_mb=4096,
        utilization=50.0,
        temperature=65.0,
    )
    assert info.total_vram_mb == 8192
    assert info.free_vram_mb == 4096
    assert info.utilization == 50.0


def test_recommend_batch_size_no_gpu(optimizer):
    """Sans GPU, retourne 1."""
    # Sans GPUtil installé, get_gpu_info retourne None
    batch = optimizer.recommend_batch_size("7B")
    assert batch >= 1


def test_recommend_batch_size_with_gpu(optimizer, monkeypatch):
    """Avec GPU simulé, retourne un batch size calculé."""
    info = GPUInfo(
        total_vram_mb=16384,
        used_vram_mb=4096,
        free_vram_mb=12000,
        utilization=30.0,
        temperature=60.0,
    )
    monkeypatch.setattr(optimizer, "get_gpu_info", lambda: info)

    batch = optimizer.recommend_batch_size("7B")
    assert batch >= 1
    assert batch <= 8  # plafond


def test_cache_model(optimizer):
    """Test du cache de modèle."""
    class FakeModel:
        pass

    model = FakeModel()
    optimizer.cache_model("test_model", model)
    assert optimizer.get_cached_model("test_model") is model


def test_get_cached_model_missing(optimizer):
    """Modèle absent du cache."""
    assert optimizer.get_cached_model("nonexistent") is None


def test_clear_cache(optimizer):
    """Test du vidage du cache."""
    optimizer.cache_model("model1", object())
    optimizer.cache_model("model2", object())
    freed = optimizer.clear_cache()
    assert freed == 2
    assert optimizer.get_cached_model("model1") is None


def test_should_reload_model_no_cache(optimizer):
    """Sans modèle en cache, doit recharger."""
    assert optimizer.should_reload_model("new_model") is True


def test_should_reload_model_cached(optimizer):
    """Avec modèle en cache et VRAM suffisante, ne recharge pas."""
    optimizer.cache_model("cached_model", object())
    # Sans GPUtil, get_gpu_info retourne None → should_reload_model retourne False
    # car le modèle est en cache et pas de contrainte VRAM
    assert optimizer.should_reload_model("cached_model") is False


def test_should_reload_model_force(optimizer):
    """Force=True recharge toujours."""
    optimizer.cache_model("cached_model", object())
    assert optimizer.should_reload_model("cached_model", force=True) is True
    assert optimizer.get_cached_model("cached_model") is None


def test_get_stats(optimizer):
    """Test des statistiques."""
    stats = optimizer.get_stats()
    assert "gpu_available" in stats
    assert "cached_models" in stats
    assert "gpu_info" in stats
