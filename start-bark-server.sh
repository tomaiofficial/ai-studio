#!/bin/sh
# Demarre le serveur Bark TTS (port 8888 par defaut).
# Exiger au prealable : pip install -r requirements-bark.txt
cd "$(dirname "$0")"
exec uvicorn bark_tts_server:app --host 0.0.0.0 --port "${BARK_PORT:-8888}" --limit-concurrency 1
