"""core/agents/demo.py — Exemple d'utilisation du multi-agents."""

import asyncio
import logging

from core.agents.orchestrator import Orchestrator
from core.agents.writer import WriterAgent
from core.agents.developer import DeveloperAgent
from core.agents.voice import VoiceAgent
from core.agents.pool import AgentPool

# On suppose qu'ici tu as déjà ta connexion Groq et ton moteau TTS
# (à adapter selon ton code actuel)

async def main():
    logging.basicConfig(level=logging.INFO)

    # Configuration de tes agents
    pool = AgentPool(project_root=".")

    # 1. Agent Rédacteur (Groq/Mistral)
    # writer = WriterAgent(groq_client, model="groq-2.0-flash")
    # pool.add_agent(writer)

    # 2. Agent Vocal (Coqui XTTS ou Edge TTS)
    # voice = VoiceAgent(tts_engine=coqui_engine, voice="fr", speed=1.0)
    # pool.add_agent(voice)

    # 3. Agent Développeur autonome
    # dev = DeveloperAgent(project_root=".")
    # pool.add_agent(dev)

    # Démarrage
    await pool.start()

    # Exemple de tâche: le cerveau (orchestrator) distribue
    result = await pool.submit_task(
        to_agent="orchestrator",
        content="Je veux add un bouton qui génère une blague. Le code doit être appliqué.",
        action="planify"
    )
    print("Plan:", result)

    await pool.shutdown()

if __name__ == "__main__":
    asyncio.run(main())
