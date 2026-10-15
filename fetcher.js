'use strict';
/* fetcher.js: one GET per URL straight from the browser, plus a concurrency-limited runner.
   Fetcher.get(url, { timeoutMs, signal, proxy }) -> result (never throws)
     proxy: { url, key } sends the request through proxy/worker.js instead of straight to the server
     success: { status, reason, finalUrl, redirected, ct, ms, size, truncated, body: Blob, retryAfter, via }
     failure: { error: { kind, message }, ms, via }   kinds as in errors.js; via = 'direct' | 'proxy'
   Runner.run(items, { concurrency, timeoutMs, fetch, onStart(item), onDone(item, result) }) -> Promise<stopped?>
     fetch(url, { timeoutMs, signal }) replaces Fetcher.get (the app uses it for the proxy fallback)
   Runner.stop() cancels in-flight requests; queued ones never start. */
const MAX_BODY = 10 * 1024 * 1024;

const Fetcher = {
  isLocal: (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost'),

  proxyUrl(proxy, target) {
    return `${proxy.url}${proxy.url.includes('?') ? '&' : '?'}key=${encodeURIComponent(proxy.key)}&url=${encodeURIComponent(target)}`;
  },

  async get(url, { timeoutMs = 15000, signal, proxy } = {}) {
    const t0 = performance.now();
    const via = proxy ? 'proxy' : 'direct';
    const fail = (kind, message = '') => ({ error: { kind, message }, ms: Math.round(performance.now() - t0), via });
    let u;
    try { u = new URL(url); } catch (e) { return fail('invalid_url', 'Not a valid URL'); }
    if (!/^https?:$/.test(u.protocol)) return fail('invalid_url', `Unsupported scheme "${u.protocol}"`);
    // The proxy is reached over https, so it can fetch plain http targets too.
    if (!proxy && location.protocol === 'https:' && u.protocol === 'http:' && !this.isLocal(u.hostname)) return fail('insecure');
    if (navigator.onLine === false) return fail('offline');

    const ctrl = new AbortController();
    let timedOut = false;
    const onStop = () => ctrl.abort();
    if (signal) { if (signal.aborted) return fail('stopped'); signal.addEventListener('abort', onStop); }
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    try {
      const res = await fetch(proxy ? this.proxyUrl(proxy, u.href) : u.href,
        { signal: ctrl.signal, cache: 'no-store', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer' });
      const pe = proxy && res.headers.get('x-proxy-error');
      if (pe) { // the Worker's own failure, not the target's response
        let msg = await res.text();
        try { msg = JSON.parse(msg).message || msg; } catch (e) {}
        return fail(pe === 'network' ? 'network' : pe === 'invalid_url' ? 'invalid_url' : 'proxy', 'Proxy: ' + msg);
      }
      const ct = res.headers.get('content-type') || '';
      const { blob, size, truncated } = await this.readCapped(res, ct);
      const hdr = (k) => proxy ? res.headers.get(k) : null;
      return {
        status: res.status, reason: proxy ? Errors.reason(res.status) || hdr('x-status-text') || '' : res.statusText || Errors.reason(res.status),
        finalUrl: hdr('x-final-url') || (proxy ? u.href : res.url || u.href),
        redirected: proxy ? hdr('x-redirected') === '1' : res.redirected, ct, ms: Math.round(performance.now() - t0), size, truncated, body: blob,
        retryAfter: res.headers.get('retry-after'), via,
      };
    } catch (e) {
      if (timedOut) return fail('timeout', `No complete response within ${Math.round(timeoutMs / 1000)} s`);
      if (signal && signal.aborted) return fail('stopped');
      if (navigator.onLine === false) return fail('offline');
      if (proxy) return fail('proxy', 'Could not reach the proxy, or it does not allow this app’s address (ALLOWED_ORIGINS).');
      // fetch() gives the same TypeError for CORS, DNS, refused, SSL and redirect loops. A no-cors probe that gets
      // any answer proves the server is reachable, so the failure was CORS.
      if (e && e.name === 'TypeError' && await this.reachable(u.href, signal)) return fail('cors', e.message);
      return fail('network', (e && e.message) || String(e));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onStop);
    }
  },

  async readCapped(res, ct) {
    if (!res.body || !res.body.getReader) {
      let blob = await res.blob();
      const truncated = blob.size > MAX_BODY;
      if (truncated) blob = blob.slice(0, MAX_BODY, ct);
      return { blob, size: blob.size, truncated };
    }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0, truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > MAX_BODY) {
        chunks.push(value.subarray(0, MAX_BODY - size)); size = MAX_BODY; truncated = true;
        reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value); size += value.length;
    }
    return { blob: new Blob(chunks, { type: ct }), size, truncated };
  },

  async reachable(url, signal) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const onStop = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onStop);
    try { await fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctrl.signal }); return true; }
    catch (e) { return false; }
    finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onStop); }
  },
};

const Runner = {
  ctrl: null,
  get running() { return !!this.ctrl; },
  async run(items, { concurrency = 4, timeoutMs = 15000, fetch: get, onStart, onDone }) {
    get = get || ((url, o) => Fetcher.get(url, o));
    const ctrl = this.ctrl = new AbortController();
    let next = 0;
    // Workers take items in queue order, so requests start (and cards appear) in CSV order.
    const worker = async () => {
      while (!ctrl.signal.aborted && next < items.length) {
        const it = items[next++];
        onStart && onStart(it);
        const r = await get(it.url, { timeoutMs, signal: ctrl.signal });
        onDone && await onDone(it, r);
      }
    };
    try { await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker)); }
    finally { this.ctrl = null; }
    return ctrl.signal.aborted;
  },
  stop() { if (this.ctrl) this.ctrl.abort(); },
};
