"""core/router/agents_router.py — API router pour le mode multi-agents."""

import asyncio
import logging
from typing import Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.agents.pool import AgentPool

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agents", tags=["agents"])

# Instance globale (à instancier une fois au démarrage de l'application)
agents_pool: AgentPool = None

def get_pool():
    return agents_pool

class AgentRequest(BaseModel):
    agent: str = "orchestrator"
    content: str = ""
    action: str = "run"
    task_id: str = ""

class AgentResponse(BaseModel):
    agent: str = ""
    status: str = "ok"
    result: Dict[str, Any] = {}
    error: str = ""

@router.post("/submit")
async def submit_agent_task(req: AgentRequest):
    """Soumet une tâche à l'un des agents du pool."""
    if agents_pool is None:
        raise HTTPException(status_code=503, detail="Pool non initialisé")
    result = await agents_pool.submit_task(
        to_agent=req.agent,
        content=req.content,
        action=req.action,
        task_id=req.task_id,
    )
    return AgentResponse(
        agent=req.agent,
        status=result.get("status", "ok"),
        result=result,
    )

@router.get("/status")
async def get_agent_status():
    """Retourne l'état de tous les agents."""
    if agents_pool is None:
        return {"agents": {}, "message": "non initialisé"}
    status = {}
    for aid, agent in agents_pool.agents.items():
        status[aid] = {
            "name": agent.name,
            "role": agent.role,
            "running": getattr(agent, "_running", False),
        }
    if agents_pool.orchestrator:
        status["orchestrator"] = {
            "name": agents_pool.or orchestrator.name,
            "role": "orchestrator",
            "running": getattr(agents_pool.orchestrator, "_running", False),
        }
    return {"agents": status}

@router.post("/start")
async def start_agents():
    """Démarre le pool d'agents."""
    global agents_pool
    if agents_pool is None:
        pool = AgentPool(project_root=".")
        agents_pool = pool
        asyncio.create_task(pool.start())
    return {"status": "started", "agents": list(agents_pool.agents.keys())}
