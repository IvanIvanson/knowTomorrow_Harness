import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const SHARED_DIR = path.join(ROOT, 'shared');

function asBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function loadConfig(env = process.env) {
  const secureSetting = String(env.COOKIE_SECURE || 'auto').toLowerCase();
  return {
    root: ROOT,
    publicDir: PUBLIC_DIR,
    sharedDir: SHARED_DIR,
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(ROOT, 'data'),
    host: env.HOST || '0.0.0.0',
    port: Number(env.PORT) || 8080,
    sessionDays: Number(env.SESSION_DAYS) || 30,
    secureCookies: secureSetting === 'auto' ? 'auto' : asBool(secureSetting, true),
    trustProxy: asBool(env.TRUST_PROXY, false),
    appOrigin: env.APP_ORIGIN || '',
    minPriorUsers: Number(env.MIN_PRIOR_USERS) || 5,
    maxBodyBytes: Number(env.MAX_BODY_BYTES) || 2 * 1024 * 1024,
    adminToken: String(env.ADMIN_TOKEN || '').trim(),
    adminSessionHours: Number(env.ADMIN_SESSION_HOURS) || 12,
    rateLimits: {
      auth: Number(env.AUTH_RATE_LIMIT) || 12,
      write: Number(env.WRITE_RATE_LIMIT) || 120,
      metrics: Number(env.METRICS_RATE_LIMIT) || 300,
      adminLogin: Number(env.ADMIN_LOGIN_RATE_LIMIT) || 8,
      windowMs: 15 * 60 * 1000
    }
  };
}
