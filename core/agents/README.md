# Multi-Agents — Guide d'utilisation

Ce module ajoute un système de **multi-agents** à l'application Agnes/Astra.
Au moins **3 agents** fonctionnent en parallèle, chacun spécialisé.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrateur (cerveau)                    │
└───────────────┬───────────────────────────┬─────────────────┘
                │                         │
        ┌───────┘          └────────┐     │
        ▼                            ▼     ▼
┌───────────────┐            ┌───────────────┐   ┌───────────────┐
│  Agent Auteur │            │  Agent Tonal  │   │  Agent Dev    │
│ (Writer)      │            │ (Voice)       │   │ (Developer)   │
│ - réponses    │            │ - texte→audio │   │ - code, tests │
│ - scripts     │            │ - narration   │   │ - modification│
│ - chat        │            │               │   │ - déploiement│
└───────────────┘            └───────────────┘   └───────────────┘
```

## Agents disponibles

| Agent | Rôle | Outil principal |
|-------|------|-----------------|
| **Orchestrateur** | coordination, planification, décision | — |
| **Auteur (Writer)** | gestion du texte, réponses, scripts | Groq (brain) |
| **Vocal (Voice)** | génération audio, TTS | Coqui XTTS / Edge TTS |
| **Développeur (Dev)** | modification de code, tests, déploiement | codebase locale |

## Activation

### 1. Installer les dépendances

```bash
cd ai-studio
pip install -r requirements.txt
# (optionnel) Coqui TTS pour la voix realiste:
pip install coqui-tts
```

### 2. Démarrer les agents

Dans `server.py`, importez et démarrez le pool :

```python
from core.agents.pool import AgentPool

# Au démarrage du serveur (dans l'asyncio event loop)
agents_pool = AgentPool(project_root=".")
asyncio.create_task(agents_pool.start())
```

### 3. Appeler les agents

Via l'API REST :

```bash
# Demander à l'orchestrateur de planifier
curl -X POST http://localhost:8765/api/agents/start

# Envoyer une tâche à l'agent auteur
curl -X POST http://localhost:8765/api/agents/submit   -H "Content-Type: application/json"   -d '{"agent": "writer", "content": "Réponds: 2+2", "task_id": "task-1"}'

# Voir l'état des agents
curl http://localhost:8765/api/agents/status
```

### 4. Intégration dans le frontend

Le frontend peut envoyer des requêtes vers `/api/agents/submit`
et recevoir les réponses des agents (téléchargement audio, etc.).

## Exemple de flux

1. L'utilisateur dit « Ajoute un bouton qui génère une blague »
2. **Orchestrateur** analyse la demande, voit « bouton »+« générer » → choisit l'agent **Développeur**
3. **Développeur** lit le code, propose une modification, la valide
4. **Auteur** génère le texte de la blague
5. **Vocal** transforme le texte en audio (si demandé)
6. Résultat renvoyé à l'utilisateur

## Personnalisation

- Ajouter un agent : créer une classe qui hérite de `AgentBase`, puis l'ajouter via `pool.add_agent()`
- Changer un agent : modifier `build_system_prompt()` pour adapter le rôle
- Répartir les tâches : modifier la logique du `orchestrator.py` (la méthode `process_task`)

## Notes

- Tous les agents sont démarrés dans un loop asyncio séparé, ils ne bloquent pas le serveur
- Les tâches sont traitées de manière séquentielle par défaut
- Les logs sont écrits au niveau INFO via `logging`
