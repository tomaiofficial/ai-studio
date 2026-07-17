"""
Photomaton ID + Assistant IA Vocal
Backend: Mistral Voxtral TTS + Pixtral Vision
"""

import os
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)  # Accepte OPTIONS preflight pour tous les endpoints

MISTRAL_API_KEY = os.environ.get('MISTRAL_API_KEY', '')
MISTRAL_TTS_URL = 'https://api.mistral.ai/v1/audio/speech'
MISTRAL_VOICES_URL = 'https://api.mistral.ai/v1/audio/voices'
MISTRAL_CHAT_URL = 'https://api.mistral.ai/v1/chat/completions'
TTS_MODEL = 'voxtral-mini-tts-2603'
CHAT_MODELS = ['pixtral-large-latest', 'mistral-large-latest']
DEFAULT_VOICE_ID = 'c69964a6-ab8b-4f8a-9465-ec0925096ec8'

SYSTEM_PROMPT = (
    "Tu es un assistant IA vocal avancé. Tu vois en temps réel ce que la caméra "
    "filme et tu écoutes l'utilisateur grâce au microphone. Ton objectif est de "
    "discuter comme un humain, avec des réponses naturelles, courtes et fluides. "
    "Tu décris uniquement ce que tu observes réellement, sans inventer. "
    "Réponds comme dans une vraie conversation. Utilise un ton chaleureux, "
    "naturel et dynamique. Si l'utilisateur montre un objet, identifie-le et "
    "explique-le simplement. Si tu n'es pas certain de ce que montre la caméra, "
    "indique ton niveau d'incertitude. Garde les réponses courtes (2-3 phrases "
    "max), sauf si l'utilisateur demande des détails. Parle avec des contractions "
    "et un style conversationnel. Tu ne dis jamais que tu es un robot."
)

# ============ EXPLICIT ROUTES (before catch-all!) ============

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/ia')
def ia_page():
    return send_from_directory('.', 'ia.html')

# ============ API ROUTES ============

@app.route('/api/tts', methods=['POST'])
def text_to_speech():
    data = request.json
    text = data.get('text', '')
    voice_id = data.get('voice_id', DEFAULT_VOICE_ID)
    if not text:
        return jsonify({'error': 'No text provided'}), 400
    try:
        resp = requests.post(MISTRAL_TTS_URL,
            headers={'Authorization': f'Bearer {MISTRAL_API_KEY}',
                     'Content-Type': 'application/json'},
            json={'model': TTS_MODEL, 'input': text,
                  'voice_id': voice_id, 'response_format': 'wav'},
            timeout=30)
        if resp.status_code != 200:
            return jsonify({'error': f'Mistral error: {resp.status_code}'}), 502
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/voices', methods=['GET'])
def list_voices():
    try:
        resp = requests.get(MISTRAL_VOICES_URL,
            headers={'Authorization': f'Bearer {MISTRAL_API_KEY}'}, timeout=10)
        return jsonify(resp.json()) if resp.status_code == 200 else (jsonify({'error': resp.text[:300]}), 502)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/ia', methods=['POST'])
def ia_assistant():
    data = request.json
    image_b64 = data.get('image')
    text = data.get('text', '')
    history = data.get('history', [])

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in history[-20:]:
        messages.append(msg)

    user_content = []
    if image_b64:
        user_content.append({"type": "image_url",
                             "image_url": f"data:image/jpeg;base64,{image_b64}"})
    if text:
        user_content.append({"type": "text", "text": text})
    if not user_content:
        return jsonify({'error': 'No text or image'}), 400

    messages.append({"role": "user", "content": user_content})

    # Chat with model fallback
    response_text = None
    for model in CHAT_MODELS:
        try:
            resp = requests.post(MISTRAL_CHAT_URL,
                headers={'Authorization': f'Bearer {MISTRAL_API_KEY}',
                         'Content-Type': 'application/json'},
                json={'model': model, 'messages': messages,
                      'max_tokens': 250, 'temperature': 0.7},
                timeout=25)
            if resp.status_code == 200:
                response_text = resp.json()['choices'][0]['message']['content']
                print(f"[IA] Chat OK via {model}")
                break
            print(f"[IA] {model} -> {resp.status_code}")
        except Exception as e:
            print(f"[IA] {model} failed: {e}")

    if not response_text:
        return jsonify({'error': 'All chat models failed'}), 502

    # TTS
    audio_b64 = ''
    try:
        tts_resp = requests.post(MISTRAL_TTS_URL,
            headers={'Authorization': f'Bearer {MISTRAL_API_KEY}',
                     'Content-Type': 'application/json'},
            json={'model': TTS_MODEL, 'input': response_text,
                  'voice_id': DEFAULT_VOICE_ID, 'response_format': 'wav'},
            timeout=30)
        if tts_resp.status_code == 200:
            audio_b64 = tts_resp.json().get('audio_data', '')
            print(f"[IA] TTS OK, {len(audio_b64)} chars")
    except Exception as e:
        print(f"[IA] TTS failed: {e}")

    return jsonify({'text': response_text, 'audio_data': audio_b64, 'format': 'wav'})

# ============ CATCH-ALL (last!) ============

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

if __name__ == '__main__':
    print("\n" + "=" * 50)
    print("  PHOTOMATON ID + ASSISTANT IA VOCAL")
    print("  Mistral Vision + Voxtral TTS")
    print("  http://localhost:8080      (photomaton)")
    print("  http://localhost:8080/ia   (assistant vocal)")
    print("=" * 50 + "\n")
    app.run(host='127.0.0.1', port=8080, debug=False)
