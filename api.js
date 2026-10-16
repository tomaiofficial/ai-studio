'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const API_TOKEN = process.env.ASTRA_API_TOKEN || '';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_FEATURE_LENGTH = 2000;
const DATA_DIR = process.env.ASTRA_DATA_DIR || path.join(__dirname, 'data');
const FEATURES_FILE = path.join(DATA_DIR, 'feature-suggestions.jsonl');

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
  if (req.method === 'GET' && url.pathname === '/') {
    return sendJson(res, 200, { service: 'astra-api', health: '/health', submitSuggestion: 'POST /add-feature' }, cors || {});
  }
  if (req.method !== 'POST' || url.pathname !== '/add-feature') {
    return sendJson(res, 404, { error: 'Not found' }, cors || {});
  }

  if (Date.now() - featureWindowStart >= 60_000) {
    featurePostCount = 0;
    featureWindowStart = Date.now();
  }
  if (++featurePostCount > 20) return sendJson(res, 429, { error: 'Too many suggestions; try again later' }, cors || {});

  if (!API_TOKEN) return sendJson(res, 503, { error: 'Server not configured: set ASTRA_API_TOKEN' }, cors || {});
  const authorization = req.headers.authorization || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!constantTimeTokenMatch(bearer)) return sendJson(res, 401, { error: 'Unauthorized' }, cors || {});
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
