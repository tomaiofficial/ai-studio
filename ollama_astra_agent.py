#!/usr/bin/env python3
"""Local, human-reviewed Astra feature proposal agent using Ollama on this PC."""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")
ALLOWED_PATHS = {"app.js", "index.html"}
MAX_PATCH = 18_000


def run(args, *, check=True, timeout=120):
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=check, timeout=timeout)


def get_diff_from_model(idea: str) -> tuple[str, str]:
    prompt = f"""You are a careful local coding assistant for a French voice assistant called Astra.
Propose ONE very small, directly relevant feature. Return JSON only with keys title, summary, patch. Do not use markdown fences. `patch` MUST be a complete unified git diff beginning with `diff --git a/app.js b/app.js` or `diff --git a/index.html b/index.html`. Reuse exact context from the provided files; if unsure, return an empty patch and explain.
Only modify app.js or index.html. Never add dependencies, network calls, credentials, arbitrary code execution, auto-deployment, autonomous loops, or invented files. Keep French voice interaction and privacy intact. Never refer to past conversations unless specifically asked. Do not add sample names or placeholder code.
Feature idea: {idea}

Current relevant files:
--- app.js ---
{(ROOT / 'app.js').read_text(encoding='utf-8')[:18000]}
--- index.html ---
{(ROOT / 'index.html').read_text(encoding='utf-8')[:10000]}
"""
    payload = json.dumps({
        "model": MODEL,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0, "num_predict": 1200, "num_ctx": 8192},
        "prompt": prompt,
    }).encode("utf-8")
    req = urllib.request.Request(OLLAMA_URL.rstrip("/") + "/api/generate", data=payload,
                                headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            result = json.loads(response.read().decode("utf-8"))
        raw = str(result.get("response", "{}")).strip()
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE)
        answer = json.loads(raw)
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Ollama inaccessible at {OLLAMA_URL}; start Ollama and pull {MODEL}: {exc}") from exc
    except (json.JSONDecodeError, KeyError) as exc:
        raise RuntimeError(f"Invalid Ollama JSON response: {exc}. Reduce prompt size or try a better local model.") from exc
    title = str(answer.get("title", "Astra local proposal")).strip()[:90]
    summary = str(answer.get("summary", "")).strip()[:1200]
    patch = answer.get("patch")
    if not isinstance(patch, str) or not patch.strip() or len(patch) > MAX_PATCH:
        raise RuntimeError("Model returned an empty or oversized patch")
    patch = re.sub(r"^```(?:diff)?\s*|\s*```$", "", patch.strip(), flags=re.IGNORECASE)
    if not patch.startswith("diff --git "):
        raise RuntimeError("Model did not return a complete unified diff; refusing to edit files")
    return title, summary + "\n\nProvider: local Ollama / " + MODEL, patch


def check_and_apply_to_worktree(patch: str) -> list[str]:
    paths = set()
    for line in patch.splitlines():
        if line.startswith("diff --git "):
            match = re.fullmatch(r"diff --git a/(.+) b/(.+)", line)
            if not match or match.group(1) != match.group(2) or match.group(1) not in ALLOWED_PATHS:
                raise RuntimeError("Patch touches a path outside the app.js/index.html allowlist")
            paths.add(match.group(1))
        if line.startswith(("GIT binary patch", "Binary files ")):
            raise RuntimeError("Binary patches are not allowed")
    if not paths:
        raise RuntimeError("No valid file changes in patch")

    patch_path = ROOT / ".astra-local-proposal.patch"
    patch_path.write_text(patch, encoding="utf-8")
    try:
        run(["git", "apply", "--check", str(patch_path)])
        run(["git", "apply", str(patch_path)])
    finally:
        patch_path.unlink(missing_ok=True)

    changed = set(run(["git", "diff", "--name-only"]).stdout.splitlines())
    if not changed or not changed.issubset(ALLOWED_PATHS):
        raise RuntimeError(f"Unexpected changed files: {sorted(changed)}")
    try:
        run(["node", "--check", "app.js"])
        run(["node", "--check", "api.js"])
        run(["git", "diff", "--check"])
    except subprocess.CalledProcessError as exc:
        raise RuntimeError("Generated patch failed checks:\n" + exc.stderr[-3000:]) from exc
    return sorted(changed)


def main():
    args = sys.argv[1:]
    allow_worktree = False
    if "--worktree" in args:
        args.remove("--worktree")
        allow_worktree = True
    if args:
        idea = " ".join(args).strip()
    else:
        idea = "Propose one small, useful voice interaction improvement Astra can implement locally."
    if not idea or len(idea) > 1500:
        raise SystemExit("Give a feature idea (max 1500 characters).")
    dirty = run(["git", "status", "--porcelain"]).stdout.splitlines()
    # In the normal repo refuse all pre-existing edits. A throwaway detached
    # worktree may contain only this script copied in for the current run.
    if dirty and not (allow_worktree and all(line.endswith("ollama_astra_agent.py") for line in dirty)):
        raise SystemExit("Working tree is not clean. Commit/stash existing changes before proposing a patch.")

    title, summary, patch = get_diff_from_model(idea)
    changed = check_and_apply_to_worktree(patch)
    proposal_dir = ROOT / "local-proposals"
    proposal_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    proposal_path = proposal_dir / f"{stamp}.md"
    proposal_path.write_text(
        f"# {title}\n\n{summary}\n\nFiles checked: {', '.join(changed)}\n\n"
        "Checks passed: node syntax and git diff whitespace. Nothing was committed or deployed.\n\n"
        f"```diff\n{patch}\n```\n", encoding="utf-8")
    print(f"Proposal saved: {proposal_path.relative_to(ROOT)}")
    print(summary)
    print("Changes are in your local working tree only. Review with git diff; deployment is not automatic.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.TimeoutExpired, subprocess.CalledProcessError) as exc:
        print(f"Astra local agent stopped safely: {exc}", file=sys.stderr)
        raise SystemExit(1)
