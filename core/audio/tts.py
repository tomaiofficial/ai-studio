"""core.audio.tts — TTS 统一接口：EdgeTTSEngine + SilentTTSEngine + GeminiTTSEngine

基于 edge_tts（免费 Azure Edge TTS）和静音占位两种实现。
也支持 Google Gemini TTS（免费，voix très réaliste）。
"""

import asyncio
import logging
import os
import base64
from abc import ABC, abstractmethod
from typing import Optional, Tuple

import edge_tts
import httpx

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
    """基于 edge_tts 的免费 TTS 引擎。

    generate() 返回 (audio_path, sub_maker)，其中 sub_maker 是 edge_tts.SubMaker 实例，
    包含逐词时间戳 cues，可用于生成 SRT 字幕。
    """

    async def generate(
        self, text: str, output_path: str, voice: str = "zh-CN-XiaoxiaoNeural", rate: str = "+0%"
    ) -> Tuple[str, "edge_tts.SubMaker"]:
        """生成 TTS 音频 + SubMaker（含 cues 时间戳）。

        Args:
            text: 要朗读的文本
            output_path: 输出音频文件路径（.mp3）
            voice: edge_tts 语音角色
            rate: 语速调节（如 "+0%", "+20%", "-10%"）

        Returns:
            (audio_path, sub_maker) 元组

        Raises:
            RuntimeError: TTS 生成失败时抛出，调用方应降级到 SilentTTSEngine。
        """
        logger.info(f"[TTS] Generating audio: voice={voice}, rate={rate}, text={len(text)} chars...")

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        max_attempts = 2
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
                # 清理半成品文件
                for p in (tmp_path, output_path):
                    if os.path.exists(p):
                        try:
                            os.remove(p)
                        except OSError:
                            pass
                if attempt < max_attempts - 1:
                    logger.warning(f"[TTS] edge_tts attempt {attempt + 1}/{max_attempts} failed: {e}, retrying...")
                    await asyncio.sleep(3)
                    continue
                logger.error(f"[TTS] edge_tts failed after {max_attempts} attempts: {e}")
                raise RuntimeError(f"EdgeTTS generation failed: {e}") from e

    async def harvest_cues(
        self, text: str, voice: str = "zh-CN-XiaoxiaoNeural", rate: str = "+0%"
    ) -> "edge_tts.SubMaker":
        """仅采集逐词时间戳，不生成/不落盘音频字节（路径 B：音频关、字幕开）。

        edge_tts 的 WordBoundary 与音频数据交织于同一 stream，需消费完整 stream
        才能收齐全部 cues；本方法只把 WordBoundary/SentenceBoundary 喂给 SubMaker，
        音频数据直接丢弃。返回含 .cues 的 sub_maker，供 generate_cue_aware_srt 使用.

        字幕只需时间线真值，不需音频字节——这正是「cues 采集」与「音频输出」解耦的核心.

        Args:
            text: 要朗读的文本
            voice: edge_tts 语音角色
            rate: 语速调节

        Returns:
            含逐词 cues 的 edge_tts.SubMaker 实例

        Raises:
            RuntimeError: 采集失败时抛出，调用方应降级到 SilentTTSEngine（字幕回退 legacy）。
        """
        logger.info(
            f"[TTS] Harvesting cues only: voice={voice}, rate={rate}, text={len(text)} chars..."
        )

        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
                sub_maker = edge_tts.SubMaker()
                async for chunk in communicate.stream():
                    if chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                        sub_maker.feed(chunk)
                cue_count = len(getattr(sub_maker, "cues", []) or [])
                logger.info(f"[TTS] Cues harvested: {cue_count} cues")
                return sub_maker
            except Exception as e:
                if attempt < max_attempts - 1:
                    logger.warning(
                        f"[TTS] harvest_cues attempt {attempt + 1}/{max_attempts} "
                        f"failed: {e}, retrying..."
                    )
                    await asyncio.sleep(3)
                    continue
                logger.error(f"[TTS] harvest_cues failed after {max_attempts} attempts: {e}")
                raise RuntimeError(f"EdgeTTS cue harvest failed: {e}") from e


class GeminiTTSEngine:
    """Google Gemini TTS引擎 - voix très réaliste et naturelle.

    Utilise l'API Gemini TTS (gemini-2.5-flash-preview-tts) avec des voix
    naturelles supportant les styles : naturel, calme, dynamique, narrateur.

    Clé API gratuite : https://aistudio.google.com/apikey
    """

    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.environ.get("GEMINI_TTS_KEY", "")
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:speech"
        self.style_map = {
            "natural": {"voice": "AURA"},
            "calm": {"voice": "PREMIUM"},
            "dynamic": {"voice": "AURA"},
            "narrator": {"voice": "OSTEEMICA"},
        }

    async def generate(
        self, text: str, output_path: str, voice_style: str = "natural", rate: float = 0.9
    ) -> Tuple[str, dict]:
        """Générer audio via Google Gemini TTS.

        Args:
            text: Texte à convertir
            output_path: Chemin de sortie audio (.wav)
            voice_style: Style de voix (natural, calm, dynamic, narrator)
            rate: Taux de parole (0.9 par défaut)

        Returns:
            (audio_path, metadata) tuple

        Raises:
            RuntimeError: Clé API non configurée ou erreur API.
        """
        if not self.api_key:
            raise RuntimeError("Google Gemini API key not configured. Set GEMINI_TTS_KEY env var or pass api_key.")

        style = self.style_map.get(voice_style, self.style_map["natural"])
        url = f"{self.base_url}?key={self.api_key}"

        payload = {
            "input": text,
            "voice": style["voice"],
            "audioConfig": {
                "audioEncoding": "WAV",
                "speakingRate": rate,
                "pitch": 0.0,
                "volumeGainDb": 0.0,
            },
        }

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, json=payload)
            if response.status_code != 200:
                raise RuntimeError(f"Gemini TTS HTTP {response.status_code}: {response.text}")

            data = response.json()
            if not data.get("audio"):
                raise RuntimeError("Gemini TTS: no audio data returned")

            # Convertir base64 vers fichier WAV
            base64_audio = data["audio"].replace("data:audio/wav;base64,", "")
            byte_chars = base64.b64decode(base64_audio)
            byte_numbers = bytearray(byte_chars)

            with open(output_path, "wb") as f:
                f.write(byte_numbers)

            metadata = {
                "voice_style": voice_style,
                "duration_estimate": len(text) / 150.0,  # estimation rough
                "api": "gemini",
            }
            return output_path, metadata

    async def harvest_cues(self, text: str, voice_style: str = "natural") -> dict:
        """Collecter les cues de temps sans générer d'audio.

        Pour Gemini TTS, on retourne des estimates de durée basées sur le texte.
        Les cues réelles viendraient de l'API de synthesis avec time_stamps.
        Pour l'instant, on estime basément sur le nombre de caractères.
        """
        estimated_duration = max(len(text) / 150.0, 1.0)
        return {
            "voice_style": voice_style,
            "estimated_duration": estimated_duration,
            "cues": [],  # Gemini ne fournit pas de cues word-level gratuites
        }


class SilentTTSEngine(TTSEngine):
    """静音占位 TTS 引擎.

    生成指定时长的静音音频，返回空 cues。用于用户关闭旁白时仍需要字幕时间轴的场景.
    """

    async def generate(
        self,
        text: str,
        output_path: str,
        voice: str = "zh-CN-XiaoxiaoNeural",
        rate: str = "+0%",
        duration_sec: Optional[float] = None,
    ) -> Tuple[str, dict]:
        """生成静音音频.

        Args:
            text: 文本（用于估算时长，如果 duration_sec 未提供）
            output_path: 输出音频文件路径
            voice: 忽略（静音模式）
            rate: 忽略（静音模式）
            duration_sec: 指定静音时长（秒），如果不提供则按文本长度估算

        Returns:
            (audio_path, empty_cues_dict) 元组
        """
        if duration_sec is None:
            # 估算时长：中文 4 字/秒
            duration_sec = max(len(text) / 4.0, 1.0)

        logger.info(f"[TTS] Generating silent audio: {duration_sec:.1f}s → {output_path}")

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        # 使用 ffmpeg 生成静音音频
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

        # P9: 检查 ffmpeg 返回码，失败时抛出异常而非静默返回
        if proc.returncode != 0:
            err_msg = stderr.decode(errors="replace")[:500] if stderr else ""
            raise RuntimeError(
                f"[TTS] ffmpeg silent generation failed (code {proc.returncode}): {err_msg}"
            )

        # 返回空 cues（用 None 而非 {}，让下游正确识别为无 SubMaker 可用）
        return output_path, None