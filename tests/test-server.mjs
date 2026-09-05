import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

// Test-only origin. An unavailable origin cannot serve even one missing PWA asset.
export async function startTestServer(prefix = '/') {
  const root = fileURLToPath(new URL('../', import.meta.url));
  let available = true;
  let shellVersion = null;
  let requests = [];
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer(async (req, res) => {
    requests.push(req.url);
    if (!available) { req.socket.destroy(); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith(prefix)) { res.writeHead(404); res.end(); return; }
      const relative = url.pathname.slice(prefix.length) || 'index.html';
      const target = path.resolve(root, relative);
      if (!target.startsWith(root)) { res.writeHead(403); res.end(); return; }
      let body = await readFile(target);
      if (relative === 'sw.js' && shellVersion) body = Buffer.from(body.toString().replace(/const VERSION = '[^']+';/, `const VERSION = '${shellVersion}';`));
      res.writeHead(200, { 'Content-Type': `${types[path.extname(target)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}${prefix}`, setAvailable: v => { available = v; }, setVersion: v => { shellVersion = v; }, takeRequests: () => { const list = requests; requests = []; return list; }, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
