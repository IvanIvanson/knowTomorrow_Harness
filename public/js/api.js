/** Минимальный клиент REST API KnowTomorrow. */

export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError('Нет соединения с сервером', 0);
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (!response.ok) {
    const message =
      (payload && payload.error) ||
      (response.status === 401
        ? 'Требуется вход в аккаунт'
        : response.status === 429
          ? 'Слишком много попыток. Попробуйте позже.'
          : 'Ошибка запроса');
    throw new ApiError(message, response.status, payload);
  }
  return payload;
}

export const api = {
  request,
  me: () => request('/api/auth/me'),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  register: ({ name, email, password, acceptTerms, consentResearch }) =>
    request('/api/auth/register', {
      method: 'POST',
      body: { name, email, password, acceptTerms, consentResearch }
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  getState: () => request('/api/state'),
  putState: (state, version) => request('/api/state', { method: 'PUT', body: { state, version } }),
  priors: () => request('/api/priors'),
  stats: () => request('/api/stats'),
  patchAccount: (patch) => request('/api/account', { method: 'PATCH', body: patch }),
  deleteAccount: (password) =>
    request('/api/account/delete', { method: 'POST', body: { password } }),
  exportUrl: '/api/account/export'
};
