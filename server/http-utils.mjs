const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
};

export class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function applyBaseHeaders(res) {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
}

export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  applyBaseHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

export function sendText(res, status, text, type = 'text/plain; charset=utf-8', extraHeaders = {}) {
  applyBaseHeaders(res);
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders
  });
  res.end(text);
}

export function redirect(res, location, status = 302) {
  applyBaseHeaders(res);
  res.writeHead(status, { Location: location, 'Content-Length': 0 });
  res.end();
}

/** Читает JSON с ограничением размера; не позволяет «залить» сервер гигантским телом. */
export function readJson(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(new HttpError(413, 'Тело запроса слишком большое'));
        return;
      }
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Некорректный JSON'));
      }
    });
    req.on('error', (error) => reject(error));
  });
}

export function clientIp(req, config) {
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function isSameOrigin(req, config) {
  const origin = req.headers.origin;
  if (!origin) return true; // CLI, curl, мобильные клиенты
  if (origin === 'null') return false;
  if (config.appOrigin && origin === config.appOrigin.replace(/\/$/, '')) return true;
  try {
    const originUrl = new URL(origin);
    return originUrl.host === req.headers.host;
  } catch {
    return false;
  }
}

export function noCacheHeaders() {
  return { 'Cache-Control': 'no-store, max-age=0' };
}
