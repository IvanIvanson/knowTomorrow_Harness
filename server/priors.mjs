import { CATEGORIES } from '../shared/constants.mjs';
import { computeOverall, normalizeState } from '../shared/app-model.mjs';
import { WEEKDAY_NAMES, weekdayIndex } from '../shared/dates.mjs';
import { mean, sd } from '../shared/analytics.mjs';

/**
 * Популяционные приоры для холодного старта.
 * Агрегируются только средние по пользователям: никаких отдельных записей наружу.
 * Порог minUsers защищает от деанонимизации малых групп.
 */
export function computePriors(rows, options = {}) {
  const minUsers = options.minUsers || 5;
  const users = [];
  let totalEntries = 0;

  for (const row of rows) {
    let state;
    try {
      state = normalizeState(JSON.parse(row.json));
    } catch {
      continue;
    }
    if (!state.entries.length) continue;
    totalEntries += state.entries.length;
    const normalizedEntries = state.entries.map((entry) => ({
      ...entry,
      overall: computeOverall(entry.ratings, state.settings.weights, state.settings.enabled)
    }));
    const categoryMeans = {};
    CATEGORIES.forEach((cat) => {
      const values = normalizedEntries
        .map((entry) => entry.ratings?.[cat])
        .filter((value) => Number.isFinite(value));
      categoryMeans[cat] = values.length ? mean(values) : null;
    });
    const overalls = normalizedEntries
      .map((entry) => entry.overall)
      .filter((value) => Number.isFinite(value));
    const weekdayMeans = Array.from({ length: 7 }, (_, index) => {
      const values = normalizedEntries
        .filter((entry) => weekdayIndex(entry.date) === index)
        .map((entry) => entry.overall)
        .filter((value) => Number.isFinite(value));
      return values.length ? mean(values) : null;
    });
    users.push({
      categoryMeans,
      overallMean: overalls.length ? mean(overalls) : null,
      weekdayMeans
    });
  }

  if (users.length < minUsers) {
    return {
      available: false,
      users: users.length,
      minUsers,
      reason: `Для популяционных ориентиров нужно не менее ${minUsers} участников с согласием на анонимную агрегацию.`,
      generatedAt: new Date().toISOString()
    };
  }

  const categories = {};
  CATEGORIES.forEach((cat) => {
    const values = users.map((user) => user.categoryMeans[cat]).filter(Number.isFinite);
    categories[cat] = {
      mean: values.length ? mean(values) : 5.5,
      sd: values.length >= 2 ? sd(values) : 1.8,
      n: values.length
    };
  });

  const overallValues = users.map((user) => user.overallMean).filter(Number.isFinite);
  const weekdays = Array.from({ length: 7 }, (_, index) => {
    const values = users.map((user) => user.weekdayMeans[index]).filter(Number.isFinite);
    return {
      index,
      name: WEEKDAY_NAMES[index],
      mean: values.length ? mean(values) : null,
      n: values.length
    };
  });

  return {
    available: true,
    users: users.length,
    entries: totalEntries,
    minUsers,
    categories,
    overall: {
      mean: overallValues.length ? mean(overallValues) : 5.5,
      sd: overallValues.length >= 2 ? sd(overallValues) : 1.8,
      n: overallValues.length
    },
    weekdays,
    note: 'Анонимные средние по участникам, давшим согласие. Используются только для холодного старта.',
    generatedAt: new Date().toISOString()
  };
}

export function loadPriors(db, config) {
  const rows = db
    .prepare(
      `SELECT s.json
         FROM states s
         JOIN users u ON u.id = s.user_id
        WHERE u.consent_research = 1
        LIMIT 5000`
    )
    .all();
  return computePriors(rows, { minUsers: config.minPriorUsers });
}
