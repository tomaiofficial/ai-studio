import base64
from flask import Flask, request, Response, jsonify
import requests
import os

app = Flask(__name__)

MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY")
MISTRAL_BASE = "https://api.mistral.ai"

def cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400"
    }

@app.route("/")
def index():
    return jsonify({"status": "ok", "service": "IA Vocal Proxy"})

@app.route("/v1/chat/completions", methods=["POST", "OPTIONS"])
def chat():
    if request.method == "OPTIONS":
        return Response("", 200, cors_headers())
    data = request.get_json(force=True, silent=True) or {}
    headers = {
        "Authorization": f"Bearer {os.environ.get('MISTRAL_API_KEY')}",
        "Content-Type": "application/json"
    }
    try:
        resp = requests.post(f"{MISTRAL_BASE}/v1/chat/completions",
                             headers=headers, json=data, timeout=60)
        return Response(resp.content, resp.status_code, dict(resp.headers))
    except requests.exceptions.Timeout:
        return jsonify({"error": "Mistral API timeout"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 502

@app.route("/v1/audio/speech", methods=["POST", "OPTIONS"])
def tts():
    if request.method == "OPTIONS":
        return Response("", 200, cors_headers())
    data = request.get_json(force=True, silent=True) or {}
    headers = {
        "Authorization": f"Bearer {os.environ.get('MISTRAL_API_KEY')}",
        "Content-Type": "application/json"
    }
    try:
        resp = requests.post(f"{MISTRAL_BASE}/v1/audio/speech",
                             headers=headers, json=data, timeout=60)
        if resp.status_code != 200:
            return Response(resp.content, resp.status_code, {"Content-Type": "application/json"})
        audio_b64 = base64.b64encode(resp.content).decode("utf-8")
        return jsonify({"audio_data": audio_b64})
    except Exception as e:
        return jsonify({"error": str(e)}), 502

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)