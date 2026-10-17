import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path.cwd()
ALLOWED_FILES = {"app.js", "index.html"}
MAX_PATCH_CHARS = 20_000
MODEL = os.getenv("MISTRAL_MODEL", "mistral-small-latest")


def fail(message: str) -> None:
    print(f"ASTRA_AGENT_ERROR: {message}", file=sys.stderr, flush=True)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        safe = message.replace("\r", " ").replace("\n", " ")
        with open(summary_path, "a", encoding="utf-8") as summary:
            summary.write(f"## Astra workflow diagnostic\n\n`{safe}`\n")
    raise SystemExit(1)


def set_output(key: str, value: str) -> None:
    output_path = os.environ.get("GITHUB_OUTPUT")
    if not output_path:
        raise RuntimeError("GITHUB_OUTPUT is not set")
    if "\n" in value or "\r" in value:
        delimiter = "astra_" + uuid.uuid4().hex
        with open(output_path, "a", encoding="utf-8") as output:
            output.write(f"{key}<<{delimiter}\n{value}\n{delimiter}\n")
    else:
        with open(output_path, "a", encoding="utf-8") as output:
            output.write(f"{key}={value}\n")


def call_model(idea_seed: str) -> dict:
    api_key = os.getenv("MISTRAL_API_KEY", "")
    if not api_key:
        fail("Missing GitHub Actions secret MISTRAL_API_KEY")

    prompt = f"""You are Astra's cautious feature-development agent. Propose at most ONE small useful feature per run for this French voice assistant.
Return strict JSON: {{"title":"short title","summary":"what it does","patch":"unified git diff"}}.
The patch may modify only app.js and index.html. Never add dependencies, credentials, remote code loading, arbitrary code execution, tracking, self-modification loops, or auto-deployment. Keep existing voice and server APIs unchanged. Prefer a small user-requested/voice interaction improvement. Do not mention old conversations or invent user data. Tests are run separately; do not put shell commands in the patch.
This run's design seed: {idea_seed}
Current app.js (relevant beginning and question handling):
{(ROOT / 'app.js').read_text(encoding='utf-8')[:12000]}
Current index.html (relevant interface):
{(ROOT / 'index.html').read_text(encoding='utf-8')[:8000]}
"""
    request_body = json.dumps({
        "model": MODEL,
        "temperature": 0.2,
        "max_tokens": 1800,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.mistral.ai/v1/chat/completions",
        data=request_body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    response_text = ""
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                status = response.status
                response_text = response.read().decode("utf-8", errors="replace")
            break
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:2000]
            if exc.code == 429 and attempt < 3:
                retry_after = exc.headers.get("Retry-After", "")
                try:
                    delay = min(max(int(retry_after), 5), 60) if retry_after else (10 * (2 ** attempt))
                except ValueError:
                    delay = 10 * (2 ** attempt)
                print(f"Mistral rate limit (429); retry {attempt + 1}/3 in {delay}s", flush=True)
                time.sleep(delay)
                continue
            fail(f"Mistral HTTP {exc.code}: {detail}")
        except Exception as exc:
            fail(f"Mistral request failed ({type(exc).__name__}): {exc}")
    if status >= 400:
        fail(f"Mistral HTTP {status}: {response_text[:2000]}")
    try:
        payload = json.loads(response_text)
        return json.loads(payload["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        fail(f"Feature model returned invalid JSON: {exc}")


def validate_patch(patch: str) -> None:
    if not patch or len(patch) > MAX_PATCH_CHARS:
        fail("Model returned an empty or oversized patch")
    paths = set()
    for line in patch.splitlines():
        if line.startswith("diff --git "):
            match = re.match(r"diff --git a/(.+) b/(.+)$", line)
            if not match:
                fail("Malformed diff header")
            before, after = match.groups()
            if before != after or before not in ALLOWED_FILES:
                fail(f"Patch attempted to modify disallowed path: {before} -> {after}")
            paths.add(before)
        if line.startswith(("GIT binary patch", "Binary files ")):
            fail("Binary patches are not permitted")
    if not paths:
        fail("Model returned no changes")
    patch_file = ROOT / "_astra_generated.patch"
    patch_file.write_text(patch, encoding="utf-8")
    try:
        subprocess.run(["git", "apply", "--check", str(patch_file)], cwd=ROOT, check=True, timeout=15)
        subprocess.run(["git", "apply", str(patch_file)], cwd=ROOT, check=True, timeout=15)
    finally:
        patch_file.unlink(missing_ok=True)
    changed = set(subprocess.check_output(["git", "diff", "--name-only"], cwd=ROOT, text=True).splitlines())
    if not changed or not changed.issubset(ALLOWED_FILES):
        fail(f"Unexpected changed paths: {sorted(changed)}")


def run_tests() -> None:
    subprocess.run(["node", "--check", "app.js"], cwd=ROOT, check=True, timeout=20)
    subprocess.run(["node", "--check", "api.js"], cwd=ROOT, check=True, timeout=20)
    subprocess.run(["git", "diff", "--check"], cwd=ROOT, check=True, timeout=20)


def main() -> None:
    seed = datetime.now(timezone.utc).strftime("daily voice feature idea %Y-%m-%d")
    proposal = call_model(seed)
    title = str(proposal.get("title", "Astra feature proposal")).strip()[:100]
    summary = str(proposal.get("summary", "Automated feature proposal")).strip()[:1000]
    patch = proposal.get("patch")
    if not isinstance(patch, str):
        fail("Proposal patch must be text")
    validate_patch(patch)
    run_tests()

    branch = "astra/auto-proposal-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    body = (
        f"Astra prepared this feature proposal automatically.\n\n{summary}\n\n"
        "Checks passed: patch path allowlist, `node --check app.js`, `node --check api.js`, and `git diff --check`.\n\n"
        "This PR is not auto-merged or auto-deployed. Review behavior and security before merging."
    )
    set_output("changed", "true")
    set_output("title", title.replace("\n", " "))
    set_output("branch", branch)
    set_output("body", body)
    print(summary)


if __name__ == "__main__":
    main()
