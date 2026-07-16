const DEFAULT_BACKEND_ORIGIN = 'https://jijin.that-is-ai.com';

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

function getRejectedPayloadReason(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const marker = `${payload.source || ''} ${payload.delivery || ''}`.toLowerCase();
  if (/\b(mock|demo|test|simulated|synthetic)\b/.test(marker)) return '上游返回了测试或模拟数据';
  if (payload.partial === true) return '上游仅返回部分数据';
  if (String(payload.delivery || '').toLowerCase().includes('derived')) return '上游返回了推导数据';
  return '';
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
    headers.set('X-Jijin-Data-Policy', 'real-only');

    if (response.ok && request.method !== 'HEAD') {
      const payload = await response.clone().json().catch(() => null);
      const rejectedReason = getRejectedPayloadReason(payload);
      if (rejectedReason) {
        const rejectedHeaders = new Headers(headers);
        rejectedHeaders.delete('Content-Encoding');
        rejectedHeaders.delete('Content-Length');
        rejectedHeaders.delete('ETag');
        rejectedHeaders.set('Content-Type', 'application/json; charset=utf-8');
        return Response.json(
          {
            ok: false,
            error: 'REAL_DATA_UNAVAILABLE',
            message: `${rejectedReason}，已按真实数据策略拒绝展示`,
            endpoint: incomingUrl.pathname,
          },
          { status: 503, headers: rejectedHeaders },
        );
      }
    }

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
