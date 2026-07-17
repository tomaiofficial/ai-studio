"""
Photomaton ID — Backend Server
Sert les fichiers statiques et proxy l'API vocale Mistral (Voxtral TTS).
"""

import os
import base64
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
        'response_format': 'wav',
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


# ---- IA page ----
@app.route('/ia')
def ia_page():
    return send_from_directory('.', 'ia.html')

# ---- IA Assistant Endpoint ----
@app.route('/api/ia', methods=['POST'])
def ia_assistant():
    """AI Vision + Chat + TTS endpoint using Mistral"""
    data = request.json
    image_b64 = data.get('image')  # base64 JPEG frame from camera (can be None)
    text = data.get('text', '')
    history = data.get('history', [])  # conversation history array

    MISTRAL_CHAT_URL = 'https://api.mistral.ai/v1/chat/completions'
    CHAT_MODEL = 'pixtral-large-latest'  # multimodal model with vision support

    SYSTEM_PROMPT = """Tu es un assistant IA vocal avancé. Tu vois en temps réel ce que la caméra filme et tu écoutes l'utilisateur grâce au microphone. Ton objectif est de discuter comme un humain, avec des réponses naturelles, courtes et fluides. Tu décris uniquement ce que tu observes réellement, sans inventer. Réponds comme dans une vraie conversation. Utilise un ton chaleureux, naturel et dynamique. Si l'utilisateur montre un objet, identifie-le et explique-le simplement. Si tu n'es pas certain de ce que montre la caméra, indique ton niveau d'incertitude. Garde les réponses courtes, sauf si l'utilisateur demande des détails. Parle avec des contractions et un style conversationnel. Tu ne dis jamais que tu es un robot. Tu te comportes comme un véritable assistant intelligent capable de voir, écouter et dialoguer naturellement."""

    # Build messages
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Add history (last 20 messages max)
    for msg in history[-20:]:
        messages.append(msg)

    # Build user content
    user_content = []
    if image_b64:
        user_content.append({
            "type": "image_url",
            "image_url": f"data:image/jpeg;base64,{image_b64}"
        })
    if text:
        user_content.append({
            "type": "text",
            "text": text
        })

    if not user_content:
        return jsonify({'error': 'No text or image provided'}), 400

    messages.append({"role": "user", "content": user_content})

    # Call Mistral Vision
    try:
        resp = requests.post(
            MISTRAL_CHAT_URL,
            headers={
                'Authorization': f'Bearer {MISTRAL_API_KEY}',
                'Content-Type': 'application/json'
            },
            json={
                "model": CHAT_MODEL,
                "messages": messages,
                "max_tokens": 300
            },
            timeout=30
        )

        if resp.status_code != 200:
            return jsonify({'error': f'Mistral chat error: {resp.status_code}', 'detail': resp.text[:500]}), 502

        response_text = resp.json()['choices'][0]['message']['content']

        # TTS
        tts_resp = requests.post(
            MISTRAL_TTS_URL,
            headers={
                'Authorization': f'Bearer {MISTRAL_API_KEY}',
                'Content-Type': 'application/json'
            },
            json={
                'model': TTS_MODEL,
                'input': response_text,
                'voice_id': DEFAULT_VOICE_ID,
                'response_format': 'wav',
            },
            timeout=30
        )

        audio_b64 = ''
        if tts_resp.status_code == 200:
            audio_b64 = tts_resp.json().get('audio_data', '')

        return jsonify({
            'text': response_text,
            'audio_data': audio_b64,
            'format': 'wav'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print("\n" + "=" * 50)
    print("  PHOTOMATON ID — Serveur Backend")
    print("  Mistral Voxtral TTS active")
    print("  http://localhost:8080")
    print("=" * 50 + "\n")
    app.run(host='127.0.0.1', port=8080, debug=False)
