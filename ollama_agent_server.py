#!/usr/bin/env python3
"""Local-only Ollama proposal UI for Astra. Never commits or deploys."""
from __future__ import annotations

import difflib
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = int(os.getenv("ASTRA_AGENT_PORT", "8765"))
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:3b")
ALLOWED_FILES = {"app.js", "index.html"}
MAX_IDEA = 700
MAX_REPLACEMENT = 12000
MAX_SOURCE_CONTEXT = 4200
PROPOSALS: dict[str, dict] = {}
PROPOSALS_LOCK = threading.Lock()
GENERATION_LOCK = threading.Lock()


def json_reply(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def run_checked(args: list[str], cwd: str | Path, timeout: int = 30, allow_diff: bool = False) -> None:
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if result.returncode and not (allow_diff and result.returncode == 1):
        raise RuntimeError((result.stderr or result.stdout or f"{args[0]} failed")[-2500:])


def make_context() -> str:
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    anchor = "async function handleQuestion(question)"
    pos = app.find(anchor)
    handle_excerpt = app[pos:pos + 3600] if pos >= 0 else ""
    feature_anchor = "const ASTRA_LOCAL_FEATURES"
    fpos = app.find(feature_anchor)
    feature_excerpt = app[fpos:fpos + 700] if fpos >= 0 else ""
    html_start = html.find("<header")
    html_end = html.find('<div class="shell">', html_start)
    html_excerpt = html[html_start:html_end] if html_start >= 0 and html_end >= 0 else ""
    return f"// Existing local feature flags\n{feature_excerpt}\n// Existing question handler\n{handle_excerpt}\n// Header markup\n{html_excerpt}"[:MAX_SOURCE_CONTEXT]


def ask_ollama(idea: str) -> dict:
    prompt = f"""Tu es l'agent local de développement d'Astra. Conçois UNE fonctionnalité utile, assez puissante pour améliorer vraiment l'assistant, mais limitée à une seule tâche claire.
Réponds en JSON strict avec les clés title, summary, file, find, replace.
- file vaut exactement app.js ou index.html.
- find est un extrait exact et unique copié du contexte fourni; replace est le bloc complet qui le remplace.
- Livre une fonction finie qui marche avec les éléments/variables déjà présents. N'ajoute pas seulement un commentaire ou une idée.
- N'invente ni fichier, ni données, ni fonction existante. Pas de dépendance, réseau/API, clé, tracking, exécution dynamique ou déploiement.
- Garde les réponses en français, respecte les préférences utilisateur, et ne ressors pas les anciennes conversations spontanément.
- Si tu ne peux pas produire un changement exact, sûr et cohérent, retourne find et replace vides.
Demande d'amélioration: {idea}

Contexte de code réel:
{make_context()}
"""
    payload = json.dumps({
        "model": MODEL,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1, "num_ctx": 4096, "num_predict": 1600},
        "prompt": prompt,
    }).encode("utf-8")
    request = urllib.request.Request(
        OLLAMA_URL.rstrip("/") + "/api/generate", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=360) as response:
            response_data = json.loads(response.read().decode("utf-8"))
        raw = str(response_data.get("response", "")).strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        answer = json.loads(raw)
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Ollama inaccessible. Lance Ollama et vérifie le modèle {MODEL}. {exc}") from exc
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise RuntimeError(f"Réponse JSON Ollama invalide; aucune modification faite. {exc}") from exc

    file = answer.get("file")
    find = answer.get("find")
    replace = answer.get("replace")
    if file not in ALLOWED_FILES or not isinstance(find, str) or not isinstance(replace, str):
        raise RuntimeError("Le modèle n'a pas fourni un remplacement local valide; aucun fichier modifié.")
    if not find.strip() or not replace.strip() or len(replace) > MAX_REPLACEMENT:
        raise RuntimeError("Le modèle a renvoyé un patch vide ou trop long; aucun fichier modifié.")
    return {
        "title": str(answer.get("title", "Proposition locale Astra"))[:120],
        "summary": str(answer.get("summary", ""))[:1000],
        "file": file,
        "find": find,
        "replace": replace,
    }


def validate_in_temp(proposal: dict) -> tuple[str, list[str]]:
    target = ROOT / proposal["file"]
    original = target.read_text(encoding="utf-8")
    if original.count(proposal["find"]) != 1:
        raise RuntimeError("L'extrait de départ n'existe pas exactement une fois dans le fichier actuel; refus sûr, rien modifié.")
    candidate = original.replace(proposal["find"], proposal["replace"], 1)
    with tempfile.TemporaryDirectory(prefix="astra-ollama-check-") as tmp:
        tmp_path = Path(tmp)
        shutil.copy2(ROOT / "app.js", tmp_path / "app.js")
        shutil.copy2(ROOT / "index.html", tmp_path / "index.html")
        shutil.copy2(ROOT / "api.js", tmp_path / "api.js")
        (tmp_path / proposal["file"]).write_text(candidate, encoding="utf-8", newline="")
        run_checked(["node", "--check", "app.js"], tmp_path)
        run_checked(["node", "--check", "api.js"], tmp_path)
        run_checked(["git", "diff", "--no-index", "--check", str(target), str(tmp_path / proposal["file"])], tmp_path, timeout=15, allow_diff=True)
        diff = "\n".join(difflib.unified_diff(
            original.splitlines(), candidate.splitlines(),
            fromfile=f"a/{proposal['file']}", tofile=f"b/{proposal['file']}", lineterm="",
        ))
        return diff, ["Remplacement exact et unique", "node --check app.js", "node --check api.js", "git diff --check"]


def apply_and_commit_locally(proposal: dict) -> dict:
    """Apply only tested allowlisted feature files; make a local commit, never push."""
    status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT, capture_output=True, text=True, check=True)
    if status.stdout.strip():
        raise RuntimeError("Il y a déjà des fichiers suivis modifiés; commit/stash-les avant d'appliquer la proposition.")
    target = ROOT / proposal["file"]
    source = target.read_text(encoding="utf-8")
    if source.count(proposal["find"]) != 1:
        raise RuntimeError("Le code source a changé depuis la proposition; génère-en une nouvelle.")
    updated = source.replace(proposal["find"], proposal["replace"], 1)
    backup = target.read_bytes()
    try:
        target.write_text(updated, encoding="utf-8", newline="")
        run_checked(["node", "--check", "app.js"], ROOT)
        run_checked(["node", "--check", "api.js"], ROOT)
        run_checked(["git", "diff", "--check"], ROOT)
        run_checked(["git", "add", "--", proposal["file"]], ROOT)
        run_checked(["git", "commit", "-m", f"Astra local feature: {proposal['title'][:60]}"], ROOT)
    except Exception as exc:
        target.write_bytes(backup)
        subprocess.run(["git", "reset", "--", proposal["file"]], cwd=ROOT, capture_output=True)
        raise RuntimeError(f"Commit local échoué; fichier restauré. {exc}") from exc
    commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    return {"commit": commit, "pushed": False, "deployed": False}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[Astra local agent] " + (fmt % args))

    def do_GET(self):
        if self.path == "/health":
            return json_reply(self, 200, {"ok": True, "model": MODEL, "scope": "localhost-only"})
        if self.path not in ("/", "/index.html"):
            return json_reply(self, 404, {"error": "Not found"})
        html_path = ROOT / "ollama_agent_ui.html"
        if not html_path.exists():
            return json_reply(self, 404, {"error": "UI file missing"})
        body = html_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path not in ("/api/propose", "/api/apply"):
            return json_reply(self, 404, {"error": "Not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 4000:
                return json_reply(self, 413, {"error": "Request size invalid"})
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return json_reply(self, 400, {"error": "Expected small JSON body"})

        if self.path == "/api/propose":
            idea = body.get("idea", "")
            if not isinstance(idea, str) or not idea.strip() or len(idea) > 700:
                return json_reply(self, 400, {"error": "Describe one idea, max 700 chars"})
            if not GENERATION_LOCK.acquire(blocking=False):
                return json_reply(self, 429, {"error": "A proposal is already running"})
            try:
                proposal = ask_ollama(idea.strip())
                diff, checks = validate_in_temp(proposal)
                proposal_id = secrets.token_urlsafe(18)
                with PROPOSALS_LOCK:
                    PROPOSALS[proposal_id] = proposal
                return json_reply(self, 200, {
                    "id": proposal_id, "title": proposal["title"], "summary": proposal["summary"],
                    "diff": diff, "checks": checks, "model": MODEL,
                    "message": "Proposition testée en sandbox uniquement; rien n'a encore été appliqué.",
                })
            except Exception as exc:
                return json_reply(self, 422, {"error": str(exc)})
            finally:
                GENERATION_LOCK.release()

        proposal_id = body.get("id", "")
        if not isinstance(proposal_id, str) or not body.get("confirm"):
            return json_reply(self, 400, {"error": "Confirmation required"})
        with PROPOSALS_LOCK:
            proposal = PROPOSALS.get(proposal_id)
        if not proposal:
            return json_reply(self, 404, {"error": "Proposal expired or already applied"})
        try:
            result = apply_and_commit_locally(proposal)
        except Exception as exc:
            return json_reply(self, 500, {"error": str(exc)})
        with PROPOSALS_LOCK:
            PROPOSALS.pop(proposal_id, None)
        return json_reply(self, 200, {"ok": True, "file": proposal["file"], **result,
                                      "message": "Applied locally, checked, and committed. Not pushed or deployed."})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Astra local agent UI at http://127.0.0.1:{PORT} using {MODEL}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
