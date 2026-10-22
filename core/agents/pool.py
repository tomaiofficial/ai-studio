"""core.agents.pool — Pool global des agents et orchestrateur central."""

import asyncio
import logging
from typing import Dict, Any, Optional

from .orchestrator import Orchestrator
from .base import AgentBase

logger = logging.getLogger(__name__)

class AgentPool:
    """Pool des agents: crée, gère et coordonne les sous-agents."""

    def __init__(self, project_root: str = None):
        self.project_root = project_root or "."
        self.agents: Dict[str, AgentBase] = {}
        self.orchestrator: Optional[Orchestrator] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._tasks: asyncio.Task = None

    def add_agent(self, agent: AgentBase) -> None:
        self.agents[agent.agent_id] = agent
        logger.info(f"[Pool] Agent ajouté: {agent.name} ({agent.role})")

    async def _start_agent(self, agent: AgentBase) -> None:
        agent.task_queue = asyncio.Queue()
        agent._running = True
        await agent.run()

    async def start(self) -> None:
        """Démarre tous les agents et l'orchestrateur."""
        self.orchestrator = Orchestrator(self.agents)
        for agent in self.agents.values():
            agent.task_queue = asyncio.Queue()
            self._tasks = asyncio.create_task(self._start_agent(agent))
        logger.info("[Pool] Tous les agents démarrés.")

    async def submit_task(self, to_agent: str, content: str, **kwargs) -> Dict[str, Any]:
        """Soumet une tâche à un agent spécifique."""
        task = {
            "content": content,
            "task_id": kwargs.get("task_id", "task"),
            "action": kwargs.get("action", "unknown"),
            "on_complete": kwargs.get("on_complete", None),
            "to_agent": to_agent,
            "from": "orchestrator",
        }
        if to_agent in self.agents:
            return await self.agents[to_agent].submit(task)
        elif to_agent == "orchestrator":
            return await self.orchestrator.submit(task)
        return {"error": f"Agent {to_agent} inexistant"}

    async def shutdown(self) -> None:
        self._running = False
        for agent in self.agents.values():
            await agent.shutdown()
        logger.info("[Pool] Tous les agents arrêtés.")
