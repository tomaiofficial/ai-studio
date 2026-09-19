"""
core/video/pipeline.py — Pipeline IA complet de génération vidéo (v8.0)

Orchestration complète du pipeline de génération :
  Prompt → Analyse IA → Optimisation → Génération → Upscaling →
  Amélioration visage → Amélioration mouvement → Audio → Compression → Livraison

Intègre :
  - PromptOptimizer (optimisation IA des prompts)
  - AgnesVideoAPI (génération vidéo)
  - VideoPostProcessor (upscaling, débruitage, HDR)
  - VideoQueue (file d'attente avec priorités)
  - VideoMonitor (monitoring et métriques)

Conçu pour être **rétro-compatible** : peut être utilisé comme wrapper autour
du pipeline existant (SimpleVideoPipeline) ou comme pipeline autonome.

Usage::

    from core.video.pipeline import AIVideoPipeline

    pipeline = AIVideoPipeline(api_key="...", quality="4k", style="cinema")
    result = await pipeline.generate(
        prompt="un enfant qui joue dans un jardin",
        duration=10,
        audio_enabled=True,
    )
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

from core.api.agnes_video import AgnesVideoAPI
from core.video.postprocess import VideoPostProcessor, PostProcessConfig, VIDEO_STYLES
from core.video.prompt_optimizer import PromptOptimizer
from core.video.queue import VideoQueue, TaskPriority
from core.video.monitoring import VideoMonitor

logger = logging.getLogger(__name__)


@dataclass
class PipelineConfig:
    """Configuration du pipeline IA complet."""

    # Qualité vidéo
    quality: str = "full_hd"  # standard | hd | full_hd | 2k | 4k
    style: str = "ultra_realistic"  # ultra_realistic | cinema | anime | photorealistic | hyper_realistic

    # Post-traitement
    denoise: bool = True
    face_enhance: bool = True
    motion_enhance: bool = False
    hdr: bool = False
    color_correct: bool = True
    compress: bool = True

    # Audio
    audio_enabled: bool = True
    audio_voice: str = "fr-FR-DeniseNeural"
    audio_rate: str = "+0%"

    # File d'attente
    priority: TaskPriority = TaskPriority.FREE
    max_concurrent: int = 2

    # Optimisation prompt
    optimize_prompt: bool = True
    fix_spelling: bool = True
    add_cinematic: bool = True

    # Timeout
    generation_timeout: int = 1800  # 30 minutes
    postprocess_timeout: int = 600   # 10 minutes


@dataclass
class GenerationResult:
    """Résultat de la génération vidéo."""

    video_path: str
    video_url: str = ""
    duration: float = 0.0
    resolution: str = ""
    quality: str = ""
    style: str = ""
    metrics: dict = field(default_factory=dict)
    stages: dict = field(default_factory=dict)


class AIVideoPipeline:
    """Pipeline IA complet de génération vidéo.

    Orchestre l'ensemble des étapes : optimisation du prompt, génération,
    post-traitement, amélioration audio, compression et livraison.
    """

    def __init__(
        self,
        api_key: str,
        config: Optional[PipelineConfig] = None,
        queue: Optional[VideoQueue] = None,
        monitor: Optional[VideoMonitor] = None,
    ):
        self.api_key = api_key
        self.config = config or PipelineConfig()
        self.queue = queue or VideoQueue(max_concurrent=self.config.max_concurrent)
        self.monitor = monitor or VideoMonitor()

        # Initialiser les composants
        self.video_api = AgnesVideoAPI(
            api_key=api_key,
            on_retry=self._on_retry,
        )
        self.postprocessor = VideoPostProcessor(
            config=PostProcessConfig(
                quality=self.config.quality,
                style=self.config.style,
                denoise=self.config.denoise,
                face_enhance=self.config.face_enhance,
                motion_enhance=self.config.motion_enhance,
                hdr=self.config.hdr,
                color_correct=self.config.color_correct,
                compress=self.config.compress,
            )
        )
        self.prompt_optimizer = PromptOptimizer(
            style=self.config.style,
            enhance=self.config.optimize_prompt,
            fix_spelling=self.config.fix_spelling,
            add_cinematic=self.config.add_cinematic,
        )

    async def _on_retry(self, attempt: int, delay: float, reason: str) -> None:
        """Callback de retry pour l'API Agnes."""
        logger.warning(
            f"[AIVideoPipeline] Retry {attempt} in {delay:.0f}s: {reason}"
        )

    async def generate(
        self,
        prompt: str,
        duration: int = 5,
        width: int = 1152,
        height: int = 768,
        reference_image_paths: Optional[list] = None,
        seed: Optional[int] = None,
        negative_prompt: Optional[str] = None,
        working_dir: str = "",
    ) -> GenerationResult:
        """Génère une vidéo complète avec le pipeline IA.

        Args:
            prompt: Prompt utilisateur.
            duration: Durée souhaitée (5, 7, 10, 12, 15 secondes).
            width: Largeur cible.
            height: Hauteur cible.
            reference_image_paths: Images de référence (i2v/keyframes).
            seed: Graine aléatoire.
            negative_prompt: Prompt négatif.
            working_dir: Répertoire de travail.

        Returns:
            GenerationResult avec le chemin de la vidéo finale.
        """
        task_id = f"ai_{int(time.time())}_{hash(prompt) % 10000}"
        self.monitor.create_task(task_id)

        stages = {}
        start_time = time.time()

        # ── Étape 1 : Analyse IA du prompt ──
        self.monitor.start_stage(task_id, "prompt_analysis")
        optimized_prompt = prompt
        if self.config.optimize_prompt:
            opt_result = await self.prompt_optimizer.optimize(prompt)
            optimized_prompt = opt_result.optimized
            stages["prompt_optimization"] = {
                "original": opt_result.original,
                "optimized": opt_result.optimized,
                "corrections": opt_result.corrections,
                "added_keywords": opt_result.added_keywords,
            }
        self.monitor.end_stage(task_id, "prompt_analysis", extra=stages.get("prompt_optimization"))

        # ── Étape 2 : Génération vidéo (via queue) ──
        self.monitor.start_stage(task_id, "video_generation")
        video_path = await self._generate_video(
            prompt=optimized_prompt,
            duration=duration,
            width=width,
            height=height,
            reference_image_paths=reference_image_paths,
            seed=seed,
            negative_prompt=negative_prompt,
            working_dir=working_dir,
        )
        self.monitor.end_stage(task_id, "video_generation", extra={"video_path": video_path})

        # ── Étape 3 : Upscaling + amélioration visuelle ──
        self.monitor.start_stage(task_id, "upscaling")
        enhanced_path = await self.postprocessor.enhance(video_path)
        if enhanced_path != video_path:
            video_path = enhanced_path
        self.monitor.end_stage(task_id, "upscaling")

        # ── Étape 4 : Amélioration audio ──
        if self.config.audio_enabled:
            self.monitor.start_stage(task_id, "audio_enhancement")
            video_path = await self._enhance_audio(video_path, prompt)
            self.monitor.end_stage(task_id, "audio_enhancement")

        # ── Étape 5 : Compression intelligente ──
        self.monitor.start_stage(task_id, "compression")
        final_path = await self._compress(video_path)
        self.monitor.end_stage(task_id, "compression")

        # ── Finalisation ──
        total_duration = time.time() - start_time
        self.monitor.finalize_task(task_id, status="completed")

        # Récupérer les métriques
        metrics = self.monitor.get_metrics(task_id) or {}

        return GenerationResult(
            video_path=final_path,
            duration=duration,
            resolution=f"{width}x{height}",
            quality=self.config.quality,
            style=self.config.style,
            metrics=metrics,
            stages=stages,
        )

    async def _generate_video(
        self,
        prompt: str,
        duration: int,
        width: int,
        height: int,
        reference_image_paths: Optional[list],
        seed: Optional[int],
        negative_prompt: Optional[str],
        working_dir: str,
    ) -> str:
        """Génère la vidéo via l'API Agnes."""
        os.makedirs(working_dir, exist_ok=True)
        video_path = os.path.join(working_dir, "final_video.mp4")

        # Soumettre via la queue
        async def _do_generate():
            video_output = await self.video_api.generate_single_video(
                prompt=prompt,
                reference_image_paths=reference_image_paths or [],
                duration=duration,
                width=width,
                height=height,
                seed=seed,
                negative_prompt=negative_prompt,
            )
            video_output.save(video_path)
            return video_path

        task = await self.queue.enqueue(
            task_id=f"gen_{int(time.time())}",
            priority=self.config.priority,
            fn=_do_generate,
        )

        result = await self.queue.wait(task.task_id, timeout=self.config.generation_timeout)
        return result

    async def _enhance_audio(self, video_path: str, prompt: str) -> str:
        """Améliore l'audio de la vidéo (TTS + débruitage + normalisation + spatialisation)."""
        from core.audio.tts import EdgeTTSEngine
        from core.audio.enhancer import AudioEnhancer, AudioEnhanceConfig

        audio_path = video_path + ".narration.wav"
        tts = EdgeTTSEngine()
        await tts.generate(
            text=prompt.strip(),
            output_path=audio_path,
            voice=self.config.audio_voice,
            rate=self.config.audio_rate,
        )

        # v8.0: Amélioration audio avancée (débruitage, normalisation, spatialisation)
        enhancer = AudioEnhancer(
            config=AudioEnhanceConfig(
                denoise=True,
                normalize=True,
                reduce_breath=True,
                spatialize=False,
                eq_preset="vocal",
                remove_clicks=True,
            )
        )
        enhanced_audio = await enhancer.enhance(audio_path, audio_path + ".enhanced.wav")

        # Overlay audio amélioré avec ffmpeg
        output_path = video_path + ".audio.mp4"
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", enhanced_audio,
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            output_path,
        ]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=120)
            if proc.returncode == 0 and os.path.exists(output_path):
                # Nettoyer le fichier audio temporaire
                if os.path.exists(audio_path):
                    os.remove(audio_path)
                if os.path.exists(enhanced_audio):
                    os.remove(enhanced_audio)
                return output_path
        except Exception as e:
            logger.warning(f"[AIVideoPipeline] Audio enhancement failed: {e}")

        return video_path

    async def _compress(self, video_path: str) -> str:
        """Compression intelligente (2-passes, bitrate adaptatif)."""
        output_path = video_path + ".final.mp4"
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-c:v", "libx264",
            "-crf", "23",
            "-preset", "medium",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            output_path,
        ]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=300)
            if proc.returncode == 0 and os.path.exists(output_path):
                return output_path
        except Exception as e:
            logger.warning(f"[AIVideoPipeline] Compression failed: {e}")

        return video_path
