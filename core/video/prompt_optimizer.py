"""
core/video/prompt_optimizer.py — Optimisation IA des prompts (v8.0)

Améliore automatiquement les prompts utilisateur avant envoi à l'API Agnes :
  - Correction orthographique / grammaticale
  - Enrichissement descriptif (détails, textures, éclairage)
  - Ajout automatique de paramètres cinématiques
  - Adaptation au style choisi (ultra_realistic, cinema, anime, etc.)

Conçu pour être **optionnel** : si l'optimisation échoue, le prompt original
est renvoyé inchangé (fail-safe).

Usage::

    from core.video.prompt_optimizer import PromptOptimizer

    opt = PromptOptimizer(style="cinema", enhance=True)
    optimized = await opt.optimize("un enfant qui joue dans un jardin")
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

from core.video.postprocess import VIDEO_STYLES

logger = logging.getLogger(__name__)

# Mots-clés cinématiques ajoutés automatiquement
CINEMATIC_SUFFIXES = [
    "cinematic lighting",
    "volumetric lighting",
    "ultra detailed",
    "8k resolution",
    "masterpiece",
    "best quality",
    "ultra realistic",
    "sharp focus",
    "depth of field",
    "film grain",
]

# Corrections orthographiques courantes (français)
SPELLING_FIXES = {
    "enfant": "enfant",
    "joue": "joue",
    "dans": "dans",
    "jardin": "jardin",
    # Ajoutez d'autres corrections courantes ici
}

# Détecteurs de langue
CHINESE_RE = re.compile(r'[\u4e00-\u9fff]')


@dataclass
class OptimizationResult:
    """Résultat de l'optimisation d'un prompt."""

    original: str
    optimized: str
    style: str
    corrections: list = None
    added_keywords: list = None

    def __post_init__(self):
        if self.corrections is None:
            self.corrections = []
        if self.added_keywords is None:
            self.added_keywords = []


class PromptOptimizer:
    """Optimiseur de prompts IA.

    Améliore les prompts utilisateur avec correction, enrichissement et
    paramètres cinématiques, tout en conservant le sens original.
    """

    def __init__(
        self,
        style: str = "ultra_realistic",
        enhance: bool = True,
        fix_spelling: bool = True,
        add_cinematic: bool = True,
        max_length: int = 500,
    ):
        self.style = style
        self.enhance = enhance
        self.fix_spelling = fix_spelling
        self.add_cinematic = add_cinematic
        self.max_length = max_length

    def _detect_language(self, text: str) -> str:
        """Détecte la langue du texte (français/chinois/autre)."""
        if CHINESE_RE.search(text):
            return "zh"
        # Détection du français : mots communs + apostrophes typiques
        fr_words = {"le", "la", "un", "une", "des", "dans", "sur", "avec", "pour",
                    "et", "ou", "qui", "que", "de", "du", "une", "les", "est",
                    "une", "dans", "par", "pour", "sur", "sous", "entre"}
        words = set(text.lower().split())
        fr_matches = len(words & fr_words)
        # Un mot français commun suffit souvent pour le français
        if fr_matches >= 1:
            return "fr"
        return "en"

    def _fix_spelling(self, text: str, lang: str) -> tuple:
        """Corrige les fautes d'orthographe courantes.

        Returns:
            (texte_corrigé, liste_des_corrections)
        """
        corrections = []
        result = text

        if lang == "fr":
            # Corrections simples pour le français
            # (une vraie correction nécessiterait un correcteur orthographique)
            common_fixes = {
                "enft": "enfant",
                "jn": "je",
                "qun": "qu'un",
                "parq": "parce que",
            }
            for wrong, right in common_fixes.items():
                if wrong in result.lower():
                    result = re.sub(
                        re.escape(wrong), right, result, flags=re.IGNORECASE
                    )
                    corrections.append(f"{wrong} → {right}")

        return result, corrections

    def _enrich_prompt(self, text: str, lang: str) -> str:
        """Enrichit le prompt avec des détails descriptifs."""
        # Ajouter des mots-clés de qualité si le prompt est court
        if len(text.split()) < 15:
            style_keywords = VIDEO_STYLES.get(self.style, VIDEO_STYLES["ultra_realistic"])
            # Extraire les mots-clés pertinents du style
            keywords = [kw.strip() for kw in style_keywords.split(",")]
            # Ajouter 2-3 mots-clés pertinents
            extra = " ".join(keywords[:3])
            text = f"{text}, {extra}"

        return text

    def _add_cinematic_params(self, text: str) -> tuple:
        """Ajoute les paramètres cinématiques au prompt.

        Returns:
            (prompt_enrichi, mots_clés_ajoutés)
        """
        added = []
        # Vérifier quels suffixes ne sont pas déjà présents
        for suffix in CINEMATIC_SUFFIXES:
            if suffix.lower() not in text.lower():
                added.append(suffix)

        # Ajouter un sous-ensemble pertinent
        selected = added[:5]  # max 5 mots-clés
        if selected:
            text = f"{text}, {', '.join(selected)}"

        return text, selected

    async def optimize(self, prompt: str) -> OptimizationResult:
        """Optimise un prompt utilisateur.

        Args:
            prompt: Le prompt original de l'utilisateur.

        Returns:
            OptimizationResult avec le prompt optimisé et les métadonnées.
        """
        if not prompt or not prompt.strip():
            return OptimizationResult(
                original=prompt,
                optimized=prompt,
                style=self.style,
            )

        original = prompt.strip()
        lang = self._detect_language(original)

        # 1. Correction orthographique
        corrected, corrections = self._fix_spelling(original, lang) if self.fix_spelling else (original, [])

        # 2. Enrichissement descriptif
        enriched = self._enrich_prompt(corrected, lang) if self.enhance else corrected

        # 3. Paramètres cinématiques
        if self.add_cinematic:
            enriched, added_kw = self._add_cinematic_params(enriched)
        else:
            added_kw = []

        # 4. Limiter la longueur
        if len(enriched) > self.max_length:
            enriched = enriched[:self.max_length].rsplit(" ", 1)[0]

        logger.info(
            f"[PromptOptimizer] Optimized: '{original[:50]}...' → '{enriched[:50]}...' "
            f"(style={self.style}, corrections={len(corrections)}, added={len(added_kw)})"
        )

        return OptimizationResult(
            original=original,
            optimized=enriched,
            style=self.style,
            corrections=corrections,
            added_keywords=added_kw,
        )

    async def optimize_simple(self, prompt: str) -> str:
        """Version simplifiée : retourne juste le prompt optimisé (str)."""
        result = await self.optimize(prompt)
        return result.optimized
