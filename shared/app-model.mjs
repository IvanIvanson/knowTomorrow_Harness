/**
 * Модель состояния KnowTomorrow: настройки, записи, веса, слияние и валидация.
 * Одна и та же схема используется в браузере (localStorage / API) и на сервере.
 */

import {
  CATEGORIES,
  DEFAULT_WEIGHTS,
  MAX_ENTRIES,
  RI,
  SCHEMA_VERSION
} from './constants.mjs';
import { isValidDateKey, todayKey } from './dates.mjs';

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

/** Матрица парных сравнений, идеально согласованная с заданными весами. */
export function matrixFromWeights(weights) {
  const n = CATEGORIES.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const ratio = weights[i] / weights[j];
      matrix[i][j] = round(Math.min(10, Math.max(0.1, ratio)), 3);
    }
  }
  return matrix;
}

/** Веса из матрицы (геометрическое среднее строк — устойчивый вариант AHP). */
export function weightsFromMatrix(matrix) {
  const n = matrix.length;
  if (!n) return null;
  const rows = matrix.map((row) =>
    Math.exp(row.reduce((acc, value) => acc + Math.log(value), 0) / n)
  );
  const total = sum(rows);
  if (!Number.isFinite(total) || total <= 0) return null;
  return rows.map((value) => value / total);
}

export function normalizeWeights(weights) {
  if (!Array.isArray(weights) || weights.length !== CATEGORIES.length) return null;
  if (weights.some((w) => !Number.isFinite(w) || w <= 0)) return null;
  const total = sum(weights);
  if (!Number.isFinite(total) || total <= 0) return null;
  return weights.map((w) => w / total);
}

export function defaultState() {
  return {
    schema: SCHEMA_VERSION,
    settings: {
      enabled: Object.fromEntries(CATEGORIES.map((cat) => [cat, true])),
      weights: [...DEFAULT_WEIGHTS],
      matrix: matrixFromWeights(DEFAULT_WEIGHTS),
      theme: 'light',
      onboardingDone: false,
      researchConsent: false
    },
    entries: []
  };
}

export function defaultEnabled() {
  return Object.fromEntries(CATEGORIES.map((cat) => [cat, true]));
}

export function activeCategories(state) {
  const enabled = state?.settings?.enabled || defaultEnabled();
  const active = CATEGORIES.filter((cat) => enabled[cat] !== false);
  return active.length >= 2 ? active : CATEGORIES.slice();
}

/** Взвешенная общая оценка; веса перенормируются по фактически заполненным категориям. */
export function computeOverall(ratings, weights, enabled = defaultEnabled()) {
  if (!ratings) return null;
  let weighted = 0;
  let weightSum = 0;
  CATEGORIES.forEach((cat, index) => {
    if (enabled[cat] === false) return;
    const value = Number(ratings[cat]);
    if (!Number.isFinite(value) || value < 1 || value > 10) return;
    const weight = Number(weights?.[index]) > 0 ? Number(weights[index]) : 0;
    if (weight <= 0) return;
    weighted += value * weight;
    weightSum += weight;
  });
  if (weightSum <= 0) return null;
  return round(weighted / weightSum, 2);
}

export function entryOverall(entry, state) {
  return computeOverall(
    entry?.ratings,
    state?.settings?.weights || DEFAULT_WEIGHTS,
    state?.settings?.enabled || defaultEnabled()
  );
}

export function normalizeRatings(raw) {
  const ratings = {};
  CATEGORIES.forEach((cat) => {
    const value = Number(raw?.[cat]);
    ratings[cat] =
      Number.isFinite(value) && value >= 1 && value <= 10
        ? Math.round(value)
        : null;
  });
  return ratings;
}

export function normalizeEntry(raw) {
  if (!raw || !isValidDateKey(raw.date)) return null;
  return {
    date: raw.date,
    ratings: normalizeRatings(raw.ratings),
    note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '',
    updatedAt:
      typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt))
        ? new Date(raw.updatedAt).toISOString()
        : new Date().toISOString()
  };
}

/** Приводит произвольное состояние к актуальной схеме (мягко, для локальных данных). */
export function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const enabled = { ...defaultEnabled() };
  if (settings.enabled && typeof settings.enabled === 'object') {
    CATEGORIES.forEach((cat) => {
      if (typeof settings.enabled[cat] === 'boolean') enabled[cat] = settings.enabled[cat];
    });
  }

  let matrix = null;
  if (Array.isArray(settings.matrix) && settings.matrix.length === CATEGORIES.length) {
    const ok = settings.matrix.every(
      (row) =>
        Array.isArray(row) &&
        row.length === CATEGORIES.length &&
        row.every((v) => Number.isFinite(Number(v)) && Number(v) >= 0.1 && Number(v) <= 10)
    );
    if (ok) matrix = settings.matrix.map((row) => row.map((v) => round(Number(v), 3)));
  }

  let weights = normalizeWeights(settings.weights);
  if (!weights && matrix) weights = weightsFromMatrix(matrix);
  if (!weights) weights = [...DEFAULT_WEIGHTS];
  if (!matrix) matrix = matrixFromWeights(weights);

  const entries = [];
  const seen = new Map();
  if (Array.isArray(raw.entries)) {
    raw.entries.slice(0, MAX_ENTRIES).forEach((item) => {
      const entry = normalizeEntry(item);
      if (!entry) return;
      const previous = seen.get(entry.date);
      if (!previous) {
        seen.set(entry.date, entry);
        entries.push(entry);
      } else if (new Date(entry.updatedAt) >= new Date(previous.updatedAt)) {
        const index = entries.indexOf(previous);
        entries[index] = entry;
        seen.set(entry.date, entry);
      }
    });
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    schema: SCHEMA_VERSION,
    settings: {
      enabled,
      weights,
      matrix,
      theme: settings.theme === 'dark' ? 'dark' : 'light',
      onboardingDone: Boolean(settings.onboardingDone),
      researchConsent: Boolean(settings.researchConsent),
      lastForecastAt:
        typeof settings.lastForecastAt === 'string' ? settings.lastForecastAt : null
    },
    entries
  };
}

/**
 * Жёсткая проверка состояния, пришедшего по API.
 * Возвращает { ok, error, state }.
 */
export function validateStateInput(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'state должен быть объектом' };
  if (!Array.isArray(raw.entries)) return { ok: false, error: 'entries должен быть массивом' };
  if (raw.entries.length > MAX_ENTRIES) {
    return { ok: false, error: `слишком много записей (максимум ${MAX_ENTRIES})` };
  }

  for (const item of raw.entries) {
    if (!item || !isValidDateKey(item.date)) {
      return { ok: false, error: 'некорректная дата записи' };
    }
    if (!item.ratings || typeof item.ratings !== 'object') {
      return { ok: false, error: 'ratings должен быть объектом' };
    }
    for (const cat of CATEGORIES) {
      const value = item.ratings[cat];
      if (value === null || value === undefined) continue;
      if (!Number.isInteger(value) || value < 1 || value > 10) {
        return { ok: false, error: `оценка ${cat} должна быть целым числом 1..10` };
      }
    }
    if (item.note !== undefined && (typeof item.note !== 'string' || item.note.length > 500)) {
      return { ok: false, error: 'заметка слишком длинная' };
    }
  }

  const settings = raw.settings;
  if (settings !== undefined) {
    if (!settings || typeof settings !== 'object') {
      return { ok: false, error: 'settings должен быть объектом' };
    }
    if (settings.weights !== undefined) {
      if (!normalizeWeights(settings.weights)) {
        return { ok: false, error: 'weights должен содержать 7 положительных чисел' };
      }
    }
    if (settings.matrix !== undefined) {
      const matrix = settings.matrix;
      const valid =
        Array.isArray(matrix) &&
        matrix.length === CATEGORIES.length &&
        matrix.every(
          (row) =>
            Array.isArray(row) &&
            row.length === CATEGORIES.length &&
            row.every((v) => Number.isFinite(Number(v)) && Number(v) >= 0.1 && Number(v) <= 10)
        );
      if (!valid) return { ok: false, error: 'некорректная матрица AHP' };
    }
  }

  return { ok: true, state: normalizeState(raw) };
}

/** Объединение локального и серверного состояний: по датам побеждает более свежая запись. */
export function mergeStates(local, remote) {
  const a = normalizeState(local);
  const b = normalizeState(remote);
  const byDate = new Map();
  [...a.entries, ...b.entries].forEach((entry) => {
    const current = byDate.get(entry.date);
    if (!current || new Date(entry.updatedAt) > new Date(current.updatedAt)) {
      byDate.set(entry.date, entry);
    }
  });
  const entries = [...byDate.values()].sort((x, y) => (x.date < y.date ? -1 : 1));

  // Настройки: если на сервере пользователь уже прошёл онбординг — берём серверные,
  // иначе сохраняем локальные (пользователь только что настроил приложение).
  const settings = b.settings.onboardingDone || b.entries.length > 0 ? b.settings : a.settings;
  return normalizeState({ schema: SCHEMA_VERSION, settings, entries });
}

export function hasAnyData(state) {
  return Boolean(state?.entries?.length);
}

export function lastEntry(state) {
  const entries = state?.entries || [];
  return entries.length ? entries[entries.length - 1] : null;
}

export function entryByDate(state, date) {
  return (state?.entries || []).find((entry) => entry.date === date) || null;
}

export function isCategoryEnabled(state, cat) {
  return state?.settings?.enabled?.[cat] !== false;
}

export { CATEGORIES, RI, todayKey };
