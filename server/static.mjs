import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { applyBaseHeaders, redirect, sendText } from './http-utils.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

const COMPRESSIBLE = new Set([
  '.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.txt', '.xml'
]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

function isSecure(req, config) {
  if (!config.trustProxy) return Boolean(req.socket?.encrypted);
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function safeJoin(baseDir, relativePath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const normalized = path.posix.normalize(decoded);
  if (normalized.startsWith('../') || normalized === '..') return null;
  const target = path.resolve(baseDir, `.${normalized.startsWith('/') ? normalized : `/${normalized}`}`);
  const root = path.resolve(baseDir);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function notFound(req, res) {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 — KnowTomorrow</title><link rel="stylesheet" href="/css/site.css"></head>
<body class="error-page"><main><p class="eyebrow">404</p><h1>Страница не найдена</h1>
<p>Возможно, ссылка устарела. Вернитесь на <a href="/">главную</a> или откройте <a href="/app">приложение</a>.</p></main></body></html>`;
  sendText(res, 404, html, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
}

function serveFile(req, res, filePath, config, options = {}) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': mime,
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': options.cacheControl || 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': CSP,
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    Vary: 'Accept-Encoding',
    ...(options.headers || {})
  };
  if (isSecure(req, config)) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }

  if (req.headers['if-none-match'] === etag) {
    applyBaseHeaders(res);
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  let body = fs.readFileSync(filePath);
  const acceptsGzip = String(req.headers['accept-encoding'] || '').includes('gzip');
  if (acceptsGzip && COMPRESSIBLE.has(ext) && body.length > 1024) {
    body = gzipSync(body, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = body.length;

  applyBaseHeaders(res);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else res.end(body);
  return true;
}

export function createStaticHandler({ publicDir, sharedDir, config }) {
  return async function handleStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method Not Allowed');
      return true;
    }

    const pathname = url.pathname;

    if (pathname === '/login') {
      redirect(res, '/?auth=login');
      return true;
    }
    if (pathname === '/register') {
      redirect(res, '/?auth=register');
      return true;
    }
    if (pathname === '/downloads' || pathname === '/download') {
      redirect(res, '/#downloads');
      return true;
    }
    if (pathname === '/privacy') {
      redirect(res, '/privacy.html');
      return true;
    }

    if (pathname === '/' || pathname === '/index.html') {
      if (serveFile(req, res, path.join(publicDir, 'index.html'), config, { cacheControl: 'no-cache' })) {
        return true;
      }
      return false;
    }

    if (pathname === '/app' || pathname === '/app/' || pathname === '/app.html') {
      if (serveFile(req, res, path.join(publicDir, 'app.html'), config, { cacheControl: 'no-cache' })) {
        return true;
      }
      return false;
    }

    if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin.html') {
      if (
        serveFile(req, res, path.join(publicDir, 'admin.html'), config, {
          cacheControl: 'no-cache',
          headers: { 'X-Robots-Tag': 'noindex, nofollow' }
        })
      ) {
        return true;
      }
      return false;
    }

    if (pathname === '/sw.js') {
      if (
        serveFile(req, res, path.join(publicDir, 'sw.js'), config, {
          cacheControl: 'no-cache, no-store, must-revalidate'
        })
      ) {
        return true;
      }
      return false;
    }

    if (pathname === '/favicon.ico') {
      if (
        serveFile(req, res, path.join(publicDir, 'assets/icons/favicon-32.png'), config, {
          cacheControl: 'public, max-age=86400'
        })
      ) {
        return true;
      }
      return false;
    }

    if (pathname.startsWith('/shared/')) {
      const filePath = safeJoin(sharedDir, pathname.slice('/shared'.length));
      if (!filePath) {
        notFound(req, res);
        return true;
      }
      if (serveFile(req, res, filePath, config, { cacheControl: 'public, max-age=300' })) return true;
      notFound(req, res);
      return true;
    }

    const filePath = safeJoin(publicDir, pathname);
    if (!filePath) {
      notFound(req, res);
      return true;
    }
    const cacheControl = pathname.startsWith('/assets/')
      ? 'public, max-age=86400'
      : 'public, max-age=600';
    if (serveFile(req, res, filePath, config, { cacheControl })) return true;

    // Человекопонятные URL приложения без hash-роутинга.
    if (!path.extname(pathname) && pathname.startsWith('/app/')) {
      if (serveFile(req, res, path.join(publicDir, 'app.html'), config, { cacheControl: 'no-cache' })) {
        return true;
      }
    }

    notFound(req, res);
    return true;
  };
}
