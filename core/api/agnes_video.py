"""core.api.agnes_video — Agnes Video API 封装（从 core/video_generator.py 迁移）"""

import asyncio
import base64
import json
import logging
import mimetypes
import os
import time
from typing import Callable, List, Optional

import requests

from core.api.error_collector import collect_error, collect_error_from_exception
from core.api.rate_limiter import get_rate_limiter
from core.config import get_agnes_base_url, get_agnes_api_root
from utils.video import download_video

logger = logging.getLogger(__name__)

DURATION_PRESETS = {
    5: (73, 15),     # ~4.9s — 73 = 8*9+1 ✅
    7: (105, 15),    # 7.0s — 105 = 8*13+1 ✅
    10: (153, 15),   # 10.2s — 153 = 8*19+1 ✅ (was 151)
    12: (177, 15),   # 11.8s — 177 = 8*22+1 ✅ (was 181)
    15: (225, 15),   # 15.0s — 225 = 8*28+1 ✅ (was 226)
}


class VideoOutput:
    def __init__(self, fmt: str, ext: str, data: str):
        self.fmt = fmt
        self.ext = ext
        self.data = data

    def save(self, path: str) -> None:
        if self.fmt == "url":
            download_video(self.data, path)
        else:
            with open(path, "wb") as f:
                f.write(self.data if isinstance(self.data, bytes) else self.data.encode())


class AgnesVideoAPI:
    """Agnes Video 生成 API 封装（t2v / i2v / ti2vid / keyframes）。"""

    def __init__(
        self,
        api_key: str,
        model: str = "agnes-video-v2.0",
        default_duration: int = 5,
        max_retries: int = 6,
        retry_base_delay: float = 15.0,
        on_retry: Optional[Callable] = None,
    ):
        self.api_key = api_key
        self.model = model
        self.default_duration = default_duration
        self.max_retries = max_retries
        self.retry_base_delay = retry_base_delay
        self.on_retry = on_retry
        self.shutdown_event = None
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def _path_to_b64(self, path: str) -> str:
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
        mime = mimetypes.guess_type(path)[0] or "image/png"
        return f"data:{mime};base64,{b64}"

    async def _resolve_image_ref(self, ref: str) -> str:
        if ref.startswith(("http://", "https://")):
            return ref
        if ref.startswith("data:"):
            return ref
        if os.path.exists(ref):
            url_file = ref + ".url"
            # P12: 缓存过期检查（预签名 URL 有效期有限，超过 1 小时则重新上传）
            _URL_CACHE_MAX_AGE = 3600  # 1 小时
            if os.path.exists(url_file):
                try:
                    with open(url_file, "r", encoding="utf-8") as f:
                        cache_data = json.loads(f.read())
                    cached_url = cache_data.get("url", "")
                    cached_ts = cache_data.get("ts", 0)
                    age = time.time() - cached_ts
                    if cached_url and age < _URL_CACHE_MAX_AGE:
                        logger.info(
                            f"[AgnesVideo] Using cached hosted URL (age={age:.0f}s): "
                            f"{cached_url[:80]}..."
                        )
                        return cached_url
                    if cached_url:
                        logger.info(
                            f"[AgnesVideo] Cached URL expired (age={age:.0f}s), re-uploading"
                        )
                except (json.JSONDecodeError, OSError) as e:
                    logger.debug(f"[AgnesVideo] Failed to read cached URL: {e}")
                # 兼容旧格式纯文本缓存文件
                except Exception as e:
                    logger.debug(f"[AgnesVideo] Failed to read legacy URL cache: {e}")
            url = await self._upload_image_to_url(ref)
            if url:
                try:
                    cache_data = {"url": url, "ts": time.time()}
                    tmp_file = url_file + ".tmp"
                    with open(tmp_file, "w", encoding="utf-8") as f:
                        json.dump(cache_data, f)
                        f.flush()
                        os.fsync(f.fileno())
                    os.replace(tmp_file, url_file)
                except Exception as e:
                    logger.debug(f"[AgnesVideo] Failed to cache URL: {e}")
                return url
            logger.warning("[AgnesVideo] Image upload failed, falling back to base64.")
            return self._path_to_b64(ref)
        return ref

    async def _upload_image_to_url(self, image_path: str, retries: int = 3) -> Optional[str]:
        for attempt in range(retries):
            if self.shutdown_event and self.shutdown_event.is_set():
                logger.info("[AgnesVideo] Image upload cancelled by shutdown")
                return None
            try:
                b64_data = self._path_to_b64(image_path)
                payload = {
                    "model": "agnes-image-2.1-flash",
                    "prompt": "Keep the image exactly as it is",
                    "n": 1,
                    "size": "1024x1024",
                    "extra_body": {
                        "response_format": "url",
                        "image": b64_data,
                    },
                }
                logger.info(f"[AgnesVideo] Uploading image to hosted URL (attempt {attempt + 1}/{retries})...")
                await asyncio.to_thread(get_rate_limiter().acquire)
                resp = await asyncio.to_thread(
                    requests.post,
                    f"{get_agnes_base_url()}/images/generations",
                    headers=self.headers,
                    json=payload,
                    timeout=(30, 120),
                )
                if resp.status_code == 429:
                    delay = 30 * (attempt + 1)
                    logger.warning(f"[AgnesVideo] Image upload 429, retry in {delay}s...")
                    await asyncio.sleep(delay)
                    continue
                resp.raise_for_status()
                result = resp.json()
                data_list = result.get("data", [])
                if data_list:
                    url = data_list[0].get("url", "")
                    if url:
                        logger.info(f"[AgnesVideo] Image uploaded to hosted URL: {url[:80]}...")
                        return url
            except Exception as e:
                logger.warning(f"[AgnesVideo] Image upload attempt {attempt + 1}/{retries} failed: {e}")
                if attempt < retries - 1:
                    await asyncio.sleep(15)
        return None

    # API frame limits by resolution tier (from Agnes API error messages)
    _FRAME_LIMITS = {
        "1080p": 169,
        "720p": 409,
        "480p": 961,
    }

    @staticmethod
    def _normalize_frame_count(nf: int) -> int:
        """Round frame count down to nearest valid value: 8 * n + 1."""
        # 8n + 1 => n = (nf - 1) / 8, round down
        n = (nf - 1) // 8
        return max(1, 8 * n + 1)

    @staticmethod
    def _get_max_frames(width: int, height: int) -> int:
        """Get the maximum allowed num_frames for the given resolution (always 8n+1)."""
        pixels = width * height
        if pixels > 1280 * 720:
            return 169   # 1080p tier = 8*21+1
        elif pixels > 854 * 480:
            return 409   # 720p tier = 8*51+1
        else:
            return 961   # 480p tier = 8*120+1

    def _get_frame_config(self, duration: Optional[int] = None,
                          width: int = 1152, height: int = 768) -> tuple:
        d = duration or self.default_duration
        max_nf = self._get_max_frames(width, height)
        if d in DURATION_PRESETS:
            nf, fr = DURATION_PRESETS[d]
            if nf <= max_nf:
                return nf, fr
            # preset exceeds limit for this resolution, cap it
            capped = self._normalize_frame_count(max_nf)
            logger.warning(
                f"[AgnesVideo] Duration preset {d}s has {nf} frames, "
                f"exceeds {max_nf} for {width}x{height}. Capped to {capped}."
            )
            return capped, fr
        best = None
        for nf in range(9, min(410, max_nf + 1), 8):  # iterates 8n+1 values
            fr = round(nf / d)
            if 1 <= fr <= 60:
                best = (nf, fr)
        if best:
            return best
        # fallback: normalize the first valid 8n+1 value
        fallback_nf = self._normalize_frame_count(min(410, max_nf))
        return fallback_nf, round(fallback_nf / d) if d else 15

    async def _poll_task(self, video_id: str, interval: int = 3,
                          max_poll_duration: int = 1800,
                          max_consecutive_failures: int = 15,
                          progress_callback=None) -> dict:
        last_status = ""
        poll_count = 0
        consecutive_failures = 0
        start_time = asyncio.get_event_loop().time()
        curl_cmd = (
            f'curl -s -H "Authorization: Bearer $AGNES_API_KEY" '
            f'"{get_agnes_api_root()}/agnesapi?video_id={video_id}"'
        )
        while True:
            # M2: 每次轮询前检查停止信号
            if self.shutdown_event and self.shutdown_event.is_set():
                raise RuntimeError("Video generation cancelled by user")

            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > max_poll_duration:
                error_msg = (
                    f"[AgnesVideo] Polling timed out after {max_poll_duration}s "
                    f"for video {video_id[:16]}"
                )
                collect_error(
                    "video", "poll_task",
                    prompt=curl_cmd,
                    error_type="PollingTimeout",
                    error_message=error_msg,
                    extra={"video_id": video_id[:16], "elapsed_s": int(elapsed)},
                )
                raise RuntimeError(error_msg)

            # Polling adaptatif : les générations Full HD durent plusieurs minutes ;
            # on espace les requêtes pour ne pas saturer le quota de l'API
            # (le polling à 3 s consomme tout le budget → 429 sur les soumissions).
            effective_interval = interval
            if poll_count > 40:
                effective_interval = max(interval, 8)

            try:
                if poll_count % 10 == 0:
                    logger.info(f"[AgnesVideo] Polling video {video_id[:16]}... (poll #{poll_count + 1}, elapsed {elapsed:.0f}s)")
                # 全局限速：每次轮询都消耗一个令牌
                await asyncio.to_thread(get_rate_limiter().acquire)
                # M2: 用 wait_for 包裹以支持取消
                resp = await asyncio.wait_for(
                    asyncio.to_thread(
                        requests.get,
                        f"{get_agnes_api_root()}/agnesapi?video_id={video_id}",
                        headers=self.headers,
                        timeout=15,
                    ),
                    timeout=30,
                )
                resp.raise_for_status()
                result = resp.json()
                poll_count += 1
                consecutive_failures = 0  # reset on success

                # Detect API-level error responses (e.g. content_policy_violation)
                # These return HTTP 200 with {"error": {...}} and no "status" field
                error_obj = result.get("error")
                if error_obj and not result.get("status"):
                    error_code = error_obj.get("code", "unknown") if isinstance(error_obj, dict) else str(error_obj)
                    error_msg = error_obj.get("message", str(error_obj)) if isinstance(error_obj, dict) else str(error_obj)
                    collect_error(
                        "video", "poll_task",
                        prompt=curl_cmd,
                        error_type="ApiError",
                        error_message=f"API error: {error_code} - {error_msg}",
                        response_body=resp.text,
                        extra={"video_id": video_id[:16], "error_code": error_code},
                    )
                    raise RuntimeError(f"API error: {error_code} — {error_msg}")

                status = result.get("status", "")
                progress = result.get("progress", 0)

                if status != last_status:
                    logger.info(f"[AgnesVideo] Video {video_id[:16]}... status={status} progress={progress}%")
                    last_status = status

                if progress_callback:
                    result_cb = progress_callback(status, progress, curl_cmd)
                    if asyncio.iscoroutine(result_cb):
                        await result_cb

                if status in ("completed", "COMPLETED"):
                    return result

                if status in ("failed", "FAILED"):
                    err = result.get("error") or "unknown error"
                    error_msg = f"Video generation failed: {err}"
                    collect_error(
                        "video", "poll_task",
                        prompt=curl_cmd,
                        error_type="VideoFailed",
                        error_message=error_msg,
                        response_body=resp.text,
                        extra={"video_id": video_id[:16], "status": status},
                    )
                    raise RuntimeError(error_msg)
            except requests.exceptions.HTTPError as e:
                # 400/404 : « introuvable ou expirée » peut être transitoire
                # (instabilité/purge côté API Agnes) → fenêtre de grâce avant
                # abandon ; refus de contenu → définitif immédiat.
                status_code = getattr(e.response, 'status_code', 0) if hasattr(e, 'response') else 0
                if status_code == 429:
                    # Rate limit au polling : la vidéo n'est PAS perdue, on attend
                    # puis on reprend (sans brûler la fenêtre de grâce).
                    retry_after = 0
                    try:
                        ra = e.response.headers.get("Retry-After") if e.response else ""
                        retry_after = int(ra) if ra and str(ra).isdigit() else 0
                    except Exception:
                        retry_after = 0
                    pause = retry_after if retry_after > 0 else 8
                    logger.warning(
                        f"[AgnesVideo] 429 rate limit au polling de {video_id[:16]}, "
                        f"pause {pause}s (la vidéo reste en cours)..."
                    )
                    collect_error(
                        "video", "poll_task",
                        prompt=curl_cmd,
                        error_type="RateLimit429",
                        error_message="HTTP 429 au polling",
                        status_code=429,
                        response_body=getattr(e.response, "text", "")[:500],
                        extra={"video_id": video_id[:16], "pause_s": pause},
                    )
                    await asyncio.sleep(pause)
                    continue
                if status_code in (400, 404):
                    error_body = ""
                    try:
                        error_body = e.response.text if hasattr(e, 'response') and e.response else ""
                    except Exception:
                        pass
                    if "content_policy" in error_body or "Unable to generate" in error_body:
                        error_msg = "Ce prompt est refusé par l'API Agnes (politique de contenu). Essayez un prompt plus neutre comme : 'un enfant qui joue dans un jardin', 'un garçon qui court dans un parc', ou 'un enfant qui lit un livre'."
                        collect_error(
                            "video", "poll_task",
                            prompt=curl_cmd,
                            error_type="ContentPolicy",
                            error_message=error_msg,
                            status_code=status_code,
                            extra={"video_id": video_id[:16]},
                        )
                        raise RuntimeError(error_msg)
                    # Vidéo introuvable côté Agnes : on continue à poller pendant
                    # la fenêtre de grâce (le 400 peut être transitoire).
                    consecutive_failures += 1
                    logger.warning(
                        f"[AgnesVideo] Video {video_id[:16]} introuvable côté API "
                        f"({consecutive_failures}/{max_consecutive_failures}), "
                        f"polling continue (fenêtre de grâce)..."
                    )
                    if consecutive_failures >= max_consecutive_failures:
                        error_msg = (
                            f"Erreur API {status_code}: vidéo introuvable ou expirée ({video_id[:16]}) "
                            f"— l'API Agnes a perdu la vidéo pendant la génération. "
                            f"Relancez la tâche."
                        )
                        collect_error(
                            "video", "poll_task",
                            prompt=curl_cmd,
                            error_type="HttpError",
                            error_message=error_msg,
                            status_code=status_code,
                            extra={"video_id": video_id[:16]},
                        )
                        raise RuntimeError(error_msg)
                else:
                    # Autres erreurs HTTP → compter comme éphémère
                    consecutive_failures += 1
                    logger.warning(
                        f"[AgnesVideo] Poll HTTP error ({consecutive_failures}/{max_consecutive_failures}): {e}"
                    )
                    collect_error_from_exception(
                        "video", "poll_task",
                        exc=e, prompt=curl_cmd,
                        retry_count=consecutive_failures,
                        extra={"video_id": video_id[:16], "poll_count": poll_count},
                    )
                    if consecutive_failures >= max_consecutive_failures:
                        error_msg = (
                            f"[AgnesVideo] Échec du polling après {max_consecutive_failures} "
                            f"erreurs consécutives pour la vidéo {video_id[:16]}"
                        )
                        raise RuntimeError(error_msg)
            except (requests.exceptions.RequestException, asyncio.TimeoutError) as e:
                consecutive_failures += 1
                logger.warning(
                    f"[AgnesVideo] Poll error ({consecutive_failures}/{max_consecutive_failures}): {e}"
                )
                collect_error_from_exception(
                    "video", "poll_task",
                    exc=e, prompt=curl_cmd,
                    retry_count=consecutive_failures,
                    extra={"video_id": video_id[:16], "poll_count": poll_count},
                )
                if consecutive_failures >= max_consecutive_failures:
                    error_msg = (
                        f"[AgnesVideo] Échec du polling après {max_consecutive_failures} "
                        f"erreurs consécutives pour la vidéo {video_id[:16]}"
                    )
                    collect_error_from_exception(
                        "video", "poll_task",
                        exc=e, prompt=curl_cmd,
                        retry_count=max_consecutive_failures,
                        extra={"video_id": video_id[:16], "poll_count": poll_count},
                    )
                    raise RuntimeError(error_msg)

            await asyncio.sleep(effective_interval)

    async def _submit_with_retry(self, payload: dict, mode_desc: str,
                                 on_retry: Optional[Callable] = None) -> str:
        cb = on_retry or self.on_retry

        async def _notify(attempt: int, delay: float, reason: str) -> None:
            if cb:
                try:
                    await cb(attempt, delay, reason)
                except Exception:
                    pass  # ne jamais bloquer la boucle de retry

        frame_reductions_left = 2  # allow up to 2 frame-count reductions on 400
        for attempt in range(self.max_retries):
            if self.shutdown_event and self.shutdown_event.is_set():
                raise RuntimeError("Video generation cancelled by user")
            try:
                logger.info(f"[AgnesVideo] Submitting {mode_desc} (attempt {attempt + 1}/{self.max_retries})...")
                # 全局限速：在发起提交请求前获取令牌
                await asyncio.to_thread(get_rate_limiter().acquire)
                # M2: 缩短读超时从 180s 到 60s，使 stop() 更快生效
                resp = await asyncio.wait_for(
                    asyncio.to_thread(
                        requests.post,
                        f"{get_agnes_base_url()}/videos",
                        headers=self.headers,
                        json=payload,
                        timeout=(15, 60),
                    ),
                    timeout=90,
                )

                if resp.status_code == 200:
                    result = resp.json()
                    video_id = result.get("video_id") or result.get("task_id") or result.get("id")
                    if video_id:
                        return video_id

                if resp.status_code == 429:
                    # v8.0: backoff exponentiel + Retry-After via le rate limiter
                    retry_after = 0
                    try:
                        ra = resp.headers.get("Retry-After")
                        if ra and str(ra).isdigit():
                            retry_after = float(ra)
                    except Exception:
                        pass
                    delay = get_rate_limiter().handle_429(retry_after if retry_after > 0 else None)
                    logger.warning(
                        f"[AgnesVideo] 429 rate limit on {mode_desc}, "
                        f"retry {attempt + 1}/{self.max_retries} in {delay:.0f}s..."
                    )
                    collect_error(
                        "video", "submit_video",
                        prompt=payload.get("prompt", ""),
                        error_type="RateLimit429",
                        error_message="HTTP 429: rate limited",
                        status_code=429,
                        response_body=resp.text,
                        retry_count=attempt + 1,
                        extra={"mode": mode_desc, "delay_s": delay},
                    )
                    await _notify(attempt + 1, delay, "429 rate limit")
                    await asyncio.sleep(delay)
                    continue

                if resp.status_code >= 500:
                    delay = self.retry_base_delay * (attempt + 1)
                    logger.warning(
                        f"[AgnesVideo] {resp.status_code} server error on {mode_desc}, "
                        f"retry {attempt + 1}/{self.max_retries} in {delay:.0f}s..."
                    )
                    collect_error(
                        "video", "submit_video",
                        prompt=payload.get("prompt", ""),
                        error_type=f"HTTP{resp.status_code}",
                        error_message=f"HTTP {resp.status_code}: server error",
                        status_code=resp.status_code,
                        response_body=resp.text,
                        retry_count=attempt + 1,
                        extra={"mode": mode_desc},
                    )
                    await _notify(attempt + 1, delay, f"HTTP {resp.status_code}")
                    await asyncio.sleep(delay)
                    continue

                # HTTP 400 with num_frames issue → reduce frames and retry
                error_text = resp.text[:500]
                if (resp.status_code == 400
                        and "num_frames" in error_text
                        and frame_reductions_left > 0):
                    old_nf = payload.get("num_frames", 0)
                    new_nf = self._normalize_frame_count(old_nf - 8)
                    if new_nf < 1 or new_nf >= old_nf:
                        new_nf = max(old_nf - 16, 1)
                    new_nf = self._normalize_frame_count(new_nf)
                    logger.warning(
                        f"[AgnesVideo] 400 num_frames error ({old_nf} frames), "
                        f"normalized to {new_nf} and retrying "
                        f"({frame_reductions_left} reductions left)..."
                    )
                    collect_error(
                        "video", "submit_video",
                        prompt=payload.get("prompt", ""),
                        error_type="NumFramesExceeded",
                        error_message=f"HTTP 400: num_frames {old_nf} exceeded, reducing to {new_nf}",
                        status_code=400,
                        response_body=resp.text,
                        retry_count=attempt + 1,
                        extra={"mode": mode_desc, "old_nf": old_nf, "new_nf": new_nf},
                    )
                    payload["num_frames"] = new_nf
                    frame_reductions_left -= 1
                    continue

                logger.error(f"[AgnesVideo] HTTP {resp.status_code}: {error_text}")
                collect_error(
                    "video", "submit_video",
                    prompt=payload.get("prompt", ""),
                    error_type="HTTPError",
                    error_message=f"HTTP {resp.status_code}: {error_text}",
                    status_code=resp.status_code,
                    response_body=resp.text,
                    retry_count=attempt + 1,
                    extra={"mode": mode_desc},
                )
                raise RuntimeError(f"Agnes video submit failed (HTTP {resp.status_code}): {error_text}")

            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError,
                        asyncio.TimeoutError) as e:
                # 每次失败都记录（包括中间重试）
                collect_error_from_exception(
                    "video", "submit_video",
                    exc=e, prompt=payload.get("prompt", ""),
                    retry_count=attempt + 1,
                    extra={"mode": mode_desc},
                )
                if attempt < self.max_retries - 1:
                    delay = self.retry_base_delay * (attempt + 1)
                    logger.warning(
                        f"[AgnesVideo] {type(e).__name__} on {mode_desc}, "
                        f"retry {attempt + 1}/{self.max_retries} in {delay:.0f}s..."
                    )
                    await _notify(attempt + 1, delay, type(e).__name__)
                    await asyncio.sleep(delay)
                    continue
                raise

        collect_error(
            "video", "submit_video",
            prompt=payload.get("prompt", ""),
            error_type="RetriesExhausted",
            error_message=f"{mode_desc}: max retries ({self.max_retries}) exceeded",
            retry_count=self.max_retries,
            extra={"mode": mode_desc},
        )
        raise RuntimeError(
            f"[AgnesVideo] {mode_desc}: max retries ({self.max_retries}) exceeded"
        )

    async def generate_single_video(
        self,
        prompt: str,
        reference_image_paths: List[str] = [],
        duration: Optional[int] = None,
        width: int = 1152,
        height: int = 768,
        seed: Optional[int] = None,
        negative_prompt: Optional[str] = None,
        progress_callback=None,
        **kwargs,
    ) -> VideoOutput:
        video_id = await self.submit_video(
            prompt=prompt,
            reference_image_paths=reference_image_paths,
            duration=duration,
            width=width,
            height=height,
            seed=seed,
            negative_prompt=negative_prompt,
            **kwargs,
        )
        return await self.wait_for_video(video_id, progress_callback)

    async def submit_video(
        self,
        prompt: str,
        reference_image_paths: List[str] = [],
        duration: Optional[int] = None,
        width: int = 1152,
        height: int = 768,
        seed: Optional[int] = None,
        negative_prompt: Optional[str] = None,
        **kwargs,
    ) -> str:
        num_frames, frame_rate = self._get_frame_config(duration, width, height)

        payload: dict = {
            "model": self.model,
            "prompt": prompt,
            "width": width,
            "height": height,
            "num_frames": num_frames,
            "frame_rate": frame_rate,
        }

        if seed is not None:
            payload["seed"] = seed
        if negative_prompt:
            payload["negative_prompt"] = negative_prompt

        # Pass through any extra quality parameters (guidance_scale, motion_bucket_id, etc.)
        # API ignores unsupported params gracefully
        for k, v in kwargs.items():
            if v is not None:
                payload[k] = v

        resolved_refs = []
        for p in reference_image_paths:
            resolved_refs.append(await self._resolve_image_ref(p))
        n_refs = len(resolved_refs)

        if n_refs == 0:
            mode_desc = "text-to-video"
        elif n_refs == 1:
            payload["image"] = resolved_refs[0]
            payload["mode"] = "ti2vid"
            mode_desc = "image-to-video"
        else:
            payload["extra_body"] = {
                "image": resolved_refs,
                "mode": "keyframes",
            }
            mode_desc = f"keyframes ({n_refs} frames)"

        logger.info(f"[AgnesVideo] {mode_desc}: {prompt[:80]}...")

        video_id = await self._submit_with_retry(payload, mode_desc)
        # Conserve le payload pour l'auto-relance si l'API perd la vidéo pendant
        # la génération (erreur « introuvable ou expirée » au polling).
        self._last_payload = payload
        self._last_mode_desc = mode_desc
        logger.info(f"[AgnesVideo] Video submitted: {video_id[:20]}...")
        return video_id

    async def wait_for_video(self, video_id: str, progress_callback=None,
                             max_poll_duration: int = 1800) -> VideoOutput:
        try:
            final = await self._poll_task(
                video_id,
                progress_callback=progress_callback,
                max_poll_duration=max_poll_duration,
            )
        except RuntimeError as e:
            # Auto-relance : si l'API a perdu/expiré la vidéo pendant la
            # génération, on resoumet une seule fois au lieu de faire échouer
            # la tâche (l'utilisateur aurait dû relancer manuellement).
            if "introuvable ou expirée" in str(e) and getattr(self, "_last_payload", None):
                logger.warning(
                    f"[AgnesVideo] Vidéo {video_id[:16]} perdue par l'API — "
                    "relance automatique de la génération (1 seule relance)..."
                )
                collect_error(
                    "video", "submit_video",
                    prompt=self._last_payload.get("prompt", ""),
                    error_type="AutoRetryVideoLost",
                    error_message=f"Vidéo perdue par l'API ({video_id[:16]}), resoumission automatique",
                    retry_count=1,
                    extra={"mode": self._last_mode_desc, "old_video_id": video_id[:16]},
                )
                video_id = await self._submit_with_retry(
                    self._last_payload, self._last_mode_desc
                )
                final = await self._poll_task(
                    video_id,
                    progress_callback=progress_callback,
                    max_poll_duration=max_poll_duration,
                )
            else:
                raise

        video_url = (
            final.get("remixed_from_video_id")
            or final.get("video_url")
            or final.get("url")
        )
        if not video_url:
            data = final.get("data", {})
            if isinstance(data, dict):
                video_url = data.get("video_url") or data.get("url")
            if not video_url:
                raise RuntimeError(f"Agnes video: no URL in completed task: {final}")

        # v8.0: vérifier que l'URL est accessible avant de la renvoyer
        if not await self._verify_video_url(video_url):
            logger.warning(
                f"[AgnesVideo] Video URL not accessible: {video_url[:80]}... "
                f"Attempting auto-relance..."
            )
            if getattr(self, "_last_payload", None):
                video_id = await self._submit_with_retry(
                    self._last_payload, self._last_mode_desc
                )
                final = await self._poll_task(
                    video_id,
                    progress_callback=progress_callback,
                    max_poll_duration=max_poll_duration,
                )
                video_url = (
                    final.get("video_url")
                    or final.get("url")
                    or final.get("remixed_from_video_id")
                )
                if not video_url:
                    raise RuntimeError(f"Agnes video: no URL after auto-relance: {final}")

        logger.info(f"[AgnesVideo] Done: {video_url[:80]}...")
        return VideoOutput(fmt="url", ext="mp4", data=video_url)

    async def _verify_video_url(self, url: str, timeout: int = 10) -> bool:
        """Vérifie qu'une URL de vidéo est accessible (HEAD request).

        v8.0 : évite de renvoyer une URL morte à la chaîne de traitement.
        """
        if not url or not url.startswith(("http://", "https://")):
            return True  # URL locale ou non-HTTP : on ne peut pas vérifier
        try:
            resp = await asyncio.wait_for(
                asyncio.to_thread(
                    requests.head,
                    url,
                    headers=self.headers,
                    timeout=timeout,
                    allow_redirects=True,
                ),
                timeout=timeout + 5,
            )
            return resp.status_code < 400
        except Exception as e:
            logger.debug(f"[AgnesVideo] URL verification failed: {e}")
            return False
