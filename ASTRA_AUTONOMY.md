# Astra autonomous feature proposals

This GitHub Actions workflow can run once per day and can also be started manually. It asks the configured model for one small feature patch, allows changes only to `app.js` and `index.html`, applies the patch in the ephemeral GitHub runner, runs syntax/diff checks, and opens a pull request. It never merges or deploys automatically.

## One-time setup

1. In the GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**.
2. Add `MISTRAL_API_KEY` with a Mistral API key you control. Keep it out of the source and the browser. This is separate from any key stored locally in Astra's browser settings for TTS.
3. In **Settings → Actions → General → Workflow permissions**, ensure the workflow token has read/write permission for contents and pull requests, if the repository policy requires it.
4. Merge this workflow into `main`; then it runs daily (UTC) or via **Actions → Astra autonomous feature proposals → Run workflow**.

Each run may incur model/API usage. Review every pull request; tests are limited to JavaScript syntax and diff whitespace checks, so manually test behavior before merging. Netlify deploys only after a merge/deploy trigger; this workflow does not publish site changes itself.
