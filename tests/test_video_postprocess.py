"""Tests pour core/video/postprocess.py"""
import os
import pytest
from core.video.postprocess import (
    VideoPostProcessor,
    PostProcessConfig,
    RESOLUTIONS,
    VIDEO_STYLES,
)


def test_resolutions():
    """Vérifie que toutes les résolutions sont définies."""
    assert "standard" in RESOLUTIONS
    assert "hd" in RESOLUTIONS
    assert "full_hd" in RESOLUTIONS
    assert "2k" in RESOLUTIONS
    assert "4k" in RESOLUTIONS
    assert RESOLUTIONS["4k"] == (3840, 2160)
    assert RESOLUTIONS["standard"] == (864, 480)


def test_video_styles():
    """Vérifie que tous les styles sont définis."""
    assert "ultra_realistic" in VIDEO_STYLES
    assert "cinema" in VIDEO_STYLES
    assert "anime" in VIDEO_STYLES
    assert "photorealistic" in VIDEO_STYLES
    assert "hyper_realistic" in VIDEO_STYLES


def test_postprocess_config_defaults():
    """Vérifie les valeurs par défaut de la configuration."""
    config = PostProcessConfig()
    assert config.quality == "full_hd"
    assert config.style == "ultra_realistic"
    assert config.denoise is True
    assert config.face_enhance is True
    assert config.motion_enhance is False
    assert config.hdr is False
    assert config.color_correct is True
    assert config.compress is True
    assert config.crf == 18


def test_postprocess_config_custom():
    """Vérifie la configuration personnalisée."""
    config = PostProcessConfig(
        quality="4k",
        style="cinema",
        denoise=False,
        face_enhance=False,
        motion_enhance=True,
        hdr=True,
        crf=20,
    )
    assert config.quality == "4k"
    assert config.style == "cinema"
    assert config.denoise is False
    assert config.face_enhance is False
    assert config.motion_enhance is True
    assert config.hdr is True
    assert config.crf == 20


def test_postprocessor_init():
    """Vérifie l'initialisation du post-processeur."""
    proc = VideoPostProcessor()
    assert proc.config.quality == "full_hd"

    config = PostProcessConfig(quality="4k")
    proc = VideoPostProcessor(config=config)
    assert proc.config.quality == "4k"


def test_postprocessor_missing_input():
    """Vérifie que le post-traitement gère les fichiers manquants (fail-safe)."""
    proc = VideoPostProcessor()
    result = asyncio_run(proc.process("/nonexistent/video.mp4", "/tmp/output.mp4"))
    assert result == "/nonexistent/video.mp4"


def test_postprocessor_build_filter_chain():
    """Vérifie la construction de la chaîne de filtres."""
    proc = VideoPostProcessor()
    info = {"width": 768, "height": 1152, "duration": 10.0}
    filters = proc._build_filter_chain(info)
    assert len(filters) > 0
    # Le premier filtre devrait être un scale (upscaling)
    assert filters[0][0] == "scale"


def test_postprocessor_build_filter_chain_no_enhance():
    """Vérifie qu'aucun filtre n'est ajouté si tout est désactivé."""
    config = PostProcessConfig(
        quality="standard",
        denoise=False,
        face_enhance=False,
        motion_enhance=False,
        hdr=False,
        color_correct=False,
    )
    proc = VideoPostProcessor(config=config)
    info = {"width": 864, "height": 480, "duration": 5.0}
    filters = proc._build_filter_chain(info)
    # Aucun filtre si la résolution est déjà à la cible et tout est désactivé
    assert len(filters) == 0


def asyncio_run(coro):
    """Helper pour exécuter un coroutine dans les tests synchrones."""
    import asyncio
    return asyncio.get_event_loop().run_until_complete(coro)
