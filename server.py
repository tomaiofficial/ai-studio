"""
Agnes Video Generator v2.0 — FastAPI 服务层

三种任务类型的路由集成：
- POST /api/tasks/simple      — 简单视频生成
- POST /api/tasks/creative    — 创意长视频生成
- POST /api/tasks/manuscript  — 稿件长视频生成
- POST /api/tasks/poetry     — 诗词视频生成
- POST /api/tasks             — 向后兼容（映射到 creative）

所有类型共享任务进度轮询、任务列表、任务详情、视频下载等端点。
resume 端点根据 task_type 自动选择对应的 Pipeline。
"""

import asyncio
import requests
import base64
import hashlib
import json
import logging
import os
import platform
import re
import shutil
import signal
import subprocess
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Dict, List, Optional, Union

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Header
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse

from core.config import get_api_key, set_api_key, delete_api_key, get_api_key_source, get_working_dir, DURATION_FRAME_MAP, get_workspaces, add_workspace, remove_workspace, set_active_workspace, get_active_workspace, REGRESSION_WORKING_DIR_ENV, get_watermark_config, set_watermark_config, WATERMARK_PROMO_TEXT_ZH, WATERMARK_PROMO_TEXT_EN, get_selected_models, set_selected_models, get_agnes_domain, set_agnes_domain, AGNES_DOMAIN_MAP, get_agnes_api_root
from core.path_security import safe_join, safe_workspace_path, UnsafePathError
from core.audio.voices import (
    get_voice_catalog,
    get_voice_lang,
    is_voice_compatible,
    is_voice_compatible_with_text,
    load_voice_catalog,
    VOICE_PREVIEW_TEXTS,
    LANG_COMPAT,
    PROJECT_LANGUAGES,
)
import edge_tts
from core.pipelines import (
    AnchorPipeline,
    BasePipeline,
    PipelineShutdown,
    SimpleVideoPipeline,
    CreativeVideoPipeline,
    ManuscriptVideoPipeline,
    PoetryVideoPipeline,
)
from core.pipelines.poetry_video import POETRY_SUBTITLE_STYLE
from core.api.agnes_image import AgnesImageAPI
from core.api.agnes_models import fetch_available_models
from core.api.error_collector import set_workspace_root
from core.artifacts import list_artifacts, resolve_artifact, get_cascade_plan, apply_cascade_plan
from core.storage import (
    get_community_store,
    get_task_store,
    init_persistent_storage,
    storage_mode,
)
from core.task_manager import TaskManager
from core.video import (
    VideoPostProcessor,
    PostProcessConfig,
    PromptOptimizer,
    VideoQueue,
    TaskPriority,
    VideoMonitor,
    AIVideoPipeline,
    PipelineConfig,
    SecurityValidator,
)
from models.task import (
    AnchorVideoTask,
    AudioConfig,
    BaseTaskState,
    CreativeVideoTask,
    ManuscriptVideoTask,
    PoetryVideoTask,
    SimpleImageTask,
    SimpleVideoTask,
    StepStatus,
    SubtitleConfig,
    SubtitleStyle,
    TaskType,
    VideoMode,
)


# ═══════════════════════════════════════════════════
# 并发控制（复用回归流程的加权信号量逻辑）
# ═══════════════════════════════════════════════════

# Agnes API 每分钟调用上限（与 rate_limiter.py / regression_runner.py 一致）
_AGNES_RATE_LIMIT = int(os.environ.get("AGNES_RATE_LIMIT", "30"))
# 各任务类型权重 = 该类型预估的每分钟 Agnes API 调用数
# 留 30% 余量 => 总权重上限 = _AGNES_RATE_LIMIT * 0.7
TASK_TYPE_WEIGHTS = {
    TaskType.SIMPLE: 1,       # 1 submit + 轻量轮询
    TaskType.CREATIVE: 3,     # Chat + N*Image + N*Video + 轮询
    TaskType.MANUSCRIPT: 4,   # 段落*Chat + 段落*Image + 轮询
    TaskType.ANCHOR: 2,       # 1 i2v submit + 轻量轮询
    TaskType.POETRY: 3,       # 1 Chat(拆分) + N*Video + N*合成
    TaskType.IMAGE: 1,        # 1 image submit
}
MAX_CONCURRENT_WEIGHT = int(_AGNES_RATE_LIMIT * 0.7)  # 默认 21


class WeightedSemaphore:
    """加权信号量：控制并发任务的总权重不超过上限。

    每个任务类型的权重 = 该类型预估的每分钟 Agnes API 调用数。
    控制并发任务数，确保总 API 调用 ≤ AGNES_RATE_LIMIT/分钟。
    逻辑与 regression_runner.py 的 WeightedSemaphore 完全一致。
    """
    def __init__(self, max_weight: int):
        self.max_weight = max_weight
        self.current = 0
        self._lock = asyncio.Lock()
        self._cond = asyncio.Condition(self._lock)

    async def acquire(self, weight: int):
        if weight > self.max_weight:
            raise ValueError(f"task weight {weight} > max {self.max_weight}")
        async with self._lock:
            while self.current + weight > self.max_weight:
                await self._cond.wait()
            self.current += weight

    async def release(self, weight: int):
        async with self._lock:
            self.current -= weight
            self._cond.notify_all()

    @property
    def utilization(self) -> float:
        return self.current / self.max_weight if self.max_weight else 0


# 全局加权信号量（服务端所有任务共享）
_pipeline_semaphore = WeightedSemaphore(MAX_CONCURRENT_WEIGHT)
# 排队中的任务: task_id -> weight
_queued_tasks: Dict[str, int] = {}


def _parse_bg_color(raw: str) -> tuple:
    """将 bg_color 字符串解析为 moviepy 2.x 兼容的 RGBA 元组。"""
    if isinstance(raw, tuple):
        return raw
    if isinstance(raw, str):
        if raw.startswith("(") and raw.endswith(")"):
            return tuple(int(x.strip()) for x in raw[1:-1].split(","))
        if "@" in raw:
            parts = raw.split("@", 1)
            color_name = parts[0].strip().lower()
            alpha_pct = float(parts[1])
            rgb = {"black": (0, 0, 0), "white": (255, 255, 255),
                   "red": (255, 0, 0), "blue": (0, 0, 255),
                   "yellow": (255, 255, 0)}.get(color_name, (0, 0, 0))
            return (*rgb, int(alpha_pct * 255))
        if raw.lower() in ("none", "transparent", ""):
            return None
    return (0, 0, 0, 128)


def _build_position(subtitle_position: str) -> tuple:
    """将 'bottom'/'top' 转为 moviepy 兼容的位置元组。"""
    if subtitle_position == "top":
        return ("center", "top")
    return ("center", "bottom")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

active_pipelines: Dict[str, BasePipeline] = {}
# task_id -> asyncio.Lock, 串行化 create/resume/stop，避免并发操作同一任务导致
# 旧 pipeline 的 finally 误删新 pipeline、或同任务双重运行。
_pipeline_locks: Dict[str, asyncio.Lock] = {}
background_tasks: set = set()
shutdown_event = asyncio.Event()

# v8.0: File d'attente globale avec priorités + monitoring
_video_queue: Optional[VideoQueue] = None
_video_monitor: Optional[VideoMonitor] = None
_security_validator: Optional[SecurityValidator] = None


def _get_pipeline_lock(task_id: str) -> asyncio.Lock:
    """获取（必要时创建）task_id 级别的并发锁。

    create/resume/stop 端点对 ``active_pipelines`` 的检查与插入之间存在
    ``await`` 让出点，快速重复操作（如 resume→stop）会让旧 pipeline 的
    ``finally`` 误删新 pipeline，甚至产生同任务双重运行。用 per-task 锁将
    这三类操作的「检查+插入/删除」关键段串行化。
    """
    lock = _pipeline_locks.get(task_id)
    if lock is None:
        lock = asyncio.Lock()
        _pipeline_locks[task_id] = lock
    return lock


def _find_dir_name(task_id: str) -> str:
    """Find the directory name for a task_id. Falls back to task_id for legacy tasks."""
    tm = TaskManager("_")
    for t in tm.list_tasks():
        if t["task_id"] == task_id:
            return t.get("dir_name", task_id)
    # Tâche restaurée depuis la base persistante (après redéploiement Render)
    meta = get_task_store().get_meta(task_id)
    if meta and meta.get("dir_name"):
        return meta["dir_name"]
    return task_id


def _get_task_owner(task_id: str) -> Optional[str]:
    """user_id du propriétaire d'une tâche.

    "" = tâche héritée (créée avant l'isolation) → publique, comme avant.
    None = tâche inconnue.
    """
    dir_name = _find_dir_name(task_id)
    tm = TaskManager(task_id, dir_name=dir_name)
    state = tm.load()
    if state:
        return getattr(state, "user_id", "") or ""
    try:
        meta = get_task_store().get_meta(task_id)
    except Exception as e:
        logger.warning(f"[Privacy] Lecture métadonnées {task_id} impossible: {e}")
        return None
    if meta:
        return meta.get("user_id", "") or ""
    return None


def _require_task_access(task_id: str, user_id: str) -> None:
    """Vérifie que l'utilisateur peut accéder/contrôler la tâche (header X-User-Id).

    - tâche inconnue → 404
    - tâche héritée (user_id vide) → accès public (comportement historique)
    - tâche avec propriétaire → seul ce propriétaire y accède (403 sinon)
    """
    owner = _get_task_owner(task_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if owner and owner != user_id:
        raise HTTPException(
            status_code=403,
            detail="Accès refusé : cette tâche appartient à un autre utilisateur",
        )


# Une tâche running/queued dont le miroir persistant n'a pas bougé depuis
# plus longtemps que ce seuil est orpheline : le process qui la faisait
# tourner a été tué (redéploiement Render, stockage éphémère) et personne
# ne la marquera jamais échouée → l'UI reste bloquée sur « Génération vidéo ».
_STALE_RUNNING_THRESHOLD_S = 300  # 5 min ; les polls mettent à jour ~toutes les 3 s


def _reconcile_stale_task(meta: dict) -> dict:
    """Réconciliation paresseuse d'une tâche restaurée depuis la base.

    Si la tâche est running/queued, qu'elle n'est pas dans les registres du
    process courant (active_pipelines / _queued_tasks) et que son miroir
    n'a pas été mis à jour depuis longtemps, on la marque échouée pour
    débloquer l'interface. Ne touche jamais aux tâches vivantes.
    """
    try:
        tid = meta.get("task_id")
        if not tid:
            return meta
        if meta.get("status") not in ("running", "queued"):
            return meta
        if tid in active_pipelines or tid in _queued_tasks:
            return meta  # pipeline encore vivant dans ce process
        updated = meta.get("updated_at") or 0
        try:
            age = time.time() - float(updated)
        except (TypeError, ValueError):
            return meta
        if age <= _STALE_RUNNING_THRESHOLD_S:
            return meta
        meta["status"] = "failed"
        meta["current_message"] = (
            "Interrompu: le serveur a redémarré pendant la génération. "
            "Relancez la tâche pour la reprendre."
        )
        try:
            get_task_store().upsert_meta(meta)
            logger.warning(
                f"[StaleTask] {tid} marquée échouée "
                f"(dernière mise à jour il y a {age:.0f}s)"
            )
        except Exception as e:
            logger.warning(f"[StaleTask] Persistance impossible pour {tid}: {e}")
    except Exception:
        pass
    return meta


# ═══════════════════════════════════════════════════
# Lifespan
# ═══════════════════════════════════════════════════


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(get_working_dir(), exist_ok=True)
    upload_dir = os.path.join(get_working_dir(), "uploads")
    os.makedirs(upload_dir, exist_ok=True)

    working_dir = get_working_dir()
    set_workspace_root(working_dir)  # 错误收集模块使用激活的工作空间
    recovered = 0
    if os.path.exists(working_dir):
        for name in os.listdir(working_dir):
            task_file = os.path.join(working_dir, name, "task_state.json")
            if os.path.exists(task_file):
                try:
                    with open(task_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    if data.get("status") in ("running", "queued"):
                        video_id = data.get("video_id")
                        if video_id:
                            # Tenter de récupérer la vidéo depuis l'API
                            try:
                                from core.api.agnes_video import AgnesVideoAPI
                                from core.config import get_api_key
                                api_key = get_api_key()
                                if api_key:
                                    video_api = AgnesVideoAPI(api_key=api_key)
                                    resp = requests.get(
                                        f"{get_agnes_api_root()}/agnesapi?video_id={video_id}",
                                        headers={"Authorization": f"Bearer {api_key}"},
                                        timeout=15,
                                    )
                                    if resp.ok:
                                        result = resp.json()
                                        if result.get("status") in ("completed", "COMPLETED"):
                                            video_url = result.get("url") or result.get("video_url")
                                            if video_url:
                                                video_path = os.path.join(working_dir, name, "final_video.mp4")
                                                import urllib.request
                                                urllib.request.urlretrieve(video_url, video_path)
                                                data["status"] = "completed"
                                                data["final_video_file"] = video_path
                                                data["current_message"] = "Récupéré automatiquement"
                                                recovered += 1
                            except Exception as e:
                                logger.debug(f"[Startup] Recovery failed for {name}: {e}")
                        
                        if data.get("status") in ("running", "queued"):
                            data["status"] = "failed"
                            data["current_message"] = "Interrompu: le serveur a redémarré"
                        
                        tmp_fd, tmp_path = tempfile.mkstemp(
                            dir=os.path.join(working_dir, name), suffix=".tmp"
                        )
                        try:
                            with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
                                json.dump(data, f, ensure_ascii=False, indent=2)
                            os.replace(tmp_path, task_file)
                        except Exception:
                            if os.path.exists(tmp_path):
                                os.remove(tmp_path)
                            raise
                except Exception as e:
                    logger.debug(f"[Startup] Failed to process task {name}: {e}")
    
    if recovered > 0:
        logger.info(f"[Startup] Recovered {recovered} video(s) from previous session")

    # v4.0: 预加载音色目录（edge_tts.list_voices），失败不阻断启动
    try:
        await load_voice_catalog()
        logger.info("[Startup] Voice catalog loaded")
    except Exception as e:
        logger.warning(f"[Startup] Voice catalog load failed ({e}); will use fallback")

    # Stockage persistant (Supabase) : schéma + bucket + tâches interrompues
    try:
        init_persistent_storage()
        logger.info(f"[Startup] Storage mode: {storage_mode()}")
    except Exception as e:
        logger.warning(f"[Startup] Storage init failed ({e}); continuing")

    # v8.0: Initialiser la file d'attente globale, le monitoring et le validateur de sécurité
    global _video_queue, _video_monitor, _security_validator
    _video_queue = VideoQueue(max_concurrent=2, max_queue_size=100)
    _video_monitor = VideoMonitor()
    _security_validator = SecurityValidator()
    await _video_queue.start()
    logger.info("[Startup] Video queue + monitor + security validator initialized (v8.0)")

    yield

    # Cleanup à l'arrêt
    if _video_queue:
        await _video_queue.stop()


app = FastAPI(title="Agnes Video Generator", lifespan=lifespan)


# ═══════════════════════════════════════════════════
# CORS — autorise les requêtes depuis GitHub Pages
# ═══════════════════════════════════════════════════
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://tomaiofficial.github.io",
        "https://agnes-ia.onrender.com",
        "http://localhost:8765",
        "http://127.0.0.1:8765",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════
# v4.0: 音色试听缓存
# ═══════════════════════════════════════════════════

# 试听音频缓存目录（系统临时目录，重启后自动清理）
VOICE_PREVIEW_CACHE_DIR = os.path.join(tempfile.gettempdir(), "agnes-voice-previews")
os.makedirs(VOICE_PREVIEW_CACHE_DIR, exist_ok=True)


def _preview_cache_key(voice_id: str, text: str) -> str:
    """生成试听缓存文件名：{md5(voice_id)}__{md5(text)}.mp3

    对 voice_id 一并做哈希，避免用户可控的 voice_id（可能含路径分隔符 / ``..``）
    流入缓存文件路径造成路径穿越。
    """
    voice_hash = hashlib.md5(voice_id.encode("utf-8")).hexdigest()
    text_hash = hashlib.md5(text.encode("utf-8")).hexdigest()
    return f"{voice_hash}__{text_hash}"


async def _get_or_generate_preview(voice_id: str, text: str) -> str:
    """获取试听音频：缓存命中直接返回路径，否则调用 edge_tts 生成后缓存。

    写入使用 .tmp + os.replace 原子替换，避免并发读到半成品。
    """
    cache_key = _preview_cache_key(voice_id, text)
    cache_path = os.path.join(VOICE_PREVIEW_CACHE_DIR, cache_key + ".mp3")
    if os.path.exists(cache_path):
        return cache_path  # 缓存命中

    tmp_path = cache_path + ".tmp"
    communicate = edge_tts.Communicate(text, voice=voice_id)
    await communicate.save(tmp_path)
    os.replace(tmp_path, cache_path)  # 原子替换
    return cache_path


def _resolve_preview_text(voice_id: str, text: str) -> str:
    """解析试听文本：显式传入优先，否则用该音色语言的预设试听句。"""
    if text:
        return text
    vlang = get_voice_lang(voice_id) or "zh"
    name = voice_id.split("-")[-1].replace("Neural", "")
    return VOICE_PREVIEW_TEXTS.get(vlang, VOICE_PREVIEW_TEXTS["zh"]).format(name=name)


def _validate_voice_compat(audio_voice: str, target_lang: str, text: str = None):
    """校验 voice 与目标任务语言的兼容性，不兼容时抛出 422。

    - target_lang: 页面语言（创意/诗歌/主播等由 LLM 按页面语言生成文本）
    - text: 稿件正文（manuscript），已知文本时做更精确的脚本级检测
    """
    if not audio_voice:
        return
    if text is not None and text.strip():
        if not is_voice_compatible_with_text(audio_voice, text):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"所选音色 {audio_voice} 不支持当前稿件语言的朗读"
                    f"（跨文字体系无法朗读，任务将失败）。请更换为匹配语言的音色。"
                ),
            )
        return
    if target_lang and not is_voice_compatible(audio_voice, target_lang):
        lang_label = PROJECT_LANGUAGES.get(target_lang, {}).get("label", target_lang)
        supported = LANG_COMPAT.get(get_voice_lang(audio_voice) or "", [])
        supported_labels = [PROJECT_LANGUAGES.get(c, {}).get("label", c) for c in supported]
        raise HTTPException(
            status_code=422,
            detail=(
                f"所选音色 {audio_voice} 不支持「{lang_label}」语言的视频生成"
                f"（仅支持：{', '.join(supported_labels)}）。请更换音色或语言。"
            ),
        )

def get_upload_dir() -> str:
    """返回当前激活工作目录下的 uploads 子目录。"""
    return os.path.join(get_working_dir(), "uploads")


# ═══════════════════════════════════════════════════
# Static files + Root
# ═══════════════════════════════════════════════════


static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def root():
    index_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Agnes Video Generator API"}


# ═══════════════════════════════════════════════════
# API Key 配置
# ═══════════════════════════════════════════════════


@app.get("/api/config")
async def get_config():
    key = get_api_key()
    source = get_api_key_source()
    active_ws = get_active_workspace()
    wm = get_watermark_config()
    data = {
        "api_key": key[:8] + "..." if key else "",
        "source": source,
        "can_clear": source == "config",
        "workspaces": get_workspaces(),
        "active_workspace": active_ws,
        "working_dir_source": "regression" if os.environ.get(REGRESSION_WORKING_DIR_ENV) else "config",
        "watermark": wm,
        "watermark_promo_zh": WATERMARK_PROMO_TEXT_ZH,
        "watermark_promo_en": WATERMARK_PROMO_TEXT_EN,
        "models": get_selected_models(),
        "agnes_domain": get_agnes_domain(),
        "agnes_domains": list(AGNES_DOMAIN_MAP.keys()),
    }
    return data


@app.post("/api/config")
async def save_config(api_key: str = Form(...)):
    set_api_key(api_key)
    return {"ok": True}


@app.delete("/api/config")
async def clear_config():
    """Delete the API key from the config file."""
    source = get_api_key_source()
    if source == "env":
        raise HTTPException(
            status_code=400,
            detail="API Key 来自环境变量，无法从界面清除",
        )
    delete_api_key()
    return {"ok": True}


# ═══════════════════════════════════════════════════
# 模型选择（v5.0）
# ═══════════════════════════════════════════════════


# 模型列表服务端缓存，避免每次页面加载都打外部接口（apihub.agnes-ai.com）导致变慢。
# TTL 默认 5 分钟；?refresh=1 或缓存过期时重新拉取。
_MODEL_CACHE = {"models": None, "ts": 0.0, "ttl": 300}


@app.get("/api/models")
async def list_models(refresh: bool = False):
    """拉取 Agnes 可用模型列表，按 text/image/video 分组。

    需已配置 API Key。列表来自 GET /v1/models?all=true（含内测模型）。
    失败时回退到硬编码默认列表。

    结果在服务端缓存 TTL 秒；普通页面加载走缓存瞬时返回，
    仅“刷新列表”按钮（?refresh=1）或缓存过期时才重新请求外部接口。
    """
    key = get_api_key()
    if not key:
        raise HTTPException(status_code=400, detail="未配置 API Key")
    now = time.time()
    if (
        not refresh
        and _MODEL_CACHE["models"] is not None
        and (now - _MODEL_CACHE["ts"]) < _MODEL_CACHE["ttl"]
    ):
        return {"ok": True, "models": _MODEL_CACHE["models"], "cached": True}
    grouped = fetch_available_models(key)
    _MODEL_CACHE["models"] = grouped
    _MODEL_CACHE["ts"] = now
    return {"ok": True, "models": grouped, "cached": False}


@app.post("/api/config/models")
async def save_models(
    text: str = Form(None),
    image: str = Form(None),
    video: str = Form(None),
):
    """保存选中的模型配置。

    text 为必填（目前仅文本模型开放选择）；image/video 接受但不强制，
    置灰时前端仍会随配置保存其值（缺省回退到当前默认值）。
    """
    if text is None or text.strip() == "":
        raise HTTPException(status_code=400, detail="文本模型不能为空")
    result = set_selected_models(
        text=text or None,
        image=image,
        video=video,
    )
    return {"ok": True, "models": result}


# ═══════════════════════════════════════════════════
# 水印配置
# ═══════════════════════════════════════════════════


@app.post("/api/config/watermark")
async def save_watermark_config(enabled: bool = Form(False)):
    """Save watermark toggle."""
    set_watermark_config(enabled=enabled)
    return {"ok": True, "enabled": enabled}


# ═══════════════════════════════════════════════════
# 域名配置（v6.0）
# ═══════════════════════════════════════════════════


@app.post("/api/config/domain")
async def save_agnes_domain(domain: str = Form(...)):
    """设置 Agnes API 域名后缀。

    Args:
        domain: "com" 或 "cn"
    """
    domain = domain.strip().lower()
    if domain not in AGNES_DOMAIN_MAP:
        raise HTTPException(
            status_code=422,
            detail=f"域名后缀必须为 {list(AGNES_DOMAIN_MAP.keys())} 之一",
        )
    set_agnes_domain(domain)
    return {"ok": True, "agnes_domain": domain}


# ═══════════════════════════════════════════════════
# 工作目录管理（多工作目录，同时仅一个 active）
# ═══════════════════════════════════════════════════


@app.get("/api/workspaces")
async def list_workspaces():
    """列出所有已配置的工作目录及当前激活项。"""
    return {
        "workspaces": get_workspaces(),
        "active_workspace": get_active_workspace(),
    }


@app.post("/api/workspaces")
async def create_workspace(path: str = Form(...), name: str = Form("")):
    """添加一个工作目录。"""
    if not path.strip():
        raise HTTPException(status_code=422, detail="path 不能为空")
    try:
        safe_path = safe_workspace_path(path.strip())
    except UnsafePathError:
        raise HTTPException(
            status_code=422,
            detail="工作目录路径不合法或超出允许范围（可由 AGNES_WORKSPACE_ROOT 环境变量放宽）",
        )
    entry = add_workspace(safe_path, name.strip())
    # safe_path 已是 safe_workspace_path 净化后的受信任值（受信任根 containment 检查），
    # 直接用于落盘即可中和路径穿越。
    os.makedirs(safe_path, exist_ok=True)
    os.makedirs(os.path.join(safe_path, "uploads"), exist_ok=True)
    return {"ok": True, "workspace": entry, "active_workspace": get_active_workspace()}


@app.delete("/api/workspaces")
async def delete_workspace(path: str = Form(...)):
    """移除一个工作目录（仅从配置中移除，不删除磁盘文件）。"""
    if not path.strip():
        raise HTTPException(status_code=422, detail="path 不能为空")
    removed = remove_workspace(path.strip())
    if not removed:
        raise HTTPException(status_code=404, detail="工作目录不存在")
    return {"ok": True, "active_workspace": get_active_workspace()}


@app.post("/api/workspaces/active")
async def activate_workspace(path: str = Form(...)):
    """设置当前激活的工作目录。"""
    if not path.strip():
        raise HTTPException(status_code=422, detail="path 不能为空")
    try:
        safe_path = safe_workspace_path(path.strip())
        active = set_active_workspace(safe_path)
    except UnsafePathError:
        raise HTTPException(
            status_code=422,
            detail="工作目录路径不合法或超出允许范围（可由 AGNES_WORKSPACE_ROOT 环境变量放宽）",
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    # safe_path 已是 safe_workspace_path 净化后的受信任值，直接用于落盘。
    os.makedirs(safe_path, exist_ok=True)
    os.makedirs(os.path.join(safe_path, "uploads"), exist_ok=True)
    return {"ok": True, "active_workspace": active}


@app.get("/api/workspaces/pick-directory")
async def pick_directory():
    """弹出操作系统原生目录选择框，返回所选目录路径。

    跨平台实现：
    - macOS: osascript
    - Linux: zenity（若不可用回退 kdialog）
    - Windows: PowerShell Forms.FolderBrowserDialog
    """
    path = await asyncio.to_thread(_pick_directory_native)
    if not path:
        return {"ok": False, "path": ""}
    return {"ok": True, "path": path}


def _pick_directory_native() -> str:
    """同步调用系统原生目录选择器，返回路径或空字符串。"""
    system = platform.system()
    try:
        if system == "Darwin":
            script = (
                'set chosenFolder to choose folder with prompt "选择工作目录"'
                "\nreturn POSIX path of chosenFolder"
            )
            r = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=120,
            )
            if r.returncode == 0:
                return r.stdout.strip()
        elif system == "Windows":
            ps_script = (
                "Add-Type -AssemblyName System.Windows.Forms;"
                "$f = New-Object System.Windows.Forms.FolderBrowserDialog;"
                "if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }"
            )
            r = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_script],
                capture_output=True, text=True, timeout=120,
            )
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip()
        else:
            for cmd in (["zenity", "--file-selection", "--directory"],
                        ["kdialog", "--getexistingdirectory", os.path.expanduser("~")]):
                try:
                    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                    if r.returncode == 0 and r.stdout.strip():
                        return r.stdout.strip()
                    break
                except FileNotFoundError:
                    continue
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        logger.warning(f"[Workspace] Directory picker failed: {e}")
    return ""


@app.get("/api/voices")
async def get_voices():
    """返回按语言分组的可选 TTS 语音角色列表（含兼容性提示）。

    响应结构：
    {
      "languages": [
        {"code": "zh", "label": "中文", "count": N, "voices": [ {id,name,region,gender,style_tags,preview_text,lang}, ... ]},
        ...
      ],
      "compat_hint": { "zh": ["zh","en"], ... }
    }
    """
    return get_voice_catalog()


@app.get("/api/voices/preview")
async def preview_voice(voice: str, text: str = ""):
    """返回音色试听音频（audio/mpeg），带服务端缓存。

    - voice: 必填，音色 id
    - text: 选填，试听文本；缺省时使用该音色语言的预设试听句
    - 跨语言不兼容时 edge_tts 抛异常，返回 400 + 明确错误信息
    """
    if not voice:
        raise HTTPException(status_code=400, detail="缺少 voice 参数")
    preview_text = _resolve_preview_text(voice, text)
    try:
        cache_path = await _get_or_generate_preview(voice, preview_text)
    except Exception as e:
        logger.warning(f"[Preview] voice={voice} failed: {e}")
        raise HTTPException(
            status_code=400,
            detail=f"该音色不支持此语言的试听文本（跨文字体系无法朗读）：{e}",
        )
    return FileResponse(
        cache_path,
        media_type="audio/mpeg",
        filename=f"{voice}.mp3",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/voices/compat")
async def voice_compat(voice: str, target_lang: str):
    """查询 voice 与目标语言 target_lang 的兼容性。

    响应：{"compatible": bool, "voice_lang": str, "target_lang": str, "supported_langs": [...]}
    """
    vlang = get_voice_lang(voice)
    compatible = is_voice_compatible(voice, target_lang)
    supported = LANG_COMPAT.get(vlang, [vlang]) if vlang else []
    return {
        "compatible": compatible,
        "voice_lang": vlang,
        "target_lang": target_lang,
        "supported_langs": supported,
    }


# ═══════════════════════════════════════════════════
# 简单图片生成（任务 + working_dir 持久化）
# ═══════════════════════════════════════════════════


@app.post("/api/image/generate")
async def generate_image(
    prompt: str = Form(...),
    user_id: str = Header(default="", alias="X-User-Id"),
    size: str = Form("1024x1024"),
    negative_prompt: Optional[str] = Form(None),
    system_prompt: str = Form(""),
    reference_image: UploadFile = File(None),
):
    """简单图片生成：创建任务 → 直调 Agnes Image API → 保存到任务目录。"""
    api_key = get_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    if len(prompt) > 5000:
        raise HTTPException(status_code=422, detail="prompt 最多 5000 字符")
    if not prompt.strip():
        raise HTTPException(status_code=422, detail="prompt 不能为空")

    _VALID_SIZES = {"1024x1024", "768x1152", "1152x768", "768x1344", "1344x768", "1792x1024", "1024x1792"}
    if size not in _VALID_SIZES:
        raise HTTPException(status_code=422, detail=f"size 必须为 {_VALID_SIZES} 之一")

    task_id = uuid.uuid4().hex[:12]
    name = f"image_{task_id}"
    dir_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{task_id}"

    state = SimpleImageTask(
        task_id=task_id,
        user_id=user_id,
        creative_name=name,
        prompt=prompt.strip(),
        size=size,
        negative_prompt=negative_prompt or "",
        system_prompt=system_prompt,
    )

    # 先用 PENDING 创建任务目录和状态文件
    tm = TaskManager(task_id, dir_name=dir_name)
    tm.create(state)

    image_api = AgnesImageAPI(api_key=api_key)

    ref_paths = []
    if reference_image and reference_image.filename:
        ext = os.path.splitext(reference_image.filename)[1] or ".png"
        upload_dir = get_upload_dir()
        os.makedirs(upload_dir, exist_ok=True)
        ref_path = os.path.join(upload_dir, f"img_ref_{uuid.uuid4().hex[:8]}{ext}")
        with open(ref_path, "wb") as f:
            f.write(await reference_image.read())
        ref_paths.append(ref_path)

    try:
        state.status = StepStatus.RUNNING
        tm.update_state(status=StepStatus.RUNNING)

        full_prompt = _build_encrypted_image_prompt(system_prompt, prompt) if system_prompt.strip() else prompt
        output = await image_api.generate_single_image(
            prompt=full_prompt,
            reference_image_paths=ref_paths,
            size=size,
            negative_prompt=negative_prompt,
        )
    except Exception as e:
        state.status = StepStatus.FAILED
        tm.update_state(status=StepStatus.FAILED)
        logger.error(f"[Image] Task {task_id} failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    img_filename = "final_image.png"
    img_path = os.path.join(tm.task_dir, img_filename)
    try:
        output.save(img_path)
    except Exception as e:
        state.status = StepStatus.FAILED
        tm.update_state(status=StepStatus.FAILED)
        logger.error(f"[Image] Task {task_id} save failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"图片保存失败: {e}")

    state.status = StepStatus.COMPLETED
    state.final_video_file = img_path
    tm.update_state(status=StepStatus.COMPLETED, final_video_file=img_path)

    logger.info(f"[Image] Task {task_id} completed: {img_path}, prompt={prompt[:60]}...")
    return {"ok": True, "task_id": task_id, "dir_name": dir_name}


@app.get("/api/image/{task_id}")
async def serve_image(task_id: str, user_id: str = Header(default="", alias="X-User-Id")):
    """返回已生成的图片文件。"""
    dir_name = _find_dir_name(task_id)
    tm = TaskManager(task_id, dir_name=dir_name)
    state = tm.load()
    if not state or not state.final_video_file:
        raise HTTPException(status_code=404, detail="Image not found")
    if state.user_id and state.user_id != user_id:
        raise HTTPException(status_code=403, detail="Accès refusé : cette tâche appartient à un autre utilisateur")
    if not os.path.exists(state.final_video_file):
        raise HTTPException(status_code=404, detail="Image file not found")
    return FileResponse(state.final_video_file)


# ═══════════════════════════════════════════════════
# 任务列表 + 详情 + 视频下载
# ═══════════════════════════════════════════════════


@app.get("/api/tasks")
async def list_tasks(user_id: str = Header(default="", alias="X-User-Id")):
    tm = TaskManager("_")
    tasks = tm.list_tasks()
    for t in tasks:
        task_tm = TaskManager(t["task_id"], dir_name=t.get("dir_name"))
        state = task_tm.load()
        if state:
            t["user_id"] = state.user_id
            t["final_video_file"] = state.final_video_file
            t["task_type"] = state.task_type
            # 创意视频特有字段
            if isinstance(state, CreativeVideoTask):
                t["scene_count"] = state.scene_count
                t["idea"] = state.idea[:100] if state.idea else ""
            # 稿件视频特有字段
            elif isinstance(state, ManuscriptVideoTask):
                t["paragraph_count"] = len(state.paragraphs)
                t["manuscript_text"] = state.manuscript_text[:100] if state.manuscript_text else ""
            # 数字人口播
            elif isinstance(state, AnchorVideoTask):
                t["script_text"] = state.script_text[:100] if state.script_text else ""
                t["anchor_prompt"] = state.anchor_prompt[:100] if state.anchor_prompt else ""
                t["paragraph_count"] = len(state.paragraphs)
            # 简单视频
            elif isinstance(state, SimpleVideoTask):
                t["prompt"] = state.prompt[:100] if state.prompt else ""
                t["mode"] = state.mode
            # 诗歌视频
            elif isinstance(state, PoetryVideoTask):
                t["poem_text"] = state.poem_text[:100] if state.poem_text else ""
            # 简单图片
            elif isinstance(state, SimpleImageTask):
                t["prompt"] = state.prompt[:100] if state.prompt else ""
                t["size"] = state.size
    # Fusion avec les métadonnées persistées (survit aux redéploiements Render) :
    # - tâches dont le fichier local a disparu → restaurées depuis la base
    # - tâches locales → champs manquants complétés depuis la base
    try:
        meta_rows = get_task_store().list_meta()
        by_id = {t["task_id"]: t for t in tasks}
        for row in meta_rows:
            tid = row.get("task_id")
            if not tid:
                continue
            if tid in by_id:
                for k, v in row.items():
                    if k in ("task_id", "dir_name") or v in (None, ""):
                        continue
                    by_id[tid].setdefault(k, v)
            else:
                # Tâche restaurée depuis la base (fichier local effacé par un
                # redéploiement) : réconcilier les orphelines pour débloquer l'UI
                row = _reconcile_stale_task(row)
                restored = {
                    "task_id": tid,
                    "dir_name": row.get("dir_name", ""),
                    "task_type": row.get("task_type", ""),
                    "creative_name": row.get("creative_name", ""),
                    "user_id": row.get("user_id", ""),
                    "status": row.get("status", "failed"),
                    "prompt": row.get("prompt", ""),
                    "current_message": row.get("current_message", ""),
                    "final_video_file": row.get("final_video_file", ""),
                    "updated_at": row.get("updated_at"),
                    "restored_from_db": True,
                }
                tasks.append(restored)
    except Exception as e:
        logger.warning(f"[Tasks] Merge des métadonnées persistées impossible: {e}")
    # Confidentialité : chaque utilisateur ne voit que ses tâches, plus les
    # tâches héritées (user_id vide, créées avant l'isolation).
    tasks = [t for t in tasks if not t.get("user_id") or t.get("user_id") == user_id]
    tasks.sort(key=lambda t: t.get("dir_name", ""), reverse=True)
    return {"tasks": tasks}


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str, user_id: str = Header(default="", alias="X-User-Id")):
    dir_name = _find_dir_name(task_id)
    tm = TaskManager(task_id, dir_name=dir_name)
    state = tm.load()
    if not state:
        # Tâche restaurée depuis la base persistante (fichier local effacé par
        # le redéploiement Render) : on renvoie les métadonnées enregistrées.
        meta = get_task_store().get_meta(task_id)
        if not meta:
            raise HTTPException(status_code=404, detail="Task not found")
        if meta.get("user_id") and meta.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="Accès refusé : cette tâche appartient à un autre utilisateur")
        # Tâche orpheline (redéploiement) → la marquer échouée pour débloquer l'UI
        meta = _reconcile_stale_task(meta)
        data = dict(meta)
        data["dir_name"] = meta.get("dir_name", "") or dir_name
        data["restored_from_db"] = True
        data["current_progress"] = 1.0 if data.get("status") == "completed" else 0.0
        return data
    if state.user_id and state.user_id != user_id:
        raise HTTPException(status_code=403, detail="Accès refusé : cette tâche appartient à un autre utilisateur")
    data = state.model_dump()
    data["dir_name"] = dir_name
    return data


@app.get("/api/video/{task_id}")
async def serve_video(task_id: str, user_id: str = Header(default="", alias="X-User-Id")):
    _require_task_access(task_id, user_id)
    dir_name = _find_dir_name(task_id)
    try:
        task_dir = safe_join(get_working_dir(), dir_name)
    except UnsafePathError:
        raise HTTPException(status_code=404, detail="Video not found")
    video_path = os.path.join(task_dir, "final_video.mp4")
    if os.path.exists(video_path):
        return FileResponse(video_path, media_type="video/mp4")
    # Fichier local perdu (système de fichiers éphémère après redéploiement) :
    # on sert la copie publiée en galerie si elle existe.
    published = _get_published_video(task_id)
    if published is None:
        raise HTTPException(status_code=404, detail="Video not found")
    target = published["video_target"]
    if target.startswith("http://") or target.startswith("https://"):
        return _proxy_storage_video(target)
    if os.path.exists(target):
        return FileResponse(target, media_type="video/mp4")
    raise HTTPException(status_code=404, detail="Video not found")


def _get_published_video(task_id: str) -> Optional[dict]:
    """Retourne la publication galerie d'une tâche, sans jamais faire échouer
    la requête si la galerie est indisponible (simple fallback vidéo)."""
    try:
        return get_community_store().find_published(task_id)
    except Exception as e:
        logger.warning(f"[Video] Récupération publication {task_id} impossible: {e}")
        return None


def _proxy_storage_video(url: str) -> StreamingResponse:
    """Sert une vidéo stockée dans Supabase Storage en la relayant en streaming.

    On ne peut pas rediriger simplement le navigateur : le frontend charge les
    vidéos via fetch() avec le header X-User-Id, ce qui déclencherait un
    préflight CORS vers le domaine Storage."""

    try:
        upstream = requests.get(url, stream=True, timeout=60)
    except Exception as e:
        logger.warning(f"[Video] Proxy storage, connexion impossible: {e}")
        raise HTTPException(status_code=502, detail="Stockage vidéo indisponible")
    if upstream.status_code != 200:
        upstream.close()
        logger.warning(f"[Video] Proxy storage {upstream.status_code} pour {url}")
        raise HTTPException(status_code=404, detail="Video not found")

    def _stream():
        try:
            for chunk in upstream.iter_content(65536):
                if chunk:
                    yield chunk
        except Exception as e:
            logger.warning(f"[Video] Proxy storage, flux interrompu: {e}")
        finally:
            upstream.close()

    return StreamingResponse(_stream(), media_type="video/mp4")


# ═══════════════════════════════════════════════════
# 中间产物 API
# ═══════════════════════════════════════════════════


# 产物类别 → MIME 类型映射
_ARTIFACT_MEDIA_TYPES = {
    "image": "image/png",
    "video": "video/mp4",
    "audio": "audio/mpeg",
    "text": "text/plain; charset=utf-8",
    "json": "application/json; charset=utf-8",
    "subtitle": "text/plain; charset=utf-8",
}


@app.get("/api/tasks/{task_id}/artifacts")
async def list_task_artifacts(task_id: str, user_id: str = Header(default="", alias="X-User-Id")):
    """列举任务的所有中间产物（含存在性检测）。"""
    dir_name = _find_dir_name(task_id)
    tm = TaskManager(task_id, dir_name=dir_name)
    state = tm.load()
    if not state:
        raise HTTPException(status_code=404, detail="Task not found")
    if state.user_id and state.user_id != user_id:
        raise HTTPException(status_code=403, detail="Accès refusé : cette tâche appartient à un autre utilisateur")

    artifacts = list_artifacts(state, tm.task_dir)
    return {
        "ok": True,
        "task_type": state.task_type.value,
        "task_status": state.status.value if state.status else "pending",
        "artifacts": [
            {
                "artifact_id": a.artifact_id,
                "step_key": a.step_key,
                "label_key": a.label_key,
                "category": a.category,
                "scope": a.scope,
                "scope_index": a.scope_index,
                "exists": a.exists,
                "size": a.size,
                "deletable": a.deletable,
            }
            for a in artifacts
        ],
    }


@app.get("/api/tasks/{task_id}/artifacts/{artifact_id}/file")
async def serve_artifact_file(task_id: str, artifact_id: str, user_id: str = Header(default="", alias="X-User-Id")):
    """安全地服务中间产物文件。"""
    dir_name = _find_dir_name(task_id)
    tm = TaskManager(task_id, dir_name=dir_name)
    state = tm.load()
    if not state:
        raise HTTPException(status_code=404, detail="Task not found")
    if state.user_id and state.user_id != user_id:
        raise HTTPException(status_code=403, detail="Accès refusé : cette tâche appartient à un autre utilisateur")

    artifact = resolve_artifact(artifact_id, state, tm.task_dir)
    if not artifact or not artifact.file_relpath:
        raise HTTPException(status_code=404, detail="Artifact not found")
    if not artifact.exists:
        raise HTTPException(status_code=404, detail="Artifact file not found")

    abs_path = os.path.join(tm.task_dir, artifact.file_relpath)
    # 路径穿越防护
    real_task_dir = os.path.realpath(tm.task_dir)
    real_abs_path = os.path.realpath(abs_path)
    if not real_abs_path.startswith(real_task_dir + os.sep):
        raise HTTPException(status_code=403, detail="Access denied")

    media_type = _ARTIFACT_MEDIA_TYPES.get(artifact.category, "application/octet-stream")
    return FileResponse(real_abs_path, media_type=media_type)


@app.get("/api/tasks/{task_id}/artifacts/{artifact_id}/cascade-preview")
async def preview_artifact_cascade(task_id: str, artifact_id: str, user_id: str = Header(default="", alias="X-User-Id")):
    """预览删除产物的级联计划（不执行删除）。"""
    dir_name = _find_dir_name(task_id)
    tm = TaskManager(task_id, dir_name=dir_name)
    state = tm.load()
    if not state:
        raise HTTPException(status_code=404, detail="Task not found")
    if state.user_id and state.user_id != user_id:
        raise HTTPException(status_code=403, detail="Accès refusé : cette tâche appartient à un autre utilisateur")

    artifact = resolve_artifact(artifact_id, state, tm.task_dir)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    plan = get_cascade_plan(artifact_id, state, tm.task_dir)
    if not plan:
        raise HTTPException(status_code=400, detail="Cannot compute cascade plan")

    # 只返回存在的文件
    existing_files = []
    for f in plan.files_to_delete:
        abs_path = os.path.join(tm.task_dir, f)
        if os.path.exists(abs_path):
            existing_files.append(f)

    return {
        "ok": True,
        "artifact_id": artifact_id,
        "files_to_delete": existing_files,
        "steps_to_reset": plan.steps_to_reset,
    }


@app.delete("/api/tasks/{task_id}/artifacts/{artifact_id}")
async def delete_task_artifact(task_id: str, artifact_id: str, user_id: str = Header(default="", alias="X-User-Id")):
    """删除指定中间产物（含级联删除后续产物 + 状态回退）。"""
    # 运行中任务保护（已停止的 pipeline 允许删除产物）
    if task_id in active_pipelines:
        pipeline = active_pipelines[task_id]
        if not pipeline._stop_event.is_set():
            raise HTTPException(status_code=409, detail="Task is running, please stop it first")

    dir_name = _find_dir_name(task_id)
    tm = TaskManager(task_id, dir_name=dir_name)
    state = tm.load()
    if not state:
        raise HTTPException(status_code=404, detail="Task not found")
    if state.user_id and state.user_id != user_id:
        raise HTTPException(status_code=403, detail="Accès refusé : cette tâche appartient à un autre utilisateur")

    artifact = resolve_artifact(artifact_id, state, tm.task_dir)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    plan = get_cascade_plan(artifact_id, state, tm.task_dir)
    if not plan:
        raise HTTPException(status_code=400, detail="Cannot compute cascade plan")

    # 1. 删除文件
    deleted_files = []
    real_task_dir = os.path.realpath(tm.task_dir)
    for f in plan.files_to_delete:
        abs_path = os.path.join(tm.task_dir, f)
        real_abs_path = os.path.realpath(abs_path)
        # 路径穿越防护
        if not real_abs_path.startswith(real_task_dir + os.sep):
            continue
        if os.path.exists(abs_path) and os.path.isfile(abs_path):
            try:
                os.remove(abs_path)
                deleted_files.append(f)
            except OSError as e:
                logger.warning(f"[Artifacts] Failed to delete {f}: {e}")

    # 2. 应用级联计划到 state
    update_kwargs = apply_cascade_plan(state, plan)

    # 3. 持久化
    tm.update_state(**update_kwargs)

    logger.info(
        f"[Artifacts] Deleted {len(deleted_files)} files for task {task_id}, "
        f"artifact={artifact_id}, reset_steps={plan.steps_to_reset}"
    )

    return {
        "ok": True,
        "deleted_files": deleted_files,
        "reset_steps": plan.steps_to_reset,
        "task_status": state.status.value if state.status else "pending",
    }


# ═══════════════════════════════════════════════════
# 辅助函数
# ═══════════════════════════════════════════════════


# 时长提取 regex 模式（支持 7 种语言）
_DURATION_PATTERNS = [
    # 中文
    r'(?:每个场景|每段|每节|每个|每)(?:约)?(\d+)\s*(?:秒|s)',
    r'(\d+)\s*(?:秒|s)\s*(?:每|/)',
    # 日文
    r'各\s*(\d+)\s*秒',
    # 英文
    r'(\d+)\s*(?:seconds?|secs?|s)\s*(?:each|per)',
    r'(?:each|per)\s*(?:scene)?\s*(\d+)\s*(?:seconds?|secs?|s)',
    # 韩文
    r'각\s*(\d+)\s*초',
    # 俄文
    r'по\s*(\d+)\s*секунд',
    # 马来/印尼
    r'(\d+)\s*(?:saat|detik)\s*(?:setiap|masing)',
    r'(?:setiap|masing)\s*(?:satu\s+)?(\d+)\s*(?:saat|detik)',
    # 通用回退
    r'(\d+)\s*(?:秒|seconds?|secs?|초|секунд|saat|detik|s)\b',
]


def _parse_duration(user_requirement: str) -> int:
    """从 user_requirement 中提取时长。支持 7 种语言。"""
    for pattern in _DURATION_PATTERNS:
        match = re.search(pattern, user_requirement, re.IGNORECASE)
        if match:
            return int(match.group(1))
    return 5


def _has_explicit_duration(user_requirement: str) -> bool:
    """检查 user_requirement 中是否显式提到了时长。支持 7 种语言。"""
    for pattern in _DURATION_PATTERNS:
        if re.search(pattern, user_requirement, re.IGNORECASE):
            return True
    return False


def _build_encrypted_image_prompt(system_prompt: str, user_prompt: str) -> str:
    """Base64 加密图片描述，在系统提示词末尾写明解密方法。"""
    encoded = base64.b64encode(user_prompt.encode("utf-8")).decode("ascii")
    has_chinese = bool(re.search(r'[\u4e00-\u9fff]', system_prompt))
    if has_chinese:
        decryption = (
            "解密方法：以下图片描述为 base64 编码。"
            "请先进行 base64 解码以获取实际描述，"
            "然后根据解码后的描述生成图片。"
            "不要直接根据编码文本生成图片。\n\n"
            f"加密描述：\n{encoded}"
        )
    else:
        decryption = (
            "Decryption method: The image description below is base64-encoded. "
            "Base64-decode it to get the actual description, "
            "then generate the image based on the decoded description. "
            "Do NOT generate based on the encoded text itself.\n\n"
            f"Encrypted description:\n{encoded}"
        )
    return f"{system_prompt}\n\n{decryption}"


def _create_pipeline_for_type(
    task_type: TaskType,
    api_key: str,
    task_id: str,
    dir_name: str,
) -> BasePipeline:
    """根据任务类型创建对应的 Pipeline 实例。

    从配置读取选中的模型（文本/图像/视频），注入各 Pipeline，
    使界面选择的模型生效。
    """
    models = get_selected_models()
    text_model = models["text"]
    image_model = models["image"]
    video_model = models["video"]

    if task_type == TaskType.SIMPLE:
        return SimpleVideoPipeline(
            api_key=api_key,
            task_id=task_id,
            dir_name=dir_name,
            chat_model=text_model,
            image_model=image_model,
            video_model=video_model,
            shutdown_event=shutdown_event,
        )
    elif task_type == TaskType.MANUSCRIPT:
        return ManuscriptVideoPipeline(
            api_key=api_key,
            task_id=task_id,
            dir_name=dir_name,
            chat_model=text_model,
            image_model=image_model,
            video_model=video_model,
            shutdown_event=shutdown_event,
        )
    elif task_type == TaskType.ANCHOR:
        return AnchorPipeline(
            api_key=api_key,
            task_id=task_id,
            dir_name=dir_name,
            chat_model=text_model,
            image_model=image_model,
            video_model=video_model,
            shutdown_event=shutdown_event,
        )
    elif task_type == TaskType.POETRY:
        return PoetryVideoPipeline(
            api_key=api_key,
            task_id=task_id,
            dir_name=dir_name,
            chat_model=text_model,
            video_model=video_model,
            shutdown_event=shutdown_event,
        )
    else:
        # CREATIVE（默认）
        return CreativeVideoPipeline(
            api_key=api_key,
            task_id=task_id,
            dir_name=dir_name,
            chat_model=text_model,
            image_model=image_model,
            video_model=video_model,
            shutdown_event=shutdown_event,
        )


async def _run_pipeline(pipeline: BasePipeline, state: BaseTaskState):
    """通用 Pipeline 执行包装器。"""
    try:
        logger.info(f"[Pipeline] Starting run for task {pipeline.task_id}, type={state.task_type}")
        await pipeline.run(state)
        logger.info(f"[Pipeline] Completed run for task {pipeline.task_id}")
    except PipelineShutdown:
        logger.info(f"[Pipeline] Task {pipeline.task_id} stopped by user")
    except Exception as e:
        logger.error(f"[Pipeline] Task {pipeline.task_id} failed: {e}", exc_info=True)
    finally:
        # 身份比对：仅当字典里仍是当前 pipeline 时才删除。
        # 否则快速 resume→stop 会让旧 pipeline 的 finally 误删新 pipeline。
        if active_pipelines.get(pipeline.task_id) is pipeline:
            del active_pipelines[pipeline.task_id]


async def _run_pipeline_with_concurrency(
    pipeline: BasePipeline,
    state: BaseTaskState,
    task_manager: TaskManager,
):
    """带并发控制的 Pipeline 执行包装器。

    复用回归流程的加权信号量逻辑：
    1. 先将任务标记为 queued（排队中）
    2. 等待加权信号量（总并发权重 ≤ MAX_CONCURRENT_WEIGHT）
    3. 获取到信号量后启动 pipeline
    4. pipeline 结束后释放信号量
    """
    weight = TASK_TYPE_WEIGHTS.get(state.task_type, 1)
    task_id = pipeline.task_id
    _queued_tasks[task_id] = weight

    logger.info(
        f"[Concurrency] Task {task_id} queued (weight={weight}, "
        f"current={_pipeline_semaphore.current}/{_pipeline_semaphore.max_weight})"
    )

    # 标记排队状态
    task_manager.update_state(status=StepStatus.QUEUED)

    # 排队时持久化进度消息（前端轮询可读取）
    task_manager.update_state(
        current_step="init", current_status="running",
        current_message="任务排队中...", current_progress=0.0,
    )

    try:
        # 等待并发槽位
        await _pipeline_semaphore.acquire(weight)
        # 已获取槽位，从排队列表移除
        _queued_tasks.pop(task_id, None)

        logger.info(
            f"[Concurrency] Task {task_id} acquired slot (weight={weight}, "
            f"current={_pipeline_semaphore.current}/{_pipeline_semaphore.max_weight})"
        )

        # 检查是否在排队期间被 stop
        if getattr(pipeline, '_stop_event', None) and pipeline._stop_event.is_set():
            logger.info(f"[Concurrency] Task {task_id} was stopped while queued, skipping")
            return

        # 启动 pipeline
        await _run_pipeline(pipeline, state)
    except asyncio.CancelledError:
        # 任务被取消（如 stop 操作）
        _queued_tasks.pop(task_id, None)
        logger.info(f"[Concurrency] Task {task_id} cancelled while queued")
    finally:
        # 释放信号量
        try:
            await _pipeline_semaphore.release(weight)
            logger.info(
                f"[Concurrency] Task {task_id} released slot (weight={weight}, "
                f"current={_pipeline_semaphore.current}/{_pipeline_semaphore.max_weight})"
            )
        except Exception:
            pass
        _queued_tasks.pop(task_id, None)


def _launch_background_task(coro):
    """Launch a background task with a strong reference to prevent GC."""
    task = asyncio.create_task(coro)
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)
    return task


# ═══════════════════════════════════════════════════
# 任务创建端点 — 三种类型
# ═══════════════════════════════════════════════════


@app.post("/api/tasks/simple")
async def create_simple_task(
    prompt: str = Form(...),
    user_id: str = Header(default="", alias="X-User-Id"),
    mode: str = Form("t2v"),
    duration: int = Form(5),
    video_width: int = Form(768),
    video_height: int = Form(1152),
    seed: Optional[int] = Form(None),
    negative_prompt: Optional[str] = Form(None),
    system_prompt: str = Form(""),
    reference_image: UploadFile = File(None),
    end_frame_image: UploadFile = File(None),
    # v7.0: 音频配置 (désactivé par défaut — l'utilisateur coche pour ajouter une voix TTS)
    audio_enabled: bool = Form(False),
    audio_voice: str = Form("fr-FR-VivienneMultilingualNeural"),
    audio_rate: str = Form("+0%"),
    # v7.0: 画质增强
    quality_boost: bool = Form(False),
):
    """创建简单视频任务（类型 1）。
    v7.0：新增音频（TTS 旁白）和画质增强支持。
    """
    api_key = get_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    # P7: 参数校验
    _VALID_MODES = {"t2v", "i2v", "ti2vid", "keyframes"}
    if mode not in _VALID_MODES:
        raise HTTPException(
            status_code=422,
            detail=f"mode 必须为 {_VALID_MODES} 之一，当前: {mode}",
        )
    if duration not in DURATION_FRAME_MAP:
        raise HTTPException(
            status_code=422,
            detail=f"duration 必须为 {sorted(DURATION_FRAME_MAP.keys())} 之一，当前: {duration}",
        )
    if len(prompt) > 5000:
        raise HTTPException(status_code=422, detail="prompt 最多 5000 字符")

    # v8.0: Validation de sécurité (prompt + rate limit IP)
    if _security_validator:
        # Rate limit par IP (protection DDoS)
        client_ip = request.client.host if request else ""
        if not _security_validator.check_ip_rate_limit(client_ip):
            _security_validator.log_security_event("rate_limit_exceeded", ip=client_ip)
            raise HTTPException(status_code=429, detail="Trop de requêtes, veuillez patienter")

        # Validation du prompt
        result = _security_validator.validate_prompt(prompt)
        if not result.valid:
            _security_validator.log_security_event(
                "blocked_prompt", ip=client_ip, user_id=user_id,
                details={"error": result.error}
            )
            raise HTTPException(status_code=400, detail=result.error or "Prompt invalide")
        if result.sanitized:
            prompt = result.sanitized

    # v7.0: 画质增强 — 强制使用更高参数
    if quality_boost:
        # 尽量使用更大的分辨率/更长的时长
        if video_width <= 768 and video_height <= 1152:
            # 升级到 1080p 对应方向
            if video_width < video_height:
                video_width, video_height = 1080, 1920
            else:
                video_width, video_height = 1920, 1080

    task_id = uuid.uuid4().hex[:12]
    dir_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{task_id}"

    # 映射模式
    video_mode = VideoMode.T2V
    if mode in ("i2v", "ti2vid"):
        video_mode = VideoMode.I2V if mode == "i2v" else VideoMode.TI2VID
    elif mode == "keyframes":
        video_mode = VideoMode.KEYFRAMES

    state = SimpleVideoTask(
        task_id=task_id,
        user_id=user_id,
        creative_name=f"simple_{task_id}",
        prompt=prompt,
        mode=video_mode,
        duration=duration,
        video_width=video_width,
        video_height=video_height,
        seed=seed,
        negative_prompt=negative_prompt,
        system_prompt=system_prompt,
        audio_enabled=audio_enabled,
        audio_voice=audio_voice,
        audio_rate=audio_rate,
        quality_boost=quality_boost,
    )

    # 处理参考图上传（L4: 用 UUID 替代客户端文件名，避免路径穿越）
    if reference_image and reference_image.filename:
        ext = os.path.splitext(reference_image.filename)[1] or ".png"
        os.makedirs(get_upload_dir(), exist_ok=True)
        upload_path = os.path.join(get_upload_dir(), f"{task_id}_ref{ext}")
        with open(upload_path, "wb") as f:
            f.write(await reference_image.read())
        state.reference_image = upload_path

    # 处理尾帧图上传（keyframes 模式）
    if end_frame_image and end_frame_image.filename:
        ext = os.path.splitext(end_frame_image.filename)[1] or ".png"
        upload_path = os.path.join(get_upload_dir(), f"{task_id}_end{ext}")
        with open(upload_path, "wb") as f:
            f.write(await end_frame_image.read())
        state.end_frame_image = upload_path

    pipeline = _create_pipeline_for_type(TaskType.SIMPLE, api_key, task_id, dir_name)
    active_pipelines[task_id] = pipeline

    tm = TaskManager(task_id, dir_name=dir_name)
    tm.create(state)
    _launch_background_task(_run_pipeline_with_concurrency(pipeline, state, tm))
    logger.info(f"[Simple] Task created: {task_id}, mode={mode}, duration={duration}s (queued)")
    return {"ok": True, "task_id": task_id, "dir_name": dir_name}


@app.post("/api/tasks/advanced")
async def create_advanced_task(
    prompt: str = Form(...),
    user_id: str = Header(default="", alias="X-User-Id"),
    duration: int = Form(5),
    video_width: int = Form(1152),
    video_height: int = Form(768),
    seed: Optional[int] = Form(None),
    negative_prompt: Optional[str] = Form(None),
    reference_image: UploadFile = File(None),
    # v8.0: paramètres de qualité avancée
    quality: str = Form("full_hd"),           # standard | hd | full_hd | 2k | 4k
    style: str = Form("ultra_realistic"),     # ultra_realistic | cinema | anime | photorealistic | hyper_realistic
    denoise: bool = Form(True),
    face_enhance: bool = Form(True),
    motion_enhance: bool = Form(False),
    hdr: bool = Form(False),
    color_correct: bool = Form(True),
    compress: bool = Form(True),
    # Audio
    audio_enabled: bool = Form(True),
    audio_voice: str = Form("fr-FR-DeniseNeural"),
    audio_rate: str = Form("+0%"),
    # Prompt optimization
    optimize_prompt: bool = Form(True),
    # Priorité
    priority: str = Form("free"),             # admin | premium | free
):
    """Crée une tâche vidéo avancée (v8.0) avec pipeline IA complet.

    Pipeline : Prompt → Analyse IA → Optimisation → Génération → Upscaling →
    Amélioration visage → Amélioration mouvement → Audio → Compression → Livraison

    Contrairement à /api/tasks/simple, cette route utilise le pipeline IA complet
    avec upscaling, débruitage, amélioration des visages, HDR et optimisation
    audio avancée.
    """
    api_key = get_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    # Validation des paramètres
    _VALID_QUALITIES = {"standard", "hd", "full_hd", "2k", "4k"}
    if quality not in _VALID_QUALITIES:
        raise HTTPException(
            status_code=422,
            detail=f"quality must be one of {_VALID_QUALITIES}, got: {quality}",
        )
    _VALID_STYLES = {"ultra_realistic", "cinema", "anime", "photorealistic", "hyper_realistic"}
    if style not in _VALID_STYLES:
        raise HTTPException(
            status_code=422,
            detail=f"style must be one of {_VALID_STYLES}, got: {style}",
        )
    _VALID_PRIORITIES = {"admin", "premium", "free"}
    if priority not in _VALID_PRIORITIES:
        raise HTTPException(
            status_code=422,
            detail=f"priority must be one of {_VALID_PRIORITIES}, got: {priority}",
        )
    if duration not in DURATION_FRAME_MAP:
        raise HTTPException(
            status_code=422,
            detail=f"duration must be one of {sorted(DURATION_FRAME_MAP.keys())}, got: {duration}",
        )
    if len(prompt) > 5000:
        raise HTTPException(status_code=422, detail="prompt最多5000字符")

    task_id = uuid.uuid4().hex[:12]
    dir_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{task_id}"

    # Mapping priorité
    priority_map = {
        "admin": TaskPriority.ADMIN,
        "premium": TaskPriority.PREMIUM,
        "free": TaskPriority.FREE,
    }

    # Configuration du pipeline
    config = PipelineConfig(
        quality=quality,
        style=style,
        denoise=denoise,
        face_enhance=face_enhance,
        motion_enhance=motion_enhance,
        hdr=hdr,
        color_correct=color_correct,
        compress=compress,
        audio_enabled=audio_enabled,
        audio_voice=audio_voice,
        audio_rate=audio_rate,
        priority=priority_map[priority],
        optimize_prompt=optimize_prompt,
    )

    # Traitement de l'image de référence
    ref_paths = []
    if reference_image and reference_image.filename:
        ext = os.path.splitext(reference_image.filename)[1] or ".png"
        os.makedirs(get_upload_dir(), exist_ok=True)
        upload_path = os.path.join(get_upload_dir(), f"{task_id}_ref{ext}")
        with open(upload_path, "wb") as f:
            f.write(await reference_image.read())
        ref_paths.append(upload_path)

    # Créer l'état de tâche (réutilise SimpleVideoTask pour compatibilité)
    state = SimpleVideoTask(
        task_id=task_id,
        dir_name=dir_name,
        task_type=TaskType.SIMPLE,
        creative_name=f"advanced_{task_id}",
        user_id=user_id,
        prompt=prompt,
        mode=VideoMode.T2V,
        duration=duration,
        video_width=video_width,
        video_height=video_height,
        seed=seed,
        negative_prompt=negative_prompt,
        audio_enabled=audio_enabled,
        audio_voice=audio_voice,
        audio_rate=audio_rate,
        quality_boost=True,  # toujours activé pour advanced
    )

    # Lancer le pipeline avancé en arrière-plan
    async def _run_advanced():
        try:
            pipeline = AIVideoPipeline(
                api_key=api_key,
                config=config,
                queue=_video_queue,
                monitor=_video_monitor,
            )
            pipeline.video_api.shutdown_event = shutdown_event

            # Émettre le statut initial
            state.status = StepStatus.QUEUED
            tm = TaskManager(task_id, dir_name=dir_name)
            tm.create(state)
            tm.update_state(
                current_step="init", current_status="running",
                current_message="En file d'attente (priorité " + priority + ")...",
                current_progress=0.0,
            )

            # Générer la vidéo
            result = await pipeline.generate(
                prompt=prompt,
                duration=duration,
                width=video_width,
                height=video_height,
                reference_image_paths=ref_paths,
                seed=seed,
                negative_prompt=negative_prompt,
                working_dir=os.path.join(get_working_dir(), dir_name),
            )

            # Mettre à jour l'état
            state.status = StepStatus.COMPLETED
            state.final_video_file = result.video_path
            tm.update_state(
                status=StepStatus.COMPLETED,
                final_video_file=result.video_path,
                current_step="done",
                current_status="completed",
                current_message="Vidéo générée avec succès !",
                current_progress=1.0,
            )
            logger.info(f"[Advanced] Task {task_id} completed: {result.video_path}")

        except Exception as e:
            logger.error(f"[Advanced] Task {task_id} failed: {e}", exc_info=True)
            state.status = StepStatus.FAILED
            tm = TaskManager(task_id, dir_name=dir_name)
            tm.update_state(
                status=StepStatus.FAILED,
                current_message=f"Erreur: {str(e)[:200]}",
            )

    _launch_background_task(_run_advanced())
    logger.info(f"[Advanced] Task created: {task_id}, quality={quality}, style={style}, priority={priority}")
    return {"ok": True, "task_id": task_id, "dir_name": dir_name}


@app.post("/api/tasks/creative")
async def create_creative_task(
    idea: str = Form(...),
    user_id: str = Header(default="", alias="X-User-Id"),
    creative_name: str = Form(""),
    style: str = Form("电影质感写实风格"),
    chaining_mode: str = Form("keyframes"),
    video_width: int = Form(768),
    video_height: int = Form(1152),
    # ── v3.x 场景配置 ──
    duration_source: str = Form("manual"),
    scene_count: int = Form(3),
    uniform_duration: bool = Form(True),
    scene_durations_json: str = Form("[5,5,5]"),
    reference_image: UploadFile = File(None),
    end_frame_images: List[UploadFile] = File(None),
    use_custom_end_frames: bool = Form(False),
    generate_end_frames_from_ref: bool = Form(True),
    # v2.0 音频配置
    audio_enabled: bool = Form(False),
    audio_voice: str = Form("zh-CN-XiaoxiaoNeural"),
    audio_rate: str = Form("+0%"),
    audio_lang: str = Form(""),  # 页面语言，用于音色兼容性校验
    # v3.0 字幕独立配置
    subtitle_enabled: bool = Form(True),
    subtitle_style_mode: str = Form("fixed"),
    subtitle_style_hints: str = Form(""),
    subtitle_font: str = Form("STHeitiMedium.ttc"),
    subtitle_color: str = Form("white"),
    subtitle_fontsize: int = Form(48),
    subtitle_position: str = Form("bottom"),
    subtitle_stroke_color: str = Form("black"),
    subtitle_stroke_width: int = Form(2),
    subtitle_bg_color: str = Form("black@0.5"),
):
    """创建创意长视频任务（类型 2）。"""
    api_key = get_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    # v4.0: 音色与目标语言兼容性校验
    if audio_enabled:
        _validate_voice_compat(audio_voice, audio_lang or "zh")

    # P7: 参数校验
    if len(idea) > 10000:
        raise HTTPException(status_code=422, detail="idea 最多 10000 字符")
    if duration_source not in ("manual", "prompt"):
        raise HTTPException(status_code=422, detail="duration_source 必须为 manual 或 prompt")
    if duration_source == "manual":
        if scene_count < 1 or scene_count > 100:
            raise HTTPException(status_code=422, detail="scene_count 范围 1-100")
        # 解析场景时长 JSON
        try:
            scene_durations = json.loads(scene_durations_json)
            if not isinstance(scene_durations, list):
                raise ValueError("not a list")
        except Exception:
            raise HTTPException(status_code=422, detail="scene_durations_json 必须为 JSON 数组")
        # 校验每个时长
        for i, d in enumerate(scene_durations):
            if not isinstance(d, (int, float)) or d < 2 or d > 60:
                raise HTTPException(status_code=422, detail=f"Scène {i+1}: durée 2-60 secondes")
    else:
        scene_durations = []

    task_id = uuid.uuid4().hex[:12]
    name = creative_name.strip() if creative_name else f"video_{task_id}"
    dir_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{task_id}"

    # 构建音频配置
    audio_config = AudioConfig(
        enabled=audio_enabled,
        voice=audio_voice,
        rate=audio_rate,
    )
    # 构建独立字幕配置（v3.0）
    subtitle_style = SubtitleStyle(
        font=subtitle_font,
        color=subtitle_color,
        fontsize=subtitle_fontsize,
        position=_build_position(subtitle_position),
        stroke_color=subtitle_stroke_color,
        stroke_width=subtitle_stroke_width,
        bg_color=_parse_bg_color(subtitle_bg_color),
        style_mode=subtitle_style_mode,
        style_hints=subtitle_style_hints,
    )
    subtitle_config = SubtitleConfig(
        enabled=subtitle_enabled,
        style=subtitle_style,
    )

    state = CreativeVideoTask(
        task_id=task_id,
        user_id=user_id,
        creative_name=name,
        idea=idea,
        style=style,
        chaining_mode=chaining_mode,
        video_width=video_width,
        video_height=video_height,
        video_duration=5,
        duration_source=duration_source,
        scene_count=scene_count,
        uniform_duration=uniform_duration,
        scene_durations=scene_durations,
        use_custom_end_frames=use_custom_end_frames,
        generate_end_frames_from_ref=generate_end_frames_from_ref,
        audio_config=audio_config,
        subtitle_config=subtitle_config,
    )

    logger.info(
        f"[Pipeline] Scene config: source={duration_source}, "
        f"scenes={scene_count}, durations={scene_durations}, uniform={uniform_duration}"
    )

    # 处理参考图上传（L4: 用 UUID 替代客户端文件名，避免路径穿越）
    if reference_image and reference_image.filename:
        ext = os.path.splitext(reference_image.filename)[1] or ".png"
        os.makedirs(get_upload_dir(), exist_ok=True)
        upload_path = os.path.join(get_upload_dir(), f"{task_id}_ref{ext}")
        with open(upload_path, "wb") as f:
            f.write(await reference_image.read())
        state.reference_image = upload_path

    # P3: 处理自定义尾帧图片上传
    if use_custom_end_frames and end_frame_images:
        saved_paths = []
        for idx, ef_file in enumerate(end_frame_images):
            if ef_file and ef_file.filename:
                ext = os.path.splitext(ef_file.filename)[1] or ".png"
                upload_path = os.path.join(get_upload_dir(), f"{task_id}_end_{idx}{ext}")
                with open(upload_path, "wb") as f:
                    f.write(await ef_file.read())
                saved_paths.append(upload_path)
        if saved_paths:
            state.end_frame_images = saved_paths
            logger.info(f"[Pipeline] Saved {len(saved_paths)} custom end frame images for task {task_id}")

    pipeline = _create_pipeline_for_type(TaskType.CREATIVE, api_key, task_id, dir_name)
    active_pipelines[task_id] = pipeline

    tm = TaskManager(task_id, dir_name=dir_name)
    tm.create(state)
    _launch_background_task(_run_pipeline_with_concurrency(pipeline, state, tm))
    logger.info(f"[Creative] Task created: {task_id}, idea={idea[:40]}... (queued)")
    return {"ok": True, "task_id": task_id, "dir_name": dir_name}


@app.post("/api/tasks/manuscript")
async def create_manuscript_task(
    manuscript_text: str = Form(...),
    user_id: str = Header(default="", alias="X-User-Id"),
    creative_name: str = Form(""),
    video_width: int = Form(768),
    video_height: int = Form(1152),
    video_duration: int = Form(10),
    # v2.0 音频配置
    audio_enabled: bool = Form(True),
    audio_voice: str = Form("zh-CN-XiaoxiaoNeural"),
    audio_rate: str = Form("+0%"),
    audio_lang: str = Form(""),  # 页面语言，用于音色兼容性校验
    # v3.0 字幕独立配置
    subtitle_enabled: bool = Form(True),
    subtitle_style_mode: str = Form("fixed"),
    subtitle_style_hints: str = Form(""),
    subtitle_font: str = Form("STHeitiMedium.ttc"),
    subtitle_color: str = Form("white"),
    subtitle_fontsize: int = Form(48),
    subtitle_position: str = Form("bottom"),
    subtitle_stroke_color: str = Form("black"),
    subtitle_stroke_width: int = Form(2),
    subtitle_bg_color: str = Form("black@0.5"),
):
    """创建稿件长视频任务（类型 3）。"""
    api_key = get_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    if not manuscript_text.strip():
        raise HTTPException(status_code=400, detail="稿件内容不能为空")
    # P7: 文本长度上限
    if len(manuscript_text) > 50000:
        raise HTTPException(status_code=422, detail="稿件文本最多 50000 字符")

    # v4.0: 稿件正文已知，做脚本级音色兼容性校验（最准确）
    if audio_enabled:
        _validate_voice_compat(audio_voice, audio_lang or "zh", text=manuscript_text)

    task_id = uuid.uuid4().hex[:12]
    name = creative_name.strip() if creative_name else f"manuscript_{task_id}"
    dir_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{task_id}"

    # 构建音频配置
    audio_config = AudioConfig(
        enabled=audio_enabled,
        voice=audio_voice,
        rate=audio_rate,
    )
    # 构建独立字幕配置（v3.0）
    subtitle_style = SubtitleStyle(
        font=subtitle_font,
        color=subtitle_color,
        fontsize=subtitle_fontsize,
        position=_build_position(subtitle_position),
        stroke_color=subtitle_stroke_color,
        stroke_width=subtitle_stroke_width,
        bg_color=_parse_bg_color(subtitle_bg_color),
        style_mode=subtitle_style_mode,
        style_hints=subtitle_style_hints,
    )
    subtitle_config = SubtitleConfig(
        enabled=subtitle_enabled,
        style=subtitle_style,
    )

    state = ManuscriptVideoTask(
        task_id=task_id,
        user_id=user_id,
        creative_name=name,
        manuscript_text=manuscript_text.strip(),
        video_width=video_width,
        video_height=video_height,
        video_duration=video_duration,
        audio_config=audio_config,
        subtitle_config=subtitle_config,
    )

    pipeline = _create_pipeline_for_type(TaskType.MANUSCRIPT, api_key, task_id, dir_name)
    active_pipelines[task_id] = pipeline

    tm = TaskManager(task_id, dir_name=dir_name)
    tm.create(state)
    _launch_background_task(_run_pipeline_with_concurrency(pipeline, state, tm))
    logger.info(f"[Manuscript] Task created: {task_id}, text_len={len(manuscript_text)} (queued)")
    return {"ok": True, "task_id": task_id, "dir_name": dir_name}


@app.post("/api/tasks/poetry")
async def create_poetry_task(
    poem_text: str = Form(...),
    user_id: str = Header(default="", alias="X-User-Id"),
    creative_name: str = Form(""),
    user_scene_prompts_json: str = Form("[]"),
    style: str = Form("电影质感写实风格"),
    video_width: int = Form(768),
    video_height: int = Form(1152),
    video_duration: int = Form(30),
    # ── 场景配置（与创意视频完全一致）──
    duration_source: str = Form("manual"),
    scene_count: int = Form(3),
    uniform_duration: bool = Form(True),
    scene_durations_json: str = Form("[5,5,5]"),
    # 音频配置（默认开启朗诵配音）
    audio_enabled: bool = Form(True),
    audio_voice: str = Form("zh-CN-XiaoxiaoNeural"),
    audio_rate: str = Form("-15%"),
    audio_lang: str = Form(""),  # 页面语言，用于音色兼容性校验
    # 字幕配置（默认开启，固定诗歌样式，用户仅开关）
    subtitle_enabled: bool = Form(True),
):
    """创建诗词视频任务（类型 6）。"""
    api_key = get_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    # v4.0: 音色与目标语言兼容性校验
    if audio_enabled:
        _validate_voice_compat(audio_voice, audio_lang or "zh")

    if not poem_text.strip():
        raise HTTPException(status_code=400, detail="古诗原文不能为空")
    if len(poem_text) > 2000:
        raise HTTPException(status_code=422, detail="古诗原文最多 2000 字符")
    if video_duration < 5 or video_duration > 300:
        raise HTTPException(status_code=422, detail="video_duration 范围 5-300 秒")
    if duration_source not in ("manual", "prompt"):
        raise HTTPException(status_code=422, detail="duration_source 必须为 manual 或 prompt")
    if duration_source == "manual":
        if scene_count < 1 or scene_count > 100:
            raise HTTPException(status_code=422, detail="scene_count 范围 1-100")
        # 解析场景时长 JSON
        try:
            scene_durations = json.loads(scene_durations_json)
            if not isinstance(scene_durations, list):
                raise ValueError("not a list")
        except Exception:
            raise HTTPException(status_code=422, detail="scene_durations_json 必须为 JSON 数组")
        for i, d in enumerate(scene_durations):
            if not isinstance(d, (int, float)) or d < 2 or d > 60:
                raise HTTPException(status_code=422, detail=f"Scène {i+1}: durée 2-60 secondes")
    else:
        scene_durations = []

    # 解析可选分镜 prompt 列表（JSON 数组）
    try:
        user_scene_prompts = json.loads(user_scene_prompts_json)
        if not isinstance(user_scene_prompts, list):
            raise ValueError("not a list")
        user_scene_prompts = [str(p) for p in user_scene_prompts]
    except Exception:
        raise HTTPException(status_code=422, detail="user_scene_prompts_json 必须为 JSON 数组")

    task_id = uuid.uuid4().hex[:12]
    name = creative_name.strip() if creative_name else f"poetry_{task_id}"
    dir_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{task_id}"

    audio_config = AudioConfig(
        enabled=audio_enabled,
        voice=audio_voice,
        rate=audio_rate,
    )
    # 字幕使用固定诗歌样式，用户仅控制开关
    subtitle_config = SubtitleConfig(
        enabled=subtitle_enabled,
        style=POETRY_SUBTITLE_STYLE,
    )

    state = PoetryVideoTask(
        task_id=task_id,
        user_id=user_id,
        creative_name=name,
        poem_text=poem_text.strip(),
        user_scene_prompts=user_scene_prompts,
        style=style.strip() or "电影质感写实风格",
        video_width=video_width,
        video_height=video_height,
        video_duration=video_duration,
        duration_source=duration_source,
        scene_count=scene_count,
        uniform_duration=uniform_duration,
        scene_durations=scene_durations,
        audio_config=audio_config,
        subtitle_config=subtitle_config,
    )

    pipeline = _create_pipeline_for_type(TaskType.POETRY, api_key, task_id, dir_name)
    active_pipelines[task_id] = pipeline

    tm = TaskManager(task_id, dir_name=dir_name)
    tm.create(state)
    _launch_background_task(_run_pipeline_with_concurrency(pipeline, state, tm))
    logger.info(f"[Poetry] Task created: {task_id}, poem={poem_text[:20]!r} (queued)")
    return {"ok": True, "task_id": task_id, "dir_name": dir_name}


@app.post("/api/tasks/anchor")
async def create_anchor_task(
    anchor_prompt: str = Form(""),
    user_id: str = Header(default="", alias="X-User-Id"),
    anchor_reference_image: str = Form(""),
    script_text: str = Form(...),
    audio_source: str = Form("post_stitch"),
    video_width: int = Form(768),
    video_height: int = Form(1344),
    audio_enabled: bool = Form(True),
    audio_voice: str = Form("zh-CN-XiaoxiaoNeural"),
    audio_rate: str = Form("+0%"),
    audio_lang: str = Form(""),  # 页面语言，用于音色兼容性校验
    subtitle_enabled: bool = Form(True),
    subtitle_style_mode: str = Form("fixed"),
    subtitle_style_hints: str = Form(""),
    subtitle_font: str = Form("STHeitiMedium.ttc"),
    subtitle_color: str = Form("white"),
    subtitle_fontsize: int = Form(42),
    subtitle_position: str = Form("bottom"),
    subtitle_stroke_color: str = Form("black"),
    subtitle_stroke_width: int = Form(2),
    subtitle_bg_color: str = Form("black@0.5"),
):
    """创建数字人口播任务（类型 4 / Phase 3）。"""
    api_key = get_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    # v4.0: 音色与稿件文本兼容性校验
    # 数字人口播的稿件由用户直接输入，应以「稿件文本的实际文字体系」为准做脚本级
    # 校验，而非页面语言。否则中文环境下输入英文稿 + 选英文音色会被误判为不支持。
    if audio_enabled:
        _validate_voice_compat(audio_voice, audio_lang or "zh", text=script_text)

    if not script_text.strip():
        raise HTTPException(status_code=400, detail="口播稿件不能为空")
    if len(script_text) > 50000:
        raise HTTPException(status_code=422, detail="口播稿件最多 50000 字符")

    task_id = uuid.uuid4().hex[:12]
    name = f"anchor_{task_id}"
    dir_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{task_id}"

    audio_config = AudioConfig(
        enabled=audio_enabled,
        voice=audio_voice,
        rate=audio_rate,
    )
    subtitle_style = SubtitleStyle(
        font=subtitle_font,
        color=subtitle_color,
        fontsize=subtitle_fontsize,
        position=_build_position(subtitle_position),
        stroke_color=subtitle_stroke_color,
        stroke_width=subtitle_stroke_width,
        bg_color=_parse_bg_color(subtitle_bg_color),
        style_mode=subtitle_style_mode,
        style_hints=subtitle_style_hints,
    )
    subtitle_config = SubtitleConfig(
        enabled=subtitle_enabled,
        style=subtitle_style,
    )

    state = AnchorVideoTask(
        task_id=task_id,
        user_id=user_id,
        creative_name=name,
        anchor_prompt=anchor_prompt,
        anchor_reference_image=anchor_reference_image,
        script_text=script_text.strip(),
        audio_source=audio_source,
        video_width=video_width,
        video_height=video_height,
        audio_config=audio_config,
        subtitle_config=subtitle_config,
    )

    pipeline = _create_pipeline_for_type(TaskType.ANCHOR, api_key, task_id, dir_name)
    active_pipelines[task_id] = pipeline

    tm = TaskManager(task_id, dir_name=dir_name)
    tm.create(state)
    _launch_background_task(_run_pipeline_with_concurrency(pipeline, state, tm))
    logger.info(f"[Anchor] Task created: {task_id}, script_len={len(script_text)} (queued)")
    return {"ok": True, "task_id": task_id, "dir_name": dir_name}


# ═══════════════════════════════════════════════════
# 向后兼容：旧的 POST /api/tasks → 映射到 creative
# ═══════════════════════════════════════════════════


@app.post("/api/tasks")
async def create_task_legacy(
    idea: str = Form(...),
    user_id: str = Header(default="", alias="X-User-Id"),
    creative_name: str = Form(""),
    user_requirement: str = Form("3个场景，每个场景10秒，电影质感"),
    style: str = Form("电影质感写实风格"),
    chaining_mode: str = Form("keyframes"),
    video_width: int = Form(768),
    video_height: int = Form(1152),
    reference_image: UploadFile = File(None),
    end_frame_images: List[UploadFile] = File(None),
    use_custom_end_frames: bool = Form(False),
    generate_end_frames_from_ref: bool = Form(True),
):
    """向后兼容旧端点，映射到 create_creative_task。"""
    return await create_creative_task(
        idea=idea,
        user_id=user_id,
        creative_name=creative_name,
        user_requirement=user_requirement,
        style=style,
        chaining_mode=chaining_mode,
        video_width=video_width,
        video_height=video_height,
        reference_image=reference_image,
        end_frame_images=end_frame_images,
        use_custom_end_frames=use_custom_end_frames,
        generate_end_frames_from_ref=generate_end_frames_from_ref,
        # 提供音频/字幕默认值（旧端点不传这些参数）
        audio_enabled=False,
        audio_voice="zh-CN-XiaoxiaoNeural",
        audio_rate="+0%",
        subtitle_enabled=True,
        subtitle_font="STHeitiMedium.ttc",
        subtitle_color="white",
        subtitle_fontsize=48,
        subtitle_position="bottom",
        subtitle_stroke_color="black",
        subtitle_stroke_width=2,
        subtitle_bg_color="black@0.5",
    )


# ═══════════════════════════════════════════════════
# 任务恢复 + 停止
# ═══════════════════════════════════════════════════


@app.get("/api/poetry-scene-prompt")
async def poetry_scene_prompt(
    poem: str = "",
    scene_count: int = 0,
    scene_durations: str = "",
    total_duration: int = 30,
    style: str = "",
):
    """返回已填充的诗歌分镜提示词（中文），供前端展示与复制。

    参数与内部 LLM 使用的完全一致（scene_count / scene_durations / total_duration / style），
    因此用户拿去任意 LLM 生成、再把「原诗句 | 画面描述」行格式贴回，与系统内生成结果一致。
    """
    import json
    from core.screenwriter import build_poetry_scene_prompt
    try:
        durations = json.loads(scene_durations) if scene_durations else []
    except (ValueError, TypeError):
        durations = []
    if not isinstance(durations, list):
        durations = []
    return build_poetry_scene_prompt(
        poem=poem,
        scene_count=scene_count,
        scene_durations=[int(d) for d in durations if str(d).isdigit()],
        total_duration=total_duration,
        style=style,
    )


@app.post("/api/tasks/{task_id}/resume")
async def resume_task(task_id: str, user_id: str = Header(default="", alias="X-User-Id")):
    api_key = get_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    # 关键段串行化：check 与 insert 之间存在多个 await 让出点，快速重复 resume
    # 会让两次请求都通过 "task not in active_pipelines" 检查并各自启动 pipeline，
    # 导致同任务双重运行、状态文件交叉写入。
    async with _get_pipeline_lock(task_id):
        if task_id in active_pipelines:
            existing = active_pipelines[task_id]
            if existing._stop_event.is_set():
                logger.info(f"[Resume] Replacing stopped pipeline for task {task_id}")
                del active_pipelines[task_id]
            else:
                raise HTTPException(status_code=400, detail="Task is already running")

        dir_name = _find_dir_name(task_id)
        tm = TaskManager(task_id, dir_name=dir_name)
        state = tm.load()
        if not state:
            raise HTTPException(status_code=404, detail="Task not found")

        if state.user_id and state.user_id != user_id:
            raise HTTPException(status_code=403, detail="Accès refusé : cette tâche appartient à un autre utilisateur")

        if state.status == StepStatus.COMPLETED:
            raise HTTPException(status_code=400, detail="Task is already completed")

        logger.info(f"[Resume] Starting resume for task {task_id}, type={state.task_type}, status={state.status}")

        # v2.0：根据 task_type 选择对应的 Pipeline
        pipeline = _create_pipeline_for_type(state.task_type, api_key, task_id, dir_name)
        active_pipelines[task_id] = pipeline

        _launch_background_task(_run_pipeline_with_concurrency(pipeline, state, tm))
    return {"ok": True, "task_id": task_id, "dir_name": dir_name}


@app.post("/api/tasks/{task_id}/stop")
async def stop_task(task_id: str, user_id: str = Header(default="", alias="X-User-Id")):
    if task_id not in active_pipelines and task_id not in _queued_tasks:
        raise HTTPException(status_code=400, detail="Task is not running")

    # Confidentialité : on ne peut stopper que ses propres tâches
    _require_task_access(task_id, user_id)

    # 停止运行中的 pipeline
    if task_id in active_pipelines:
        pipeline = active_pipelines[task_id]
        pipeline.stop()

    dir_name = _find_dir_name(task_id)
    tm = TaskManager(task_id, dir_name=dir_name)
    state = tm.load()
    if state and state.status in (StepStatus.RUNNING, StepStatus.QUEUED):
        tm.update_state(status=StepStatus.PENDING)
        logger.info(f"[Stop] Task {task_id} status -> pending")

    logger.info(f"[Stop] Task {task_id} stop requested")
    return {"ok": True, "task_id": task_id}


# ═══════════════════════════════════════════════════
# 并发状态接口
# ═══════════════════════════════════════════════════


@app.get("/api/concurrency")
async def get_concurrency_status():
    """返回当前并发控制状态：已用权重、上限、排队任务列表。"""
    running_tasks = []
    for tid, pl in active_pipelines.items():
        if tid not in _queued_tasks:
            # 真正在运行的（已获取信号量）
            running_tasks.append({
                "task_id": tid,
                "type": getattr(pl, '_task_type', 'unknown'),
            })

    queued = [
        {"task_id": tid, "weight": w}
        for tid, w in _queued_tasks.items()
    ]

    return {
        "ok": True,
        "max_weight": _pipeline_semaphore.max_weight,
        "current_weight": _pipeline_semaphore.current,
        "utilization": round(_pipeline_semaphore.utilization, 2),
        "running_count": len(running_tasks),
        "queued_count": len(queued),
        "queued_tasks": queued,
        "rate_limit_per_min": _AGNES_RATE_LIMIT,
        "task_weights": {k.value: v for k, v in TASK_TYPE_WEIGHTS.items()},
    }


# ═══════════════════════════════════════════════════
# 回归测试清理
# ═══════════════════════════════════════════════════

@app.post("/api/cleanup-regression")
async def cleanup_regression():
    """安全清理回归测试产物（报告、日志、任务目录）。

    只删除产物清单中记录的内容，不影响用户原有任务数据。
    """
    working_dir = get_working_dir()
    manifest_path = os.path.join(working_dir, ".regression_manifest.json")

    if not os.path.exists(manifest_path):
        raise HTTPException(
            status_code=404,
            detail="未找到回归测试产物清单，可能没有执行过回归测试")

    try:
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        raise HTTPException(
            status_code=500,
            detail=f"读取清单失败: {e}")

    removed_dirs = 0
    removed_files = 0
    errors: list = []
    project_root = os.path.dirname(os.path.abspath(__file__))
    upload_dir = os.path.join(working_dir, "uploads")

    # 1. 清理任务目录
    for dir_name in manifest.get("task_dirs", []):
        dir_path = os.path.join(working_dir, dir_name)
        if os.path.isdir(dir_path):
            try:
                shutil.rmtree(dir_path)
                removed_dirs += 1
            except OSError as e:
                logger.warning(f"[Cleanup] 删除目录失败 {dir_name}: {e}")
                errors.append(f"删除目录失败: {dir_name}")

    # 2. 清理上传文件
    for fname in manifest.get("uploads", []):
        fpath = os.path.join(upload_dir, fname)
        if os.path.isfile(fpath):
            try:
                os.remove(fpath)
                removed_files += 1
            except OSError as e:
                logger.warning(f"[Cleanup] 删除上传文件失败 {fname}: {e}")
                errors.append(f"删除上传文件失败: {fname}")

    # 3. 清理报告文件
    for rel_path in manifest.get("reports", []):
        abs_path = os.path.join(project_root, rel_path)
        if os.path.isfile(abs_path):
            try:
                os.remove(abs_path)
                removed_files += 1
            except OSError as e:
                logger.warning(f"[Cleanup] 删除报告失败 {rel_path}: {e}")
                errors.append(f"删除报告失败: {rel_path}")

    # 4. 清理服务器日志
    log_rel = manifest.get("server_log", "")
    if log_rel:
        log_path = os.path.join(project_root, log_rel)
        if os.path.isfile(log_path):
            try:
                os.remove(log_path)
                removed_files += 1
            except OSError as e:
                logger.warning(f"[Cleanup] 删除日志失败: {e}")
                errors.append("删除日志失败")

    # 5. 清理清单本身
    try:
        os.remove(manifest_path)
        removed_files += 1
    except OSError as e:
        logger.warning(f"[Cleanup] 删除清单失败: {e}")
        errors.append("删除清单失败")

    scenarios_cleaned = len(manifest.get("scenarios", {}))
    logger.info(
        f"[Cleanup] 回归清理完成: {removed_dirs} 目录, "
        f"{removed_files} 文件, {scenarios_cleaned} 场景")

    return {
        "ok": len(errors) == 0,
        "removed_dirs": removed_dirs,
        "removed_files": removed_files,
        "scenarios_cleaned": scenarios_cleaned,
        "errors": errors,
    }


# ═══════════════════════════════════════════════════
# 社区 / 社交功能
# ═══════════════════════════════════════════════════


def _extract_display_prompt(state):
    if isinstance(state, SimpleVideoTask) or isinstance(state, SimpleImageTask):
        return state.prompt
    if isinstance(state, CreativeVideoTask):
        return state.idea
    if isinstance(state, ManuscriptVideoTask):
        return state.manuscript_text
    if isinstance(state, AnchorVideoTask):
        return state.script_text
    if isinstance(state, PoetryVideoTask):
        return state.poem_text
    return ""


def _extract_duration(state):
    if hasattr(state, "duration") and isinstance(state.duration, (int, float)):
        return state.duration
    if hasattr(state, "video_duration") and isinstance(state.video_duration, (int, float)):
        return state.video_duration
    return 0


def _probe_video_duration(path: str) -> float:
    """Retourne la durée RÉELLE de la vidéo (ffprobe), 0.0 si indisponible."""
    try:
        import subprocess, json
        r = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path],
            capture_output=True, text=True, timeout=15,
        )
        if not r.stdout:
            return 0.0
        data = json.loads(r.stdout)
        return float(data.get("format", {}).get("duration", 0) or 0)
    except Exception:
        return 0.0


def _community_error(e: Exception, fallback_detail: str) -> HTTPException:
    """Convertit les erreurs de la couche de stockage en HTTPException propres."""
    if isinstance(e, KeyError):
        return HTTPException(status_code=404, detail="Video not found")
    logger.exception(f"[Community] {fallback_detail}: {e}")
    return HTTPException(status_code=500, detail=fallback_detail)


@app.post("/api/tasks/{task_id}/publish")
async def publish_video(task_id: str, request: Request, user_id: str = Header(default="", alias="X-User-Id")):
    try:
        body = await request.json()
    except Exception:
        body = {}
    author = (body.get("author") or "Anonyme").strip() or "Anonyme"
    dir_name = _find_dir_name(task_id)
    tm = TaskManager(task_id, dir_name=dir_name)
    state = tm.load()
    if not state:
        # Fichiers locaux perdus (redéploiement, FS éphémère) : si la vidéo a
        # déjà été publiée en galerie, on la renvoie telle quelle (idempotent).
        meta = get_task_store().get_meta(task_id)
        if meta and meta.get("user_id") and meta.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="Accès refusé : cette tâche appartient à un autre utilisateur")
        existing = _get_published_video(task_id)
        if existing:
            logger.info(f"[Community] Tâche {task_id}: déjà publiée ({existing['video_id']}), fichiers locaux absents")
            return {
                "ok": True,
                "video_id": existing["video_id"],
                "video_url": existing["video_url"],
                "already_published": True,
            }
        raise HTTPException(status_code=404, detail="Task not found")
    if state.user_id and state.user_id != user_id:
        raise HTTPException(status_code=403, detail="Accès refusé : cette tâche appartient à un autre utilisateur")
    if not state.final_video_file or not os.path.exists(state.final_video_file):
        # Fichier local disparu (redéploiement, FS éphémère) : si la vidéo a déjà
        # été publiée en galerie, on la renvoie telle quelle (idempotent).
        existing = _get_published_video(task_id)
        if existing:
            logger.info(f"[Community] Tâche {task_id}: déjà publiée ({existing['video_id']}), fichier local absent")
            return {
                "ok": True,
                "video_id": existing["video_id"],
                "video_url": existing["video_url"],
                "already_published": True,
            }
        raise HTTPException(status_code=400, detail="Task has no final video file")
    prompt = _extract_display_prompt(state)
    duration = _probe_video_duration(state.final_video_file) or _extract_duration(state)
    resolution = f"{state.video_width}x{state.video_height}"
    try:
        result = get_community_store().publish(
            task_id=task_id,
            author=author,
            prompt=prompt,
            duration=duration,
            resolution=resolution,
            video_path=state.final_video_file,
            user_id=user_id,
        )
    except Exception as e:
        raise _community_error(e, "Publication impossible")
    logger.info(
        f"[Community] Published video {result['video_id']} (storage={storage_mode()}, "
        f"author={author!r}, prompt={prompt[:60]!r})"
    )
    return {
        "ok": True,
        "video_id": result["video_id"],
        "video_url": result["video_url"],
    }


@app.get("/api/community/videos")
async def list_community_videos(page: int = 1, per_page: int = 20):
    try:
        result = get_community_store().list_videos(page=page, per_page=per_page)
    except Exception as e:
        raise _community_error(e, "Chargement de la galerie impossible")
    return {
        "ok": True,
        "videos": result["videos"],
        "total": result["total"],
        "page": page,
        "per_page": per_page,
    }


@app.post("/api/community/videos/{video_id}/like")
async def toggle_like(video_id: str, request: Request):
    client_host = request.client.host if request.client else "unknown"
    visitor_hash = hashlib.sha256(
        (client_host + ":" + video_id).encode("utf-8")
    ).hexdigest()[:16]
    try:
        return get_community_store().toggle_like(video_id, visitor_hash)
    except KeyError:
        raise HTTPException(status_code=404, detail="Video not found")
    except Exception as e:
        raise _community_error(e, "Like impossible")


@app.get("/api/community/videos/{video_id}/comments")
async def get_comments(video_id: str):
    try:
        return {"comments": get_community_store().get_comments(video_id)}
    except KeyError:
        raise HTTPException(status_code=404, detail="Video not found")
    except Exception as e:
        raise _community_error(e, "Chargement des commentaires impossible")


@app.post("/api/community/videos/{video_id}/comments")
async def add_comment(video_id: str, body: dict):
    # Compatibilité : l'ancien frontend envoyait parfois `content` au lieu de `text`
    text = (body.get("text") or body.get("content") or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Comment text cannot be empty")
    author = (body.get("author") or "Anonyme").strip() or "Anonyme"
    try:
        return get_community_store().add_comment(video_id, author, text)
    except KeyError:
        raise HTTPException(status_code=404, detail="Video not found")
    except Exception as e:
        raise _community_error(e, "Ajout du commentaire impossible")


@app.get("/api/community/videos/{video_id}/video")
async def serve_community_video(video_id: str):
    target = get_community_store().get_video(video_id)
    if not target:
        raise HTTPException(status_code=404, detail="Video not found")
    if target.startswith("http://") or target.startswith("https://"):
        # Mode persistant : redirection vers l'URL publique du stockage Supabase
        return RedirectResponse(target, status_code=307)
    return FileResponse(target, media_type="video/mp4")


@app.delete("/api/community/videos/{video_id}")
async def delete_community_video(video_id: str, user_id: str = Header(default="", alias="X-User-Id")):
    """Supprimer une vidéo publiée de la galerie (fichier + métadonnées + likes + commentaires).

    Réservé au créateur de la publication : le header X-User-Id doit
    correspondre au user_id enregistré à la publication (403 sinon).
    """
    try:
        get_community_store().delete(video_id, user_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Video not found in gallery")
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise _community_error(e, "Suppression impossible")
    logger.info(f"[Community] Video {video_id} deleted (storage={storage_mode()})")
    return {"ok": True}


# ═══════════════════════════════════════════════════
# 启动
# ═══════════════════════════════════════════════════


if __name__ == "__main__":
    import uvicorn

    # 允许通过环境变量覆盖监听地址/端口（npm 启动器 free-short-video 会注入）
    # 默认值保持向后兼容：0.0.0.0:8765
    _HOST = os.environ.get("HOST", "0.0.0.0")
    _PORT = int(os.environ.get("PORT", "8765"))
    config = uvicorn.Config(app, host=_HOST, port=_PORT, log_level="info")
    server = uvicorn.Server(config)

    original_handle_exit = server.handle_exit

    def _handle_exit(sig, frame):
        if shutdown_event.is_set():
            logger.warning("Force exiting...")
            os._exit(1)
        logger.info("Shutting down gracefully (Ctrl+C again to force)...")
        shutdown_event.set()
        if callable(original_handle_exit):
            original_handle_exit(sig, frame)

    server.handle_exit = _handle_exit

    server.run()
