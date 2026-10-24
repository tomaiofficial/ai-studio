"""
bark_tts_server.py — serveur vocal Bark pour le site Astra.

Exposition :
    POST /bark/tts  { "text": "..." }  ->  { "audio": "<base64 WAV>", "sr": 24000 }

Le client (PWA, app.js) appelle ce point avec le texte, et reçoit le WAV en
base64, qu'il joue avec l'API Web Audio du navigateur.

Lancement :
    uvicorn bark_tts_server:app --host 0.0.0.0 --port 8888

Dépendances (requirements-bark.txt) :
    fastapi, uvicorn, bark, numpy, scipy
"""

import base64
import io
import os

import bark

# PyTorch 2.14+ : torch.load default weights_only=True refuse les checkpoints
# anciens de bark (scalaires numpy). On laisse torch.load charger avec weights_only=False,
# le checkpoint vient de Suno (source de confiance, ouvrable en local).
_orig_load = __import__("torch").load


def _bark_load(*args, **kwargs):
    kwargs.setdefault("map_location", "cpu")
    kwargs["weights_only"] = False
    return _orig_load(*args, **kwargs)


__import__("torch").load = _bark_load

import numpy as np
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from scipy.io import wavfile

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Modèles Bark (téléchargés au démarrage si absents).
bark.preload_models(
    text_use_gpu=False,
    text_use_small=True,
    coarse_use_gpu=False,
    coarse_use_small=True,
    fine_use_gpu=False,
    fine_use_small=True,
    codec_use_gpu=False,
    force_reload=False,
)

# Précurseur d'audio pour éviter les sauts de volume.
_AUDIO_GAIN = 0.90


def _text_to_pcm16(text: str) -> bytes:
    """Transforme du texte en bytes PCM 16-bit mono, 24 kHz."""
    if not text or not text.strip():
        return b""
    semantic = bark.text_to_semantic(text)
    audio = bark.semantic_to_waveform(semantic)
    # audio est float32 [-1, 1] ; on le range en int16 mono.
    audio = np.clip(audio, -1.0, 1.0) * _AUDIO_GAIN
    audio16 = (audio * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    wavfile.write(buf, 24000, audio16)
    return buf.getvalue()


@app.post("/bark/tts")
async def bark_tts(request: Request):
    data = await request.json()
    text = str(data.get("text", "") or "").strip()
    if not text:
        return {"error": "text requis", "audio": ""}
    try:
        wav_bytes = _text_to_pcm16(text)
    except Exception as exc:  # pas de crash 500, retour d'erreur propre
        return {"error": f"generation echouee: {exc}", "audio": ""}
    if not wav_bytes:
        return {"error": "pas de son genere", "audio": ""}
    return {
        "audio": base64.b64encode(wav_bytes).decode("ascii"),
        "sr": 24000,
        "channels": 1,
        "width": 2,
    }


@app.get("/health")
def health():
    return {"status": "ok", "service": "bark-tts-server"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("BARK_HOST", "0.0.0.0"), port=int(os.environ.get("BARK_PORT", 8888)))
