const TARGET_LABELS = {
  landing: 'Главная',
  app: 'Приложение',
  windows: 'Windows',
  'macos-linux': 'macOS / Linux',
  android: 'Android',
  ios: 'iPhone / iPad',
  pwa: 'PWA'
};

const TYPE_LABELS = {
  view: 'Просмотр',
  download: 'Скачивание',
  install: 'PWA-установка'
};

const numberFormat = new Intl.NumberFormat('ru-RU');

function formatNumber(value) {
  return numberFormat.format(Number(value) || 0);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function targetLabel(target) {
  return TARGET_LABELS[target] || target;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `Ошибка ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

const loginView = document.getElementById('loginView');
const dashboard = document.getElementById('dashboard');
const logoutButton = document.getElementById('logoutBtn');
const statusLabel = document.getElementById('adminStatus');
const loginForm = document.getElementById('adminLoginForm');
const loginError = document.getElementById('loginError');
const loginHint = document.getElementById('loginHint');
const loginSubmit = document.getElementById('loginSubmit');
const dashboardError = document.getElementById('dashboardError');
const refreshButton = document.getElementById('refreshBtn');

function setLoginError(message) {
  if (!loginError) return;
  loginError.textContent = message || '';
  loginError.classList.toggle('is-visible', Boolean(message));
}

function setDashboardError(message) {
  if (!dashboardError) return;
  dashboardError.textContent = message || '';
  dashboardError.classList.toggle('hidden', !message);
}

function showLogin({ configured = true, message = '' } = {}) {
  loginView.classList.remove('hidden');
  dashboard.classList.add('hidden');
  logoutButton.classList.add('hidden');
  statusLabel.textContent = configured ? 'Доступ закрыт' : 'ADMIN_TOKEN не задан';
  loginSubmit.disabled = !configured;
  if (!configured) {
    loginHint.innerHTML =
      'Админка не настроена. Задайте переменную окружения <code>ADMIN_TOKEN</code> (не короче 12 символов) и перезапустите сервер.';
  }
  setLoginError(message);
}

function showDashboard() {
  loginView.classList.add('hidden');
  dashboard.classList.remove('hidden');
  logoutButton.classList.remove('hidden');
  statusLabel.textContent = 'Доступ разрешён';
  setLoginError('');
}

function periodHtml(period) {
  return `
    <div class="period-row"><span>Просмотры</span><b>${formatNumber(period.views)}</b></div>
    <div class="period-row"><span>Скачивания</span><b>${formatNumber(period.downloads)}</b></div>
    <div class="period-row"><span>PWA-установки</span><b>${formatNumber(period.installs)}</b></div>
  `;
}

function tableRows(rows) {
  if (!rows.length) {
    return '<tr><td colspan="2" class="admin-empty-cell">Пока нет данных</td></tr>';
  }
  return rows
    .map(
      (row) => `<tr>
        <td><span class="target-name">${row.label}</span></td>
        <td>${formatNumber(row.value)}</td>
      </tr>`
    )
    .join('');
}

function buildChart(daily) {
  const compact = window.innerWidth < 700;
  const width = compact ? 480 : 920;
  const height = compact ? 220 : 280;
  const pad = {
    left: compact ? 34 : 44,
    right: 12,
    top: 16,
    bottom: compact ? 30 : 36
  };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(
    1,
    ...daily.map((day) => Math.max(day.views, day.downloads))
  );
  const y = (value) => pad.top + plotHeight - (value / maxValue) * plotHeight;
  const groupWidth = plotWidth / Math.max(1, daily.length);
  const barWidth = Math.max(3, Math.min(10, groupWidth * 0.3));
  const gridValues = [0, 0.5, 1].map((ratio) => Math.round(maxValue * ratio));

  const grid = gridValues
    .map(
      (value) =>
        `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}" />
         <text class="chart-axis-text" x="${pad.left - 9}" y="${y(value) + 3}" text-anchor="end">${formatNumber(value)}</text>`
    )
    .join('');

  const bars = daily
    .map((day, index) => {
      const center = pad.left + groupWidth * (index + 0.5);
      const viewHeight = plotHeight - (y(day.views) - pad.top);
      const downloadHeight = plotHeight - (y(day.downloads) - pad.top);
      const label =
        index % 5 === 0 || index === daily.length - 1
          ? `<text class="chart-axis-text" x="${center}" y="${height - 14}" text-anchor="middle">${day.day.slice(5).replace('-', '.')}</text>`
          : '';
      return `<g>
        <rect class="chart-bar-views" x="${center - barWidth - 1}" y="${y(day.views)}" width="${barWidth}" height="${Math.max(0, viewHeight)}" rx="2">
          <title>${day.day}: просмотры ${formatNumber(day.views)}</title>
        </rect>
        <rect class="chart-bar-downloads" x="${center + 1}" y="${y(day.downloads)}" width="${barWidth}" height="${Math.max(0, downloadHeight)}" rx="2">
          <title>${day.day}: скачивания ${formatNumber(day.downloads)}</title>
        </rect>
        ${label}
      </g>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Просмотры и скачивания за 30 дней">
    ${grid}
    ${bars}
  </svg>`;
}

function renderStats(stats) {
  setDashboardError('');
  document.getElementById('totalViews').textContent = formatNumber(stats.totals.views);
  document.getElementById('totalDownloads').textContent = formatNumber(stats.totals.downloads);
  document.getElementById('totalInstalls').textContent = formatNumber(stats.totals.installs);
  document.getElementById('todayViews').textContent = formatNumber(stats.today.views);
  document.getElementById('generatedAt').textContent =
    `Обновлено ${formatDateTime(stats.generatedAt)} · последнее событие ${formatDateTime(stats.lastEventAt)}`;

  document.getElementById('periodToday').innerHTML = periodHtml(stats.today);
  document.getElementById('period7').innerHTML = periodHtml(stats.last7);
  document.getElementById('period30').innerHTML = periodHtml(stats.last30);
  document.getElementById('periodAll').innerHTML = periodHtml(stats.totals);

  const byTarget = new Map(stats.byTarget.map((row) => [`${row.type}:${row.target}`, row.count]));
  const viewCount = (target) => byTarget.get(`view:${target}`) || 0;
  const downloadCount = (target) => byTarget.get(`download:${target}`) || 0;

  document.getElementById('pagesTable').innerHTML = tableRows([
    { label: 'Главная', value: viewCount('landing') },
    { label: 'Приложение', value: viewCount('app') }
  ]);

  document.getElementById('downloadsTable').innerHTML = tableRows([
    { label: 'Windows', value: downloadCount('windows') },
    { label: 'macOS / Linux', value: downloadCount('macos-linux') },
    { label: 'Android', value: downloadCount('android') },
    { label: 'iPhone / iPad', value: downloadCount('ios') },
    { label: 'PWA', value: downloadCount('pwa') }
  ]);

  const allRows = stats.byTarget.map((row) => ({
    label: `${targetLabel(row.target)} <span class="target-type">${TYPE_LABELS[row.type] || row.type}</span>`,
    value: row.count
  }));
  document.getElementById('allMetricsTable').innerHTML = allRows.length
    ? allRows
        .map(
          (row) => `<tr><td>${row.label}</td><td>${formatNumber(row.value)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="2" class="admin-empty-cell">Пока нет событий</td></tr>';

  const chart = document.getElementById('adminChart');
  const hasData = stats.daily.some((day) => day.views || day.downloads);
  chart.innerHTML = hasData
    ? buildChart(stats.daily)
    : '<div class="admin-chart-empty">Пока нет просмотров и скачиваний за последние 30 дней.</div>';
}

async function loadStats() {
  refreshButton.disabled = true;
  refreshButton.textContent = 'Загрузка…';
  try {
    const stats = await request('/api/admin/stats');
    renderStats(stats);
    showDashboard();
  } catch (error) {
    if (error.status === 401) {
      showLogin({ configured: true, message: 'Сессия админки истекла. Введите токен снова.' });
    } else {
      setDashboardError(error.message || 'Не удалось загрузить статистику.');
    }
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = 'Обновить';
  }
}

async function openDashboard() {
  showDashboard();
  await loadStats();
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoginError('');
  const token = document.getElementById('adminToken').value;
  if (!token) {
    setLoginError('Введите ADMIN_TOKEN.');
    return;
  }
  loginSubmit.disabled = true;
  loginSubmit.textContent = 'Проверяем…';
  try {
    await request('/api/admin/login', { method: 'POST', body: { token } });
    document.getElementById('adminToken').value = '';
    await openDashboard();
  } catch (error) {
    setLoginError(error.message || 'Не удалось войти.');
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Открыть статистику';
  }
});

refreshButton?.addEventListener('click', loadStats);

logoutButton?.addEventListener('click', async () => {
  try {
    await request('/api/admin/logout', { method: 'POST' });
  } catch {
    // cookie всё равно очищаем на клиенте через показ формы
  }
  showLogin({ configured: true });
});

async function init() {
  try {
    const session = await request('/api/admin/session');
    if (!session.configured) {
      showLogin({ configured: false });
      return;
    }
    if (session.authenticated) {
      await openDashboard();
    } else {
      showLogin({ configured: true });
    }
  } catch {
    showLogin({ configured: true, message: 'Сервер недоступен.' });
  }
}

init();
