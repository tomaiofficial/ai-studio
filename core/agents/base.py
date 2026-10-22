"""core.agents.base — Classe de base pour tous les agents."""

import asyncio
import logging
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

class AgentBase(ABC):
    """Agent générique — toute agent doit en hériter."""

    def __init__(self, agent_id: Optional[str] = None, name: Optional[str] = None, role: str = "generic"):
        self.agent_id = agent_id or uuid.uuid4().hex[:8]
        self.name = name or self.__class__.__name__
        self.role = role
        self.ctx: Dict[str, Any] = {}
        self.task_queue: asyncio.Queue = asyncio.Queue()
        self._running = False

    @abstractmethod
    async def run(self) -> None:
        """Boucle principale de l'agent."""
        ...

    @abstractmethod
    async def process_task(self, task: Dict[str, Any]) -> Dict[str, Any]:
        """Exécute une tâche spécifique à ce genre d'agent."""
        ...

    @abstractmethod
    def build_system_prompt(self) -> str:
        """Instruction système qui définit le comportement de l'agent."""
        ...

    async def submit(self, task: Dict[str, Any]) -> Dict[str, Any]:
        """Soumet une tâche à l'agent (séquentiel)."""
        self.task_queue.put_nowait(task)
        return await self.process_task(task)

    async def shutdown(self):
        self._running = False
        logger.info(f"[Agent {self.name}] arrêté.")
