"""
Photomaton ID + Assistant IA Vocal
Backend: Mistral Voxtral TTS + Pixtral Vision
"""

import os
import time
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

MISTRAL_API_KEY = os.environ.get('MISTRAL_API_KEY', '')
MISTRAL_TTS_URL = 'https://api.mistral.ai/v1/audio/speech'
MISTRAL_VOICES_URL = 'https://api.mistral.ai/v1/audio/voices'
MISTRAL_CHAT_URL = 'https://api.mistral.ai/v1/chat/completions'
TTS_MODEL = 'voxtral-mini-tts-2603'
CHAT_MODELS = ['pixtral-large-latest', 'mistral-large-latest']
DEFAULT_VOICE_ID = 'c69964a6-ab8b-4f8a-9465-ec0925096ec8'

SYSTEM_PROMPT = (
    "Tu es un assistant vocal amical et bavard. Tu vois ce que la caméra filme "
    "mais tu n'es pas obligé d'en parler à chaque fois. Réponds de façon "
    "complète mais pas trop longue, 2-3 phrases suffisent. Développe un peu, "
    "sois naturel et chaleureux, comme ChatGPT Live."
)


# ---- Pages HTML ----
@app.route('/')
def page_index():
    return send_from_directory('.', 'index.html')

@app.route('/ia')
def page_ia():
    return send_from_directory('.', 'ia.html')

@app.route('/photomaton.html')
def page_photomaton():
    return send_from_directory('.', 'photomaton.html')


# ---- API: TTS ----
@app.route('/api/tts', methods=['POST'])
def api_tts():
    data = request.json
    text = data.get('text', '')
    voice_id = data.get('voice_id', DEFAULT_VOICE_ID)
    if not text:
        return jsonify({'error': 'No text'}), 400
    try:
        resp = requests.post(MISTRAL_TTS_URL,
            headers={'Authorization': f'Bearer {MISTRAL_API_KEY}',
                     'Content-Type': 'application/json'},
            json={'model': TTS_MODEL, 'input': text,
                  'voice_id': voice_id, 'response_format': 'wav'},
            timeout=30)
        if resp.status_code != 200:
            return jsonify({'error': f'Mistral {resp.status_code}'}), 502
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---- API: Voices ----
@app.route('/api/voices', methods=['GET'])
def api_voices():
    try:
        resp = requests.get(MISTRAL_VOICES_URL,
            headers={'Authorization': f'Bearer {MISTRAL_API_KEY}'}, timeout=10)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---- API: IA Assistant (POST only) ----
@app.route('/api/ia', methods=['POST'])
def api_ia():
    data = request.json
    if not data:
        return jsonify({'error': 'No JSON body'}), 400

    image_b64 = data.get('image')
    text = data.get('text', '')
    history = data.get('history', [])

    t0 = time.time()
    print(f"\n[IA] === New request ===")
    print(f"[IA] text={text[:80]!r}, has_image={bool(image_b64)}, history={len(history)}")

    # Build Mistral messages
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

    # ---- Chat ----
    response_text = None
    chat_err = ''
    for model in CHAT_MODELS:
        try:
            print(f"[IA] Chat: {model}...")
            resp = requests.post(MISTRAL_CHAT_URL,
                headers={'Authorization': f'Bearer {MISTRAL_API_KEY}',
                         'Content-Type': 'application/json'},
                json={'model': model, 'messages': messages,
                      'max_tokens': 250, 'temperature': 0.7},
                timeout=30)
            if resp.status_code == 200:
                response_text = resp.json()['choices'][0]['message']['content']
                print(f"[IA] Chat OK ({model}) {time.time()-t0:.1f}s: {response_text[:80]!r}")
                break
            chat_err = f'{model} HTTP {resp.status_code}'
            print(f"[IA] Chat fail: {chat_err}")
        except Exception as e:
            chat_err = f'{model}: {e}'
            print(f"[IA] Chat error: {chat_err}")

    if not response_text:
        print(f"[IA] ALL CHAT MODELS FAILED")
        return jsonify({'error': 'Chat failed', 'detail': chat_err}), 502

    # ---- TTS ----
    audio_b64 = ''
    tts_err = ''
    tts_t0 = time.time()
    try:
        print(f"[IA] TTS: calling Mistral...")
        tts_resp = requests.post(MISTRAL_TTS_URL,
            headers={'Authorization': f'Bearer {MISTRAL_API_KEY}',
                     'Content-Type': 'application/json'},
            json={'model': TTS_MODEL, 'input': response_text,
                  'voice_id': DEFAULT_VOICE_ID, 'response_format': 'wav'},
            timeout=60)
        if tts_resp.status_code == 200:
            audio_b64 = tts_resp.json().get('audio_data', '')
            print(f"[IA] TTS OK ({time.time()-tts_t0:.1f}s), {len(audio_b64)} chars")
        else:
            tts_err = f'HTTP {tts_resp.status_code}: {tts_resp.text[:200]}'
            print(f"[IA] TTS FAIL: {tts_err}")
    except Exception as e:
        tts_err = str(e)
        print(f"[IA] TTS ERROR: {tts_err}")

    print(f"[IA] Total: {time.time()-t0:.1f}s | audio={'OK' if audio_b64 else 'NO'}")

    return jsonify({
        'text': response_text,
        'audio_data': audio_b64,
        'format': 'wav',
        'tts_ok': bool(audio_b64),
        'tts_error': tts_err or None
    })


# ---- Fichiers statiques ----
@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory('.', filename)


if __name__ == '__main__':
    print("\n" + "=" * 50)
    print("  PHOTOMATON ID + ASSISTANT IA VOCAL")
    print(f"  Key: {MISTRAL_API_KEY[:8]}...{MISTRAL_API_KEY[-4:]}")
    print("  http://localhost:8080      (photomaton)")
    print("  http://localhost:8080/ia   (assistant vocal)")
    print("=" * 50 + "\n")
    app.run(host='0.0.0.0', port=8080, debug=False)
