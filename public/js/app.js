import { api, ApiError } from './api.js';
import { CATEGORY_ICON, svgIcon } from './icons.js';
import { intervalBar, lineChart, radarChart, weekdayBars } from './charts.js';
import {
  confidenceBadge,
  confidenceDots,
  debounce,
  detectPlatform,
  downloadFile,
  escapeHtml,
  formatDateRu,
  formatDateShort,
  formatP,
  formatScore,
  isStandalone,
  methodShort,
  pluralRu,
  setButtonLoading,
  toast,
  trendChip,
  weekdayRu
} from './ui.js';
import {
  CATEGORIES,
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  CATEGORY_SHORT,
  CR_THRESHOLD,
  DEFAULT_WEIGHTS,
  PRESETS
} from '/shared/constants.mjs';
import {
  activeCategories,
  computeOverall,
  defaultState,
  entryByDate,
  matrixFromWeights,
  mergeStates,
  normalizeState
} from '/shared/app-model.mjs';
import {
  ahpWeights,
  analyzeState,
  diagnoseAHP,
  forecastAll
} from '/shared/analytics.mjs';
import { addDays, daysBetween, todayKey, WEEKDAY_SHORT } from '/shared/dates.mjs';
import { generateDemoState } from '/shared/demo.mjs';

const STORAGE_KEY = 'knowtomorrow:state:v2';
const VIEW_META = {
  today: { title: 'Сегодня', kicker: 'Дневник' },
  history: { title: 'История', kicker: 'Записи' },
  insights: { title: 'Аналитика', kicker: 'Связи и паттерны' },
  forecast: { title: 'Прогноз', kicker: 'Гипотеза на завтра' },
  weights: { title: 'Веса', kicker: 'Матрица Саати' },
  settings: { title: 'Настройки', kicker: 'Аккаунт и данные' }
};

let state = loadLocalState();
let user = null;
let version = 0;
let dirty = false;
let syncing = false;
let syncTimer = null;
let forecastCache = null;
let analysisCache = null;
let priorsCache;
let selectedDate = todayKey();
let draft = null;
let weightsDraft = null;
let weightsPreview = null;
let currentView = 'today';
let deferredPrompt = null;
let authAttempted = false;

// ---------------------------------------------------------------------------
// Инициализация
// ---------------------------------------------------------------------------

function injectIcons() {
  document.querySelectorAll('[data-icon]').forEach((element) => {
    if (!element.innerHTML.trim()) element.innerHTML = svgIcon(element.dataset.icon);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.innerHTML = svgIcon(theme === 'dark' ? 'sun' : 'moon');
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
  }
  const themeSwitch = document.getElementById('themeSwitch');
  if (themeSwitch) themeSwitch.checked = theme === 'dark';
}

function setSyncStatus(mode, text) {
  const container = document.getElementById('syncStatus');
  const label = document.getElementById('syncText');
  if (!container || !label) return;
  container.classList.remove('is-ok', 'is-saving', 'is-error');
  if (mode === 'ok') container.classList.add('is-ok');
  if (mode === 'saving') container.classList.add('is-saving');
  if (mode === 'error') container.classList.add('is-error');
  label.textContent = text;
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch {
    // повреждённое локальное состояние — начинаем заново
  }

  // Мягкая миграция из предыдущей версии приложения (localStorage ratingHistory).
  try {
    const legacyHistory = JSON.parse(localStorage.getItem('ratingHistory') || 'null');
    if (Array.isArray(legacyHistory) && legacyHistory.length) {
      const legacyWeights = JSON.parse(localStorage.getItem('categoryWeights') || 'null');
      const legacyMatrix = JSON.parse(localStorage.getItem('pairwiseMatrix') || 'null');
      return normalizeState({
        settings: {
          weights: Array.isArray(legacyWeights) && legacyWeights.length === 7 ? legacyWeights : DEFAULT_WEIGHTS,
          matrix: Array.isArray(legacyMatrix) && legacyMatrix.length === 7 ? legacyMatrix : null,
          onboardingDone: true
        },
        entries: legacyHistory
      });
    }
  } catch {
    // ignore
  }
  return defaultState();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast('Не удалось сохранить данные в браузере: закончилось место.', 'error');
  }
}

function invalidateAnalysis() {
  analysisCache = null;
  forecastCache = null;
}

function getAnalysis() {
  if (!analysisCache) analysisCache = analyzeState(state);
  return analysisCache;
}

function saveState({ sync = true } = {}) {
  state = normalizeState(state);
  persist();
  invalidateAnalysis();
  if (sync) scheduleSync();
}

function scheduleSync() {
  if (!user) {
    setSyncStatus('guest', 'Гостевой режим');
    return;
  }
  dirty = true;
  setSyncStatus('saving', 'Сохраняем…');
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => syncNow(), 650);
}

async function syncNow() {
  if (!user || syncing) return;
  syncing = true;
  window.clearTimeout(syncTimer);
  setSyncStatus('saving', 'Сохраняем…');
  try {
    const result = await api.putState(state, version);
    version = result.version;
    dirty = false;
    setSyncStatus('ok', 'Синхронизировано');
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.data?.state) {
      const hadLocal = state.entries.length;
      state = mergeStates(state, error.data.state);
      version = error.data.version;
      persist();
      try {
        const result = await api.putState(state, version);
        version = result.version;
        dirty = false;
        setSyncStatus('ok', 'Синхронизировано');
        renderAll();
        if (hadLocal) toast('Записи из другого устройства объединены.', 'success');
      } catch {
        setSyncStatus('error', 'Конфликт версий');
      }
    } else if (error instanceof ApiError && error.status === 401) {
      user = null;
      setSyncStatus('guest', 'Сессия истекла');
      renderAccountChrome();
      toast('Сессия истекла. Войдите снова, данные пока в браузере.', 'error');
    } else {
      dirty = true;
      setSyncStatus(navigator.onLine ? 'error' : 'offline', navigator.onLine ? 'Ошибка синхронизации' : 'Офлайн — локально');
    }
  } finally {
    syncing = false;
  }
}

async function initAuth() {
  if (authAttempted) return;
  authAttempted = true;
  try {
    const me = await api.me();
    if (!me.user) {
      setSyncStatus('guest', 'Гостевой режим');
      return;
    }
    user = me.user;
    state.settings.researchConsent = Boolean(user.consentResearch);
    persist();
    const remote = await api.getState();
    version = remote.version || 0;
    weightsDraft = null;
    const hadLocal = state.entries.length > 0;
    if (remote.state && Array.isArray(remote.state.entries)) {
      state = mergeStates(state, remote.state);
      persist();
      if (hadLocal && remote.state.entries.length) {
        toast('Локальные записи объединены с аккаунтом.', 'success');
      }
    }
    state.settings.researchConsent = Boolean(user.consentResearch);
    persist();
    renderAccountChrome();
    if (state.entries.length && (version === 0 || hadLocal)) {
      await syncNow();
    } else {
      setSyncStatus('ok', 'Синхронизировано');
    }
    renderAll();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      user = null;
      setSyncStatus('guest', 'Гостевой режим');
    } else {
      setSyncStatus('error', 'Сервер недоступен');
    }
  } finally {
    authAttempted = false;
  }
}

// ---------------------------------------------------------------------------
// Навигация
// ---------------------------------------------------------------------------

function navigate(view, { scroll = true } = {}) {
  if (!VIEW_META[view]) view = 'today';
  currentView = view;
  if (window.location.hash !== `#${view}`) {
    history.replaceState(null, '', `#${view}`);
  }
  applyView(view, { scroll });
}

function applyView(view, { scroll = true } = {}) {
  document.querySelectorAll('.view').forEach((section) => {
    const active = section.dataset.view === view;
    section.hidden = !active;
    section.classList.toggle('is-active', active);
  });
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === view);
  });
  const meta = VIEW_META[view] || VIEW_META.today;
  const title = document.getElementById('viewTitle');
  const kicker = document.getElementById('viewKicker');
  if (title) title.textContent = meta.title;
  if (kicker) kicker.textContent = meta.kicker;
  closeSidebar({ restoreFocus: true });

  if (view === 'today') renderToday();
  if (view === 'history') renderHistory();
  if (view === 'insights') renderInsights();
  if (view === 'weights') renderWeights();
  if (view === 'settings') renderSettings();
  if (view === 'forecast') ensureForecast();

  if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
}

function openSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const toggle = document.getElementById('menuToggle');
  sidebar?.classList.add('is-open');
  sidebar?.removeAttribute('aria-hidden');
  if (sidebar) sidebar.inert = false;
  if (backdrop) backdrop.hidden = false;
  document.body.classList.add('sidebar-open');
  toggle?.setAttribute('aria-expanded', 'true');
  window.setTimeout(() => document.getElementById('sidebarClose')?.focus(), 80);
}

function closeSidebar({ restoreFocus = false } = {}) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const toggle = document.getElementById('menuToggle');
  const wasOpen = Boolean(sidebar?.classList.contains('is-open'));
  sidebar?.classList.remove('is-open');
  if (sidebar) {
    const mobile = window.innerWidth <= 1020;
    if (mobile) {
      sidebar.setAttribute('aria-hidden', 'true');
      sidebar.inert = true;
    } else {
      sidebar.removeAttribute('aria-hidden');
      sidebar.inert = false;
    }
  }
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove('sidebar-open');
  toggle?.setAttribute('aria-expanded', 'false');
  if (wasOpen && restoreFocus && window.innerWidth <= 1020) toggle?.focus();
}

// ---------------------------------------------------------------------------
// Общая оболочка
// ---------------------------------------------------------------------------

function renderAll() {
  renderAccountChrome();
  renderSidebarStats();
  renderToday();
  renderHistory();
  renderInsights();
  renderWeights();
  renderSettings();
  if (currentView === 'forecast') ensureForecast(true);
}

function initial(value) {
  const text = String(value || 'Г').trim();
  return text ? text[0].toUpperCase() : 'Г';
}

function renderAccountChrome() {
  const name = user?.name || 'Гость';
  const email = user?.email || 'данные в браузере';
  ['accountAvatar', 'topbarAvatar'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.textContent = initial(name);
  });
  const accountName = document.getElementById('accountName');
  const accountEmail = document.getElementById('accountEmail');
  const topbarName = document.getElementById('topbarName');
  if (accountName) accountName.textContent = name;
  if (accountEmail) accountEmail.textContent = email;
  if (topbarName) topbarName.textContent = user ? name : 'Гость';
  const action = document.getElementById('accountAction');
  if (action) action.textContent = user ? 'Настройки аккаунта' : 'Войти в аккаунт';
  const topbarLogin = document.getElementById('topbarLogin');
  if (topbarLogin) topbarLogin.classList.add('hidden');
  if (!user) setSyncStatus('guest', 'Гостевой режим');
}

function renderSidebarStats() {
  const count = document.getElementById('navHistoryCount');
  if (count) count.textContent = String(state.entries.length);
  const badge = document.getElementById('navForecastBadge');
  if (badge) badge.textContent = state.entries.length >= 3 ? 'гипотеза' : 'мало данных';
  const date = document.getElementById('sidebarDate');
  const weekday = document.getElementById('sidebarWeekday');
  if (date) {
    date.textContent = new Date(`${todayKey()}T12:00:00`).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long'
    });
  }
  if (weekday) weekday.textContent = weekdayRu(todayKey());
}

// ---------------------------------------------------------------------------
// Сегодня
// ---------------------------------------------------------------------------

function categoryWeight(cat) {
  const active = activeCategories(state);
  const total = active.reduce((acc, item) => {
    const index = CATEGORIES.indexOf(item);
    const value = Number(state.settings.weights[index]);
    return acc + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const index = CATEGORIES.indexOf(cat);
  const weight = Number(state.settings.weights[index]);
  if (!Number.isFinite(weight) || weight <= 0 || total <= 0) return 0;
  return weight / total;
}

function renderToday() {
  const dateInput = document.getElementById('ratingDate');
  if (!dateInput) return;
  const today = todayKey();
  if (!selectedDate) selectedDate = today;
  if (selectedDate > today) selectedDate = today;
  dateInput.value = selectedDate;
  dateInput.max = today;

  const entry = entryByDate(state, selectedDate);
  const active = activeCategories(state);
  const defaultRating = 6;
  draft = {
    date: selectedDate,
    ratings: Object.fromEntries(
      CATEGORIES.map((cat) => [
        cat,
        entry
          ? entry.ratings?.[cat] ?? null
          : active.includes(cat)
            ? defaultRating
            : null
      ])
    ),
    note: entry?.note || ''
  };

  const meta = document.getElementById('ratingDateMeta');
  if (meta) {
    const relative = daysBetween(selectedDate, today);
    const relativeText =
      relative === 0 ? 'сегодня' : relative === 1 ? 'вчера' : `${relative} дн. назад`;
    meta.textContent = `${weekdayRu(selectedDate)} · ${relativeText}${entry ? ' · запись есть' : ''}`;
  }

  const status = document.getElementById('todayStatus');
  if (status) {
    status.textContent = entry ? 'отмечено' : 'не отмечено';
    status.className = `badge ${entry ? 'badge--green' : ''}`;
  }

  const rows = document.getElementById('ratingRows');
  if (rows) {
    rows.innerHTML = CATEGORIES.map((cat) => {
      const enabled = active.includes(cat);
      const value = draft.ratings[cat];
      const skipped = value === null;
      return `<div class="rating-row ${skipped ? 'is-skipped' : ''}" data-cat="${cat}">
        <div class="rating-label">
          <span class="rating-icon">${svgIcon(CATEGORY_ICON[cat])}</span>
          <div class="rating-label-text">
            <strong>${escapeHtml(CATEGORY_LABELS[cat])}</strong>
            <span>${escapeHtml(CATEGORY_HINTS[cat])}</span>
            <span class="rating-weight">вес ${Math.round(categoryWeight(cat) * 100)}%</span>
          </div>
        </div>
        <input type="range" min="1" max="10" step="1" value="${skipped ? defaultRating : value}"
          aria-label="${escapeHtml(CATEGORY_LABELS[cat])}" ${skipped || !enabled ? 'disabled' : ''}>
        <output class="rating-value">${skipped ? '—' : value}</output>
        <button class="skip-btn" type="button" title="${skipped ? 'Вернуть оценку' : 'Не знаю / пропустить'}"
          aria-label="${skipped ? 'Вернуть оценку' : 'Пропустить категорию'}">${skipped ? '↺' : '×'}</button>
      </div>`;
    }).join('');

    rows.querySelectorAll('input[type="range"]').forEach((input) => {
      const cat = input.closest('.rating-row').dataset.cat;
      updateRangeFill(input);
      input.addEventListener('input', () => {
        draft.ratings[cat] = Number(input.value);
        const output = input.closest('.rating-row').querySelector('.rating-value');
        if (output) output.textContent = input.value;
        updateRangeFill(input);
        updateOverallPreview();
      });
    });

    rows.querySelectorAll('.skip-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const row = button.closest('.rating-row');
        const cat = row.dataset.cat;
        if (draft.ratings[cat] === null) {
          draft.ratings[cat] = defaultRating;
          row.classList.remove('is-skipped');
          row.querySelector('input').disabled = false;
          row.querySelector('input').value = defaultRating;
          row.querySelector('.rating-value').textContent = defaultRating;
          button.textContent = '×';
          updateRangeFill(row.querySelector('input'));
        } else {
          draft.ratings[cat] = null;
          row.classList.add('is-skipped');
          row.querySelector('input').disabled = true;
          row.querySelector('.rating-value').textContent = '—';
          button.textContent = '↺';
        }
        updateOverallPreview();
      });
    });
  }

  const note = document.getElementById('ratingNote');
  if (note) note.value = draft.note;

  const saveButton = document.getElementById('saveRatingBtn');
  if (saveButton) saveButton.textContent = entry ? 'Обновить день' : 'Сохранить день';

  updateOverallPreview();
  renderTodayAside();
}

function updateRangeFill(input) {
  const value = Number(input.value);
  const percent = ((value - 1) / 9) * 100;
  input.style.setProperty('--fill', `${percent}%`);
}

function currentDraftRatings() {
  if (!draft) return {};
  return Object.fromEntries(
    CATEGORIES.map((cat) => {
      const value = draft.ratings[cat];
      return [cat, value === undefined ? null : value];
    })
  );
}

function updateOverallPreview() {
  const ratings = currentDraftRatings();
  const overall = computeOverall(ratings, state.settings.weights, state.settings.enabled);
  const preview = document.getElementById('overallPreview');
  if (preview) preview.textContent = overall === null ? '—' : formatScore(overall);
  const filled = activeCategories(state).filter(
    (cat) => ratings[cat] !== null && ratings[cat] !== undefined
  ).length;
  const hint = document.getElementById('overallHint');
  if (hint) {
    if (filled === 0) {
      hint.textContent = 'Заполните хотя бы одну сферу.';
    } else {
      hint.textContent = `Заполнено ${filled} из ${activeCategories(state).length}. Веса можно изменить в разделе «Веса».`;
    }
  }
}

function renderTodayAside() {
  const analysis = getAnalysis();
  const summary = analysis.summary;
  const streak = summary?.streak ?? 0;
  const streakValue = document.getElementById('streakValue');
  const streakUnit = document.getElementById('streakUnit');
  if (streakValue) streakValue.textContent = String(streak);
  if (streakUnit) {
    streakUnit.textContent = pluralRu(streak, 'день', 'дня', 'дней');
  }
  const streakHint = document.getElementById('streakHint');
  if (streakHint) {
    streakHint.textContent =
      streak === 0
        ? 'Сегодня ещё не отмечено. Начните с одной записи.'
        : streak < 7
          ? `До первой недели наблюдений осталось ${7 - streak} ${pluralRu(7 - streak, 'день', 'дня', 'дней')}.`
          : 'Хорошая серия. Продолжайте — данные становятся устойчивее.';
  }

  const insightText = document.getElementById('todayInsightText');
  if (insightText) {
    const pattern = analysis.patterns?.[0];
    if (pattern) {
      insightText.textContent = pattern.text;
    } else if (state.entries.length === 0) {
      insightText.textContent = 'Добавьте несколько дней, чтобы увидеть связи и прогноз.';
    } else {
      const remaining = Math.max(0, 7 - state.entries.length);
      insightText.textContent = remaining
        ? `Уже ${state.entries.length} ${pluralRu(state.entries.length, 'запись', 'записи', 'записей')}. Ещё ${remaining} — и появятся первые устойчивые связи.`
        : 'Связи пока не достигли порога устойчивости. Продолжайте отмечать дни.';
    }
  }
}

function saveToday(event) {
  event?.preventDefault();
  if (!draft) return;
  const ratings = currentDraftRatings();
  const filled = activeCategories(state).filter(
    (cat) => ratings[cat] !== null && ratings[cat] !== undefined
  );
  if (!filled.length) {
    toast('Поставьте хотя бы одну оценку.', 'error');
    return;
  }
  const note = document.getElementById('ratingNote')?.value.trim() || '';
  const entry = {
    date: selectedDate,
    ratings,
    note,
    updatedAt: new Date().toISOString()
  };
  const index = state.entries.findIndex((item) => item.date === selectedDate);
  if (index >= 0) state.entries[index] = entry;
  else state.entries.push(entry);
  state.entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  state.settings.onboardingDone = true;
  saveState();
  renderToday();
  renderSidebarStats();
  renderHistory();
  if (currentView === 'insights') renderInsights();
  toast(index >= 0 ? 'Запись обновлена.' : 'День сохранён.', 'success');
  if (state.entries.length === 1) {
    window.setTimeout(() => toast('Первый день записан. Через 7–14 записей появится прогноз.', 'info', 5200), 500);
  }
}

async function loadDemo({ replace = false, view = 'today' } = {}) {
  if (state.entries.length && !replace) {
    openConfirm({
      title: 'Загрузить демо-данные?',
      text: 'Текущие записи будут заменены демонстрационным набором из 70 дней. Это удобно, чтобы посмотреть аналитику, но не для реального дневника.',
      confirmText: 'Заменить демо',
      danger: false,
      onConfirm: () => loadDemo({ replace: true })
    });
    return;
  }
  const demo = generateDemoState({ days: 70 });
  demo.settings.theme = state.settings.theme;
  demo.settings.researchConsent = state.settings.researchConsent;
  state = demo;
  weightsDraft = null;
  selectedDate = todayKey();
  saveState();
  renderAll();
  closeModal();
  navigate(view);
  toast('Демо-данные загружены: 70 дней. Это не ваши реальные записи.', 'success', 5000);
}

// ---------------------------------------------------------------------------
// История
// ---------------------------------------------------------------------------

function filteredEntries() {
  const period = document.getElementById('historyPeriod')?.value || 'all';
  if (period === 'all') return [...state.entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  const cutoff = addDays(todayKey(), -Number(period) + 1);
  return state.entries.filter((entry) => entry.date >= cutoff).sort((a, b) => (a.date < b.date ? -1 : 1));
}

function renderHistory() {
  const body = document.getElementById('historyBody');
  if (!body) return;
  const entries = filteredEntries().sort((a, b) => (a.date < b.date ? 1 : -1));
  const empty = document.getElementById('historyEmpty');
  const table = document.querySelector('#view-history .table-scroll');
  if (!entries.length) {
    body.innerHTML = '';
    empty?.classList.remove('hidden');
    if (table) table.classList.add('hidden');
  } else {
    empty?.classList.add('hidden');
    if (table) table.classList.remove('hidden');
    body.innerHTML = entries
      .map((entry) => {
        const overall = computeOverall(entry.ratings, state.settings.weights, state.settings.enabled);
        const cls = overall === null ? 'is-mid' : overall >= 7 ? 'is-good' : overall >= 4 ? 'is-mid' : 'is-low';
        const spheres = CATEGORIES.filter((cat) => Number.isFinite(entry.ratings?.[cat]))
          .map((cat) => {
            const value = entry.ratings[cat];
            return `<span class="mini-sphere s-${value}" title="${escapeHtml(
              CATEGORY_LABELS[cat]
            )}: ${value}">${value}</span>`;
          })
          .join('');
        const note = entry.note
          ? `<span title="${escapeHtml(entry.note)}">${escapeHtml(entry.note.slice(0, 80))}${
              entry.note.length > 80 ? '…' : ''
            }</span>`
          : '<span class="muted">—</span>';
        return `<tr>
          <td class="td-date">${escapeHtml(formatDateShort(entry.date))}<small>${escapeHtml(
            weekdayRu(entry.date)
          )} · ${entry.date}</small></td>
          <td><span class="score-pill ${cls}">${formatScore(overall)}</span></td>
          <td><div class="mini-spheres">${spheres}</div></td>
          <td class="td-note">${note}</td>
          <td>
            <div class="row-actions">
              <button class="row-action" type="button" data-edit="${entry.date}" title="Редактировать" aria-label="Редактировать ${entry.date}">${svgIcon(
                'edit'
              )}</button>
              <button class="row-action is-danger" type="button" data-delete="${entry.date}" title="Удалить" aria-label="Удалить ${entry.date}">${svgIcon(
                'trash'
              )}</button>
            </div>
          </td>
        </tr>`;
      })
      .join('');
  }

  renderHistoryChart();
}

function renderHistoryChart() {
  const container = document.getElementById('historyChart');
  if (!container) return;
  const selected = document.getElementById('chartSelect')?.value || 'overall';
  const all = [...state.entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  const entries = all.length > 90 ? all.slice(-90) : all;
  const title = document.getElementById('chartTitle');
  if (title) title.textContent = selected === 'overall' ? 'Общая оценка' : CATEGORY_LABELS[selected];
  const labels = entries.map((entry) => formatDateShort(entry.date));
  const values = entries.map((entry) =>
    selected === 'overall'
      ? computeOverall(entry.ratings, state.settings.weights, state.settings.enabled)
      : entry.ratings?.[selected] ?? null
  );
  lineChart(container, { labels, values, label: CATEGORY_LABELS[selected] });
}

function exportJson() {
  const payload = {
    app: 'KnowTomorrow',
    version: 2,
    exportedAt: new Date().toISOString(),
    state
  };
  downloadFile(
    `knowtomorrow-${todayKey()}.json`,
    JSON.stringify(payload, null, 2),
    'application/json'
  );
  toast('Экспорт JSON готов.', 'success');
}

function exportCsv() {
  const header = ['date', 'overall', ...CATEGORIES, 'note'];
  const rows = [...state.entries]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((entry) => {
      const overall = computeOverall(entry.ratings, state.settings.weights, state.settings.enabled);
      return [
        entry.date,
        overall ?? '',
        ...CATEGORIES.map((cat) => entry.ratings?.[cat] ?? ''),
        entry.note || ''
      ];
    });
  const csv = [header, ...rows]
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? '');
          return /[";\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(';')
    )
    .join('\r\n');
  downloadFile(`knowtomorrow-${todayKey()}.csv`, `\uFEFF${csv}`, 'text/csv');
  toast('CSV готов. Разделитель — точка с запятой.', 'success');
}

function parseImport(payload) {
  if (!payload) return null;
  const raw =
    payload.state && typeof payload.state === 'object'
      ? payload.state
      : payload.ratingHistory
        ? { entries: payload.ratingHistory }
        : payload;
  if (!raw || !Array.isArray(raw.entries)) return null;
  return normalizeState(raw);
}

async function importFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const imported = parseImport(JSON.parse(text));
    if (!imported) {
      toast('В файле не найден дневник KnowTomorrow.', 'error');
      return;
    }
    const before = state.entries.length;
    state = mergeStates(state, imported);
    state.settings.onboardingDone = true;
    weightsDraft = null;
    saveState();
    renderAll();
    toast(`Импорт завершён: ${before} → ${state.entries.length} записей.`, 'success');
  } catch {
    toast('Не удалось прочитать JSON. Проверьте файл.', 'error');
  }
}

function openRatingEditor(date) {
  const entry = entryByDate(state, date);
  const today = todayKey();
  const values = Object.fromEntries(
    CATEGORIES.map((cat) => [cat, entry?.ratings?.[cat] ?? null])
  );
  const rows = CATEGORIES.map((cat) => {
    const value = values[cat] ?? 6;
    return `<div class="rating-row" data-modal-cat="${cat}">
      <div class="rating-label">
        <span class="rating-icon">${svgIcon(CATEGORY_ICON[cat])}</span>
        <div class="rating-label-text"><strong>${escapeHtml(CATEGORY_LABELS[cat])}</strong></div>
      </div>
      <input type="range" min="1" max="10" step="1" value="${value}" aria-label="${escapeHtml(
        CATEGORY_LABELS[cat]
      )}">
      <output class="rating-value">${values[cat] === null ? '—' : value}</output>
    </div>`;
  }).join('');

  const body = `
    <div class="field">
      <label for="modalDate">Дата</label>
      <input type="date" id="modalDate" value="${date}" max="${today}" required>
    </div>
    <div class="modal-rating-rows" id="modalRatingRows">${rows}</div>
    <div class="field">
      <label for="modalNote">Заметка</label>
      <textarea id="modalNote" maxlength="500" rows="2">${escapeHtml(entry?.note || '')}</textarea>
    </div>
    <p class="stat-note">Если оценка не нужна — оставьте значение и нажмите «Сохранить». Пропуск категории доступен в основной форме.</p>
  `;
  openModal({
    title: entry ? 'Редактировать день' : 'Добавить пропущенный день',
    kicker: 'Дневник',
    body,
    actions: [
      { label: 'Отмена', className: 'btn btn-ghost', onClick: closeModal },
      {
        label: 'Сохранить',
        className: 'btn btn-primary',
        id: 'modalSaveRating',
        onClick: () => {
          const modalDate = document.getElementById('modalDate').value;
          const ratings = {};
          document.querySelectorAll('#modalRatingRows .rating-row').forEach((row) => {
            const cat = row.dataset.modalCat;
            const output = row.querySelector('.rating-value').textContent;
            const input = row.querySelector('input');
            ratings[cat] = output === '—' ? null : Number(input.value);
          });
          const filled = Object.values(ratings).filter((value) => value !== null);
          if (!filled.length) {
            toast('Поставьте хотя бы одну оценку.', 'error');
            return;
          }
          if (!modalDate || modalDate > today) {
            toast('Дата не может быть в будущем.', 'error');
            return;
          }
          const item = {
            date: modalDate,
            ratings,
            note: document.getElementById('modalNote').value.trim(),
            updatedAt: new Date().toISOString()
          };
          const index = state.entries.findIndex((entryItem) => entryItem.date === modalDate);
          if (index >= 0) state.entries[index] = item;
          else state.entries.push(item);
          state.entries.sort((a, b) => (a.date < b.date ? -1 : 1));
          saveState();
          closeModal();
          renderAll();
          toast('Запись сохранена.', 'success');
        }
      }
    ]
  });

  document.querySelectorAll('#modalRatingRows input[type="range"]').forEach((input) => {
    updateRangeFill(input);
    input.addEventListener('input', () => {
      const row = input.closest('.rating-row');
      row.querySelector('.rating-value').textContent = input.value;
      updateRangeFill(input);
    });
  });
}

function deleteEntry(date) {
  openConfirm({
    title: 'Удалить запись?',
    text: `Запись за ${formatDateRu(date)} будет удалена. Это действие нельзя отменить.`,
    confirmText: 'Удалить',
    danger: true,
    onConfirm: () => {
      state.entries = state.entries.filter((entry) => entry.date !== date);
      saveState();
      closeModal();
      renderAll();
      toast('Запись удалена.', 'success');
    }
  });
}

// ---------------------------------------------------------------------------
// Аналитика
// ---------------------------------------------------------------------------

function periodAverage(daysAgoStart, daysAgoEnd) {
  const today = todayKey();
  const start = addDays(today, -daysAgoStart);
  const end = addDays(today, -daysAgoEnd);
  const entries = state.entries.filter((entry) => entry.date >= start && entry.date < end);
  return entries;
}

function renderInsights() {
  const container = document.getElementById('insightCards');
  if (!container) return;
  const analysis = getAnalysis();
  const empty = document.getElementById('insightsEmpty');
  const grid = document.querySelector('#view-insights .insights-grid');
  const patternsCard = document.querySelector('#view-insights .patterns-card');
  const corrCard = document.querySelector('#view-insights .correlation-table')?.closest('.card');
  const badge = document.getElementById('insightsBadge');

  if (!state.entries.length) {
    container.innerHTML = '';
    empty?.classList.remove('hidden');
    [container, grid, patternsCard, corrCard].forEach((element) => element?.classList.add('hidden'));
    if (badge) badge.textContent = 'нет данных';
    return;
  }

  empty?.classList.add('hidden');
  [container, grid, patternsCard, corrCard].forEach((element) => element?.classList.remove('hidden'));
  if (badge) {
    badge.textContent = state.entries.length < 8 ? 'мало данных' : 'исследовательский режим';
  }

  const summary = analysis.summary;
  const bestWeekday = summary.weekdayMeans
    .filter((item) => item.n >= 2 && Number.isFinite(item.mean))
    .sort((a, b) => b.mean - a.mean)[0];
  const trend = summary.trend;
  const trendValue = Number.isFinite(trend.slopePerWeek) ? trend.slopePerWeek : null;
  const cards = [
    {
      label: 'Средняя оценка',
      value: formatScore(summary.avgOverall),
      unit: 'из 10',
      foot: `${summary.totalEntries} ${pluralRu(summary.totalEntries, 'запись', 'записи', 'записей')} · покрытие ${Math.round(
        summary.coverage * 100
      )}%`
    },
    {
      label: 'Серия',
      value: String(summary.streak),
      unit: pluralRu(summary.streak, 'день', 'дня', 'дней'),
      foot: 'подряд без пропусков'
    },
    {
      label: 'Лучший день',
      value: bestWeekday ? WEEKDAY_SHORT[bestWeekday.index] : '—',
      unit: bestWeekday ? formatScore(bestWeekday.mean) : '',
      foot: bestWeekday ? `в среднем · n = ${bestWeekday.n}` : 'нужно больше данных'
    },
    {
      label: 'Тренд',
      value:
        trendValue === null
          ? '—'
          : `${trendValue > 0 ? '+' : ''}${trendValue.toFixed(1)}`,
      unit: 'за неделю',
      foot:
        trend.p === null
          ? 'недостаточно данных'
          : `p = ${formatP(trend.p)}${trend.p < 0.1 ? ' · заметно' : ' · в пределах шума'}`
    }
  ];

  container.innerHTML = cards
    .map(
      (card) => `<article class="insight-card">
        <span class="insight-card-label">${escapeHtml(card.label)}</span>
        <div class="insight-card-value">${escapeHtml(card.value)} <small>${escapeHtml(card.unit)}</small></div>
        <p class="insight-card-foot">${escapeHtml(card.foot)}</p>
      </article>`
    )
    .join('');

  const active = activeCategories(state);
  const values = active.map((cat) => summary.avgByCategory[cat]?.mean);
  const recent = periodAverage(29, 0);
  const previous = periodAverage(59, 30);
  const previousValues =
    previous.length >= 3
      ? active.map((cat) => {
          const items = previous.map((entry) => entry.ratings?.[cat]).filter(Number.isFinite);
          return items.length ? items.reduce((a, b) => a + b, 0) / items.length : null;
        })
      : null;
  radarChart(document.getElementById('radarChart'), {
    labels: active.map((cat) => CATEGORY_SHORT[cat]),
    values,
    previous: previousValues
  });
  const radarPeriod = document.getElementById('radarPeriod');
  if (radarPeriod) {
    radarPeriod.textContent = previousValues ? 'весь период / прошлый месяц' : 'весь период';
  }
  weekdayBars(document.getElementById('weekdayChart'), { items: summary.weekdayMeans });

  const patternsList = document.getElementById('patternsList');
  const patternCount = document.getElementById('patternCount');
  if (patternCount) patternCount.textContent = String(analysis.patterns.length);
  if (patternsList) {
    if (!analysis.patterns.length) {
      patternsList.innerHTML = `<p class="muted small">Пока устойчивых связей не видно. Это тоже результат: данных мало или связи слабые.</p>`;
    } else {
      patternsList.innerHTML = analysis.patterns
        .slice(0, 6)
        .map((pattern) => {
          const positive = pattern.effect >= 0;
          const isCorrelation = pattern.kind === 'correlation';
          const effectText = isCorrelation
            ? `${pattern.r > 0 ? '+' : ''}${pattern.r.toFixed(2)}`
            : `${pattern.effect > 0 ? '+' : ''}${pattern.effect.toFixed(1)}`;
          const effectLabel = isCorrelation ? 'r' : 'балла';
          const icon = isCorrelation ? 'spark' : positive ? 'arrowUp' : 'arrowDown';
          return `<article class="pattern-item">
            <span class="pattern-icon ${positive ? 'is-positive' : 'is-negative'}">${svgIcon(icon)}</span>
            <div>
              <h4 class="pattern-title">${escapeHtml(pattern.title)}</h4>
              <p class="pattern-text">${escapeHtml(pattern.text)}</p>
              <div class="pattern-meta">
                <span class="pill">n = ${pattern.n}</span>
                <span class="pill">p = ${formatP(pattern.p)}</span>
                <span class="pill">q = ${formatP(pattern.q)}</span>
                <span class="badge ${isCorrelation ? 'badge--teal' : 'badge--amber'}">${isCorrelation ? 'корреляция' : 'различие групп'}</span>
              </div>
            </div>
            <span class="pattern-effect ${positive ? 'text-green' : 'text-red'}">${effectText}<small>${effectLabel}</small></span>
          </article>`;
        })
        .join('');
    }
  }
  const patternNote = document.getElementById('patternNote');
  if (patternNote) {
    patternNote.textContent = `Проведено ${analysis.multipleComparisons.tests} проверок; q — поправка Benjamini–Hochberg. Малые выборки дают нестабильные оценки, это предварительные связи, а не причинность.`;
  }
  renderCorrelationTable(analysis);
}

function correlationClass(r) {
  if (!Number.isFinite(r)) return '';
  const strength = Math.min(4, Math.ceil(Math.abs(r) * 8));
  return `corr-${r > 0 ? 'pos' : 'neg'}-${Math.max(1, strength)}`;
}

function renderCorrelationTable(analysis) {
  const body = document.getElementById('correlationBody');
  if (!body) return;
  const active = activeCategories(state);
  body.innerHTML = active
    .map((cat) => {
      const cells = [1, 2, 3].map((lag) => {
        const row = analysis.correlations.find((item) => item.category === cat && item.lag === lag);
        if (!row) return '<td><span class="corr-empty">—</span></td>';
        return `<td><span class="corr-cell ${correlationClass(row.r)}" title="n=${row.n}, p=${formatP(
          row.p
        )}, q=${formatP(row.q)}">${row.r > 0 ? '+' : ''}${row.r.toFixed(2)}</span><span class="corr-sub">p ${formatP(
          row.p
        )} · n ${row.n}</span></td>`;
      });
      return `<tr><td>${escapeHtml(CATEGORY_LABELS[cat])}</td>${cells.join('')}</tr>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Прогноз
// ---------------------------------------------------------------------------

function setForecastLoading(loading) {
  document.getElementById('forecastLoading')?.classList.toggle('hidden', !loading);
  document.getElementById('forecastContent')?.classList.toggle('hidden', loading || !forecastCache);
}

async function getPriors() {
  if (priorsCache !== undefined) return priorsCache;
  try {
    const result = await api.priors();
    priorsCache = result?.available ? result : null;
  } catch {
    priorsCache = null;
  }
  return priorsCache;
}

async function ensureForecast(force = false) {
  const empty = document.getElementById('forecastEmpty');
  const content = document.getElementById('forecastContent');
  if (!state.entries.length) {
    empty?.classList.remove('hidden');
    content?.classList.add('hidden');
    document.getElementById('forecastLoading')?.classList.add('hidden');
    return;
  }
  if (forecastCache && !force) {
    empty?.classList.add('hidden');
    content?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  content?.classList.add('hidden');
  setForecastLoading(true);
  const messages = [
    'Строим признаки и лаги…',
    'Обучаем модели на прошлых днях…',
    'Сравниваем с наивным прогнозом…',
    'Считаем интервалы и объяснения…'
  ];
  let messageIndex = 0;
  const loadingText = document.getElementById('forecastLoadingText');
  if (loadingText) loadingText.textContent = messages[0];
  const interval = window.setInterval(() => {
    messageIndex = (messageIndex + 1) % messages.length;
    if (loadingText) loadingText.textContent = messages[messageIndex];
  }, 900);

  await new Promise((resolve) => window.setTimeout(resolve, 40));
  try {
    const prior = await getPriors();
    forecastCache = forecastAll(state, { prior });
    renderForecast(forecastCache);
  } catch (error) {
    console.error(error);
    toast('Не удалось построить прогноз. Попробуйте ещё раз.', 'error');
    empty?.classList.remove('hidden');
  } finally {
    window.clearInterval(interval);
    setForecastLoading(false);
  }
}

function driversHtml(drivers, className = '') {
  if (!drivers?.length) return '<p class="muted tiny">Нет выраженных вкладов.</p>';
  const max = Math.max(...drivers.map((driver) => Math.abs(driver.contribution)), 0.01);
  return `<div class="driver-list ${className}">${drivers
    .map((driver) => {
      const width = Math.max(4, Math.round((Math.abs(driver.contribution) / max) * 100));
      const sign = driver.contribution > 0 ? '+' : '';
      return `<div class="driver-row" title="${escapeHtml(driver.note || '')}">
        <span>${escapeHtml(driver.label)}</span>
        <span class="driver-track"><i data-width="${width}" class="${driver.contribution < 0 ? 'is-negative' : ''}"></i></span>
        <span class="driver-value">${sign}${formatScore(driver.contribution, 2)}</span>
      </div>`;
    })
    .join('')}</div>`;
}

function applyBarWidths(container) {
  container.querySelectorAll('[data-width]').forEach((element) => {
    element.style.width = `${element.dataset.width}%`;
  });
}

function renderForecast(forecast) {
  const content = document.getElementById('forecastContent');
  if (!content) return;
  content.classList.remove('hidden');
  const overall = forecast.overall;
  const horizon = document.getElementById('forecastHorizon');
  if (horizon) horizon.textContent = `на ${formatDateShort(forecast.horizon)}`;
  if (!overall) {
    content.innerHTML = '';
    return;
  }

  const validation = overall.validation;
  const methodLabel = overall.method === 'composition' ? 'взвешенная композиция' : methodShort(overall.method);
  const confidenceScore = overall.confidence?.score ?? 0.2;
  const overallDrivers = overall.drivers
    .map((driver) => ({
      ...driver,
      contribution: Number(driver.contribution) || 0
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const categoryCards = activeCategories(state)
    .map((cat) => forecast.categories[cat])
    .filter(Boolean)
    .map((item) => {
      const model = item.validation?.models?.[item.method];
      const driverList = item.drivers?.length
        ? item.drivers.slice(0, 3)
        : [];
      return `<article class="forecast-card">
        <div class="forecast-card-head">
          <span class="forecast-card-icon">${svgIcon(CATEGORY_ICON[item.target])}</span>
          <div>
            <div class="forecast-card-title">${escapeHtml(item.label)}</div>
            <div class="forecast-card-sub">${item.n} ${pluralRu(item.n, 'наблюдение', 'наблюдения', 'наблюдений')} · ${escapeHtml(
              methodShort(item.method)
            )}</div>
          </div>
          <span class="conf-inline" title="Уверенность ${Math.round((item.confidence?.score || 0) * 100)}%">${confidenceDots(
            item.confidence?.score
          )}</span>
        </div>
        <div class="forecast-card-score">
          <strong>${formatScore(item.value)}</strong>
          <span>${formatScore(item.low)}–${formatScore(item.high)}</span>
          ${trendChip(item.trend)}
        </div>
        ${intervalBar({ low: item.low, value: item.value, high: item.high })}
        <div class="forecast-driver-list">${driversHtml(driverList)}
        </div>
        <details>
          <summary>Детали модели</summary>
          <div class="forecast-detail-row"><span>Метод</span><b>${escapeHtml(item.methodLabel)}</b></div>
          <div class="forecast-detail-row"><span>Наблюдений</span><b>${item.n}</b></div>
          <div class="forecast-detail-row"><span>MAE на прошлом</span><b>${model ? formatScore(model.mae, 2) : '—'}</b></div>
          <div class="forecast-detail-row"><span>RMSE</span><b>${model ? formatScore(model.rmse, 2) : '—'}</b></div>
          <div class="forecast-detail-row"><span>Уверенность</span><b>${escapeHtml(item.confidence?.label || '—')}</b></div>
          ${(item.drivers || [])
            .map(
              (driver) =>
                `<div class="forecast-detail-row"><span>${escapeHtml(driver.label)}</span><b>${formatScore(
                  driver.contribution,
                  2
                )}</b></div>`
            )
            .join('')}
        </details>
      </article>`;
    })
    .join('');

  const modelRows = ['naive', 'mean', 'ridge', 'gbdt']
    .filter((kind) => validation.models?.[kind]?.mae !== null && validation.models?.[kind]?.mae !== undefined)
    .map((kind) => {
      const model = validation.models[kind];
      const isChosen = kind === validation.chosen;
      const labels = {
        naive: 'Наивная «завтра = сегодня»',
        mean: 'Среднее по истории',
        ridge: 'Ridge-регрессия',
        gbdt: 'Градиентный бустинг'
      };
      return `<tr class="${isChosen ? 'is-chosen' : ''}">
        <td>${labels[kind]}</td>
        <td>${formatScore(model.mae, 2)}</td>
        <td>${formatScore(model.rmse, 2)}</td>
        <td>${model.n}</td>
        <td>${isChosen ? 'выбрана' : ''}</td>
      </tr>`;
    })
    .join('');

  const verdictClass = validation.significant
    ? 'is-positive'
    : validation.improvementPct > 0
      ? 'is-warning'
      : '';

  content.innerHTML = `
    <article class="forecast-overall">
      <div class="forecast-overall-main">
        <span class="forecast-overall-kicker">Общая оценка · ${escapeHtml(formatDateRu(forecast.horizon))}</span>
        <div class="forecast-overall-score">
          <strong>${formatScore(overall.value)}</strong>
          <span class="forecast-overall-interval">${formatScore(overall.low)}–${formatScore(overall.high)}</span>
        </div>
        <div class="forecast-overall-meta">
          ${confidenceBadge(overall.confidence)}
          ${trendChip(overall.trend)}
          <span class="badge">${escapeHtml(methodLabel)}</span>
          <span class="badge">${overall.n} ${pluralRu(overall.n, 'запись', 'записи', 'записей')}</span>
        </div>
        <p class="forecast-overall-note">Оценка — взвешенная сумма покритериальных прогнозов. Интервал показывает типичную ошибку на прошлых днях, а не гарантию.</p>
      </div>
      <div class="forecast-drivers">
        <h4>Что формирует оценку</h4>
        ${driversHtml(overallDrivers)}
      </div>
    </article>

    <div class="forecast-categories">${categoryCards}</div>

    <section class="card card-pad validation-card">
      <div class="card-heading">
        <div>
          <span class="card-kicker">Проверка на прошлом</span>
          <h3>Модель против наивного прогноза</h3>
        </div>
        <span class="badge ${validation.significant ? 'badge--green' : 'badge--amber'}">${
          validation.available ? `${validation.folds} проверок` : 'мало данных'
        }</span>
      </div>
      ${
        validation.available
          ? `<div class="table-scroll"><table class="validation-table">
              <thead><tr><th>Модель</th><th>MAE</th><th>RMSE</th><th>n</th><th></th></tr></thead>
              <tbody>${modelRows}</tbody>
            </table></div>`
          : ''
      }
      <p class="validation-verdict ${verdictClass}">${escapeHtml(validation.verdict)}</p>
      ${
        validation.available
          ? `<p class="stat-note">Улучшение по MAE: ${
              validation.improvementPct === null
                ? '—'
                : `${validation.improvementPct > 0 ? '+' : ''}${validation.improvementPct.toFixed(1)}%`
            }; парный t-тест p = ${formatP(validation.pValue)}. Проверка идёт по последним ${validation.folds} дням, модель обучается только на прошлом.</p>`
          : ''
      }
    </section>

    <section class="card card-pad model-doc-card">
      <div class="card-heading">
        <div>
          <span class="card-kicker">Model card</span>
          <h3>Что учла модель</h3>
        </div>
      </div>
      <div class="model-specs">
        <div class="model-spec"><span>Признаки</span><b>лаги 1–2–3–7, средние 3/7, день недели, перерыв, контекст сфер</b></div>
        <div class="model-spec"><span>Метод общей оценки</span><b>${escapeHtml(overall.methodLabel)}</b></div>
        <div class="model-spec"><span>Проверка</span><b>walk-forward, ${validation.folds || 0} шагов</b></div>
        <div class="model-spec"><span>Популяционные приоры</span><b>${forecast.priorUsed ? 'используются' : 'нет'}</b></div>
        <div class="model-spec"><span>Данных в дневнике</span><b>${forecast.nEntries} ${pluralRu(forecast.nEntries, 'запись', 'записи', 'записей')}</b></div>
        <div class="model-spec"><span>Алгоритмы</span><b>Ridge, gradient boosting, naive, mean</b></div>
      </div>
      <div class="limitations">
        <h4>Ограничения</h4>
        <ul>${forecast.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
    </section>
  `;
  applyBarWidths(content);
}

// ---------------------------------------------------------------------------
// Веса
// ---------------------------------------------------------------------------

const PRESET_ENTRIES = Object.entries(PRESETS);

function renderWeights() {
  const body = document.getElementById('weightsBody');
  const head = document.getElementById('weightsHead');
  if (!body || !head) return;
  if (!weightsDraft) {
    weightsDraft = (state.settings.matrix || matrixFromWeights(state.settings.weights)).map((row) => [...row]);
  }

  head.innerHTML = `<tr><th>Критерий</th>${CATEGORIES.map(
    (cat) => `<th title="${escapeHtml(CATEGORY_LABELS[cat])}">${escapeHtml(CATEGORY_SHORT[cat])}</th>`
  ).join('')}</tr>`;

  body.innerHTML = CATEGORIES.map((cat, i) => {
    const cells = CATEGORIES.map((other, j) => {
      if (i === j) return '<td class="diag">1</td>';
      if (j < i) {
        return `<td class="reciprocal" data-recip="${i}-${j}">${formatReciprocal(weightsDraft[i][j])}</td>`;
      }
      return `<td><input type="number" min="0.1" max="9" step="0.1" value="${formatInput(
        weightsDraft[i][j]
      )}" data-i="${i}" data-j="${j}" aria-label="${escapeHtml(CATEGORY_LABELS[cat])} к ${escapeHtml(
        CATEGORY_LABELS[other] || CATEGORY_SHORT[other]
      )}"></td>`;
    }).join('');
    return `<tr><td>${escapeHtml(CATEGORY_LABELS[cat])}</td>${cells}</tr>`;
  }).join('');

  body.querySelectorAll('input[data-i]').forEach((input) => {
    input.addEventListener('input', () => {
      const i = Number(input.dataset.i);
      const j = Number(input.dataset.j);
      let value = Number(String(input.value).replace(',', '.'));
      if (!Number.isFinite(value) || value <= 0) return;
      value = Math.min(9, Math.max(0.1, value));
      weightsDraft[i][j] = value;
      weightsDraft[j][i] = 1 / value;
      const reciprocal = body.querySelector(`[data-recip="${j}-${i}"]`);
      if (reciprocal) reciprocal.textContent = formatReciprocal(1 / value);
      updateWeightsPreview();
    });
  });

  const presetRow = document.getElementById('presetRow');
  if (presetRow) {
    presetRow.innerHTML = PRESET_ENTRIES.map(
      ([key, preset]) =>
        `<button type="button" class="preset-btn" data-preset="${key}">${escapeHtml(preset.title)}</button>`
    ).join('');
    presetRow.querySelectorAll('[data-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const preset = PRESETS[button.dataset.preset];
        if (!preset) return;
        weightsDraft = matrixFromWeights(preset.weights);
        renderWeights();
        toast(`Пресет «${preset.title}» применён. Не забудьте сохранить.`, 'info');
      });
    });
  }

  updateWeightsPreview();
}

function formatReciprocal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (number >= 1) return number.toFixed(2);
  return `1/${(1 / number).toFixed(2)}`;
}

function formatInput(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return Number(number.toFixed(3)).toString();
}

function updateWeightsPreview() {
  if (!weightsDraft) return;
  const weights = ahpWeights(weightsDraft) || state.settings.weights;
  const diagnosis = diagnoseAHP(weightsDraft);
  weightsPreview = { weights, diagnosis };

  const crValue = document.getElementById('crValue');
  if (crValue) crValue.textContent = diagnosis.cr.toFixed(3);
  const meter = document.getElementById('crMeterFill');
  if (meter) {
    const ratio = Math.min(1, diagnosis.cr / 0.2);
    meter.style.width = `${Math.max(2, ratio * 100)}%`;
    meter.className = diagnosis.cr > CR_THRESHOLD ? 'is-bad' : diagnosis.cr > 0.05 ? 'is-warning' : '';
  }
  const advice = document.getElementById('crAdvice');
  if (advice) advice.textContent = diagnosis.advice;
  const card = document.getElementById('consistencyCard');
  if (card) {
    card.classList.toggle('is-bad', !diagnosis.ok);
    card.classList.toggle('is-ok', diagnosis.ok);
  }

  const bars = document.getElementById('weightBars');
  if (bars) {
    bars.innerHTML = CATEGORIES.map((cat, index) => {
      const value = weights[index] || 0;
      return `<div class="weight-bar-row">
        <span>${escapeHtml(CATEGORY_SHORT[cat])}</span>
        <span class="weight-track"><i data-width="${Math.round(value * 100)}"></i></span>
        <b>${Math.round(value * 100)}%</b>
      </div>`;
    }).join('');
    applyBarWidths(bars);
  }
}

function saveWeights() {
  if (!weightsPreview || !weightsDraft) return;
  state.settings.matrix = weightsDraft.map((row) => row.map((value) => Number(value)));
  state.settings.weights = weightsPreview.weights;
  saveState();
  renderAll();
  toast(
    weightsPreview.diagnosis.ok
      ? 'Веса сохранены. Общая оценка пересчитана.'
      : 'Веса сохранены, но суждения противоречивы (CR > 0.1). Рекомендуем пересмотреть матрицу.',
    weightsPreview.diagnosis.ok ? 'success' : 'error',
    5000
  );
}

// ---------------------------------------------------------------------------
// Настройки
// ---------------------------------------------------------------------------

function renderSettings() {
  const title = document.getElementById('settingsAccountTitle');
  const badge = document.getElementById('settingsAccountBadge');
  const body = document.getElementById('settingsAccountBody');
  if (!title || !body) return;

  title.textContent = user ? user.name : 'Гостевой режим';
  if (badge) {
    badge.textContent = user ? 'синхронизация' : 'локально';
    badge.className = `badge ${user ? 'badge--green' : 'badge--amber'}`;
  }

  body.innerHTML = user
    ? `<div class="account-settings">
        <span class="account-avatar">${escapeHtml(initial(user.name))}</span>
        <div><strong>${escapeHtml(user.name)}</strong><span>${escapeHtml(user.email)}</span></div>
      </div>
      <div class="settings-row"><span>Записей в аккаунте</span><b>${state.entries.length}</b></div>
      <div class="settings-row"><span>Согласие на агрегацию</span><b>${user.consentResearch ? 'да' : 'нет'}</b></div>
      <div class="row mt-2">
        <button class="btn btn-outline btn-sm" type="button" id="settingsLogoutBtn">Выйти</button>
        <button class="btn btn-ghost btn-sm" type="button" id="settingsAccountExport">Экспорт аккаунта</button>
      </div>`
    : `<p class="small muted mb-2">Вы работаете без аккаунта: записи хранятся в этом браузере. Войдите, чтобы синхронизировать их между устройствами.</p>
      <div class="row">
        <a class="btn btn-primary btn-sm" href="/?auth=register">Создать аккаунт</a>
        <a class="btn btn-outline btn-sm" href="/?auth=login">Войти</a>
      </div>
      <p class="stat-note">Локальные записи будут объединены с аккаунтом при входе.</p>`;

  document.getElementById('settingsLogoutBtn')?.addEventListener('click', logout);
  document.getElementById('settingsAccountExport')?.addEventListener('click', () => {
    window.location.href = api.exportUrl;
  });

  const toggles = document.getElementById('categoryToggles');
  if (toggles) {
    const active = activeCategories(state);
    toggles.innerHTML = CATEGORIES.map(
      (cat) => `<label class="category-toggle">
        <input type="checkbox" data-cat-toggle="${cat}" ${active.includes(cat) ? 'checked' : ''}>
        <span>${escapeHtml(CATEGORY_SHORT[cat])}</span>
      </label>`
    ).join('');
    toggles.querySelectorAll('[data-cat-toggle]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const cat = checkbox.dataset.catToggle;
        const wouldBeActive = CATEGORIES.filter((item) =>
          item === cat ? checkbox.checked : state.settings.enabled[item] !== false
        );
        if (wouldBeActive.length < 2) {
          checkbox.checked = true;
          toast('Нужно оставить минимум две категории.', 'error');
          return;
        }
        state.settings.enabled[cat] = checkbox.checked;
        saveState();
        invalidateAnalysis();
        renderToday();
        renderSidebarStats();
        renderInsights();
        toast(checkbox.checked ? `«${CATEGORY_SHORT[cat]}» включена.` : `«${CATEGORY_SHORT[cat]}» отключена.`, 'info');
      });
    });
  }

  const research = document.getElementById('researchConsent');
  if (research) {
    research.checked = Boolean(state.settings.researchConsent);
    research.onchange = async () => {
      state.settings.researchConsent = research.checked;
      saveState();
      if (user) {
        try {
          const result = await api.patchAccount({ consentResearch: research.checked });
          user = result.user;
          priorsCache = undefined;
          toast('Настройка приватности сохранена.', 'success');
        } catch {
          toast('Не удалось сохранить согласие на сервере.', 'error');
        }
      } else {
        toast(
          research.checked
            ? 'Согласие сохранено локально. Оно начнёт действовать после входа в аккаунт.'
            : 'Согласие отозвано.',
          'info'
        );
      }
    };
  }

  const themeSwitch = document.getElementById('themeSwitch');
  if (themeSwitch) {
    themeSwitch.checked = state.settings.theme === 'dark';
    themeSwitch.onchange = () => {
      state.settings.theme = themeSwitch.checked ? 'dark' : 'light';
      applyTheme(state.settings.theme);
      saveState();
    };
  }

  const deleteBtn = document.getElementById('deleteAccountBtn');
  if (deleteBtn) {
    deleteBtn.disabled = !user;
    deleteBtn.onclick = () => (user ? openDeleteAccount() : toast('Войдите в аккаунт.', 'error'));
  }
  const deleteHint = document.getElementById('deleteAccountHint');
  if (deleteHint) {
    deleteHint.textContent = user
      ? 'Потребуется пароль. Локальная копия в этом браузере тоже будет удалена.'
      : 'Доступно только при входе в аккаунт.';
  }

  const exportButton = document.getElementById('settingsExportBtn');
  if (exportButton) exportButton.onclick = exportJson;
  const csvButton = document.getElementById('settingsCsvBtn');
  if (csvButton) csvButton.onclick = exportCsv;
  const importButton = document.getElementById('settingsImportBtn');
  if (importButton) {
    importButton.onclick = () => document.getElementById('settingsImportFile').click();
  }
  const importInput = document.getElementById('settingsImportFile');
  if (importInput) {
    importInput.onchange = async (event) => {
      await importFile(event.target.files?.[0]);
      event.target.value = '';
    };
  }
  const demoButton = document.getElementById('loadDemoSettings');
  if (demoButton) demoButton.onclick = () => loadDemo();
  const clearButton = document.getElementById('clearDataBtn');
  if (clearButton) clearButton.onclick = clearAllData;
  const installButton = document.getElementById('settingsInstallBtn');
  if (installButton) installButton.onclick = installPWA;
}

function clearAllData() {
  openConfirm({
    title: 'Удалить все записи?',
    text: 'Дневник, настройки весов и заметки будут удалены из этого браузера. Если вы вошли в аккаунт, удаление синхронизируется. Отменить это нельзя. Рекомендуем сначала сделать экспорт.',
    confirmText: 'Удалить всё',
    danger: true,
    onConfirm: () => {
      state = defaultState();
      state.settings.theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      selectedDate = todayKey();
      weightsDraft = null;
      saveState();
      closeModal();
      renderAll();
      toast('Все записи удалены.', 'success');
    }
  });
}

async function logout() {
  try {
    await api.logout();
  } catch {
    // даже при ошибке сети выходим локально
  }
  user = null;
  version = 0;
  setSyncStatus('guest', 'Гостевой режим');
  renderAll();
  toast('Вы вышли из аккаунта. Записи остались в браузере.', 'info');
}

function openDeleteAccount() {
  openModal({
    title: 'Удалить аккаунт',
    kicker: 'Необратимо',
    body: `<p>Будут удалены аккаунт, все записи, настройки и сессии на сервере. Локальная копия в этом браузере также будет очищена.</p>
      <div class="field mt-2"><label for="deletePassword">Пароль для подтверждения</label><input type="password" id="deletePassword" autocomplete="current-password"></div>
      <p class="stat-note">Если хотите сохранить дневник, сначала сделайте экспорт.</p>`,
    actions: [
      { label: 'Отмена', className: 'btn btn-ghost', onClick: closeModal },
      {
        label: 'Удалить аккаунт',
        className: 'btn btn-danger',
        onClick: async () => {
          const password = document.getElementById('deletePassword').value;
          if (!password) {
            toast('Введите пароль.', 'error');
            return;
          }
          try {
            await api.deleteAccount(password);
            user = null;
            version = 0;
            state = defaultState();
            localStorage.removeItem(STORAGE_KEY);
            closeModal();
            renderAll();
            toast('Аккаунт и локальные данные удалены.', 'success');
          } catch (error) {
            toast(error instanceof ApiError ? error.message : 'Не удалось удалить аккаунт.', 'error');
          }
        }
      }
    ]
  });
}

// ---------------------------------------------------------------------------
// Модальные окна
// ---------------------------------------------------------------------------

function closeModal() {
  const root = document.getElementById('modalRoot');
  if (!root) return;
  root.classList.remove('is-open');
  root.innerHTML = '';
  document.body.classList.remove('modal-open');
}

function openModal({ title, kicker = '', body, actions = [], wide = false }) {
  const root = document.getElementById('modalRoot');
  if (!root) return;
  root.innerHTML = `<div class="modal-overlay" data-close-modal></div>
    <div class="modal-card ${wide ? 'modal-card--wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(
      title
    )}">
      <div class="modal-head">
        <div>${kicker ? `<span class="card-kicker">${escapeHtml(kicker)}</span>` : ''}<h3>${escapeHtml(
          title
        )}</h3></div>
        <button class="modal-close" type="button" data-close-modal aria-label="Закрыть">${svgIcon('close')}</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">${actions
        .map(
          (action, index) =>
            `<button type="button" class="${action.className || 'btn btn-primary'}" data-modal-action="${index}" ${
              action.id ? `id="${action.id}"` : ''
            }>${escapeHtml(action.label)}</button>`
        )
        .join('')}</div>
    </div>`;
  root.classList.add('is-open');
  document.body.classList.add('modal-open');
  root.querySelectorAll('[data-close-modal]').forEach((element) => {
    element.addEventListener('click', closeModal);
  });
  root.querySelectorAll('[data-modal-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = actions[Number(button.dataset.modalAction)];
      action?.onClick?.();
    });
  });
  const firstInput = root.querySelector('input, textarea, select');
  if (firstInput) window.setTimeout(() => firstInput.focus(), 80);
}

function openConfirm({ title, text, confirmText = 'Подтвердить', danger = false, onConfirm }) {
  openModal({
    title,
    kicker: danger ? 'Подтверждение' : '',
    body: `<p>${escapeHtml(text)}</p>`,
    actions: [
      { label: 'Отмена', className: 'btn btn-ghost', onClick: closeModal },
      {
        label: confirmText,
        className: danger ? 'btn btn-danger' : 'btn btn-primary',
        onClick: onConfirm
      }
    ]
  });
}

function openOnboarding() {
  openModal({
    title: 'Три вещи, которые стоит знать',
    kicker: 'Как это работает',
    wide: true,
    body: `<div class="onboarding-steps">
        <div class="onboarding-step"><span>1</span><div><strong>Оценивайте день по семи сферам</strong><p>Это не тест. Отмечайте то, что действительно влияло. Можно пропустить категорию.</p></div></div>
        <div class="onboarding-step"><span>2</span><div><strong>Связи появятся не сразу</strong><p>Через 7–14 записей приложение начнёт показывать лаги и паттерны. На малых данных выводы предварительные.</p></div></div>
        <div class="onboarding-step"><span>3</span><div><strong>Прогноз — это гипотеза</strong><p>Смотрите на интервал, число наблюдений и проверку на прошлом. Если модель не лучше наивной, приложение так и скажет.</p></div></div>
      </div>
      <p class="stat-note">Это инструмент саморефлексии, а не медицинский прибор. Данные можно экспортировать и удалить в любой момент.</p>`,
    actions: [
      { label: 'Позже', className: 'btn btn-ghost', onClick: () => finishOnboarding(false) },
      { label: 'Оценить сегодня', className: 'btn btn-outline', onClick: () => finishOnboarding(false) },
      { label: 'Посмотреть на демо', className: 'btn btn-primary', onClick: () => loadDemo({ replace: true }) }
    ]
  });
}

function finishOnboarding() {
  state.settings.onboardingDone = true;
  saveState();
  closeModal();
}

// ---------------------------------------------------------------------------
// Установка / PWA / тема
// ---------------------------------------------------------------------------

function installPWA() {
  if (isStandalone()) {
    toast('Приложение уже установлено.', 'info');
    return;
  }
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice?.then((choice) => {
      if (choice.outcome === 'accepted') toast('Установка началась.', 'success');
      deferredPrompt = null;
    });
    return;
  }
  const platform = detectPlatform();
  const instructions = {
    ios: 'В Safari нажмите «Поделиться» → «На экран „Домой“».',
    android: 'В Chrome откройте меню ⋮ → «Установить приложение» или «Добавить на главный экран».',
    windows: 'В Chrome/Edge нажмите значок установки в адресной строке или меню → «Установить приложение».',
    macos: 'В Chrome/Edge выберите меню → «Установить KnowTomorrow».',
    linux: 'В Chrome/Chromium выберите меню → «Установить приложение».'
  };
  openModal({
    title: 'Как установить',
    kicker: 'PWA',
    body: `<p>${escapeHtml(instructions[platform] || instructions.windows)}</p>
      <p class="stat-note">После установки приложение открывается в отдельном окне и работает офлайн. Данные синхронизируются при подключении.</p>`,
    actions: [{ label: 'Понятно', className: 'btn btn-primary', onClick: closeModal }]
  });
}

// ---------------------------------------------------------------------------
// События и запуск
// ---------------------------------------------------------------------------

function bindEvents() {
  document.getElementById('menuToggle')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar?.classList.contains('is-open')) closeSidebar({ restoreFocus: true });
    else openSidebar();
  });
  document.getElementById('sidebarClose')?.addEventListener('click', () =>
    closeSidebar({ restoreFocus: true })
  );
  document.getElementById('sidebarBackdrop')?.addEventListener('click', () =>
    closeSidebar({ restoreFocus: true })
  );
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1020) closeSidebar();
  });

  document.querySelectorAll('.nav-item[data-view], .mobile-nav-item[data-view]').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.view));
  });
  document.addEventListener('click', (event) => {
    const go = event.target.closest('[data-go]');
    if (go) navigate(go.dataset.go);
  });

  document.getElementById('todayForm')?.addEventListener('submit', saveToday);
  document.getElementById('ratingDate')?.addEventListener('change', (event) => {
    selectedDate = event.target.value || todayKey();
    renderToday();
  });
  document.getElementById('clearRatingBtn')?.addEventListener('click', () => {
    if (!draft) return;
    const active = activeCategories(state);
    CATEGORIES.forEach((cat) => {
      draft.ratings[cat] = active.includes(cat) ? 6 : null;
      const row = document.querySelector(`#ratingRows .rating-row[data-cat="${cat}"]`);
      if (!row) return;
      const input = row.querySelector('input[type="range"]');
      const output = row.querySelector('.rating-value');
      const skip = row.querySelector('.skip-btn');
      const enabled = active.includes(cat);
      row.classList.toggle('is-skipped', !enabled);
      input.disabled = !enabled;
      input.value = 6;
      output.textContent = enabled ? '6' : '—';
      if (skip) skip.textContent = enabled ? '×' : '↺';
      updateRangeFill(input);
    });
    const note = document.getElementById('ratingNote');
    if (note) note.value = '';
    updateOverallPreview();
  });
  document.getElementById('loadDemoBtn')?.addEventListener('click', () => loadDemo());

  document.getElementById('chartSelect')?.addEventListener('change', renderHistoryChart);
  document.getElementById('historyPeriod')?.addEventListener('change', renderHistory);
  document.getElementById('exportJsonBtn')?.addEventListener('click', exportJson);
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportCsv);
  document.getElementById('importBtn')?.addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile')?.addEventListener('change', async (event) => {
    await importFile(event.target.files?.[0]);
    event.target.value = '';
  });
  document.getElementById('addPastBtn')?.addEventListener('click', () => openRatingEditor(addDays(todayKey(), -1)));

  document.getElementById('historyBody')?.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit]');
    if (edit) openRatingEditor(edit.dataset.edit);
    const remove = event.target.closest('[data-delete]');
    if (remove) deleteEntry(remove.dataset.delete);
  });

  document.getElementById('saveWeightsBtn')?.addEventListener('click', saveWeights);
  document.getElementById('resetWeightsBtn')?.addEventListener('click', () => {
    weightsDraft = matrixFromWeights(DEFAULT_WEIGHTS);
    renderWeights();
  });
  document.getElementById('equalWeightsBtn')?.addEventListener('click', () => {
    weightsDraft = matrixFromWeights(PRESETS.equal.weights);
    renderWeights();
  });

  document.getElementById('recalcForecastBtn')?.addEventListener('click', () => {
    forecastCache = null;
    ensureForecast(true);
  });

  const themeToggle = document.getElementById('themeToggle');
  themeToggle?.addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state.settings.theme);
    saveState();
    renderSettings();
  });

  document.getElementById('accountAction')?.addEventListener('click', () => {
    if (user) navigate('settings');
    else window.location.href = '/?auth=login';
  });
  document.getElementById('accountChip')?.addEventListener('click', () => {
    if (user) navigate('settings');
    else window.location.href = '/?auth=login';
  });

  window.addEventListener('online', () => {
    const offline = document.getElementById('offlineBadge');
    offline?.classList.add('hidden');
    if (!user) initAuth();
    else if (dirty) syncNow();
    toast('Соединение восстановлено.', 'success');
  });
  window.addEventListener('offline', () => {
    document.getElementById('offlineBadge')?.classList.remove('hidden');
    if (user) setSyncStatus('error', 'Офлайн — локально');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
      closeSidebar({ restoreFocus: true });
    }
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    toast('KnowTomorrow установлен.', 'success');
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (error) {
    console.warn('SW registration failed', error);
  }
}

async function boot() {
  injectIcons();
  applyTheme(state.settings.theme);
  bindEvents();
  renderAll();
  if (!navigator.onLine) document.getElementById('offlineBadge')?.classList.remove('hidden');

  const hash = window.location.hash.replace('#', '');
  const initialView = VIEW_META[hash] ? hash : 'today';
  navigate(initialView, { scroll: false });

  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') === '1' && state.entries.length === 0) {
    loadDemo({ replace: true, view: initialView });
  }

  await initAuth();
  renderAccountChrome();

  const today = document.getElementById('ratingDate');
  if (today) {
    today.value = selectedDate;
    today.max = todayKey();
  }

  const shouldOnboard =
    state.entries.length === 0 &&
    (!state.settings.onboardingDone || params.get('onboarding') === '1');
  if (shouldOnboard && !params.get('demo')) {
    window.setTimeout(openOnboarding, 450);
  }

  registerServiceWorker();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

// Экспорт для отладки в консоли (не является публичным API).
window.__knowTomorrow = {
  get state() {
    return state;
  },
  get user() {
    return user;
  },
  reload: () => renderAll(),
  forecast: () => forecastAll(state)
};
