"""Tests pour core/audio/enhancer.py"""
import pytest
from core.audio.enhancer import AudioEnhancer, AudioEnhanceConfig


@pytest.fixture
def enhancer():
    return AudioEnhancer()


def test_audio_enhance_config_defaults():
    """Vérifie les valeurs par défaut."""
    config = AudioEnhanceConfig()
    assert config.denoise is True
    assert config.normalize is True
    assert config.reduce_breath is True
    assert config.spatialize is False
    assert config.eq_preset == "vocal"
    assert config.remove_clicks is True
    assert config.target_lufs == -16.0


def test_audio_enhance_config_custom():
    """Configuration personnalisée."""
    config = AudioEnhanceConfig(
        denoise=False,
        normalize=False,
        spatialize=True,
        eq_preset="music",
        target_lufs=-14.0,
    )
    assert config.denoise is False
    assert config.spatialize is True
    assert config.eq_preset == "music"
    assert config.target_lufs == -14.0


def test_eq_presets(enhancer):
    """Vérifie les préréglages d'égalisation."""
    assert "vocal" in enhancer.EQ_PRESETS
    assert "music" in enhancer.EQ_PRESETS
    assert "podcast" in enhancer.EQ_PRESETS
    assert "flat" in enhancer.EQ_PRESETS
    assert enhancer.EQ_PRESETS["flat"] == ""


def test_build_filter_chain(enhancer):
    """Construit la chaîne de filtres."""
    chain = enhancer._build_filter_chain()
    assert isinstance(chain, str)
    assert len(chain) > 0
    # Vérifier que loudnorm est présent (normalisation)
    assert "loudnorm" in chain
    # Vérifier que afftdn est présent (débruitage)
    assert "afftdn" in chain


def test_build_filter_chain_empty():
    """Chaîne de filtres vide si tout désactivé."""
    config = AudioEnhanceConfig(
        denoise=False,
        normalize=False,
        reduce_breath=False,
        remove_clicks=False,
        eq_preset="flat",
    )
    enhancer = AudioEnhancer(config=config)
    chain = enhancer._build_filter_chain()
    assert chain == ""


def test_enhance_missing_file(enhancer):
    """Fichier manquant → retourne le chemin d'origine (fail-safe)."""
    import asyncio
    result = asyncio.run(enhancer.enhance("/nonexistent/audio.wav", "/tmp/output.wav"))
    assert result == "/nonexistent/audio.wav"


def test_ffmpeg_available(enhancer):
    """Vérifie la disponibilité de ffmpeg."""
    result = enhancer._ffmpeg_available()
    assert isinstance(result, bool)
