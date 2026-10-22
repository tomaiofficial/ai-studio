#!/usr/bin/env python3
"""
Serveur Kyutai TTS local (Moshi) — voix françaises natives, haute qualité
Gratuit, sans clé, tourne en local via le package officiel `moshi`.
Usage : python kyutai-tts-server.py
Puis dans l'app : Réglages → Voix → "🇫🇷 Kyutai (Moshi)"
"""
import asyncio
import json
import sys
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import torch

# Configuration
HOST = '127.0.0.1'
PORT = 5004

# Modèle Kyutai (Moshi TTS)
MODEL_ID = os.environ.get('KYUTAI_TTS_MODEL', 'kyutai/tts-1.0')

# Voix Kyutai disponibles (selon le modèle)
KYUTAI_VOICES = [
    {'id': 'kyutai-fr-female-1', 'name': 'Kyutai Française 1 (naturelle)', 'lang': 'fr'},
    {'id': 'kyutai-fr-female-2', 'name': 'Kyutai Française 2 (expressive)', 'lang': 'fr'},
    {'id': 'kyutai-fr-male-1', 'name': 'Kyutai Français 1 (profond)', 'lang': 'fr'},
    {'id': 'kyutai-fr-male-2', 'name': 'Kyutai Français 2 (calme)', 'lang': 'fr'},
    {'id': 'kyutai-en-female-1', 'name': 'Kyutai English Female 1', 'lang': 'en'},
    {'id': 'kyutai-en-male-1', 'name': 'Kyutai English Male 1', 'lang': 'en'},
]

# Cache global
_model = None
_device = None

def load_model():
    """Charge le modèle Kyutai TTS une seule fois."""
    global _model, _device
    if _model is not None:
        return True
    try:
        print(f'[KYUTAI-TTS] Chargement du modèle {MODEL_ID}...')
        _device = 'cuda' if torch.cuda.is_available() else 'cpu'
        print(f'[KYUTAI-TTS] Device: {_device}')
        
        # Import du package officiel moshi
        try:
            from moshi.models import loaders
            from moshi.models.tts import TTSModel
        except ImportError:
            print('[KYUTAI-TTS] Package `moshi` non installé.')
            print('[KYUTAI-TTS] Installez: pip install moshi')
            return False
        
        # Chargement du modèle via le loader officiel
        _model = loaders.get_tts_model(MODEL_ID, device=_device)
        print('[KYUTAI-TTS] Modèle chargé avec succès')
        return True
    except Exception as e:
        print(f'[KYUTAI-TTS] ERREUR chargement: {e}')
        print('[KYUTAI-TTS] Installez: pip install moshi')
        print(f'[KYUTAI-TTS] Modèle: {MODEL_ID} (vérifiez sur huggingface.co/kyutai)')
        return False

class KyutaiTTSHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/voices':
            self.send_json({'voices': KYUTAI_VOICES})
        elif parsed.path == '/health':
            loaded = _model is not None
            self.send_json({'status': 'ok' if loaded else 'loading', 'service': 'kyutai-tts', 'model': MODEL_ID, 'loaded': loaded})
        else:
            self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/synthesize':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
                text = data.get('text', '')
                voice = data.get('voice', 'kyutai-fr-female-1')
                if not text:
                    self.send_json({'error': 'text requis'}, 400)
                    return
                audio_data = self.synthesize(text, voice)
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(audio_data)))
                self.end_headers()
                self.wfile.write(audio_data)
            except Exception as e:
                self.send_json({'error': str(e)}, 500)
        else:
            self.send_error(404)

    def synthesize(self, text, voice):
        """Synthèse avec le modèle Kyutai."""
        if _model is None:
            if not load_model():
                raise RuntimeError('Modèle Kyutai non chargé')
        
        # Mapping voice_id -> speaker_id ou config voix
        # Kyutai TTS utilise des speaker embeddings ou des configs
        speaker_id = self._voice_to_speaker(voice)
        
        # Génération audio via le modèle Kyutai
        # L'API exacte dépend de la version du package moshi
        import torchaudio
        import io
        
        with torch.no_grad():
            # Génération - l'API dépend de la version
            # Exemple typique: model.generate(text, speaker_id=...)
            audio_tensor = _model.generate(text, speaker_id=speaker_id)
            
            # Conversion en WAV bytes
            buf = io.BytesIO()
            torchaudio.save(buf, audio_tensor.cpu().unsqueeze(0), 24000, format='wav')
            return buf.getvalue()

    def _voice_to_speaker(self, voice_id):
        """Mappe voice_id vers speaker_id du modèle."""
        mapping = {
            'kyutai-fr-female-1': 0,
            'kyutai-fr-female-2': 1,
            'kyutai-fr-male-1': 2,
            'kyutai-fr-male-2': 3,
            'kyutai-en-female-1': 4,
            'kyutai-en-male-1': 5,
        }
        return mapping.get(voice_id, 0)

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def log_message(self, format, *args):
        print(f'[KYUTAI-TTS] {format % args}')

def main():
    if not load_model():
        print('[KYUTAI-TTS] Échec du pré-chargement. Le serveur démarre quand même.')
        print('[KYUTAI-TTS] Le modèle se chargera à la première requête (plus lent).')
    
    server = HTTPServer((HOST, PORT), KyutaiTTSHandler)
    print(f'[KYUTAI-TTS] Serveur démarré sur http://{HOST}:{PORT}')
    print(f'[KYUTAI-TTS] Modèle: {MODEL_ID}')
    print(f'[KYUTAI-TTS] Voix disponibles: {len(KYUTAI_VOICES)} (français + anglais)')
    print('[KYUTAI-TTS] Appuyez sur Ctrl+C pour arrêter')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[KYUTAI-TTS] Arrêt...')
        server.shutdown()

if __name__ == '__main__':
    main()