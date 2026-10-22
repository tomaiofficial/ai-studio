"""core.agents.voice — Agent vocal: génération audio via Coqui/Edge TTS."""

import asyncio
import logging
from typing import Any, Dict

from .base import AgentBase

logger = logging.getLogger(__name__)

class VoiceAgent(AgentBase):
    """Agent vocal: génère de la parole via le moteau TTS (Coqui XTTS ou Edge)."""

    def __init__(self, tts_engine, voice="fr", speed=1.0):
        super().__init__(agent_id="voice", name="Vocal", role="voice")
        self.engine = tts_engine
        self.voice = voice
        self.speed = speed

    def build_system_prompt(self) -> str:
        return (
            "Vous êtes l'Agent Vocal de l'application. Votre rôle est de transformer le texte en parole "
            "réelle avec un rendu naturel. Vous utilisez Coqui XTTS (realiste, local) ou Edge TTS (gratuit, cloud). "
            "Vous devez produire un fichier audio clair, avec un débit naturel, adapté à la langue du texte."
        )

    async def process_task(self, task: Dict[str, Any]) -> Dict[str, Any]:
        text = task.get("text", "")
        voice = task.get("voice", self.voice)
        speed_raw = task.get("speed", self.speed)
        output_path = task.get("output_path", "")
        task_id = task.get("task_id", "unknown")
        logger.info(f"[Agent Vocal] Génère audio: {text[:60]}... -> {output_path}")
        result = {"audio_path": output_path or f"voice_{task_id}.mp3", "status": "ok"}
        try:
            await self.engine.generate(
                text=text,
                output_path=output_path or f"voice_{task_id}.mp3",
                voice=voice,
                rate=speed_raw,
            )
            result["audio_path"] = output_path or f"voice_{task_id}.mp3"
        except Exception as e:
            logger.error(f"[Agent Vocal] erreur: {e}")
            result["error"] = str(e)
            result["status"] = "failed"
        return result

    async def run(self):
        self._running = True
        logger.info(f"[Agent {self.name}] démarré.")
        while self._running:
            try:
                task = await asyncio.wait_for(self.task_queue.get(), timeout=5.0)
                if task is None:
                    continue
                result = await self.process_task(task)
                task["result"] = result
                task["status"] = "completed"
                if "on_complete" in task:
                    try:
                        await task["on_complete"](task)
                    except Exception:
                        pass
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"[Agent {self.name}] erreur: {e}")
