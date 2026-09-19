"""Tests pour core/video/persistent_storage.py"""
import asyncio
import os
import pytest
from core.video.persistent_storage import PersistentStorage


@pytest.fixture
def storage():
    return PersistentStorage()


def test_storage_init(storage):
    """Vérifie l'initialisation."""
    assert storage._local_cache_dir is not None
    assert os.path.exists(storage._local_cache_dir)


def test_storage_is_persistent(storage):
    """Vérifie la propriété is_persistent."""
    # Sans Supabase configuré, devrait être False
    result = storage.is_persistent
    assert isinstance(result, bool)


def test_verify_file_exists_missing(storage):
    """Fichier manquant retourne False."""
    result = asyncio.run(storage.verify_file_exists("/nonexistent/file.mp4"))
    assert result is False


def test_verify_file_exists_empty(storage):
    """Fichier vide retourne False."""
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False) as f:
        path = f.name
    try:
        result = asyncio.run(storage.verify_file_exists(path))
        assert result is False  # 0 bytes
    finally:
        os.remove(path)


def test_verify_file_exists_valid(storage):
    """Fichier valide retourne True."""
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, mode="w") as f:
        f.write("test content")
        path = f.name
    try:
        result = asyncio.run(storage.verify_file_exists(path))
        assert result is True
    finally:
        os.remove(path)


def test_get_file_hash_missing(storage):
    """Hash d'un fichier manquant retourne None."""
    assert storage.get_file_hash("/nonexistent/file.mp4") is None


def test_get_file_hash_valid(storage):
    """Hash d'un fichier valide."""
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, mode="w") as f:
        f.write("test content")
        path = f.name
    try:
        h = storage.get_file_hash(path)
        assert h is not None
        assert len(h) == 64
    finally:
        os.remove(path)


def test_sanitize_filename(storage):
    """Test de la sanitisation (via SecurityValidator)."""
    from core.video.security import SecurityValidator
    sv = SecurityValidator()
    assert sv.sanitize_filename("../../../etc/passwd") == "passwd"
