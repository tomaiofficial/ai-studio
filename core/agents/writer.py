"""core.agents.writer — Agent génération texte: réponses, scripts, narration."""

import asyncio
import logging
from typing import Any, Dict

from .base import AgentBase

logger = logging.getLogger(__name__)

class WriterAgent(AgentBase):
    """Agent de contenu: génération de texte, réponses, scripts, narration."""

    def __init__(self, groq_api, model="groq-2.0-flash"):
        super().__init__(agent_id="writer", name="Rédacteur", role="writer")
        self.groq = groq_api
        self.model = model

    def build_system_prompt(self) -> str:
        return (
            "Vous êtes l'agent Rédacteur de l'application VA. Votre rôle est de: "
            "1) répondre aux questions de l'utilisateur en français, naturel et concis, "
            "2) écrire des scripts, des descriptions, des narrations de scène, "
            "3) adapter le ton au contexte (formel, familier, pédagogique, dramatique), "
            "4) rester bref et structuré, utiliser des puces pour la lisibilité."
        )

    async def process_task(self, task: Dict[str, Any]) -> Dict[str, Any]:
        content = task.get("content", "")
        prompt = task.get("prompt", "")
        media_type = task.get("media_type", "text")
        logger.info(f"[Agent Writer] Reçoit: {prompt[:80]}...")
        result = {"text": "", "media": None, "type": media_type, "task_id": task.get("task_id")}
        try:
            response = await self.groq.chat(
                system_prompt=self.build_system_prompt(),
                user_prompt=prompt,
                max_tokens=4096,
            )
            if isinstance(response, dict):
                result["text"] = str(response.get("choices", [{}])[0].get("text", ""))
            elif isinstance(response, str):
                result["text"] = response
        except Exception as e:
            logger.error(f"[Agent Writer] erreur Groq: {e}")
            result["error"] = str(e)
        logger.info(f"[Agent Writer] Résultat: {len(result.get('text', ''))} chars")
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
