"""core.agents.orchestrator — Agent directeur: coordonne les tâches entre les agents."""

import asyncio
import logging
from typing import Any, Dict

from .base import AgentBase

logger = logging.getLogger(__name__)

class Orchestrator(AgentBase):
    """Agent directeur: reçoit la demande, planifie, distribue aux sous-agents."""

    def __init__(self, pool: Dict[str, AgentBase]):
        super().__init__(agent_id="orchestrator", name="Cerveau", role="orchestrator")
        self.pool = pool

    async def run(self):
        self._running = True
        logger.info(f"[Agent {self.name}] démarré.")
        while self._running:
            try:
                task = await asyncio.wait_for(self.task_queue.get(), timeout=5.0)
                if task is None:
                    continue
                self.ctx["last_task"] = task
                agent_id = task.get("to_agent", "orchestrator")
                if agent_id == "orchestrator":
                    result = await self.process_task(task)
                    task["result"] = result
                    task["status"] = "completed"
                    if "broadcast" in task:
                        for aid in task["broadcast"]:
                            if aid in self.pool:
                                await self.pool[aid].submit(task)
                    if "on_complete" in task:
                        try:
                            await task["on_complete"](task)
                        except Exception:
                            pass
                else:
                    if agent_id in self.pool:
                        task["from"] = self.agent_id
                        sub_result = await self.pool[agent_id].submit(task)
                        task["result"] = sub_result
                        task["status"] = "completed"
                        if "on_complete" in task:
                            try:
                                await task["on_complete"](task)
                            except Exception:
                                pass
                    else:
                        task["error"] = f"Agent inconnu: {agent_id}"
                        task["status"] = "failed"
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"[Agent {self.name}] erreur: {e}")

    async def process_task(self, task: Dict[str, Any]) -> Dict[str, Any]:
        """Planifie et décide quelle agent traiter."""
        plan = {
            "task": task.get("task", "Indéfini"),
            "priority": "normal",
            "steps": [],
            "agents_needed": [],
        }
        content = task.get("content", "")
        if any(k in content.lower() for k in ["code", "modifier", "version", "deploy", "git"]):
            plan["agents_needed"].append("developer")
        if any(k in content.lower() for k in ["voix", "audio", "parler", "tts", "sound"]):
            plan["agents_needed"].append("voice")
        if any(k in content.lower() for k in ["répondre", "chat", "converser", "décrire"]):
            plan["agents_needed"].append("writer")
        if any(k in content.lower() for k in ["tester", "valider", "check", "review"]):
            plan["agents_needed"].append("reviewer")
        if not plan["agents_needed"]:
            plan["agents_needed"].append("writer")
        plan["final_agents"] = list(set(plan["agents_needed"]))
        return plan

    def build_system_prompt(self) -> str:
        return (
            "Vous êtes le Cerveau de l'application VA (IA vocale). Vous coordonnez les agents "
            "et prenez les décisions principales. Vous devez: 1) comprendre la demande de l'utilisateur, "
            "2) planifier les tâches, 3) distribuer le travail aux agents spécialisés, "
            "4) collecter les résultats, 5) confirmer aux utilisateurs les actions effectuées."
        )
