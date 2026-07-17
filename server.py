"""
Photomaton ID — Backend Server
Sert les fichiers statiques et proxy l'API vocale Mistral (Voxtral TTS).
"""

import os
from flask import Flask, request, jsonify, send_from_directory
import requests
from dotenv import load_dotenv

load_dotenv()  # charge le fichier .env

app = Flask(__name__, static_folder='.', static_url_path='')

# Mistral API config — lit depuis .env ou variable d'environnement
MISTRAL_API_KEY = os.environ.get('MISTRAL_API_KEY', '')
MISTRAL_TTS_URL = 'https://api.mistral.ai/v1/audio/speech'
MISTRAL_VOICES_URL = 'https://api.mistral.ai/v1/audio/voices'
TTS_MODEL = 'voxtral-mini-tts-2603'
DEFAULT_VOICE_ID = 'c69964a6-ab8b-4f8a-9465-ec0925096ec8'  # Paul Neutral (supports FR)

# ---- Static files ----
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

# ---- TTS Endpoint ----
@app.route('/api/tts', methods=['POST'])
def text_to_speech():
    """Proxy to Mistral Voxtral TTS API"""
    data = request.json
    text = data.get('text', '')
    voice_id = data.get('voice_id', DEFAULT_VOICE_ID)

    if not text:
        return jsonify({'error': 'No text provided'}), 400

    payload = {
        'model': TTS_MODEL,
        'input': text,
        'voice_id': voice_id,
        'response_format': 'mp3',
    }

    try:
        headers = {
            'Authorization': f'Bearer {MISTRAL_API_KEY}',
            'Content-Type': 'application/json',
        }
        print(f"[TTS] Calling Mistral with voice_id={voice_id}, text_len={len(text)}")
        resp = requests.post(
            MISTRAL_TTS_URL,
            json=payload,
            headers=headers,
            timeout=30,
        )
        print(f"[TTS] Mistral response: {resp.status_code}")

        if resp.status_code != 200:
            return jsonify({
                'error': f'Mistral API error: {resp.status_code}',
                'detail': resp.text[:500]
            }), 502

        result = resp.json()
        audio_data = result.get('audio_data', '')

        if not audio_data:
            return jsonify({'error': 'No audio data in response'}), 502

        return jsonify({
            'audio_data': audio_data,
            'format': 'mp3'
        })

    except requests.exceptions.Timeout:
        return jsonify({'error': 'Mistral API timeout'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ---- List available voices ----
@app.route('/api/voices', methods=['GET'])
def list_voices():
    """List available Mistral TTS voices"""
    try:
        resp = requests.get(
            MISTRAL_VOICES_URL,
            headers={'Authorization': f'Bearer {MISTRAL_API_KEY}'},
            timeout=10,
        )
        if resp.status_code == 200:
            return jsonify(resp.json())
        return jsonify({'error': f'API error: {resp.status_code}'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print("\n" + "=" * 50)
    print("  PHOTOMATON ID — Serveur Backend")
    print("  Mistral Voxtral TTS active")
    print("  http://localhost:8080")
    print("=" * 50 + "\n")
    app.run(host='127.0.0.1', port=8080, debug=False)
