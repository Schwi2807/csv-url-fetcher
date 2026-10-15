// CSV URL Fetcher proxy: a Cloudflare Worker that fetches a URL for the app and adds the CORS headers the target
// server left out. Paste this whole file into a new Worker, then set (Worker → Settings → Variables and Secrets):
//   PROXY_KEY        (Secret) the key shown in the app under Settings → Proxy. Without it every request is refused.
//   ALLOWED_ORIGINS  (Text, optional) comma-separated app addresses. Default: https://schwi2807.github.io
// Request:  GET <worker>/?key=<PROXY_KEY>&url=<encoded target URL>     (add &ping=1 to only check the key)
// Response: the target's status and body; X-Final-Url, X-Redirected, X-Status-Text; on the Worker's own failures
//           an X-Proxy-Error header (origin, auth, config, invalid_url, network) with a JSON {error, message} body.

const DEFAULT_ORIGINS = 'https://schwi2807.github.io';
const EXPOSE = 'X-Final-Url, X-Redirected, X-Status-Text, X-Proxy-Error, Retry-After';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
    const cors = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': EXPOSE, Vary: 'Origin' }
      : { Vary: 'Origin' };
    const fail = (status, kind, message) => new Response(JSON.stringify({ error: kind, message }), {
      status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Proxy-Error': kind },
    });

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method !== 'GET') return fail(405, 'method', 'Only GET is supported');
    if (!allowed.includes(origin)) return fail(403, 'origin', `Requests from "${origin || 'no origin'}" are not allowed (ALLOWED_ORIGINS)`);
    if (!env.PROXY_KEY) return fail(500, 'config', 'The PROXY_KEY secret is not set on this Worker');

    const q = new URL(request.url).searchParams;
    if (q.get('key') !== env.PROXY_KEY) return fail(401, 'auth', 'Wrong proxy key');
    if (q.has('ping')) return new Response('{"ok":true}', { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

    let target;
    try { target = new URL(q.get('url') || ''); } catch (e) { return fail(400, 'invalid_url', 'Not a valid URL'); }
    if (!/^https?:$/.test(target.protocol)) return fail(400, 'invalid_url', `Unsupported scheme "${target.protocol}"`);

    let res;
    try {
      res = await fetch(target.href, { redirect: 'follow', headers: { Accept: '*/*', 'User-Agent': 'csv-url-fetcher-proxy/1.0' } });
    } catch (e) {
      return fail(502, 'network', String((e && e.message) || e));
    }
    const headers = new Headers(cors);
    for (const k of ['Content-Type', 'Retry-After']) { const v = res.headers.get(k); if (v) headers.set(k, v); }
    headers.set('X-Final-Url', res.url || target.href);
    headers.set('X-Redirected', res.redirected ? '1' : '0');
    headers.set('X-Status-Text', res.statusText || '');
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  },
};
