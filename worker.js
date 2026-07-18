export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = 'https://api.mistral.ai' + url.pathname + url.search;
    const headers = new Headers(request.headers);
    headers.set('Authorization', 'Bearer RmZmxSfwoOIUdLCifXVLfbYhI0EO8j2U');
    const body = await request.text();
    const resp = await fetch(target, { method: request.method, headers, body: body || null });
    const respHeaders = new Headers(resp.headers);
    respHeaders.set('Access-Control-Allow-Origin', '*');
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: respHeaders });
  },
};
