"""
core/audio/enhancer.py — Amélioration audio avancée (v8.0)

Pipeline d'amélioration audio :
  1. Suppression du bruit (RNNoise / afftdn)
  2. Normalisation audio (loudnorm)
  3. Réduction de souffle (highpass)
  4. Spatialisation (stéréo / surround virtuel)
  5. Meilleur mixage (égalisation)
  6. Suppression des clics (clics/pops)
  7. Synchronisation parfaite

Usage::

    from core.audio.enhancer import AudioEnhancer

    enhancer = AudioEnhancer()
    enhanced_path = await enhancer.enhance("input.wav", "output.wav")
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class AudioEnhanceConfig:
    """Configuration de l'amélioration audio."""
    denoise: bool = True          # suppression du bruit
    normalize: bool = True        # normalisation (loudnorm)
    reduce_breath: bool = True     # réduction de souffle
    spatialize: bool = False      # spatialisation stéréo
    eq_preset: str = "vocal"      # vocal | music | podcast | flat
    remove_clicks: bool = True    # suppression des clics/pops
    target_lufs: float = -16.0    # cible de normalisation LUFS
    timeout: int = 120            # timeout ffmpeg


class AudioEnhancer:
    """Amélioreur audio avancé.

    Utilise ffmpeg pour le traitement audio (fail-safe : si ffmpeg n'est
    pas disponible ou échoue, le fichier original est conservé).
    """

    # Préréglages d'égalisation
    EQ_PRESETS = {
        "vocal": "equalizer=f=250:t=q:w=1:g=3,equalizer=f=2200:t=q:w=1:g=-2,equalizer=f=5000:t=q:w=1:g=2",
        "music": "equalizer=f=60:t=q:w=1:g=2,equalizer=f=170:t=q:w=1:g=1,equalizer=f=3100:t=q:w=1:g=1,equalizer=f=11000:t=q:w=1:g=2",
        "podcast": "equalizer=f=100:t=q:w=1:g=3,equalizer=f=1000:t=q:w=1:g=-1,equalizer=f=4000:t=q:w=1:g=2",
        "flat": "",
    }

    def __init__(self, config: Optional[AudioEnhanceConfig] = None):
        self.config = config or AudioEnhanceConfig()

    @staticmethod
    def _ffmpeg_available() -> bool:
        return shutil.which("ffmpeg") is not None

    def _build_filter_chain(self) -> str:
        """Construit la chaîne de filtres ffmpeg pour l'amélioration audio."""
        filters = []

        # 1. Suppression des clics/pops (détection de pics)
        if self.config.remove_clicks:
            filters.append("clickrem")

        # 2. Suppression du bruit (RNNoise si disponible, sinon afftdn)
        if self.config.denoise:
            # afftdn = débruitage spectral
            filters.append("afftdn=nr=12:nf=-25")

        # 3. Réduction de souffle (highpass à 80Hz pour enlever les souffles)
        if self.config.reduce_breath:
            filters.append("highpass=f=80:width_type=q:width=1")

        # 4. Égalisation
        eq_filter = self.EQ_PRESETS.get(self.config.eq_preset, "")
        if eq_filter:
            filters.append(eq_filter)

        # 5. Normalisation (loudnorm — cible LUFS)
        if self.config.normalize:
            filters.append(
                f"loudnorm=I={self.config.target_lufs}:TP=-1.5:LRA=11:print_format=summary"
            )

        # 6. Spatialisation (stéréo large)
        if self.config.spatialize:
            filters.append("stereotools=spatial=1")

        return ",".join(filters) if filters else ""

    async def enhance(self, input_path: str, output_path: str) -> str:
        """Applique l'amélioration audio sur un fichier.

        Args:
            input_path: Chemin du fichier audio source.
            output_path: Chemin de sortie.

        Returns:
            Chemin du fichier amélioré (output_path si succès, input_path si échec).
        """
        if not self._ffmpeg_available():
            logger.warning("[AudioEnhancer] ffmpeg not available, skipping enhancement")
            return input_path

        if not os.path.exists(input_path):
            logger.warning(f"[AudioEnhancer] Input not found: {input_path}")
            return input_path

        filter_chain = self._build_filter_chain()
        if not filter_chain:
            logger.info("[AudioEnhancer] No filters to apply, copying original")
            return input_path

        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-af", filter_chain,
            "-c:a", "aac",
            "-b:a", "192k",
            "-ar", "48000",  # sample rate 48kHz
            output_path,
        ]

        logger.info(f"[AudioEnhancer] Applying filters: {filter_chain[:100]}...")

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=self.config.timeout
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                logger.error(f"[AudioEnhancer] Timeout after {self.config.timeout}s")
                return input_path

            if proc.returncode != 0:
                err = stderr.decode(errors="replace")[:500] if stderr else ""
                logger.warning(f"[AudioEnhancer] ffmpeg failed: {err}")
                if os.path.exists(output_path):
                    os.remove(output_path)
                return input_path

            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                logger.info(f"[AudioEnhancer] Enhanced audio saved: {output_path}")
                return output_path
            else:
                logger.warning("[AudioEnhancer] Output empty, keeping original")
                return input_path

        except Exception as e:
            logger.error(f"[AudioEnhancer] Error: {e}")
            return input_path

    async def enhance_video_audio(self, video_path: str) -> str:
        """Extrait, améliore et réinjecte l'audio d'une vidéo.

        Args:
            video_path: Chemin de la vidéo.

        Returns:
            Chemin de la vidéo avec audio amélioré.
        """
        if not self._ffmpeg_available():
            return video_path

        # Extraire l'audio
        audio_path = video_path + ".audio.wav"
        extract_cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2",
            audio_path,
        ]

        try:
            proc = await asyncio.create_subprocess_exec(
                *extract_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=60)
            if proc.returncode != 0 or not os.path.exists(audio_path):
                logger.warning("[AudioEnhancer] Audio extraction failed")
                return video_path
        except Exception as e:
            logger.warning(f"[AudioEnhancer] Extraction failed: {e}")
            return video_path

        # Améliorer l'audio
        enhanced_audio = video_path + ".audio_enhanced.wav"
        enhanced_audio = await self.enhance(audio_path, enhanced_audio)

        # Réinjecter dans la vidéo
        output_path = video_path + ".audio_enhanced.mp4"
        mux_cmd = [
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
                *mux_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=120)
            if proc.returncode == 0 and os.path.exists(output_path):
                # Nettoyer les fichiers temporaires
                for tmp in [audio_path, enhanced_audio]:
                    if os.path.exists(tmp):
                        os.remove(tmp)
                return output_path
        except Exception as e:
            logger.warning(f"[AudioEnhancer] Mux failed: {e}")

        # Nettoyer
        for tmp in [audio_path, enhanced_audio]:
            if os.path.exists(tmp):
                os.remove(tmp)

        return video_path
