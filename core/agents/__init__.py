"""core.agents — Multi-agents pour l'application VA (Agnes/Astra)."""

from .base import AgentBase
from .orchestrator import Orchestrator
from .writer import WriterAgent
from .developer import DeveloperAgent
from .voice import VoiceAgent
from .pool import AgentPool

__all__ = [
    "AgentBase",
    "Orchestrator",
    "WriterAgent",
    "DeveloperAgent",
    "VoiceAgent",
    "AgentPool",
]
