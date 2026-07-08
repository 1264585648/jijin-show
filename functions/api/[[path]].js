const DEFAULT_BACKEND_ORIGIN = 'http://34.150.36.161:8000';

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function getBackendOrigin(env = {}) {
  return normalizeOrigin(env.JIJIN_API_BACKEND || env.API_BASE || DEFAULT_BACKEND_ORIGIN);
}

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function onRequest(context) {
  const { request, env = {} } = context;
  const corsHeaders = getCorsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const backendOrigin = getBackendOrigin(env);
  if (!backendOrigin) {
    return Response.json(
      { ok: false, error: 'Missing backend origin. Set JIJIN_API_BACKEND in Cloudflare Pages.' },
      { status: 500, headers: corsHeaders },
    );
  }

  const incomingUrl = new URL(request.url);
  const targetUrl = `${backendOrigin}${incomingUrl.pathname}${incomingUrl.search}`;
  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.delete('Host');
  proxyHeaders.delete('CF-Connecting-IP');
  proxyHeaders.delete('CF-IPCountry');
  proxyHeaders.delete('CF-Ray');

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'follow',
    });

    const headers = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
    headers.set('Cache-Control', 'no-store');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: 'Backend proxy request failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502, headers: corsHeaders },
    );
  }
}
