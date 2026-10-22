const MAX_IDEA_LENGTH = 1500;
const MAX_PATCH_LENGTH = 12000;
const ALLOWED_FILES = new Set(['index.html', 'app.js', 'manifest.webmanifest']);

function json(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(payload) };
}

function cleanPatch(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_PATCH_LENGTH) throw new Error('Patch absent ou trop volumineux.');
  const lines = raw.replace(/^```(?:diff)?\s*/i, '').replace(/\s*```$/, '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('+++ ') && !line.startsWith('--- ')) continue;
    const file = line.slice(4).split('\t')[0].replace(/^a\//, '').replace(/^b\//, '');
    if (file === '/dev/null') continue;
    if (!ALLOWED_FILES.has(file)) throw new Error('Le patch essaie de modifier un fichier non autorisé.');
  }
  if (!lines.some(line => line.startsWith('+++ ') || line.startsWith('--- '))) throw new Error('Le modèle n’a pas fourni de diff unifié valide.');
  return lines.join('\n');
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://astra-ianetlifyapp.netlify.app';
  if (origin && origin !== allowedOrigin) return json(403, { error: 'Origin not allowed.' });
  if (!process.env.OPENAI_API_KEY) return json(503, { error: 'OPENAI_API_KEY must be configured in Netlify environment variables.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Expected valid JSON.' }); }
  const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
  if (!idea || idea.length > MAX_IDEA_LENGTH) return json(400, { error: `idea must contain 1-${MAX_IDEA_LENGTH} characters.` });

  const prompt = [
    'Prepare a small, safe code proposal for the Astra static voice-assistant site.',
    'Return JSON only: {"summary":"...","patch":"..."}; patch must be a unified diff.',
    'Only modify index.html, app.js, or manifest.webmanifest. Do not edit server secrets, deployment configuration, workflows, or dependencies.',
    'Never add self-replication, automatic publishing, credential access, hidden tracking, or arbitrary code execution.',
    'The patch will be applied only in a temporary sandbox and only syntax/diff checks will run. It will NOT be committed or deployed.',
    'If the request is unsafe, vague, or unsuitable, return an empty patch and explain briefly.',
    'Idea: ' + idea,
  ].join('\n');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
        signal: controller.signal,
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok) return json(502, { error: `AI provider error (${response.status}).` });
    const result = await response.json();
    const answer = JSON.parse(result.choices?.[0]?.message?.content || '{}');
    const summary = typeof answer.summary === 'string' ? answer.summary.slice(0, 1200) : '';
    if (!answer.patch) return json(422, { error: summary || 'No safe patch proposed.' });
    const patch = cleanPatch(answer.patch);

    // Tests are deliberately fixed, never supplied by the model.
    const tests = [
      { name: 'Patch is a unified diff limited to approved files', passed: true },
      { name: 'Patch returned for manual review; no repository files changed', passed: true },
    ];
    return json(200, { ok: true, summary, patch, tests, status: 'review-required', published: false });
  } catch (error) {
    console.error('[propose-feature]', error?.message || error);
    return json(422, { error: error.message || 'Proposal could not be prepared.' });
  }
};
