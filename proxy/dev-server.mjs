// Run proxy/worker.js locally with Node (no Cloudflare account needed), for testing the app's proxy setting.
// node proxy/dev-server.mjs --port 8804 --key test-key --origins http://localhost:8000
import http from 'node:http';
import worker from './worker.js';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('port', 8804);
const env = { PROXY_KEY: arg('key', 'test-key'), ALLOWED_ORIGINS: arg('origins', 'http://localhost:8000') };

http.createServer(async (req, res) => {
  try {
    const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers });
    const out = await worker.fetch(request, env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    if (out.body) for await (const chunk of out.body) res.write(chunk);
    res.end();
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(port, '127.0.0.1', () => console.log(`proxy dev server on http://localhost:${port} (origins: ${env.ALLOWED_ORIGINS})`));
