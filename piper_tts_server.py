"""
piper_tts_server.py — Serveur de synthèse vocale Piper (Mozilla TTS, ultra-rapide)
pour le site Astra.

Exposition :
    POST /piper/tts  { "text": "..." }  ->  { "audio": "<base64 WAV>", "sr": 22050 }

Le client (PWA, app.js) appelle ce point avec le texte et reçoit le WAV en base64,
qu'il joue avec l'API Web Audio du navigateur.

Lancement :
    python3 piper_tts_server.py
"""

import base64
import io
import json
import os
import wave

import numpy as np
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from piper.voice import PiperVoice

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Chemin vers le modèle Piper voix française
MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(MODEL_DIR, "fr_FR-siwis-medium.onnx")
CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "fr_FR-siwis-medium.onnx.json"
)

# Chargement du modèle au démarrage (lent mais une seule fois).
print(f"[Piper TTS] Chargement du modèle {MODEL_PATH} ...")
voice = PiperVoice.load(str(MODEL_PATH), str(CONFIG_PATH))
print("[Piper TTS] Modèle chargé.")

# Configuration de synthèse
_SYN_CONFIG = {"noise_scale": 0.667, "length_scale": 1.0, "noise_w": 0.8}

# Convertisseur WAV PCM16 16-bit mono
def _float_to_pcm16(audio_float: np.ndarray) -> bytes:
    audio16 = np.clip(audio_float, -1.0, 1.0) * 32767.0
    audio16 = audio16.astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(22050)
        w.writeframes(audio16.tobytes())
    return buf.getvalue()


@app.post("/piper/tts")
async def piper_tts(request: Request):
    data = await request.json()
    text = str(data.get("text", "") or "").strip()
    if not text:
        return {"error": "text requis", "audio": "", "sr": 22050}

    try:
        # Génération (2-3 s, ultra-rapide)
        chunks = list(voice.synthesize(text, syn_config=_SYN_CONFIG))
        audio_float = np.concatenate([c.audio_float_array for c in chunks])
    except Exception as exc:
        return {"error": f"génération echouee: {exc}", "audio": "", "sr": 22050}

    try:
        wav_bytes = _float_to_pcm16(audio_float)
    except Exception:
        return {"error": "échec conversion WAV", "audio": "", "sr": 22050}

    return {
        "audio": base64.b64encode(wav_bytes).decode("ascii"),
        "sr": 22050,
        "channels": 1,
        "width": 2,
    }


@app.get("/health")
def health():
    return {"status": "ok", "service": "piper-tts-server"}
