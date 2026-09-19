"""Tests pour core/video/security.py"""
import pytest
from core.video.security import (
    SecurityValidator,
    ValidationResult,
    MAX_PROMPT_LENGTH,
    MAX_UPLOAD_SIZE,
)


@pytest.fixture
def validator():
    return SecurityValidator()


def test_validate_prompt_valid(validator):
    """Prompt valide passe la validation."""
    result = validator.validate_prompt("un enfant qui joue dans un jardin")
    assert result.valid is True
    assert result.sanitized is not None


def test_validate_prompt_empty(validator):
    """Prompt vide échoue."""
    result = validator.validate_prompt("")
    assert result.valid is False
    assert "vide" in result.error.lower()


def test_validate_prompt_too_long(validator):
    """Prompt trop long échoue."""
    result = validator.validate_prompt("a" * (MAX_PROMPT_LENGTH + 1))
    assert result.valid is False
    assert "long" in result.error.lower() or "trop" in result.error.lower()


def test_validate_prompt_blocked_content(validator):
    """Contenu bloqué échoue."""
    result = validator.validate_prompt("un enfant qui regarde du porn")
    assert result.valid is False
    assert "bloqué" in result.error.lower() or "inapproprié" in result.error.lower()


def test_validate_upload_valid(validator):
    """Upload valide passe."""
    result = validator.validate_upload(
        "image.png", "image/png", 1024, width=512, height=512
    )
    assert result.valid is True


def test_validate_upload_too_large(validator):
    """Upload trop grand échoue."""
    result = validator.validate_upload(
        "video.mp4", "video/mp4", MAX_UPLOAD_SIZE + 1
    )
    assert result.valid is False
    assert "grand" in result.error.lower() or "taille" in result.error.lower()


def test_validate_upload_bad_extension(validator):
    """Extension non autorisée échoue."""
    result = validator.validate_upload(
        "script.exe", "application/octet-stream", 1024
    )
    assert result.valid is False


def test_validate_upload_bad_dimensions(validator):
    """Dimensions trop grandes échouent."""
    result = validator.validate_upload(
        "image.png", "image/png", 1024, width=5000, height=5000
    )
    assert result.valid is False


def test_check_ip_rate_limit(validator):
    """Rate limit par IP fonctionne."""
    # Réinitialiser le compteur global
    from core.video.security import _IP_RATE_LIMIT
    _IP_RATE_LIMIT.clear()

    # Premières requêtes autorisées
    for i in range(30):
        assert validator.check_ip_rate_limit("192.168.1.1") is True

    # 31e requête bloquée
    assert validator.check_ip_rate_limit("192.168.1.1") is False


def test_check_ip_rate_limit_different_ips(validator):
    """Chaque IP a son propre quota."""
    from core.video.security import _IP_RATE_LIMIT
    _IP_RATE_LIMIT.clear()

    for i in range(30):
        assert validator.check_ip_rate_limit("192.168.1.1") is True
    # IP différente a son propre quota
    assert validator.check_ip_rate_limit("192.168.1.2") is True


def test_sanitize_filename(validator):
    """Sanitise les noms de fichiers."""
    assert validator.sanitize_filename("../../../etc/passwd") == "passwd"
    assert validator.sanitize_filename("file<script>.png") == "file_script_.png"
    assert validator.sanitize_filename("normal_file.png") == "normal_file.png"


def test_hash_content(validator):
    """Calcule le hash SHA256."""
    h1 = validator.hash_content(b"hello")
    h2 = validator.hash_content(b"hello")
    h3 = validator.hash_content(b"world")
    assert h1 == h2
    assert h1 != h3
    assert len(h1) == 64  # SHA256 = 64 hex chars


def test_hash_content_missing_file(validator):
    """Hash d'un fichier manquant retourne None."""
    from core.video.persistent_storage import PersistentStorage
    storage = PersistentStorage()
    assert storage.get_file_hash("/nonexistent/file.mp4") is None
