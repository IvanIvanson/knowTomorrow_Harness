import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ahpWeights,
  ahpConsistency,
  analyzeState,
  benjaminiHochberg,
  buildSeries,
  cohenD,
  diagnoseAHP,
  forecastAll,
  forecastTarget,
  mean,
  pairedTTest,
  pearson,
  studentTwoSidedP
} from '../shared/analytics.mjs';
import { generateDemoState, blankState } from '../shared/demo.mjs';
import { CATEGORIES, DEFAULT_WEIGHTS, RI } from '../shared/constants.mjs';
import {
  computeOverall,
  defaultEnabled,
  mergeStates,
  normalizeState,
  validateStateInput
} from '../shared/app-model.mjs';

const consistentMatrix = (() => {
  const n = CATEGORIES.length;
  const m = Array.from({ length: n }, () => Array(n).fill(1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) m[i][j] = DEFAULT_WEIGHTS[i] / DEFAULT_WEIGHTS[j];
  }
  return m;
})();

test('AHP: веса нормированы, идеально согласованная матрица даёт CR ≈ 0', () => {
  const weights = ahpWeights(consistentMatrix);
  assert.equal(weights.length, CATEGORIES.length);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const { cr } = ahpConsistency(consistentMatrix, weights);
  assert.ok(cr < 0.001, `CR должен быть близок к нулю, получено ${cr}`);
});

test('AHP: противоречивая матрица даёт CR > 0.1 и указывает проблемную тройку', () => {
  const matrix = Array.from({ length: 7 }, (_, i) =>
    Array.from({ length: 7 }, (_, j) => (i === j ? 1 : 1))
  );
  matrix[0][1] = 9;
  matrix[1][0] = 1 / 9;
  matrix[1][2] = 9;
  matrix[2][1] = 1 / 9;
  matrix[0][2] = 1 / 9;
  matrix[2][0] = 9;
  const diagnosis = diagnoseAHP(matrix);
  assert.ok(diagnosis.cr > 0.1, `CR должен быть большим, получено ${diagnosis.cr}`);
  assert.equal(diagnosis.ok, false);
  assert.ok(diagnosis.worst);
  assert.equal(diagnosis.worst.labels.length, 3);
  assert.match(diagnosis.advice, /Пересмотрите|противоречат/);
});

test('AHP: RI соответствует числу критериев', () => {
  assert.equal(RI.length, 10);
  assert.equal(RI[6], 1.32);
});

test('Статистика: корреляция, p-значение и поправка на множественные сравнения', () => {
  const perfect = pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
  assert.equal(perfect.r, 1);
  assert.ok(perfect.p < 0.001);

  const moderate = pearson(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [2, 1, 4, 3, 6, 5, 8, 7, 10, 9]
  );
  assert.ok(moderate.r > 0.8 && moderate.r < 1);

  const p = studentTwoSidedP(2.1, 18);
  assert.ok(p > 0.04 && p < 0.06, `p=${p}`);

  const q = benjaminiHochberg([0.01, 0.04, 0.2, 0.5]);
  assert.equal(q.length, 4);
  assert.ok(q[0] <= q[1] && q[1] <= q[2] && q[2] <= q[3]);
  assert.ok(q[0] <= 0.04);
});

test('Статистика: парный тест и размер эффекта', () => {
  const same = pairedTTest([1, 2, 3], [1, 2, 3]);
  assert.equal(same.p, 1);
  const d = cohenD([8, 8, 8, 8], [4, 4, 4, 4]);
  assert.ok(d > 3);
  assert.equal(mean([1, 2, null, 3]), 2);
});

test('Веса категорий: общая оценка перенормируется по заполненным категориям', () => {
  const weights = [0.5, 0.5, 0, 0, 0, 0, 0];
  const overall = computeOverall({ wellbeing: 8, home: 4 }, weights, defaultEnabled());
  assert.equal(overall, 6);
  assert.equal(computeOverall({}, weights, defaultEnabled()), null);
});

test('Оценка: пустая и две записи — холодный старт, а не ложная уверенность', () => {
  const state = blankState();
  let forecast = forecastAll(state);
  assert.equal(forecast.available, false);

  state.entries = [
    {
      date: '2026-01-01',
      ratings: Object.fromEntries(CATEGORIES.map((cat) => [cat, 6])),
      updatedAt: '2026-01-01T10:00:00Z'
    },
    {
      date: '2026-01-02',
      ratings: Object.fromEntries(CATEGORIES.map((cat) => [cat, 7])),
      updatedAt: '2026-01-02T10:00:00Z'
    }
  ];
  forecast = forecastAll(state);
  assert.equal(forecast.available, true);
  assert.ok(forecast.overall);
  for (const cat of CATEGORIES) {
    assert.equal(forecast.categories[cat].method, 'cold-start');
    assert.equal(forecast.categories[cat].confidence.label, 'низкая');
    assert.ok(forecast.categories[cat].low <= forecast.categories[cat].value);
    assert.ok(forecast.categories[cat].value <= forecast.categories[cat].high);
  }
});

test('Прогноз по демо-данным: все критерии, интервалы и валидация присутствуют', () => {
  const state = generateDemoState({ days: 70 });
  const started = performance.now();
  const forecast = forecastAll(state);
  const elapsed = performance.now() - started;

  assert.ok(elapsed < 6000, `прогноз слишком медленный: ${elapsed.toFixed(0)} мс`);
  assert.equal(forecast.available, true);
  assert.ok(forecast.overall);
  assert.ok(forecast.overall.value >= 1 && forecast.overall.value <= 10);
  assert.ok(forecast.overall.low <= forecast.overall.value);
  assert.ok(forecast.overall.high >= forecast.overall.value);
  assert.match(forecast.disclaimer, /гипотез/i);

  for (const cat of CATEGORIES) {
    const item = forecast.categories[cat];
    assert.ok(item, `нет прогноза для ${cat}`);
    assert.ok(Number.isFinite(item.value), `нечисловой прогноз для ${cat}`);
    assert.ok(item.value >= 1 && item.value <= 10);
    assert.ok(item.low >= 1 && item.high <= 10);
    assert.ok(item.low <= item.value && item.value <= item.high);
    assert.ok(item.n > 0);
    assert.ok(item.method);
    assert.ok(item.confidence.label);
    assert.ok(Array.isArray(item.drivers));
    assert.ok(item.validation);
  }

  const validation = forecast.overall.validation;
  assert.equal(validation.available, true);
  assert.ok(validation.folds >= 2);
  assert.ok(validation.models.naive.mae > 0);
  assert.ok(validation.models[validation.chosen].rmse > 0);
  assert.match(validation.verdict, /MAE|модель|прогноз|ошибка|наивн/i);

  const lowSum = CATEGORIES.reduce((acc, cat) => {
    const index = CATEGORIES.indexOf(cat);
    return acc + forecast.categories[cat].value * state.settings.weights[index];
  }, 0);
  assert.ok(Math.abs(lowSum - forecast.overall.value) < 0.15);
});

test('Паттерны: демо-данные воспроизводят эффект неживой природы на следующий день', () => {
  const state = generateDemoState({ days: 90, seed: 777 });
  const analysis = analyzeState(state);
  assert.equal(analysis.available, true);
  assert.ok(analysis.patterns.length > 0);
  const inanimate = analysis.effects.find(
    (effect) => effect.category === 'inanimate' && effect.type === 'low'
  );
  assert.ok(inanimate, 'ожидался эффект низкой неживой природы');
  assert.ok(inanimate.diff < 0, 'эффект должен быть отрицательным');
  assert.ok(inanimate.p < 0.1, `p=${inanimate.p}`);
  assert.ok(analysis.correlations.length > 0);
  assert.ok(analysis.correlations.every((row) => row.q !== undefined));
});

test('Отключённые категории не попадают в прогноз, веса перенормируются', () => {
  const state = generateDemoState({ days: 40 });
  state.settings.enabled.living = false;
  state.settings.enabled.street = false;
  const forecast = forecastAll(state);
  assert.equal(forecast.categories.living, undefined);
  assert.equal(forecast.categories.street, undefined);
  assert.ok(forecast.categories.wellbeing);
  assert.equal(forecast.overall.value >= 1, true);
});

test('Слияние состояний: более свежая запись побеждает, записи не теряются', () => {
  const local = normalizeState({
    settings: { onboardingDone: false },
    entries: [
      {
        date: '2026-01-01',
        ratings: Object.fromEntries(CATEGORIES.map((cat) => [cat, 5])),
        updatedAt: '2026-01-01T10:00:00Z'
      }
    ]
  });
  const remote = normalizeState({
    settings: { onboardingDone: true },
    entries: [
      {
        date: '2026-01-01',
        ratings: Object.fromEntries(CATEGORIES.map((cat) => [cat, 8])),
        updatedAt: '2026-01-01T12:00:00Z'
      },
      {
        date: '2026-01-02',
        ratings: Object.fromEntries(CATEGORIES.map((cat) => [cat, 7])),
        updatedAt: '2026-01-02T10:00:00Z'
      }
    ]
  });
  const merged = mergeStates(local, remote);
  assert.equal(merged.entries.length, 2);
  assert.equal(merged.entries[0].ratings.wellbeing, 8);
  assert.equal(merged.settings.onboardingDone, true);
});

test('Валидация состояния отклоняет мусор и принимает корректные данные', () => {
  const badDate = validateStateInput({ entries: [{ date: '2026-13-40', ratings: {} }] });
  assert.equal(badDate.ok, false);

  const badRating = validateStateInput({
    entries: [{ date: '2026-01-01', ratings: { wellbeing: 42 } }]
  });
  assert.equal(badRating.ok, false);

  const good = validateStateInput({
    entries: [
      {
        date: '2026-01-01',
        ratings: { wellbeing: 7, home: 6 },
        note: 'ok',
        updatedAt: '2026-01-01T10:00:00Z'
      }
    ],
    settings: { weights: [...DEFAULT_WEIGHTS] }
  });
  assert.equal(good.ok, true);
  assert.equal(good.state.entries.length, 1);
  assert.equal(good.state.entries[0].ratings.wellbeing, 7);
});

test('Прогноз одной цели детерминирован при одном и том же состоянии', () => {
  const state = generateDemoState({ days: 45 });
  const series = buildSeries(state);
  const first = forecastTarget(series, 'wellbeing');
  const second = forecastTarget(series, 'wellbeing');
  assert.equal(first.value, second.value);
  assert.equal(first.low, second.low);
  assert.equal(first.method, second.method);
  assert.deepEqual(first.drivers, second.drivers);
});
