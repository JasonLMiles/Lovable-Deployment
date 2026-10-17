// Deployment host for a prebuilt Lovable app. No third-party runtime packages.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(await readFile(path.join(root, 'release.json'), 'utf8'));
const port = Number(process.env.PORT || 8080);
const upstreamPort = Number(process.env.APP_INTERNAL_PORT || 3001);
if (port === upstreamPort && manifest.stack === 'tanstack') throw new Error('Runtime ports must differ');
const publicConfig = Object.freeze({
  appName: process.env.PUBLIC_APP_NAME || 'Lovable application',
  environment: process.env.PUBLIC_ENVIRONMENT || 'local',
  apiBaseUrl: process.env.PUBLIC_API_BASE_URL || '/api',
  supabaseUrl: process.env.PUBLIC_SUPABASE_URL || '',
  supabasePublishableKey: process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
});
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.avif':'image/avif',
  '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8',
  '.pdf':'application/pdf', '.wasm':'application/wasm', '.webmanifest':'application/manifest+json' };
const staticRoot = path.join(root, 'dist');
let child;
let shuttingDown = false;
if (manifest.stack === 'tanstack') {
  child = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1',
      PORT: String(upstreamPort), NITRO_HOST: '127.0.0.1', NITRO_PORT: String(upstreamPort) },
  });
  child.on('error', () => process.exit(1));
  child.on('exit', code => { if (!shuttingDown) process.exit(code || 1); });
} else if (manifest.stack !== 'vite') throw new Error('Unsupported stack');

function json(req, res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'content-length': Buffer.byteLength(data) });
  res.end(req.method === 'HEAD' ? undefined : data);
}

async function healthy() {
  if (manifest.stack === 'vite') return (await stat(path.join(staticRoot, 'index.html'))).isFile();
  // Override with a dependency-aware, anonymous internal readiness route in the app.
  const healthPath = process.env.APP_HEALTH_PATH || '/';
  if (!healthPath.startsWith('/') || healthPath.startsWith('//')) return false;
  const response = await fetch(`http://127.0.0.1:${upstreamPort}${healthPath}`, {
    redirect: 'manual', signal: AbortSignal.timeout(4000),
  });
  await response.body?.cancel();
  return response.status >= 200 && response.status < 300;
}

async function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return; }
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end(); return; }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(p => p.startsWith('.'))) {
    res.writeHead(404); res.end(); return;
  }
  let candidate = path.resolve(staticRoot, '.' + decoded);
  if (!candidate.startsWith(staticRoot + path.sep) && candidate !== staticRoot) { res.writeHead(404); res.end(); return; }
  try {
    if ((await stat(candidate)).isDirectory()) candidate = path.join(candidate, 'index.html');
    await stat(candidate);
  } catch {
    // An unknown API or asset must not be disguised as a successful HTML response.
    if (path.extname(decoded) || decoded === '/api' || decoded.startsWith('/api/') ||
        !String(req.headers.accept || '').includes('text/html')) { res.writeHead(404); res.end(); return; }
    candidate = path.join(staticRoot, 'index.html');
  }
  const actual = await realpath(candidate);
  if (!actual.startsWith(staticRoot + path.sep)) { res.writeHead(404); res.end(); return; }
  const info = await stat(actual);
  if (!info.isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(actual).toLowerCase()] || 'application/octet-stream',
    'content-length': info.size, 'cache-control': 'no-cache' });
  if (req.method === 'HEAD') res.end();
  else createReadStream(actual).on('error', () => res.destroy()).pipe(res);
}

function endToEndHeaders(headers) {
  const blocked = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization',
    'te','trailer','transfer-encoding','upgrade', ...String(headers.connection || '').toLowerCase().split(',').map(s => s.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase())));
}

function proxy(req, res) {
  const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort,
    path: req.url, method: req.method, headers: endToEndHeaders(req.headers) }, response => {
    res.writeHead(response.statusCode || 502, endToEndHeaders(response.headers));
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  upstream.on('error', () => {
    if (res.headersSent) res.destroy();
    else json(req, res, 502, { error: 'Application unavailable' });
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
  req.pipe(upstream);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  // Deliberately omit URLs, query strings, claims and bodies from deployment-host logs.
  res.on('finish', () => console.log(JSON.stringify({ event: 'request', status: res.statusCode,
    durationMs: Date.now() - started, revision: manifest.revision })));
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/healthz') {
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      let ok = false;
      try { ok = await healthy(); } catch { /* Unready, return 503 without dependency details. */ }
      json(req, res, ok ? 200 : 503, { status: ok ? 'ok' : 'unavailable', revision: manifest.revision });
    } else if (pathname === '/_deployment/runtime-config.json') {
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      json(req, res, 200, publicConfig);
    } else if (pathname.startsWith('/_deployment/')) { res.writeHead(404); res.end(); }
    else if (manifest.stack === 'tanstack') proxy(req, res);
    else await serveStatic(req, res, pathname);
  } catch {
    if (res.headersSent) res.destroy();
    else json(req, res, 500, { error: 'Request failed' });
  }
});
// The template supports ordinary HTTP and streaming responses. WebSockets need a separate adapter.
server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n'));
server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', port, stack: manifest.stack })));
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => { child?.kill('SIGTERM'); process.exit(0); });
  child?.kill('SIGTERM');
  setTimeout(() => { child?.kill('SIGKILL'); process.exit(1); }, 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
