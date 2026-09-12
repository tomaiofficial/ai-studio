"""core.audio.tts — TTS 统一接口：EdgeTTSEngine + SilentTTSEngine

基于 edge_tts（免费 Azure Edge TTS，pas de clé API requise） et
silence占位两种实现. TTS entièrement local, pas de clé API nécessaire.
"""

import asyncio
import logging
import os
from abc import ABC, abstractmethod
from typing import Optional, Tuple

import edge_tts

logger = logging.getLogger(__name__)


class TTSEngine(ABC):
    """TTS 抽象基类。"""

    @abstractmethod
    async def generate(
        self, text: str, output_path: str, voice: str = "zh-CN-XiaoxiaoNeural", rate: str = "+0%"
    ) -> Tuple[str, object]:
        """生成音频文件，返回 (audio_path, sub_maker_or_cues)。"""
        ...


class EdgeTTSEngine(TTSEngine):
    """基于 edge_tts 的免费 TTS 引擎 - **pas de clé API requise**.

    edge_tts utilise les services gratuits d'Azure AI Speech,
    aucune clé API n'est requise pour une utilisation de base.

    generate() 返回 (audio_path, sub_maker)，其中 sub_maker 是 edge_tts.SubMaker 实例，
    包含逐词时间戳 cues，可用于生成 SRT 字幕.

    Voix françaises recommandées :
    - zh-CN-XiaoxiaoNeural (Chinese, sounds natural)
    - fr-FR-HenriettaNeural (French, haute qualité)
    - fr-FR-JacquelineNeural (French, classique)

    Usage::
        engine = EdgeTTSEngine()
        await engine.generate("Bonjour le monde", "output.mp3")
    """

    async def generate(
        self, text: str, output_path: str, voice: str = "fr-FR-HenriettaNeural", rate: str = "+0%"
    ) -> Tuple[str, "edge_tts.SubMaker"]:
        """Générer TTS audio via edge_tts (pas de clé API requise).

        Args:
            text: Texte à convertir en audio
            output_path: Chemin de sortie audio (.mp3)
            voice: Voix edge_tts (par défaut: fr-FR-HenriettaNeural)
            rate: Vitesse de parole ( "+0%", "+20%", "-10%" etc.)

        Returns:
            (audio_path, sub_maker) tuple containing:
            - audio_path: Chemin du fichier audio généré
            - sub_maker: edge_tts.SubMaker instance avec cues de mots pour sous-titres

        Raises:
            RuntimeError: Si la génération échoue après les tentatives de retry.
        """
        logger.info(f"[TTS] Génération audio edge_tts: voice={voice}, text={len(text)} chars...")

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
                sub_maker = edge_tts.SubMaker()

                tmp_path = output_path + ".tmp"
                with open(tmp_path, "wb") as audio_file:
                    async for chunk in communicate.stream():
                        if chunk["type"] == "audio":
                            audio_file.write(chunk["data"])
                        elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                            sub_maker.feed(chunk)

                # 原子替换，避免半成品被误用
                os.replace(tmp_path, output_path)
                logger.info(f"[TTS] Audio saved: {output_path}")
                return output_path, sub_maker
            except Exception as e:
                # Nettoyer les fichiers partiels
                for p in (tmp_path, output_path):
                    if os.path.exists(p):
                        try:
                            os.remove(p)
                        except OSError:
                            pass
                if attempt < max_attempts - 1:
                    logger.warning(f"[TTS] edge_tts tentative {attempt + 1}/{max_attempts} échouée: {e}, nouvelle tentative...")
                    await asyncio.sleep(3)
                    continue
                logger.error(f"[TTS] edge_tts échoué après {max_attempts} tentatives: {e}")
                raise RuntimeError(f"EdgeTTS génération échouée: {e}") from e

    async def harvest_cues(
        self, text: str, voice: str = "fr-FR-HenriettaNeural", rate: str = "+0%"
    ) -> "edge_tts.SubMaker":
        """Collecter les cues de mots sans générer d'audio (chemin B: audio désactivé, sous-titres activé).

        edge_tts de WordBoundary et audio data sont entrelacés dans le même stream,
        il faut consommer le stream complet pour récupérer tous les cues;
        cette méthode ne garde que les WordBoundary/SentenceBoundary,
        les données audio sont ignorées. Retourne sub_maker pour generate_cue_aware_srt.

        Args:
            text: Texte à extraire les cues
            voice: Voix edge_tts
            rate: Vitesse de parole

        Returns:
            edge_tts.SubMaker avec les cues collectées

        Raises:
            RuntimeError: Si l'extraction des cues échoue.
        """
        logger.info(f"[TTS] Extraction cues uniquement: voice={voice}, text={len(text)} chars...")

        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
                sub_maker = edge_tts.SubMaker()
                async for chunk in communicate.stream():
                    if chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                        sub_maker.feed(chunk)
                cue_count = len(getattr(sub_maker, "cues", []) or [])
                logger.info(f"[TTS] Cues collectées: {cue_count} cues")
                return sub_maker
            except Exception as e:
                if attempt < max_attempts - 1:
                    logger.warning(
                        f"[TTS] extraction cues tentative {attempt + 1}/{max_attempts} échouée: {e}, nouvelle tentative..."
                    )
                    await asyncio.sleep(3)
                    continue
                logger.error(f"[TTS] extraction cues échouée après {max_attempts} tentatives: {e}")
                raise RuntimeError(f"EdgeTTS cue extraction failed: {e}") from e


class SilentTTSEngine(TTSEngine):
    """静音占位 TTS 引擎.

    Génère un audio muet de durée spécifiée, utilisé lorsque l'utilisateur
    a désactivé la voix mais que les sous-temps sont toujours nécessaires.

    Returns:
        (audio_path, None) - audio path with None cues
    """

    async def generate(
        self,
        text: str,
        output_path: str,
        voice: str = "zh-CN-XiaoxiaoNeural",
        rate: str = "+0%",
        duration_sec: Optional[float] = None,
    ) -> Tuple[str, dict]:
        """Générer audio muet de durée spécifiée.

        Args:
            text: Texte (utilisé pour estimation de durée si duration_sec non fourni)
            output_path: Chemin de sortie audio
            voice: Ignoré en mode muet
            rate: Ignoré en mode muet
            duration_sec: Durée en secondes. Si non fourni, estimé à partir de la longueur du texte.

        Returns:
            (audio_path, empty_cues_dict) tuple
        """
        if duration_sec is None:
            # Estimation: chinois 4 caractères/seconde, fallback 1 seconde minimum
            duration_sec = max(len(text) / 4.0, 1.0)

        logger.info(f"[TTS] Génération audio muet: {duration_sec:.1f}s → {output_path}")

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        # Utiliser ffmpeg pour générer de l'audio muet
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", f"anullsrc=r=44100:cl=mono",
            "-t", str(duration_sec),
            "-c:a", "libmp3lame",
            "-q:a", "4",
            output_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        # Vérifier le code de retour ffmpeg
        if proc.returncode != 0:
            err_msg = stderr.decode(errors="replace")[:500] if stderr else ""
            raise RuntimeError(
                f"[TTS] ffmpeg muet génération échouée (code {proc.returncode}): {err_msg}"
            )

        # Retourner None pour cues (indique pas de SubMaker disponible)
        return output_path, None