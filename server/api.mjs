import { randomUUID } from 'node:crypto';

import { validateStateInput } from '../shared/app-model.mjs';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  hashPassword,
  isSecureRequest,
  isValidEmail,
  normalizeEmail,
  passwordProblem,
  publicUser,
  sessionCookie,
  sessionUser,
  verifyPassword
} from './auth.mjs';
import { recordEvent } from './db.mjs';
import {
  HttpError,
  clientIp,
  isSameOrigin,
  readJson,
  sendJson
} from './http-utils.mjs';
import { loadPriors } from './priors.mjs';

function rateLimit(limiter, key, limit, windowMs) {
  const result = limiter.check(key, limit, windowMs);
  if (!result.ok) {
    throw new HttpError(429, `Слишком много попыток. Повторите через ${result.retryAfter} с.`);
  }
}

function requireUser(db, req) {
  const user = sessionUser(db, req);
  if (!user) throw new HttpError(401, 'Требуется вход в аккаунт');
  return user;
}

function sanitizeName(name, email) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (!clean) return email.split('@')[0].slice(0, 60);
  if (clean.length > 60) throw new HttpError(400, 'Имя слишком длинное');
  return clean;
}

function stateRow(db, userId) {
  return db
    .prepare('SELECT json, version, updated_at, entry_count FROM states WHERE user_id = ?')
    .get(userId);
}

/**
 * REST API. Возвращает функцию-обработчик; true — запрос обработан.
 */
export function createApi({ db, config, limiter }) {
  let priorsCache = null;
  let priorsAt = 0;

  function cachedPriors() {
    const now = Date.now();
    if (!priorsCache || now - priorsAt > 5 * 60 * 1000) {
      priorsCache = loadPriors(db, config);
      priorsAt = now;
    }
    return priorsCache;
  }

  async function route(req, res, url) {
    const path = url.pathname;
    const method = req.method;
    const session = sessionUser(db, req);

    if (path === '/api/health' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        service: 'knowtomorrow',
        version: '2.0.1',
        time: new Date().toISOString()
      });
      return;
    }

    if (path === '/api/auth/register' && method === 'POST') {
      rateLimit(limiter, `register:${clientIp(req, config)}`, config.rateLimits.auth, config.rateLimits.windowMs);
      const body = await readJson(req, config.maxBodyBytes);
      if (body.acceptTerms !== true) {
        throw new HttpError(400, 'Нужно принять условия использования и политику конфиденциальности');
      }
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) throw new HttpError(400, 'Некорректный email');
      const problem = passwordProblem(body.password);
      if (problem) throw new HttpError(400, problem);
      const name = sanitizeName(body.name, email);
      const consentResearch = body.consentResearch === true;

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) throw new HttpError(409, 'Аккаунт с таким email уже существует');

      const { hash, salt } = await hashPassword(body.password);
      const id = randomUUID();
      const now = new Date().toISOString();
      try {
        db.prepare(
          `INSERT INTO users (id, email, name, pass_hash, pass_salt, created_at, consent_research, consent_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, email, name, hash, salt, now, consentResearch ? 1 : 0, consentResearch ? now : null);
      } catch (error) {
        if (String(error.message).includes('UNIQUE')) {
          throw new HttpError(409, 'Аккаунт с таким email уже существует');
        }
        throw error;
      }

      const user = {
        id,
        email,
        name,
        createdAt: now,
        consentResearch,
        consentAt: consentResearch ? now : null
      };
      const sessionInfo = createSession(db, id, req.headers['user-agent'], config.sessionDays);
      res.setHeader(
        'Set-Cookie',
        sessionCookie(
          sessionInfo.token,
          isSecureRequest(req, config),
          sessionInfo.maxAge
        )
      );
      recordEvent(db, 'register', { consentResearch });
      sendJson(res, 201, { user: publicUser(user) });
      return;
    }

    if (path === '/api/auth/login' && method === 'POST') {
      rateLimit(limiter, `login:${clientIp(req, config)}`, config.rateLimits.auth, config.rateLimits.windowMs);
      const body = await readJson(req, config.maxBodyBytes);
      const email = normalizeEmail(body.email);
      rateLimit(limiter, `login-email:${email}`, config.rateLimits.auth, config.rateLimits.windowMs);
      if (!isValidEmail(email) || typeof body.password !== 'string') {
        throw new HttpError(401, 'Неверный email или пароль');
      }
      const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!row) {
        // Выравниваем время ответа, чтобы не подсказывать, существует ли аккаунт.
        await hashPassword(body.password);
        throw new HttpError(401, 'Неверный email или пароль');
      }
      const ok = await verifyPassword(body.password, row.pass_hash, row.pass_salt);
      if (!ok) {
        recordEvent(db, 'login_failed');
        throw new HttpError(401, 'Неверный email или пароль');
      }
      const sessionInfo = createSession(db, row.id, req.headers['user-agent'], config.sessionDays);
      res.setHeader(
        'Set-Cookie',
        sessionCookie(sessionInfo.token, isSecureRequest(req, config), sessionInfo.maxAge)
      );
      recordEvent(db, 'login');
      sendJson(res, 200, {
        user: publicUser({
          id: row.id,
          email: row.email,
          name: row.name,
          createdAt: row.created_at,
          consentResearch: row.consent_research,
          consentAt: row.consent_at
        })
      });
      return;
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      if (session) deleteSession(db, req);
      res.setHeader('Set-Cookie', clearSessionCookie(isSecureRequest(req, config)));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (path === '/api/auth/me' && method === 'GET') {
      sendJson(res, 200, { user: session ? publicUser(session) : null });
      return;
    }

    if (path === '/api/account' && method === 'PATCH') {
      const user = requireUser(db, req);
      const body = await readJson(req, config.maxBodyBytes);
      let name = user.name;
      if (body.name !== undefined) name = sanitizeName(body.name, user.email);
      let consent = user.consentResearch;
      let consentAt = user.consentAt;
      if (body.consentResearch !== undefined) {
        consent = body.consentResearch === true;
        consentAt = consent ? new Date().toISOString() : null;
      }
      db.prepare(
        'UPDATE users SET name = ?, consent_research = ?, consent_at = ? WHERE id = ?'
      ).run(name, consent ? 1 : 0, consentAt, user.id);
      priorsCache = null;
      sendJson(res, 200, {
        user: publicUser({
          ...user,
          name,
          consentResearch: consent,
          consentAt
        })
      });
      return;
    }

    if (path === '/api/account/delete' && method === 'POST') {
      const user = requireUser(db, req);
      const body = await readJson(req, config.maxBodyBytes);
      const row = db.prepare('SELECT pass_hash, pass_salt FROM users WHERE id = ?').get(user.id);
      const ok = await verifyPassword(body.password || '', row?.pass_hash, row?.pass_salt);
      if (!ok) throw new HttpError(403, 'Неверный пароль');
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      priorsCache = null;
      res.setHeader('Set-Cookie', clearSessionCookie(isSecureRequest(req, config)));
      recordEvent(db, 'account_deleted');
      sendJson(res, 200, { ok: true });
      return;
    }

    if (path === '/api/state' && method === 'GET') {
      const user = requireUser(db, req);
      const row = stateRow(db, user.id);
      if (!row) {
        sendJson(res, 200, { state: null, version: 0, updatedAt: null, entryCount: 0 });
        return;
      }
      sendJson(res, 200, {
        state: JSON.parse(row.json),
        version: row.version,
        updatedAt: row.updated_at,
        entryCount: row.entry_count
      });
      return;
    }

    if (path === '/api/state' && method === 'PUT') {
      const user = requireUser(db, req);
      rateLimit(limiter, `write:${user.id}`, config.rateLimits.write, config.rateLimits.windowMs);
      const body = await readJson(req, config.maxBodyBytes);
      if (body.state === undefined) throw new HttpError(400, 'Не передано состояние');
      const validation = validateStateInput(body.state);
      if (!validation.ok) throw new HttpError(400, validation.error);
      const serialized = JSON.stringify(validation.state);
      if (Buffer.byteLength(serialized) > config.maxBodyBytes) {
        throw new HttpError(413, 'Состояние слишком большое');
      }
      const current = stateRow(db, user.id);
      if (current && body.version !== current.version) {
        sendJson(res, 409, {
          error: 'Конфликт версий: данные были изменены в другом месте',
          code: 'conflict',
          version: current.version,
          updatedAt: current.updated_at,
          state: JSON.parse(current.json)
        });
        return;
      }
      const now = new Date().toISOString();
      const version = current ? current.version + 1 : 1;
      const entryCount = validation.state.entries.length;
      if (current) {
        db.prepare(
          'UPDATE states SET json = ?, version = ?, entry_count = ?, updated_at = ? WHERE user_id = ?'
        ).run(serialized, version, entryCount, now, user.id);
      } else {
        db.prepare(
          'INSERT INTO states (user_id, json, version, entry_count, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).run(user.id, serialized, version, entryCount, now);
      }
      const consent = validation.state.settings.researchConsent;
      db.prepare('UPDATE users SET consent_research = ?, consent_at = ? WHERE id = ?').run(
        consent ? 1 : 0,
        consent ? now : null,
        user.id
      );
      priorsCache = null;
      recordEvent(db, 'state_saved', { entries: entryCount });
      sendJson(res, 200, { version, updatedAt: now, entryCount });
      return;
    }

    if (path === '/api/account/export' && method === 'GET') {
      const user = requireUser(db, req);
      const row = stateRow(db, user.id);
      const payload = {
        app: 'KnowTomorrow',
        exportedAt: new Date().toISOString(),
        user: publicUser(user),
        state: row ? JSON.parse(row.json) : null
      };
      sendJson(res, 200, payload, {
        'Content-Disposition': `attachment; filename="knowtomorrow-export-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      });
      return;
    }

    if (path === '/api/priors' && method === 'GET') {
      sendJson(res, 200, cachedPriors());
      return;
    }

    if (path === '/api/stats' && method === 'GET') {
      const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      const contributors = db
        .prepare('SELECT COUNT(*) AS n FROM users WHERE consent_research = 1')
        .get().n;
      const stateStats = db
        .prepare('SELECT COUNT(*) AS states, COALESCE(SUM(entry_count), 0) AS entries FROM states')
        .get();
      sendJson(res, 200, {
        users,
        contributors,
        states: stateStats.states,
        entries: stateStats.entries,
        generatedAt: new Date().toISOString()
      });
      return;
    }

    throw new HttpError(404, 'Метод API не найден');
  }

  return async function handleApi(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD' && !isSameOrigin(req, config)) {
        throw new HttpError(403, 'Запрос с другого источника отклонён');
      }
      await route(req, res, url);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return true;
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
      } else {
        console.error('[api]', error);
        sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
      }
    }
    return true;
  };
}
