#!/usr/bin/env python3
"""
Serveur Edge TTS local — voix neuronales Microsoft (Henrietta, Denise, etc.)
Gratuit, sans clé, tourne en local. Usage : python edge-tts-server.py
Puis dans l'app : Réglages → Voix → "Microsoft Edge TTS (local)"
"""
import asyncio
import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import edge_tts

# Configuration
HOST = '127.0.0.1'
PORT = 5002

# Voix françaises recommandées (neurales, haute qualité)
FR_VOICES = [
    {'id': 'fr-FR-HenriettaNeural', 'name': 'Henrietta (femme, naturelle, premium)', 'gender': 'Female'},
    {'id': 'fr-FR-DeniseNeural', 'name': 'Denise (femme, chaleureuse)', 'gender': 'Female'},
    {'id': 'fr-FR-EloiseNeural', 'name': 'Eloise (femme, expressive)', 'gender': 'Female'},
    {'id': 'fr-FR-RemyNeural', 'name': 'Remy (homme, naturel)', 'gender': 'Male'},
    {'id': 'fr-FR-AlainNeural', 'name': 'Alain (homme, profond)', 'gender': 'Male'},
    {'id': 'fr-FR-YvesNeural', 'name': 'Yves (homme, doux)', 'gender': 'Male'},
    {'id': 'fr-CA-SylvieNeural', 'name': 'Sylvie (Québec, femme)', 'gender': 'Female'},
    {'id': 'fr-CA-AntoineNeural', 'name': 'Antoine (Québec, homme)', 'gender': 'Male'},
]

class EdgeTTSHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/voices':
            self.send_json({'voices': FR_VOICES})
        elif parsed.path == '/health':
            self.send_json({'status': 'ok', 'service': 'edge-tts'})
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
                voice = data.get('voice', 'fr-FR-HenriettaNeural')
                rate = data.get('rate', '+0%')
                pitch = data.get('pitch', '+0Hz')
                if not text:
                    self.send_json({'error': 'text requis'}, 400)
                    return
                # Synthèse async
                audio_data = asyncio.run(self.synthesize(text, voice, rate, pitch))
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(audio_data)))
                self.end_headers()
                self.wfile.write(audio_data)
            except Exception as e:
                self.send_json({'error': str(e)}, 500)
        else:
            self.send_error(404)

    async def synthesize(self, text, voice, rate, pitch):
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        audio_chunks = []
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                audio_chunks.append(chunk['data'])
        return b''.join(audio_chunks)

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def log_message(self, format, *args):
        print(f'[EdgeTTS] {format % args}')

def main():
    try:
        import edge_tts
    except ImportError:
        print('ERREUR: edge-tts non installé. Lancez: pip install edge-tts')
        sys.exit(1)

    server = HTTPServer((HOST, PORT), EdgeTTSHandler)
    print(f'[EdgeTTS] Serveur démarré sur http://{HOST}:{PORT}')
    print(f'[EdgeTTS] Voix disponibles: {len(FR_VOICES)} (Henrietta, Denise, Remy, etc.)')
    print('[EdgeTTS] Appuyez sur Ctrl+C pour arrêter')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[EdgeTTS] Arrêt...')
        server.shutdown()

if __name__ == '__main__':
    main()