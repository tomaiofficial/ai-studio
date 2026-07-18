export default {
  async fetch(request) {
    const url = new URL(request.url);
    const apiKey = MISTRAL_API_KEY;

    const target = 'https://api.mistral.ai' + url.pathname + url.search;

    const headers = new Headers(request.headers);
    headers.set('Authorization', 'Bearer ' + apiKey);

    const body = request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH'
      ? await request.text()
      : null;

    const resp = await fetch(target, {
      method: request.method,
      headers: headers,
      body: body,
    });

    const respHeaders = new Headers(resp.headers);
    respHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders,
    });
  },
};
