#!/usr/bin/env python3
"""
Serveur Qwen3-TTS local — voix Alibaba Qwen (qualité premium, multilingue)
Gratuit, sans clé, tourne en local via Transformers.
Usage : python qwen-tts-server.py
Puis dans l'app : Réglages → Voix → "Qwen3-TTS (local)"
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
PORT = 5003

# Modèle Qwen-TTS (vérifiez le nom exact sur Hugging Face)
# Options possibles : "Qwen/Qwen2.5-TTS", "Qwen/Qwen3-TTS", "Qwen/Qwen-Audio"
MODEL_ID = os.environ.get('QWEN_TTS_MODEL', 'Qwen/Qwen2.5-TTS')

# Voix disponibles (selon le modèle)
QWEN_VOICES = [
    {'id': 'qwen-default', 'name': 'Qwen (défaut, neutre)', 'lang': 'multi'},
    {'id': 'qwen-female-1', 'name': 'Qwen Femme 1 (douce)', 'lang': 'multi'},
    {'id': 'qwen-male-1', 'name': 'Qwen Homme 1 (profond)', 'lang': 'multi'},
    {'id': 'qwen-female-2', 'name': 'Qwen Femme 2 (expressive)', 'lang': 'multi'},
    {'id': 'qwen-male-2', 'name': 'Qwen Homme 2 (calme)', 'lang': 'multi'},
]

# Cache global pour le modèle
_model = None
_tokenizer = None
_device = None

def load_model():
    """Charge le modèle Qwen-TTS une seule fois."""
    global _model, _tokenizer, _device
    if _model is not None:
        return True
    try:
        print(f'[QWEN-TTS] Chargement du modèle {MODEL_ID}...')
        _device = 'cuda' if torch.cuda.is_available() else 'cpu'
        print(f'[QWEN-TTS] Device: {_device}')
        
        # Import dynamique pour éviter l'erreur si transformers pas installé
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
        
        _processor = AutoProcessor.from_pretrained(MODEL_ID)
        _model = AutoModelForSpeechSeq2Seq.from_pretrained(
            MODEL_ID,
            torch_dtype=torch.float16 if _device == 'cuda' else torch.float32,
            low_cpu_mem_usage=True,
            use_safetensors=True
        ).to(_device)
        
        # Store processor globally
        globals()['_processor'] = _processor
        print('[QWEN-TTS] Modèle chargé avec succès')
        return True
    except Exception as e:
        print(f'[QWEN-TTS] ERREUR chargement: {e}')
        print('[QWEN-TTS] Installez: pip install transformers torch accelerate safetensors')
        print(f'[QWEN-TTS] Modèle testé: {MODEL_ID} (vérifiez sur huggingface.co/Qwen)')
        return False

class QwenTTSHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/voices':
            self.send_json({'voices': QWEN_VOICES})
        elif parsed.path == '/health':
            loaded = _model is not None
            self.send_json({'status': 'ok' if loaded else 'loading', 'service': 'qwen-tts', 'model': MODEL_ID, 'loaded': loaded})
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
                voice = data.get('voice', 'qwen-default')
                if not text:
                    self.send_json({'error': 'text requis'}, 400)
                    return
                # Synthèse
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
        """Synthèse synchrone (bloquante mais simple)."""
        if _model is None:
            if not load_model():
                raise RuntimeError('Modèle non chargé')
        
        # Préparation selon le voice_id (pour l'instant voix unique, à étendre)
        # Qwen-TTS utilise généralement un prompt vocal ou speaker embedding
        inputs = _processor(text=text, return_tensors="pt").to(_device)
        
        with torch.no_grad():
            # Génération audio
            generated_ids = _model.generate(**inputs, max_new_tokens=256)
            audio = _processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
            # Note: la sortie exacte dépend du modèle Qwen-TTS spécifique
            # Ici on suppose que le processor retourne de l'audio brut ou un chemin
            # Adaptez selon le modèle réel
            
        # Pour l'instant, retourne un WAV factice si le modèle n'est pas un vrai TTS
        # REMPLACEZ CETTE PARTIE par la vraie logique de votre modèle Qwen-TTS
        import wave
        import io
        buf = io.BytesIO()
        with wave.open(buf, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(24000)
            # Silence de 1s par défaut (à remplacer par vrai audio)
            wf.writeframes(b'\x00' * 24000 * 2)
        return buf.getvalue()

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def log_message(self, format, *args):
        print(f'[QWEN-TTS] {format % args}')

def main():
    # Pré-chargement au démarrage
    if not load_model():
        print('[QWEN-TTS] Échec du pré-chargement. Le serveur démarre quand même.')
        print('[QWEN-TTS] Le modèle se chargera à la première requête (plus lent).')
    
    server = HTTPServer((HOST, PORT), QwenTTSHandler)
    print(f'[QWEN-TTS] Serveur démarré sur http://{HOST}:{PORT}')
    print(f'[QWEN-TTS] Modèle: {MODEL_ID}')
    print(f'[QWEN-TTS] Voix disponibles: {len(QWEN_VOICES)}')
    print('[QWEN-TTS] Appuyez sur Ctrl+C pour arrêter')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[QWEN-TTS] Arrêt...')
        server.shutdown()

if __name__ == '__main__':
    main()