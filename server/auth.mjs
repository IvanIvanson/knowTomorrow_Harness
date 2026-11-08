import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE = 'kt_session';

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export function passwordProblem(password) {
  if (typeof password !== 'string') return 'Пароль обязателен';
  if (password.length < 8) return 'Пароль должен быть не короче 8 символов';
  if (password.length > 200) return 'Пароль слишком длинный';
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64');
  const derived = await scryptAsync(password, salt, 64, SCRYPT_OPTIONS);
  return { hash: derived.toString('hex'), salt };
}

export async function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const expected = Buffer.from(hash, 'hex');
  const derived = await scryptAsync(password, salt, 64, SCRYPT_OPTIONS);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function parseCookies(header) {
  const result = {};
  if (!header) return result;
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      value = rawValue;
    }
    if (key) result[key] = value;
  });
  return result;
}

export function isSecureRequest(req, config) {
  if (config.secureCookies !== 'auto') return Boolean(config.secureCookies);
  const proto = config.trustProxy
    ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    : req.socket?.encrypted
      ? 'https'
      : 'http';
  return proto === 'https';
}

export function sessionCookie(token, secure, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(secure) {
  return sessionCookie('', secure, 0);
}

export function createSession(db, userId, userAgent, sessionDays = 30) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + sessionDays * 86400000);
  db.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    randomBytes(16).toString('hex'),
    userId,
    sha256(token),
    now.toISOString(),
    expires.toISOString(),
    String(userAgent || '').slice(0, 300)
  );
  return { token, expiresAt: expires.toISOString(), maxAge: sessionDays * 86400 };
}

export function sessionUser(db, req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.created_at, u.consent_research, u.consent_at,
              s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
    )
    .get(sha256(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
    consentResearch: Boolean(row.consent_research),
    consentAt: row.consent_at
  };
}

export function deleteSession(db, req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export class RateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  check(key, limit, windowMs) {
    const now = Date.now();
    const bucket = (this.buckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
    if (bucket.length >= limit) {
      const retryAfter = Math.ceil((windowMs - (now - bucket[0])) / 1000);
      this.buckets.set(key, bucket);
      return { ok: false, retryAfter: Math.max(1, retryAfter) };
    }
    bucket.push(now);
    this.buckets.set(key, bucket);
    if (this.buckets.size > 10000) {
      for (const [bucketKey, values] of this.buckets) {
        if (!values.some((timestamp) => now - timestamp < windowMs)) {
          this.buckets.delete(bucketKey);
        }
      }
    }
    return { ok: true };
  }
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt || user.created_at,
    consentResearch: Boolean(user.consentResearch ?? user.consent_research),
    consentAt: user.consentAt || user.consent_at || null
  };
}
