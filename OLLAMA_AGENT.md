# Local Astra feature agent (Ollama)

This agent runs on this PC and uses a model served by Ollama at `127.0.0.1:11434`. It generates one small patch, permits changes only to `app.js` and `index.html`, applies it to the local worktree, runs JavaScript syntax and diff checks, and saves a review copy under `local-proposals/`. It never commits, pushes, or deploys automatically.

## One-time setup on Windows

1. Install Ollama from https://ollama.com/download/windows and start the Ollama app.
2. In PowerShell, run `ollama pull qwen2.5-coder:7b` (large model download; RAM/GPU affect speed).
3. Ensure Python 3, Node.js, and Git are installed.
4. From the repository folder, run: `python ollama_astra_agent.py "ajoute une fonction locale pour ..."`
5. Review `git diff` and the Markdown file in `local-proposals/`. If you approve, commit and push yourself; Netlify then deploys according to its repo settings.

Run again whenever the PC is on to have the local model propose another feature. This is not continuous background service: the script runs only when started, Ollama must be running, and the PC must stay on during generation. No cloud API key is used.
