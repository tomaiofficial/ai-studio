from flask import Flask, request, Response
import requests
import os

app = Flask(__name__)

MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY")
MISTRAL_BASE = "https://api.mistral.ai"

@app.route("/v1/chat/completions", methods=["POST", "OPTIONS"])
def chat():
    if request.method == "OPTIONS":
        return Response("", 200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        })
    headers = {
        "Authorization": f"Bearer {os.environ.get('MISTRAL_API_KEY')}",
        "Content-Type": "application/json"
    }
    resp = requests.post(f"{MISTRAL_BASE}/v1/chat/completions",
                         headers=headers, json=request.get_json(), timeout=60)
    return Response(resp.content, resp.status_code, resp.headers.items())

@app.route("/v1/audio/speech", methods=["POST", "OPTIONS"])
def tts():
    if request.method == "OPTIONS":
        return Response("", 200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        })
    headers = {
        "Authorization": f"Bearer {os.environ.get('MISTRAL_API_KEY')}",
        "Content-Type": "application/json"
    }
    resp = requests.post(f"{MISTRAL_BASE}/v1/audio/speech",
                         headers=headers, json=request.get_json(), timeout=60)
    return Response(resp.content, resp.status_code, resp.headers.items())

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)