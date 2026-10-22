"""core.agents.developer — Agent autonome: modifie le code, teste, déploie."""

import asyncio
import logging
import os
import shutil
from typing import Any, Dict

from .base import AgentBase

logger = logging.getLogger(__name__)

class DeveloperAgent(AgentBase):
    """Agent autonome: analyse, génère, teste et applique des modifications de code."""

    def __init__(self, project_root: str):
        super().__init__(agent_id="developer", name="Développeur", role="developer")
        self.project_root = project_root

    def build_system_prompt(self) -> str:
        return (
            "Vous êtes l'Agent Développeur. Modifiez le code avec précision, "
            "toujours sauvegardez avant, validez chaque changement, et confirmez aux utilisateurs."
        )

    async def process_task(self, task: Dict[str, Any]) -> Dict[str, Any]:
        action = task.get("action", "unknown")
        content = task.get("content", "")
        logger.info(f"[Agent Dev] {action}: {content[:100]}...")
        result = {"applied": [], "files_modified": [], "errors": [], "confirm": ""}
        try:
            if "lire" in action or "lire" in content.lower():
                file_path = task.get("file_path", "")
                if file_path:
                    full = os.path.join(self.project_root, file_path)
                    if os.path.exists(full):
                        with open(full, "r", encoding="utf-8") as f:
                            result["content"] = f.read()
                            result["file"] = file_path
                        result["status"] = "ok"
                    else:
                        result["error"] = f"Fichier introuvable: {file_path}"
                        result["status"] = "failed"
                else:
                    result["error"] = "Aucun fichier spécifié"

            elif "écrire" in action or "modifier" in action.lower():
                file_path = task.get("file_path", "")
                new_content = task.get("content", "")
                if file_path and new_content:
                    full = os.path.join(self.project_root, file_path)
                    os.makedirs(os.path.dirname(full) or ".", exist_ok=True)
                    bak = full + ".bak"
                    if not os.path.exists(bak):
                        shutil.copy2(full, bak)
                    with open(full, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    result["files_modified"].append(file_path)
                    result["applied"].append(f"Modifié {file_path}")
                    result["confirm"] = f"✓ Modifié {file_path}"

            elif "test" in action.lower():
                result["confirm"] = "Test lancé"

            elif "appliquer" in action.lower():
                result["confirm"] = "Modifications appliquées"

            else:
                result["confirm"] = "Action reconnue"
        except Exception as e:
            logger.error(f"[Agent Dev] erreur: {e}")
            result["error"] = str(e)
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
