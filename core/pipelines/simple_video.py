"""core.pipelines.simple_video — 简单视频生成流水线（类型 1）

用户输入 prompt → 选择模式（t2v/i2v/keyframes）→ 调用 Agnes Video API → 返回视频。
v7.0：新增 TTS 音频旁白叠加（真实感语音 + 音量增强）。
"""

import asyncio
import logging
import os
import re
import time
from typing import Callable, Optional

from core.api.agnes_video import AgnesVideoAPI
from core.audio.tts import EdgeTTSEngine, SilentTTSEngine
from core.pipelines import BasePipeline, PipelineShutdown
from models.task import SimpleVideoTask, StepStatus

logger = logging.getLogger(__name__)


class SimpleVideoPipeline(BasePipeline):
    """简单视频生成流水线。

    步骤：参数校验 → 提交视频任务 → 轮询等待 → 下载保存。
    支持 resume：通过 task.json 中保存的 video_id 恢复轮询。
    """

    def __init__(
        self,
        api_key: str,
        task_id: str,
        dir_name: str = None,
        chat_model: str = "agnes-2.0-flash",
        image_model: str = "agnes-image-2.1-flash",
        video_model: str = "agnes-video-v2.0",
        progress_callback: Optional[Callable] = None,
        shutdown_event: Optional[asyncio.Event] = None,
    ):
        super().__init__(api_key, task_id, dir_name, progress_callback, shutdown_event)
        self.video_api = AgnesVideoAPI(
            api_key=api_key,
            model=video_model,
            on_retry=self._on_video_submit_retry,
        )
        self.video_api.shutdown_event = shutdown_event

    async def _on_video_submit_retry(self, attempt: int, delay: float, reason: str) -> None:
        """Informe l'utilisateur pendant les nouvelles tentatives d'envoi à l'API vidéo."""
        await self._emit(
            "video_gen", "running",
            f"API vidéo occupée ({reason}) — nouvel essai {attempt}/6 dans {delay:.0f}s...",
            0.2,
        )

    async def run(self, state: SimpleVideoTask) -> str:
        """执行简单视频生成流水线。"""
        self._state = state
        self._state.status = StepStatus.RUNNING
        self.task_manager.create(self._state)

        await self._emit("init", "running", "Démarrage de la génération...", 0.0)

        try:
            video_path = await self._submit_and_wait()

            # 水印后处理（共享实现）
            video_path = self._apply_watermark(video_path)

            # v7.0: TTS 音频旁白生成 + 叠加
            video_path = await self._generate_audio_overlay(video_path)

            # v7.1: Qualité améliorée (post-processing sharpening + contrast)
            video_path = await self._quality_enhance(video_path)

            self._state.status = StepStatus.COMPLETED
            self._state.final_video_file = video_path
            self.task_manager.update_state(
                status=StepStatus.COMPLETED,
                final_video_file=video_path,
            )
            await self._emit("done", "completed", "Vidéo générée avec succès !", 1.0, {"final_video": video_path})
            return video_path

        except PipelineShutdown as e:
            logger.info(f"[Simple] Shutdown: {e}")
            await self._emit("error", "failed", "Tâche interrompue. Vous pouvez la reprendre depuis la liste.", 0.0)
            raise
        except Exception as e:
            self._state.status = StepStatus.FAILED
            self.task_manager.update_state(status=StepStatus.FAILED)
            await self._emit("error", "failed", str(e), 0.0)
            raise

    # ------------------------------------------------------------------
    # 水印语言来源（共享 _apply_watermark 用）
    # ------------------------------------------------------------------

    def _get_watermark_language_text(self) -> str:
        return self._state.prompt

    async def _submit_and_wait(self) -> str:
        """提交视频任务并等待完成。支持 resume。"""
        video_path = os.path.join(self.working_dir, "final_video.mp4")

        if os.path.exists(video_path):
            logger.info("[Simple] Video already exists, skipping")
            return video_path

        # 轮询超时随视频时长缩放（API 渲染约为实时 10-20x，长视频需要更多时间）
        poll_timeout = max(900, (self._state.duration or 5) * 120)

        # 进度回调：将 API 进度 (0-100) 归一化为前端 0.3-0.9。
        # Agnes API 在渲染期间经常只返回 progress=0 直到完成，
        # 因此叠加一个时间驱动的“蠕变”分量，让进度条保持移动，
        # 避免 UI 长时间冻结在 30%。
        _wait_started = time.time()

        async def _api_progress(status, progress, curl_cmd):
            elapsed_min = max(0.0, (time.time() - _wait_started) / 60.0)
            creep = min(0.35, elapsed_min * 0.10)  # +10%/min, plafonné à +35%
            normalized = min(0.85, 0.3 + (progress / 100.0) * 0.6 + creep)
            if status in ("queued", "QUEUED", "") and progress == 0:
                msg = "En attente dans la file du serveur Agnes..."
            elif progress > 0:
                msg = f"Génération vidéo... {progress}%"
            else:
                msg = f"Génération vidéo en cours... ({elapsed_min:.0f} min écoulée)"
            await self._emit("video_gen", "running", msg, normalized)

        # 尝试从 task.json 恢复（resume 场景）
        saved_video_id = self._load_task_json(self.working_dir)
        if saved_video_id:
            logger.info(f"[Simple] Resuming from saved task.json video_id: {saved_video_id}")
            self._state.video_id = saved_video_id
            self.task_manager.update_state(video_id=saved_video_id)
            await self._emit("video_gen", "running", f"Génération vidéo {saved_video_id[:16]}...", 0.3)
            video_output = await self.video_api.wait_for_video(
                saved_video_id,
                progress_callback=_api_progress,
                max_poll_duration=poll_timeout,
            )
            video_output.save(video_path)
            return video_path

        # 也检查 state 中的 video_id（旧版 resume 兼容）
        if self._state.video_id:
            logger.info(f"[Simple] Resuming from state video_id: {self._state.video_id}")
            self._save_task_json(self.working_dir, {"video_id": self._state.video_id})
            await self._emit("video_gen", "running", f"Génération vidéo {self._state.video_id[:16]}...", 0.3)
            video_output = await self.video_api.wait_for_video(
                self._state.video_id,
                progress_callback=_api_progress,
                max_poll_duration=poll_timeout,
            )
            video_output.save(video_path)
            return video_path

        # 构建参考图列表
        ref_images = []
        if self._state.reference_image:
            ref_images.append(self._state.reference_image)
        if self._state.end_frame_image:
            ref_images.append(self._state.end_frame_image)

        await self._emit("video_gen", "running", f"Soumission de la tâche vidéo (mode={self._state.mode})...", 0.1)

        # 分隔符跟随用户 prompt 语言
        _has_chinese = bool(re.search(r'[\u4e00-\u9fff]', self._state.prompt))
        _sep = "--- 请严格按照以下描述生成图像/视频 ---" if _has_chinese else "--- Generate image/video strictly based on the following description ---"
        full_prompt = f"{self._state.system_prompt.strip()}\n\n{_sep}\n{self._state.prompt}" if self._state.system_prompt.strip() else self._state.prompt
        # v7.1: Qualité API — ajouter des paramètres supplémentaires pour boost
        extra_kwargs = {}
        if self._state.quality_boost:
            extra_kwargs = {
                "cfg_scale": 7.0,         # stronger prompt adherence
                "steps": 50,               # more denoising steps = better quality
                "motion_bucket_id": 127,   # smoother, more natural motion
            }
        video_id = await self.video_api.submit_video(
            prompt=full_prompt,
            reference_image_paths=ref_images,
            duration=self._state.duration,
            width=self._state.video_width,
            height=self._state.video_height,
            seed=self._state.seed,
            negative_prompt=self._state.negative_prompt,
            **extra_kwargs,
        )

        # 持久化 video_id + curl 命令
        self._state.video_id = video_id
        self._save_task_json(self.working_dir, {"video_id": video_id})
        self.task_manager.update_state(video_id=video_id)

        await self._emit("video_gen", "running", f"Génération vidéo {video_id[:16]}...", 0.3)

        video_output = await self.video_api.wait_for_video(
            video_id,
            progress_callback=_api_progress,
            max_poll_duration=poll_timeout,
        )
        video_output.save(video_path)

        await self._emit("video_gen", "completed", "Vidéo générée", 0.9)
        return video_path

    # ------------------------------------------------------------------
    # v7.0: TTS 音频旁白生成 + 叠加
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # v7.1: Audio Sync Fix + Quality Enhancement
    # ------------------------------------------------------------------

    async def _generate_audio_overlay(self, video_path: str) -> str:
        """Generate TTS narration and overlay onto video with perfect audio sync.

        - edge_tts Azure Neural Voices for realistic French narration
        - ffmpeg filter_complex for frame-perfect alignment:
          • tpad to freeze last frame if video is shorter
          • apad + loudnorm for clean audio padding + consistent volume
          • Explicit stream mapping prevents desync
        """
        if not self._state.audio_enabled:
            logger.info("[Simple] Audio disabled by user, skipping")
            return video_path

        self._state.step_audio = StepStatus.RUNNING
        self.task_manager.update_state(step_audio=StepStatus.RUNNING)
        await self._emit("audio", "running", "Génération de la narration audio...", 0.91)

        combined_audio = os.path.join(self.working_dir, "narration.wav")
        self._state.combined_audio = combined_audio
        narration_text = self._state.prompt.strip()
        os.makedirs(self.working_dir, exist_ok=True)

        try:
            if narration_text:
                tts = EdgeTTSEngine()
                sub_maker = await tts.generate(
                    text=narration_text,
                    output_path=combined_audio,
                    voice=self._state.audio_voice,
                    rate=self._state.audio_rate,
                )
                logger.info(
                    f"[Simple] TTS audio generated: {combined_audio} "
                    f"(voice={self._state.audio_voice}, {len(narration_text)} chars)"
                )
            else:
                logger.info("[Simple] No narration text, silent track")
                silent = SilentTTSEngine()
                await silent.generate(text="", output_path=combined_audio, duration=15.0)
        except Exception as e:
            logger.warning(f"[Simple] TTS generation failed (non-fatal): {e}")
            await self._emit("audio", "failed", "Audio indisponible", 0.93)
            self._state.step_audio = StepStatus.FAILED
            self.task_manager.update_state(step_audio=StepStatus.FAILED)
            return video_path

        # ── Step 2: ffmpeg frame-perfect overlay ──
        output_path = video_path.replace(".mp4", "_audio.mp4")
        if output_path == video_path:
            output_path = video_path.replace("final_video", "final_video_audio")

        try:
            import json, subprocess

            def _probe(path: str) -> dict:
                r = subprocess.run(
                    ["ffprobe", "-v", "quiet", "-print_format", "json",
                     "-show_format", "-show_streams", path],
                    capture_output=True, text=True, timeout=15)
                return json.loads(r.stdout) if r.stdout else {}

            v_info = _probe(video_path)
            v_dur = float(v_info.get("format", {}).get("duration", 0))
            a_info = _probe(combined_audio) if os.path.exists(combined_audio) else {}
            a_dur = float(a_info.get("format", {}).get("duration", 0))

            if v_dur <= 0:
                logger.warning("[Simple] Could not probe video, skipping audio")
                return video_path

            final_dur = max(v_dur, a_dur)
            # v7.2: Durée maximale garantie 15 s (reels) — une narration trop longue
            # est tronquée proprement au lieu de rallonger la vidéo au-delà de 15 s.
            _MAX_REEL_DURATION = 15.0
            if final_dur > _MAX_REEL_DURATION:
                logger.info(
                    f"[Simple] Narration dépasse {_MAX_REEL_DURATION:.0f}s "
                    f"({final_dur:.1f}s) — troncature à {_MAX_REEL_DURATION:.0f}s"
                )
                final_dur = _MAX_REEL_DURATION
            logger.info(f"[Simple] Overlay: video={v_dur:.3f}s audio={a_dur:.3f}s final={final_dur:.3f}s")

            # Build filter_complex chain
            filters = []
            needs_apad = a_dur > 0 and a_dur < final_dur - 0.1
            needs_atrim = a_dur > final_dur + 0.1
            needs_tpad = v_dur < final_dur - 0.1

            # Audio: pad + loudnorm (consistent volume, no clipping)
            if needs_atrim:
                filters.append(
                    f"[1:a]atrim=0:{final_dur:.3f},asetpts=PTS-STARTPTS,"
                    f"loudnorm=I=-16:LRA=11:TP=-1.5[a]"
                )
            elif needs_apad:
                pad_dur = final_dur - a_dur
                filters.append(f"[1:a]apad=pad_dur={pad_dur:.3f},loudnorm=I=-16:LRA=11:TP=-1.5[a]")
            elif a_dur > 0:
                filters.append("[1:a]loudnorm=I=-16:LRA=11:TP=-1.5[a]")
            else:
                filters.append("[1:a]anull[a]")

            # Video: freeze last frame if shorter
            if needs_tpad:
                pad_dur = final_dur - v_dur
                filters.insert(0, f"[0:v]tpad=stop_mode=clone:stop_duration={pad_dur:.3f}[v]")
                v_tag = "[v]"
            else:
                filters.insert(0, "[0:v]null[v]")
                v_tag = "[v]"

            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-i", combined_audio,
                "-filter_complex", "; ".join(filters),
                "-map", v_tag, "-map", "[a]",
                "-c:v", "libx264", "-preset", "slow", "-crf", "18",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
                "-shortest",
                "-avoid_negative_ts", "make_zero",
                "-fflags", "+genpts",
                "-movflags", "+faststart",
                output_path,
            ]
            logger.info(f"[Simple] ffmpeg overlay starting...")
            subprocess.run(cmd, check=True, capture_output=True, timeout=180)

            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                os.replace(output_path, video_path)
                logger.info(f"[Simple] Audio overlay complete: {video_path}")
            else:
                logger.warning("[Simple] ffmpeg overlay empty, keeping original")

            self._state.step_audio = StepStatus.COMPLETED
            self._state.combined_audio = combined_audio
            self.task_manager.update_state(step_audio=StepStatus.COMPLETED, combined_audio=combined_audio)
            await self._emit("audio", "completed", "Narration audio ajoutée ✓", 0.95)

        except Exception as e:
            logger.warning(f"[Simple] Audio overlay failed (non-fatal): {e}")
            await self._emit("audio", "failed", "Audio non disponible", 0.93)
            self._state.step_audio = StepStatus.FAILED
            self.task_manager.update_state(step_audio=StepStatus.FAILED)

        return video_path

    # ------------------------------------------------------------------
    # v7.1: Quality Enhancement — post-processing for more realistic video
    # ------------------------------------------------------------------

    async def _quality_enhance(self, video_path: str) -> str:
        """Apply post-processing filters for higher quality, more realistic video.

        Performed only when quality_boost is enabled.
        Uses ffmpeg filters:
        - unsharp: sharpens details
        - eq: contrast & saturation boost for richer colors
        - deband: removes color banding artifacts
        - Higher CRF + slow preset for cleaner encoding
        """
        if not self._state.quality_boost:
            return video_path

        logger.info("[Simple] Quality boost enabled — applying post-processing...")
        await self._emit("quality", "running", "Amélioration de la qualité vidéo...", 0.96)

        output_path = video_path.replace(".mp4", "_enhanced.mp4")
        if output_path == video_path:
            output_path = video_path.replace("final_video", "final_video_enhanced")

        try:
            import subprocess
            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                # Quality filters for realism
                "-vf", "unsharp=5:5:0.8:3:3:0.4,eq=contrast=1.1:saturation=1.15,deband=1:0.2:1:0.1",
                "-c:v", "libx264",
                "-preset", "slow",
                "-crf", "17",             # even higher quality than default 18
                "-pix_fmt", "yuv420p",
                "-c:a", "copy",            # keep audio untouched
                "-movflags", "+faststart",
                output_path,
            ]
            subprocess.run(cmd, check=True, capture_output=True, timeout=300)
            logger.info(f"[Simple] Quality enhancement done: {output_path}")

            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                os.replace(output_path, video_path)
                await self._emit("quality", "completed", "Qualité améliorée ✓", 0.98)
            else:
                logger.warning("[Simple] Quality enhancement produced empty output")
                await self._emit("quality", "failed", "Amélioration impossible", 0.96)

        except Exception as e:
            logger.warning(f"[Simple] Quality enhancement failed (non-fatal): {e}")
            await self._emit("quality", "failed", "Amélioration impossible", 0.96)

        return video_path
