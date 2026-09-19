"""Tests pour core/video/prompt_optimizer.py"""
import pytest
from core.video.prompt_optimizer import PromptOptimizer, OptimizationResult


def test_prompt_optimizer_defaults():
    """Vérifie les valeurs par défaut."""
    opt = PromptOptimizer()
    assert opt.style == "ultra_realistic"
    assert opt.enhance is True
    assert opt.fix_spelling is True
    assert opt.add_cinematic is True


def test_prompt_optimizer_detect_language_chinese():
    """Détecte le chinois."""
    opt = PromptOptimizer()
    assert opt._detect_language("un enfant qui joue dans un jardin") == "fr"
    assert opt._detect_language("un chat noir") == "fr"
    assert opt._detect_language("一个孩子在玩耍") == "zh"
    assert opt._detect_language("a child playing") == "en"


def test_prompt_optimizer_fix_spelling():
    """Corrige les fautes courantes."""
    opt = PromptOptimizer(fix_spelling=True)
    result, corrections = opt._fix_spelling("un enft qui joue", "fr")
    assert "enft" not in result
    assert len(corrections) > 0


def test_prompt_optimizer_enrich_prompt():
    """Enrichit un prompt court."""
    opt = PromptOptimizer(enhance=True, style="cinema")
    result = opt._enrich_prompt("un enfant", "fr")
    assert "cinematic" in result.lower() or "film" in result.lower()


def test_prompt_optimizer_add_cinematic():
    """Ajoute les paramètres cinématiques."""
    opt = PromptOptimizer(add_cinematic=True)
    result, added = opt._add_cinematic_params("un enfant qui joue")
    assert len(added) > 0
    assert "cinematic" in result.lower()


def test_prompt_optimizer_optimize_empty():
    """Gère les prompts vides."""
    opt = PromptOptimizer()
    result = asyncio_run(opt.optimize(""))
    assert result.optimized == ""
    assert result.original == ""


def test_prompt_optimizer_optimize_full():
    """Test complet d'optimisation."""
    opt = PromptOptimizer(style="cinema")
    result = asyncio_run(opt.optimize("un enfant qui joue dans un jardin"))
    assert result.original == "un enfant qui joue dans un jardin"
    assert result.optimized != result.original
    assert result.style == "cinema"
    assert len(result.added_keywords) > 0


def test_prompt_optimizer_optimize_simple():
    """Version simplifiée."""
    opt = PromptOptimizer()
    result = asyncio_run(opt.optimize_simple("un chat"))
    assert isinstance(result, str)
    assert len(result) > 0


def asyncio_run(coro):
    """Helper pour exécuter un coroutine dans les tests synchrones."""
    import asyncio
    return asyncio.get_event_loop().run_until_complete(coro)
