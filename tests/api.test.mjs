import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../server/index.mjs';
import { loadConfig } from '../server/config.mjs';
import { generateDemoState } from '../shared/demo.mjs';
import { CATEGORIES } from '../shared/constants.mjs';

let app;
let base;
let tempDir;

async function request(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;
  const response = await fetch(`${base}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // HTML или пустой ответ
  }
  const setCookie = response.headers.getSetCookie?.() || [];
  return {
    status: response.status,
    headers: response.headers,
    text,
    json,
    cookie: setCookie.length ? setCookie[0].split(';')[0] : null
  };
}

async function register(email, { consent = false, name = 'Тест' } = {}) {
  return request('/api/auth/register', {
    method: 'POST',
    body: {
      email,
      password: 'password123',
      name,
      acceptTerms: true,
      consentResearch: consent
    }
  });
}

function demoState(days, seed = 1) {
  const state = generateDemoState({ days, seed });
  state.settings.researchConsent = true;
  return state;
}

test.before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'knowtomorrow-test-'));
  const config = {
    ...loadConfig({}),
    dataDir: tempDir,
    host: '127.0.0.1',
    port: 0,
    secureCookies: false,
    trustProxy: false,
    appOrigin: '',
    minPriorUsers: 3,
    rateLimits: { auth: 100, write: 200, windowMs: 60_000 }
  };
  app = createApp(config);
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  if (app) await app.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

test('Healthcheck отвечает и не требует авторизации', async () => {
  const response = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.service, 'knowtomorrow');
});

test('Регистрация: валидация email, пароля и условий', async () => {
  const badEmail = await register('not-an-email');
  assert.equal(badEmail.status, 400);

  const badPassword = await request('/api/auth/register', {
    method: 'POST',
    body: { email: 'a@example.com', password: '123', acceptTerms: true }
  });
  assert.equal(badPassword.status, 400);

  const noTerms = await request('/api/auth/register', {
    method: 'POST',
    body: { email: 'b@example.com', password: 'password123' }
  });
  assert.equal(noTerms.status, 400);
});

test('Регистрация, сессия, повторная регистрация и выход', async () => {
  const created = await register('user1@example.com', { consent: true, name: '  Иван  ' });
  assert.equal(created.status, 201);
  assert.equal(created.json.user.email, 'user1@example.com');
  assert.equal(created.json.user.name, 'Иван');
  assert.equal(created.json.user.consentResearch, true);
  assert.ok(created.cookie?.startsWith('kt_session='));

  const me = await request('/api/auth/me', { cookie: created.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, 'user1@example.com');

  const duplicate = await register('USER1@example.com');
  assert.equal(duplicate.status, 409);

  const logout = await request('/api/auth/logout', {
    method: 'POST',
    cookie: created.cookie
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);

  const afterLogout = await request('/api/auth/me', { cookie: created.cookie });
  assert.equal(afterLogout.json.user, null);
});

test('Вход: неверный пароль и успешный вход', async () => {
  await register('login@example.com');
  const wrong = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'login@example.com', password: 'wrong-password' }
  });
  assert.equal(wrong.status, 401);
  assert.doesNotMatch(wrong.json.error, /не существует|нет аккаунта/i);

  const ok = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'LOGIN@example.com', password: 'password123' }
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.cookie);
});

test('Состояние: сохранение, версии и конфликт', async () => {
  const account = await register('state@example.com');
  const empty = await request('/api/state', { cookie: account.cookie });
  assert.equal(empty.status, 200);
  assert.equal(empty.json.state, null);
  assert.equal(empty.json.version, 0);

  const state = demoState(30, 2);
  state.settings.researchConsent = false;
  const saved = await request('/api/state', {
    method: 'PUT',
    cookie: account.cookie,
    body: { state, version: 0 }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.version, 1);

  const loaded = await request('/api/state', { cookie: account.cookie });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.json.version, 1);
  assert.equal(loaded.json.state.entries.length, 30);

  const updated = await request('/api/state', {
    method: 'PUT',
    cookie: account.cookie,
    body: { state, version: 1 }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.version, 2);

  const conflict = await request('/api/state', {
    method: 'PUT',
    cookie: account.cookie,
    body: { state, version: 1 }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.code, 'conflict');
  assert.equal(conflict.json.version, 2);
  assert.ok(conflict.json.state);
});

test('Состояние: мусорные данные отклоняются', async () => {
  const account = await register('badstate@example.com');
  const saved = await request('/api/state', {
    method: 'PUT',
    cookie: account.cookie,
    body: {
      version: 0,
      state: { entries: [{ date: '2026-01-01', ratings: { wellbeing: 99 } }] }
    }
  });
  assert.equal(saved.status, 400);
});

test('Приоры: недоступны на малой выборке, затем агрегируются анонимно', async () => {
  const initial = await request('/api/priors');
  assert.equal(initial.status, 200);
  assert.equal(initial.json.available, false);
  assert.ok(initial.json.minUsers >= 3);

  const accounts = [];
  for (let index = 0; index < 4; index++) {
    const account = await register(`prior${index}@example.com`, { consent: true });
    assert.equal(account.status, 201);
    const state = demoState(24, 100 + index);
    state.settings.researchConsent = true;
    const saved = await request('/api/state', {
      method: 'PUT',
      cookie: account.cookie,
      body: { state, version: 0 }
    });
    assert.equal(saved.status, 200);
    accounts.push(account);
  }

  const priors = await request('/api/priors');
  assert.equal(priors.status, 200);
  assert.equal(priors.json.available, true);
  assert.ok(priors.json.users >= 3);
  for (const cat of CATEGORIES) {
    assert.ok(Number.isFinite(priors.json.categories[cat].mean));
    assert.ok(priors.json.categories[cat].mean >= 1 && priors.json.categories[cat].mean <= 10);
  }
  assert.ok(priors.json.overall.mean >= 1 && priors.json.overall.mean <= 10);
  const serialized = JSON.stringify(priors.json);
  assert.equal(serialized.includes('"ratings"'), false);
  assert.equal(serialized.includes('"entries":['), false);
});

test('Статистика, экспорт и управление согласием', async () => {
  const account = await register('stats@example.com', { consent: true });
  const state = demoState(10, 7);
  state.settings.researchConsent = true;
  await request('/api/state', {
    method: 'PUT',
    cookie: account.cookie,
    body: { state, version: 0 }
  });

  const stats = await request('/api/stats');
  assert.equal(stats.status, 200);
  assert.ok(stats.json.users >= 5);
  assert.ok(stats.json.entries >= 10);

  const exported = await request('/api/account/export', { cookie: account.cookie });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  assert.equal(exported.json.state.entries.length, 20);

  const patched = await request('/api/account', {
    method: 'PATCH',
    cookie: account.cookie,
    body: { name: 'Новое имя', consentResearch: false }
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.user.name, 'Новое имя');
  assert.equal(patched.json.user.consentResearch, false);
});

test('Запрос с чужого Origin отклоняется', async () => {
  const response = await request('/api/auth/login', {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: { email: 'login@example.com', password: 'password123' }
  });
  assert.equal(response.status, 403);
});

test('Удаление аккаунта требует пароль и удаляет сессию', async () => {
  const account = await register('delete@example.com');
  const wrong = await request('/api/account/delete', {
    method: 'POST',
    cookie: account.cookie,
    body: { password: 'nope' }
  });
  assert.equal(wrong.status, 403);

  const deleted = await request('/api/account/delete', {
    method: 'POST',
    cookie: account.cookie,
    body: { password: 'password123' }
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.json.ok, true);

  const after = await request('/api/auth/me', { cookie: account.cookie });
  assert.equal(after.json.user, null);
});

test('Защита от обхода каталога и раздача shared-модулей', async () => {
  const traversal = await request('/..%2fpackage.json');
  assert.equal(traversal.status, 404);
  const shared = await request('/shared/analytics.mjs');
  assert.equal(shared.status, 200);
  assert.match(shared.headers.get('content-type'), /javascript/);
});

test('Заголовки безопасности выставлены', async () => {
  const response = await request('/api/health');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});
