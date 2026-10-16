'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const API_TOKEN = process.env.ASTRA_API_TOKEN || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const PUBLIC_SUGGESTIONS = process.env.PUBLIC_SUGGESTIONS === 'true';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_FEATURE_LENGTH = 2000;
const DATA_DIR = process.env.ASTRA_DATA_DIR || path.join(__dirname, 'data');
const FEATURES_FILE = path.join(DATA_DIR, 'feature-suggestions.jsonl');
const MAX_SUGGESTIONS_PER_MINUTE = 20;

const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || 'https://tomaiofficial.github.io')
    .split(',').map(value => value.trim()).filter(Boolean)
);

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function getCorsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (!allowedOrigins.has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
  };
}

function constantTimeTokenMatch(candidate) {
  if (!API_TOKEN || !candidate) return false;
  const expected = Buffer.from(API_TOKEN);
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('Expected valid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function appendFeature(feature) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    feature,
    status: 'suggestion',
  };
  await fs.promises.appendFile(FEATURES_FILE, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
  return record;
}

let featurePostCount = 0;
let featureWindowStart = Date.now();

async function readSuggestions(limit = 30) {
  let raw;
  try { raw = await fs.promises.readFile(FEATURES_FILE, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return raw.split('\n').filter(Boolean).slice(-limit).reverse().flatMap(line => {
    try {
      const record = JSON.parse(line);
      return [{ id: record.id, createdAt: record.createdAt, feature: record.feature, status: record.status }];
    } catch { return []; }
  });
}

function runCommand(command, args, options = {}) {
  const { spawn } = require('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code}: ${stderr.slice(-4000)}`)));
  });
}

async function generateProposal(feature) {
  if (!OPENAI_API_KEY) throw Object.assign(new Error('Set OPENAI_API_KEY on Render'), { status: 503 });
  const prompt = [
    'You are a cautious software engineer proposing a small feature for this static voice-assistant repository.',
    'Return only JSON with keys summary (string), patch (unified diff string), tests (array of shell command strings).',
    'Only edit index.html, app.js, api.js, package.json, or render.yaml. Never edit secrets, certificates, workflows, or deployment credentials.',
    'Do not create a self-replicating or autonomous deployment mechanism. No publishing, network calls from tests, destructive commands, or arbitrary scripts.',
    'Tests must be limited to `node --check app.js`, `node --check api.js`, and `git diff --check`.',
    'If the requested idea is too broad, unsafe, or unrelated, return an empty patch and explain in summary.',
    'Requested feature: ' + feature,
  ].join('\n');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
      signal: controller.signal,
    });
    if (!response.ok) throw Object.assign(new Error(`AI provider returned ${response.status}`), { status: 502 });
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    const proposal = JSON.parse(content || '{}');
    if (typeof proposal.patch !== 'string' || !Array.isArray(proposal.tests) || typeof proposal.summary !== 'string') {
      throw Object.assign(new Error('AI returned an invalid proposal'), { status: 502 });
    }
    return { summary: proposal.summary.slice(0, 2000), patch: proposal.patch.slice(0, 20_000), tests: proposal.tests };
  } finally {
    clearTimeout(timer);
  }
}

async function validateProposal(patch) {
  const tempDir = await fs.promises.mkdtemp(path.join(require('node:os').tmpdir(), 'astra-proposal-'));
  try {
    await fs.promises.cp(__dirname, tempDir, {
      recursive: true,
      filter: source => !source.includes(`${path.sep}.git${path.sep}`) && !source.includes(`${path.sep}node_modules${path.sep}`) && !source.includes(`${path.sep}certs${path.sep}`) && !source.includes(`${path.sep}data${path.sep}`),
    });
    const patchFile = path.join(tempDir, 'proposal.patch');
    await fs.promises.writeFile(patchFile, patch, 'utf8');
    await runCommand('git', ['apply', '--check', patchFile], { cwd: tempDir, timeout: 10_000 });
    await runCommand('git', ['apply', patchFile], { cwd: tempDir, timeout: 10_000 });
    await runCommand(process.execPath, ['--check', 'app.js'], { cwd: tempDir, timeout: 10_000 });
    await runCommand(process.execPath, ['--check', 'api.js'], { cwd: tempDir, timeout: 10_000 });
    await runCommand('git', ['diff', '--check'], { cwd: tempDir, timeout: 10_000 });
    return { passed: true, checks: ['git apply --check', 'node --check app.js', 'node --check api.js', 'git diff --check'] };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

async function appendProposal(feature, proposal, validation) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), feature, summary: proposal.summary, patch: proposal.patch, validation, status: 'proposal-needs-human-review' };
  await fs.promises.appendFile(FEATURES_FILE, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
  return record;
}

const server = http.createServer(async (req, res) => {
  const cors = getCorsHeaders(req);
  if (cors === null) return sendJson(res, 403, { error: 'Origin not allowed' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors || {});
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'astra-api' }, cors || {});
  }
  if (req.method === 'GET' && url.pathname === '/suggestions') {
    if (PUBLIC_SUGGESTIONS) return sendJson(res, 403, { error: 'Suggestion review is not public' }, cors || {});
    if (!API_TOKEN) return sendJson(res, 503, { error: 'Server not configured: set ASTRA_API_TOKEN' }, cors || {});
    const authorization = req.headers.authorization || '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!constantTimeTokenMatch(bearer)) return sendJson(res, 401, { error: 'Unauthorized' }, cors || {});
    try {
      const suggestions = await readSuggestions();
      return sendJson(res, 200, { ok: true, suggestions }, cors || {});
    } catch {
      return sendJson(res, 500, { error: 'Could not read suggestions' }, cors || {});
    }
  }
  if (req.method === 'POST' && url.pathname === '/propose-feature') {
    if (!PUBLIC_SUGGESTIONS) {
      if (!API_TOKEN) return sendJson(res, 503, { error: 'Server not configured: set ASTRA_API_TOKEN' }, cors || {});
      const authorization = req.headers.authorization || '';
      const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!constantTimeTokenMatch(bearer)) return sendJson(res, 401, { error: 'Unauthorized' }, cors || {});
    }
    if (Date.now() - featureWindowStart >= 60_000) {
      featurePostCount = 0;
      featureWindowStart = Date.now();
    }
    if (++featurePostCount > 3) return sendJson(res, 429, { error: 'Proposal limit reached; try again in a minute' }, cors || {});
    if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
      return sendJson(res, 415, { error: 'Content-Type must be application/json' }, cors || {});
    }
    try {
      const body = await readJson(req);
      const feature = typeof body.feature === 'string' ? body.feature.trim() : '';
      if (!feature || feature.length > MAX_FEATURE_LENGTH) return sendJson(res, 400, { error: `feature must contain 1-${MAX_FEATURE_LENGTH} characters` }, cors || {});
      const proposal = await generateProposal(feature);
      if (!proposal.patch.trim()) return sendJson(res, 422, { error: 'No safe patch was proposed', summary: proposal.summary }, cors || {});
      const validation = await validateProposal(proposal.patch);
      const record = await appendProposal(feature, proposal, validation);
      return sendJson(res, 201, { ok: true, id: record.id, summary: record.summary, patch: record.patch, tests: validation, status: record.status }, cors || {});
    } catch (error) {
      return sendJson(res, error.status || 422, { error: error.status ? error.message : 'Proposal rejected or tests failed' }, cors || {});
    }
  }
  if (req.method === 'GET' && url.pathname === '/') {
    return sendJson(res, 200, { service: 'astra-api', health: '/health', submitSuggestion: 'POST /add-feature', createTestedProposal: 'POST /propose-feature (protected, human review required)' }, cors || {});
  }
  if (req.method !== 'POST' || url.pathname !== '/add-feature') {
    return sendJson(res, 404, { error: 'Not found' }, cors || {});
  }

  if (Date.now() - featureWindowStart >= 60_000) {
    featurePostCount = 0;
    featureWindowStart = Date.now();
  }
  if (++featurePostCount > MAX_SUGGESTIONS_PER_MINUTE) return sendJson(res, 429, { error: 'Too many suggestions; try again later' }, cors || {});

  if (!PUBLIC_SUGGESTIONS) {
    if (!API_TOKEN) return sendJson(res, 503, { error: 'Server not configured: set ASTRA_API_TOKEN' }, cors || {});
    const authorization = req.headers.authorization || '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!constantTimeTokenMatch(bearer)) return sendJson(res, 401, { error: 'Unauthorized' }, cors || {});
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
    return sendJson(res, 415, { error: 'Content-Type must be application/json' }, cors || {});
  }

  try {
    const body = await readJson(req);
    const feature = typeof body.feature === 'string' ? body.feature.trim() : '';
    if (!feature) return sendJson(res, 400, { error: 'feature must be a non-empty string' }, cors || {});
    if (feature.length > MAX_FEATURE_LENGTH) return sendJson(res, 413, { error: `feature must be at most ${MAX_FEATURE_LENGTH} characters` }, cors || {});
    const record = await appendFeature(feature);
    return sendJson(res, 201, { ok: true, savedAs: 'suggestion', id: record.id }, cors || {});
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.status ? error.message : 'Could not save suggestion' }, cors || {});
  }
});

server.listen(PORT, HOST, () => console.log(`Astra API listening on ${HOST}:${PORT}`));

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
