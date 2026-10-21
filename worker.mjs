/* ai-studio worker : assets (site) + /api/tts (proxy Edge-TTS neural Microsoft).
   v10.80 : voix neurales gratuites a vie SANS cle — WS speech.platform.bing
   appelle via fetch(Upgrade: websocket) (seul un Worker peut poser les
   headers Sec-MS-GEC / Sec-WebSocket-Version interdits au navigateur). */

const TRUSTED = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=' + TRUSTED;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.2849.68 Safari/537.36 Edg/130.0.2849.68';
const GEC_VERSION = '1-130.0.2849.68';

const EDGE_FR_VOICES = [
  'fr-FR-VivienneMultilingualNeural', 'fr-FR-RemyMultilingualNeural',
  'fr-FR-DeniseNeural', 'fr-FR-HenriNeural', 'fr-FR-EloiseNeural',
  'fr-FR-SylvieNeural', 'fr-FR-CoralieNeural', 'fr-FR-AlainNeural',
  'fr-FR-CharlineNeural'
];

function gecToken(){
  const seconds = Math.floor((Date.now() / 1000 + 11644473600) / 300) * 300;
  const ticks = BigInt(seconds) * 10000000n;
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticks.toString() + TRUSTED)).then(b =>
    [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()
  );
}

function corsify(init){
  const h = new Headers(init && init.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key');
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return h;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function edgeTts(text, voice){
  const gec = await gecToken();
  const up = await fetch(WSS + '&Sec-MS-GEC=' + gec + '&Sec-MS-GEC-Version=' + GEC_VERSION, {
    headers: {
      'Upgrade': 'websocket',
      'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': UA,
      'Sec-MS-GEC': gec,
      'Sec-MS-GEC-Version': GEC_VERSION
    }
  });
  if (!up.webSocket) return null;
  const ws = up.webSocket;
  ws.accept();
  const chunks = [];
  let ended = false;
  const ts = () => new Date().toUTCString();
  const utf = JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } });
  ws.send('X-Timestamp:' + ts() + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' + utf);
  const reqId = crypto.randomUUID().replace(/-/g, '');
  const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='fr-FR'><voice name='" + xml(voice) + "'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>" + xml(text) + '</prosody></voice></speak>';
  ws.send('X-RequestId:' + reqId + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + ts() + '\r\nPath:ssml\r\n\r\n' + ssml);
  ws.addEventListener('message', (e) => {
    if (ended) return;
    try {
      if (typeof e.data === 'string'){
        if (e.data.indexOf('Path:turn.end') >= 0){ ended = true; try { ws.close(); } catch {} }
        return;
      }
      const buf = new Uint8Array(e.data);
      const hint = buf[1];
      const body = buf.subarray(2 + hint);
      const head = new TextDecoder().decode(buf.subarray(2, 2 + hint));
      if (head.indexOf('Path:audio') >= 0 && body.length) chunks.push(body);
    } catch {}
  });
  await new Promise((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (ended || Date.now() - t0 > 25000){ clearInterval(iv); try { ws.close(); } catch {} res(); }
    }, 150);
  });
  if (!chunks.length) return null;
  const total = chunks.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks){ out.set(c, off); off += c.length; }
  return out;
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsify() });
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === '/api/tts' && request.method === 'POST'){
        const body = await request.json();
        const text = String(body.text || '').slice(0, 3000);
        const voice = String(body.voice || 'fr-FR-VivienneMultilingualNeural');
        if (!text.trim()) return new Response(JSON.stringify({ error: 'text requis' }), { status: 400, headers: corsify() });
        const audio = await edgeTts(text, voice);
        if (!audio || audio.length < 100) return new Response(JSON.stringify({ error: 'upstream tts failed' }), { status: 502, headers: corsify() });
        return new Response(audio, { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
      }
      if (url.pathname === '/api/voices'){
        return new Response(JSON.stringify({ ok: true, voices: EDGE_FR_VOICES }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Access-Control-Allow-Origin': '*' } });
    } catch(e){
      return new Response(JSON.stringify({ error: String(e && e.message) }), { status: 500, headers: corsify() });
    }
  }
};
