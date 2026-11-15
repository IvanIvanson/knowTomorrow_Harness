import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { isSecureRequest, parseCookies } from './auth.mjs';

export const ADMIN_COOKIE = 'kt_admin';
const SESSION_LABEL = 'knowtomorrow-admin-session-v1';

function safeHashEqual(left, right) {
  const a = createHash('sha256').update(String(left)).digest();
  const b = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(a, b);
}

export function adminConfigured(config) {
  return typeof config.adminToken === 'string' && config.adminToken.length >= 12;
}

export function verifyAdminToken(provided, config) {
  if (!adminConfigured(config) || typeof provided !== 'string') return false;
  return safeHashEqual(provided, config.adminToken);
}

function adminSessionValue(config) {
  return createHmac('sha256', config.adminToken).update(SESSION_LABEL).digest('hex');
}

export function isAdmin(req, config) {
  if (!adminConfigured(config)) return false;
  const value = parseCookies(req.headers.cookie)[ADMIN_COOKIE];
  if (!value) return false;
  return safeHashEqual(value, adminSessionValue(config));
}

export function adminCookie(config, secure, maxAgeSeconds) {
  const parts = [
    `${ADMIN_COOKIE}=${encodeURIComponent(adminSessionValue(config))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearAdminCookie(secure) {
  const parts = [`${ADMIN_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function setAdminCookie(res, req, config) {
  res.setHeader(
    'Set-Cookie',
    adminCookie(
      config,
      isSecureRequest(req, config),
      Math.max(1, config.adminSessionHours) * 3600
    )
  );
}
