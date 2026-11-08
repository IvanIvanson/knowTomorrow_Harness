/**
 * KnowTomorrow — аналитический движок.
 *
 * Принципы:
 *  - никаких «чёрных ящиков» без объяснения;
 *  - на малых данных сложная модель не выбирается, если не обходит наивный прогноз;
 *  - каждый прогноз сопровождается интервалом, числом наблюдений и проверкой на прошлом.
 *
 * Модуль не имеет зависимостей и работает и в браузере, и в Node.js.
 */

import {
  CATEGORIES,
  CATEGORY_LABELS,
  CR_THRESHOLD,
  RI
} from './constants.mjs';
import {
  addDays,
  daysBetween,
  todayKey,
  WEEKDAY_NAMES,
  weekdayIndex
} from './dates.mjs';
import {
  activeCategories,
  computeOverall,
  normalizeState
} from './app-model.mjs';

// ---------------------------------------------------------------------------
// Базовая математика
// ---------------------------------------------------------------------------

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function mean(values) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

export function variance(values, sample = true) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const m = mean(clean);
  const divisor = sample ? clean.length - 1 : clean.length;
  return clean.reduce((acc, v) => acc + (v - m) ** 2, 0) / divisor;
}

export function sd(values, sample = true) {
  const v = variance(values, sample);
  return v === null ? null : Math.sqrt(v);
}

export function quantile(values, q) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const pos = (clean.length - 1) * clamp(q, 0, 1);
  const base = Math.floor(pos);
  const rest = pos - base;
  if (clean[base + 1] === undefined) return clean[base];
  return clean[base] + rest * (clean[base + 1] - clean[base]);
}

export const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function median(values) {
  return quantile(values, 0.5);
}

function logGamma(x) {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a, b, x) {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Регуляризованная неполная бета-функция I_x(a,b). */
export function incompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Двустороннее p-значение для t-статистики. */
export function studentTwoSidedP(t, df) {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return 1;
  return clamp(incompleteBeta(df / 2, 0.5, df / (df + t * t)), 0, 1);
}

/** Корреляция Пирсона с двусторонним p-значением. */
export function pearson(xs, ys) {
  const pairs = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  const n = pairs.length;
  if (n < 3) return { r: null, n, p: null };
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  pairs.forEach(([x, y]) => {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  });
  if (sxx === 0 || syy === 0) return { r: 0, n, p: 1 };
  const r = clamp(sxy / Math.sqrt(sxx * syy), -1, 1);
  const t = r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
  return { r, n, p: studentTwoSidedP(t, n - 2) };
}

export function cohenD(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a);
  const vb = variance(b);
  if (ma === null || mb === null) return null;
  const na = a.length;
  const nb = b.length;
  const pooled = Math.sqrt(
    Math.max(1e-9, (((na - 1) * (va || 0)) + ((nb - 1) * (vb || 0))) / Math.max(1, na + nb - 2))
  );
  return (ma - mb) / pooled;
}

export function welchTTest(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a) || 0;
  const vb = variance(b) || 0;
  const na = a.length;
  const nb = b.length;
  if (ma === null || mb === null || na < 2 || nb < 2) {
    return { t: null, df: null, p: null, diff: null };
  }
  const se2 = va / na + vb / nb;
  if (se2 <= 0) return { t: 0, df: na + nb - 2, p: 1, diff: ma - mb };
  const t = (ma - mb) / Math.sqrt(se2);
  const df = se2 ** 2 / (
    (va * va) / (na * na * (na - 1)) + (vb * vb) / (nb * nb * (nb - 1))
  );
  return { t, df, p: studentTwoSidedP(t, df), diff: ma - mb };
}

export function pairedTTest(a, b) {
  const diffs = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) diffs.push(a[i] - b[i]);
  }
  const n = diffs.length;
  if (n < 2) return { t: null, df: n - 1, p: null, meanDiff: mean(diffs) };
  const m = mean(diffs);
  const s = sd(diffs);
  if (!s) return { t: 0, df: n - 1, p: 1, meanDiff: m };
  const t = m / (s / Math.sqrt(n));
  return { t, df: n - 1, p: studentTwoSidedP(t, n - 1), meanDiff: m, n };
}

/** Линейный тренд y от x; p — значимость наклона. */
export function linearTrend(xs, ys) {
  const pairs = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  const n = pairs.length;
  if (n < 3) return { slope: null, intercept: null, p: null, n };
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let sxx = 0;
  let sxy = 0;
  pairs.forEach(([x, y]) => {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
  });
  if (sxx === 0) return { slope: 0, intercept: my, p: 1, n };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  pairs.forEach(([x, y]) => {
    sse += (y - (intercept + slope * x)) ** 2;
  });
  const se = Math.sqrt(sse / (n - 2) / sxx);
  const t = se > 0 ? slope / se : 0;
  return { slope, intercept, p: se > 0 ? studentTwoSidedP(t, n - 2) : 1, n };
}

/** Поправка Бенджамини—Хохберга для множественных сравнений. */
export function benjaminiHochberg(pValues) {
  const items = pValues
    .map((p, index) => ({ p: p === null ? 1 : p, index }))
    .sort((a, b) => a.p - b.p);
  const m = items.length;
  const q = new Array(m);
  let previous = 1;
  for (let rank = m - 1; rank >= 0; rank--) {
    const value = Math.min(previous, (items[rank].p * m) / (rank + 1));
    q[items[rank].index] = clamp(value, 0, 1);
    previous = value;
  }
  return q;
}

// ---------------------------------------------------------------------------
// AHP: веса и согласованность
// ---------------------------------------------------------------------------

/** Веса методом геометрического среднего строк (устойчив к малым ошибкам). */
export function ahpWeights(matrix) {
  const n = matrix?.length;
  if (!n) return null;
  const rows = matrix.map((row) =>
    Math.exp(row.reduce((acc, value) => acc + Math.log(Math.max(1e-9, value)), 0) / n)
  );
  const total = rows.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return rows.map((value) => value / total);
}

export function ahpConsistency(matrix, weights = ahpWeights(matrix)) {
  const n = matrix.length;
  if (n <= 2) return { lambdaMax: n, ci: 0, cr: 0 };
  let lambdaMax = 0;
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < n; j++) rowSum += matrix[i][j] * weights[j];
    lambdaMax += rowSum / weights[i];
  }
  lambdaMax /= n;
  const ci = Math.max(0, (lambdaMax - n) / (n - 1));
  const cr = RI[n - 1] > 0 ? ci / RI[n - 1] : 0;
  return { lambdaMax, ci, cr };
}

/**
 * Диагностика AHP: CR, самая несогласованная тройка критериев и совет.
 * Именно тройка, а не абстрактное «пересмотрите всё», помогает пользователю.
 */
export function diagnoseAHP(matrix) {
  const weights = ahpWeights(matrix);
  const { cr, ci, lambdaMax } = ahpConsistency(matrix, weights);
  const n = matrix.length;
  let worst = null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const triple = [
          [matrix[i][i], matrix[i][j], matrix[i][k]],
          [matrix[j][i], matrix[j][j], matrix[j][k]],
          [matrix[k][i], matrix[k][j], matrix[k][k]]
        ];
        const tripleWeights = ahpWeights(triple);
        const tripleCr = ahpConsistency(triple, tripleWeights).cr;
        if (!worst || tripleCr > worst.cr) {
          worst = { i, j, k, cr: tripleCr };
        }
      }
    }
  }
  const ok = cr <= CR_THRESHOLD;
  let advice = ok
    ? 'Суждения достаточно согласованы: можно сохранять веса.'
    : 'Суждения противоречивы. Пересмотрите в первую очередь выделенную тройку сравнений.';
  if (!ok && worst) {
    advice = `Сильнее всего противоречат друг другу «${CATEGORY_LABELS[CATEGORIES[worst.i]]}», «${CATEGORY_LABELS[CATEGORIES[worst.j]]}» и «${CATEGORY_LABELS[CATEGORIES[worst.k]]}». Проверьте три числа между ними.`;
  }
  return {
    weights,
    cr,
    ci,
    lambdaMax,
    ok,
    threshold: CR_THRESHOLD,
    worst: worst
      ? {
          ...worst,
          labels: [CATEGORIES[worst.i], CATEGORIES[worst.j], CATEGORIES[worst.k]].map(
            (cat) => CATEGORY_LABELS[cat]
          )
        }
      : null,
    advice
  };
}

// ---------------------------------------------------------------------------
// Временные ряды и признаки
// ---------------------------------------------------------------------------

const FEATURE_LABELS = {
  lag1: 'вчера',
  lag2: '2 дня назад',
  lag3: '3 дня назад',
  lag7: 'неделю назад',
  mean3: 'среднее за 3 дня',
  mean7: 'среднее за неделю',
  dowSin: 'день недели',
  dowCos: 'день недели',
  gap: 'перерыв в записях'
};

function buildSeries(state) {
  const normalized = normalizeState(state);
  const weights = normalized.settings.weights;
  const enabled = normalized.settings.enabled;
  const entries = normalized.entries.map((entry) => ({
    ...entry,
    overall: computeOverall(entry.ratings, weights, enabled)
  }));
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  return { state: normalized, entries, byDate };
}

function valueAt(series, date, target) {
  const entry = series.byDate.get(date);
  if (!entry) return null;
  if (target === 'overall') return Number.isFinite(entry.overall) ? entry.overall : null;
  const value = entry.ratings?.[target];
  return Number.isFinite(value) ? value : null;
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function featureSpec(target, includeContext = true) {
  const spec = ['lag1', 'lag2', 'lag3', 'lag7', 'mean3', 'mean7', 'dowSin', 'dowCos', 'gap'];
  if (includeContext) {
    CATEGORIES.filter((cat) => cat !== target).forEach((cat) => spec.push(`ctx_${cat}`));
  }
  return spec;
}

function featureLabel(feature) {
  if (feature.startsWith('ctx_')) {
    return `${CATEGORY_LABELS[feature.slice(4)]} вчера`;
  }
  if (feature === 'lag1' && feature.startsWith('lag')) return FEATURE_LABELS[feature] || feature;
  return FEATURE_LABELS[feature] || feature;
}

function previousEntryDate(series, date) {
  let low = 0;
  let high = series.entries.length - 1;
  let result = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (series.entries[mid].date < date) {
      result = series.entries[mid].date;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

function windowMean(series, date, target, days, minCount) {
  const values = [];
  for (let offset = 1; offset <= days; offset++) {
    const value = valueAt(series, addDays(date, -offset), target);
    if (isFiniteNumber(value)) values.push(value);
  }
  if (values.length < minCount) return null;
  return mean(values);
}

function rawFeatures(series, date, target, spec) {
  const values = {};
  const lagOffsets = { lag1: 1, lag2: 2, lag3: 3, lag7: 7 };
  Object.entries(lagOffsets).forEach(([key, offset]) => {
    values[key] = valueAt(series, addDays(date, -offset), target);
  });
  values.mean3 = windowMean(series, date, target, 3, 2);
  values.mean7 = windowMean(series, date, target, 7, 3);
  const wd = weekdayIndex(date);
  values.dowSin = Math.sin((2 * Math.PI * wd) / 7);
  values.dowCos = Math.cos((2 * Math.PI * wd) / 7);
  const previous = previousEntryDate(series, date);
  values.gap = previous ? daysBetween(previous, date) : 30;

  spec.filter((f) => f.startsWith('ctx_')).forEach((feature) => {
    const cat = feature.slice(4);
    values[feature] = valueAt(series, addDays(date, -1), cat);
  });
  return values;
}

function featureVector(values, spec) {
  return spec.map((feature) => {
    const value = values[feature];
    return Number.isFinite(value) ? value : null;
  });
}

function informative(values, spec) {
  return spec.some(
    (feature) =>
      feature !== 'dowSin' &&
      feature !== 'dowCos' &&
      feature !== 'gap' &&
      Number.isFinite(values[feature])
  );
}

function buildRows(series, target, spec) {
  const rows = [];
  series.entries.forEach((entry) => {
    const y = target === 'overall' ? entry.overall : entry.ratings?.[target];
    if (!Number.isFinite(y)) return;
    const values = rawFeatures(series, entry.date, target, spec);
    if (!informative(values, spec)) return;
    rows.push({ date: entry.date, y, values });
  });
  return rows;
}

function featureMedians(rows, spec) {
  const medians = {};
  spec.forEach((feature) => {
    const values = rows
      .map((row) => row.values[feature])
      .filter((value) => Number.isFinite(value));
    medians[feature] = values.length ? median(values) : 0;
  });
  return medians;
}

function impute(values, medians, spec) {
  return spec.map((feature, index) => {
    const value = values[feature];
    return Number.isFinite(value) ? value : medians[feature];
  });
}

function targetValues(series, target) {
  return series.entries
    .map((entry) => (target === 'overall' ? entry.overall : entry.ratings?.[target]))
    .filter((value) => Number.isFinite(value));
}

// ---------------------------------------------------------------------------
// Модели
// ---------------------------------------------------------------------------

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) continue;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= div;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      if (!factor) continue;
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

export function fitRidge(X, y, lambda = 3) {
  const n = X.length;
  const p = X[0]?.length || 0;
  const means = Array.from({ length: p }, (_, j) => mean(X.map((row) => row[j])) || 0);
  const sds = Array.from({ length: p }, (_, j) => {
    const s = sd(X.map((row) => row[j]));
    return s && s > 1e-9 ? s : 1;
  });
  const yMean = mean(y) || 0;
  const ySdRaw = sd(y);
  const ySd = ySdRaw && ySdRaw > 1e-9 ? ySdRaw : 1;

  const Z = X.map((row) => row.map((value, j) => (value - means[j]) / sds[j]));
  const zy = y.map((value) => (value - yMean) / ySd);
  const XtX = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty = Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += Z[i][j] * zy[i];
      for (let k = j; k < p; k++) XtX[j][k] += Z[i][j] * Z[i][k];
    }
  }
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < j; k++) XtX[j][k] = XtX[k][j];
    XtX[j][j] += lambda;
  }
  const beta = solveLinearSystem(XtX, Xty);
  return {
    kind: 'ridge',
    means,
    sds,
    yMean,
    ySd,
    beta,
    lambda,
    predict(raw) {
      let z = 0;
      for (let j = 0; j < p; j++) {
        z += beta[j] * ((raw[j] - means[j]) / sds[j]);
      }
      return yMean + ySd * z;
    }
  };
}

function sse(values) {
  if (!values.length) return 0;
  const m = mean(values);
  return values.reduce((acc, value) => acc + (value - m) ** 2, 0);
}

function buildTree(X, y, indices, depth, options, importance) {
  const target = indices.map((i) => y[i]);
  const nodeValue = mean(target) || 0;
  if (
    depth >= options.maxDepth ||
    indices.length < options.minSamples * 2 ||
    sse(target) < 1e-9
  ) {
    return { leaf: nodeValue };
  }
  const p = X[0].length;
  let best = null;

  for (let feature = 0; feature < p; feature++) {
    const sortedValues = [...new Set(indices.map((i) => X[i][feature]))].sort((a, b) => a - b);
    if (sortedValues.length < 2) continue;
    const candidates = new Set();
    const steps = Math.min(4, sortedValues.length - 1);
    for (let s = 1; s <= steps; s++) {
      const q = s / (steps + 1);
      const value = quantile(sortedValues, q);
      if (value !== null) candidates.add(value);
    }
    for (const threshold of candidates) {
      const left = [];
      const right = [];
      indices.forEach((i) => (X[i][feature] <= threshold ? left : right).push(i));
      if (left.length < options.minSamples || right.length < options.minSamples) continue;
      const gain =
        sse(target) -
        sse(left.map((i) => y[i])) -
        sse(right.map((i) => y[i]));
      if (!best || gain > best.gain) best = { feature, threshold, gain, left, right };
    }
  }

  if (!best || best.gain <= 1e-9) return { leaf: nodeValue };
  importance[best.feature] += best.gain;
  return {
    feature: best.feature,
    threshold: best.threshold,
    left: buildTree(X, y, best.left, depth + 1, options, importance),
    right: buildTree(X, y, best.right, depth + 1, options, importance)
  };
}

function predictTree(tree, row) {
  if (tree.leaf !== undefined) return tree.leaf;
  return row[tree.feature] <= tree.threshold
    ? predictTree(tree.left, row)
    : predictTree(tree.right, row);
}

export function fitGBDT(X, y, options = {}) {
  const opts = {
    trees: 14,
    learningRate: 0.08,
    maxDepth: 2,
    minSamples: 5,
    ...options
  };
  const base = mean(y) || 0;
  const predictions = Array(X.length).fill(base);
  const trees = [];
  const importance = Array(X[0]?.length || 0).fill(0);

  for (let iteration = 0; iteration < opts.trees; iteration++) {
    const residuals = y.map((value, i) => value - predictions[i]);
    if (sse(residuals) < 1e-9) break;
    const indices = X.map((_, i) => i);
    const tree = buildTree(X, residuals, indices, 0, opts, importance);
    trees.push(tree);
    for (let i = 0; i < X.length; i++) {
      predictions[i] += opts.learningRate * predictTree(tree, X[i]);
    }
  }

  const importanceTotal = importance.reduce((a, b) => a + b, 0) || 1;
  return {
    kind: 'gbdt',
    base,
    trees,
    learningRate: opts.learningRate,
    importance: importance.map((value) => value / importanceTotal),
    predict(raw) {
      return trees.reduce(
        (acc, tree) => acc + opts.learningRate * predictTree(tree, raw),
        base
      );
    }
  };
}

function metrics(pairs) {
  if (!pairs.length) return { mae: null, rmse: null, n: 0 };
  const errors = pairs.map((pair) => pair.actual - pair.predicted);
  return {
    mae: mean(errors.map((e) => Math.abs(e))),
    rmse: Math.sqrt(mean(errors.map((e) => e * e))),
    n: pairs.length
  };
}

function evaluateFolds(rows, spec, minComplex) {
  if (rows.length < 6) return null;
  const minTrain = Math.max(4, Math.min(21, Math.floor(rows.length * 0.5)));
  const start = Math.max(minTrain, rows.length - 14);
  const folds = [];

  for (let i = start; i < rows.length; i++) {
    const train = rows.slice(0, i);
    const test = rows[i];
    if (train.length < 4) continue;
    const medians = featureMedians(train, spec);
    const trainX = train.map((row) => impute(row.values, medians, spec));
    const trainY = train.map((row) => row.y);
    const lastY = trainY[trainY.length - 1];
    const meanY = mean(trainY);
    const baseline = { __last: lastY, __mean: meanY };

    let ridge = null;
    let gbdt = null;
    if (train.length >= minComplex) {
      ridge = fitRidge(trainX, trainY, 3);
      gbdt = fitGBDT(trainX, trainY);
    }

    const predict = (kind) => {
      if (kind === 'naive') return baseline.__last;
      if (kind === 'mean') return baseline.__mean;
      const model = kind === 'ridge' ? ridge : gbdt;
      if (!model) return baseline.__mean;
      return model.predict(impute(test.values, medians, spec));
    };

    folds.push({
      date: test.date,
      actual: test.y,
      naive: predict('naive'),
      mean: predict('mean'),
      ridge: predict('ridge'),
      gbdt: predict('gbdt')
    });
  }

  if (folds.length < 2) return null;
  const models = {};
  ['naive', 'mean', 'ridge', 'gbdt'].forEach((kind) => {
    models[kind] = metrics(folds.map((fold) => ({ actual: fold.actual, predicted: fold[kind] })));
  });
  return { folds, models };
}

function chooseModel(models) {
  const order = ['naive', 'mean', 'ridge', 'gbdt'];
  const available = order.filter((kind) => models[kind]?.n && Number.isFinite(models[kind].mae));
  if (!available.length) return 'naive';
  const best = available.reduce((a, b) => (models[a].mae <= models[b].mae ? a : b));
  const bestMae = models[best].mae;
  // Предпочитаем простую модель, если сложная не даёт ощутимого выигрыша.
  for (const kind of order) {
    if (!available.includes(kind)) continue;
    if (models[kind].mae <= bestMae * 1.01 + 0.01) return kind;
  }
  return best;
}

function methodLabel(kind) {
  return {
    'cold-start': 'Холодный старт: среднее и популяционный ориентир',
    naive: 'Наивная модель «завтра = сегодня»',
    mean: 'Среднее по истории',
    ridge: 'Ridge-регрессия (регуляризованная линейная)',
    gbdt: 'Градиентный бустинг (небольшие деревья)'
  }[kind] || kind;
}

function confidenceFor(modelKind, mae, n, foldCount) {
  let score = 0.25;
  if (n >= 5) score = 0.42;
  if (n >= 10) score = 0.56;
  if (n >= 20) score = 0.7;
  if (n >= 40) score = 0.8;
  if (Number.isFinite(mae)) score *= clamp(1.12 - mae / 2.6, 0.55, 1.08);
  if (modelKind === 'naive' || modelKind === 'mean') score *= 0.92;
  if (foldCount < 5) score *= 0.8;
  score = clamp(score, 0.15, 0.9);
  return {
    score,
    label: score >= 0.65 ? 'высокая' : score >= 0.4 ? 'средняя' : 'низкая'
  };
}

/** Уверенность не должна быть «высокой», если проверка не показала преимущества. */
function capConfidence(confidence, validation) {
  if (!validation) return confidence;
  if (!validation.available) {
    confidence.score = Math.min(confidence.score, 0.34);
  } else if (!validation.significant) {
    confidence.score = Math.min(confidence.score, 0.58);
  }
  confidence.label =
    confidence.score >= 0.65 ? 'высокая' : confidence.score >= 0.4 ? 'средняя' : 'низкая';
  return confidence;
}

function priorFor(prior, target) {
  if (!prior) return null;
  if (target === 'overall') return prior.overall || null;
  return prior.categories?.[target] || null;
}

function driversFor(modelKind, model, xRaw, medians, spec, stats) {
  if (!model || (modelKind !== 'ridge' && modelKind !== 'gbdt')) {
    if (modelKind === 'naive') {
      return [
        {
          key: 'lag1',
          label: 'Ваша оценка вчера',
          contribution: Number.isFinite(stats.last) && Number.isFinite(stats.mean)
            ? round(stats.last - stats.mean, 2)
            : 0,
          note: 'Прогноз повторяет последнее значение: модель не нашла более точного правила'
        }
      ];
    }
    const drivers = [
      {
        key: 'mean',
        label: `Среднее за ${stats.n} наблюдений`,
        contribution: 0,
        note: 'Более сложная модель не обошла среднее на проверке'
      }
    ];
    if (Number.isFinite(stats.last) && Number.isFinite(stats.mean)) {
      drivers.push({
        key: 'last',
        label: 'Последнее значение',
        contribution: round(stats.last - stats.mean, 2),
        note: stats.last > stats.mean ? 'выше вашего среднего' : 'ниже вашего среднего'
      });
    }
    if (stats.horizon) {
      drivers.push({
        key: 'weekday',
        label: `День недели: ${WEEKDAY_NAMES[weekdayIndex(stats.horizon)]}`,
        contribution: 0,
        note: 'Учтён в календарных признаках модели'
      });
    }
    return drivers;
  }

  const x = impute(xRaw, medians, spec);
  const contributions = [];

  if (modelKind === 'ridge') {
    spec.forEach((feature, j) => {
      const z = (x[j] - model.means[j]) / model.sds[j];
      const contribution = model.beta[j] * z * model.ySd;
      if (Math.abs(contribution) >= 0.02) {
        contributions.push({
          key: feature,
          label: featureLabel(feature),
          contribution: round(contribution, 2),
          note: contribution > 0 ? 'тянет оценку вверх' : 'тянет оценку вниз'
        });
      }
    });
  } else {
    const basePrediction = model.predict(x);
    const baseRow = spec.map((_, j) => medians[spec[j]]);
    spec.forEach((feature, j) => {
      const alternative = [...x];
      alternative[j] = baseRow[j];
      const contribution = basePrediction - model.predict(alternative);
      if (Math.abs(contribution) >= 0.02) {
        contributions.push({
          key: feature,
          label: featureLabel(feature),
          contribution: round(contribution, 2),
          note: 'приблизительный вклад'
        });
      }
    });
  }

  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return contributions.slice(0, 4);
}

function buildValidation(evaluation, chosen, target) {
  if (!evaluation) {
    return {
      available: false,
      folds: 0,
      chosen,
      models: {},
      improvementPct: null,
      pValue: null,
      significant: false,
      verdict:
        'Пока слишком мало данных для проверки на прошлом. Прогноз ниже — осторожная гипотеза, а не результат валидированной модели.'
    };
  }
  const models = evaluation.models;
  const naiveMae = models.naive?.mae;
  const chosenMae = models[chosen]?.mae;
  const errorsChosen = evaluation.folds.map((fold) => Math.abs(fold.actual - fold[chosen]));
  const errorsNaive = evaluation.folds.map((fold) => Math.abs(fold.actual - fold.naive));
  const test = pairedTTest(errorsChosen, errorsNaive);
  const improvementPct =
    Number.isFinite(naiveMae) && naiveMae > 0 && Number.isFinite(chosenMae)
      ? ((naiveMae - chosenMae) / naiveMae) * 100
      : null;
  const significant = Boolean(test.p !== null && test.p < 0.05 && improvementPct > 0);

  let verdict;
  if (improvementPct === null) {
    verdict = 'Не удалось сравнить модели: слишком мало исторических периодов.';
  } else if (improvementPct > 0 && significant) {
    verdict = `На проверке по прошлым дням модель обходит «завтра = сегодня» на ${round(improvementPct, 1)}% по MAE (p = ${round(test.p, 3)}). Это ещё не гарантия на будущее.`;
  } else if (improvementPct > 2) {
    verdict = `Средняя ошибка ниже наивной на ${round(improvementPct, 1)}%, но различие статистически не значимо (p = ${round(test.p, 3)}). На малых данных это ожидаемо.`;
  } else {
    verdict = 'Модель не обходит наивный прогноз «завтра = сегодня». Для малых данных это нормальный результат; в интерфейсе честно показан именно он.';
  }

  return {
    available: true,
    folds: evaluation.folds.length,
    from: evaluation.folds[0]?.date || null,
    to: evaluation.folds[evaluation.folds.length - 1]?.date || null,
    chosen,
    models,
    improvementPct,
    pValue: test.p,
    meanAbsDiff: test.meanDiff,
    significant,
    verdict,
    target
  };
}

function predictionInterval(residuals, value, fallbackSd) {
  const rmse = residuals.length
    ? Math.sqrt(mean(residuals.map((residual) => residual ** 2)))
    : null;
  const scale = Number.isFinite(rmse) ? rmse : fallbackSd || 1.8;
  const spread = clamp(1.28 * Math.max(scale, 0.65), 0.9, 3.6);
  return {
    low: round(clamp(value - spread, 1, 10), 1),
    high: round(clamp(value + spread, 1, 10), 1)
  };
}

/**
 * Прогноз одной цели (общая оценка или конкретная категория).
 * @param {object} series — результат buildSeries
 * @param {string} target — 'overall' | категория
 * @param {object} options — { prior }
 */
export function forecastTarget(series, target, options = {}) {
  const spec = featureSpec(target, true);
  const allRows = buildRows(series, target, spec);
  // Для модели достаточно последнего года: дальше растёт только время обучения,
  // а не качество. Паттерны при этом считаются по всей истории.
  const rows = allRows.slice(-365);
  const values = targetValues(series, target);
  const n = values.length;
  const lastEntry = series.entries[series.entries.length - 1] || null;
  const lastDate = lastEntry?.date || todayKey();
  const horizon = addDays(lastDate, 1);
  const latest = n ? values[values.length - 1] : null;
  const prior = priorFor(options.prior, target);
  const personalMean = n ? mean(values) : null;

  // Холодный старт: данных мало — не притворяемся, что обучили модель.
  if (n < 5 || rows.length < 4) {
    const priorMean = Number.isFinite(prior?.mean) ? prior.mean : 5.5;
    const weight = n / (n + 6);
    const point = n ? personalMean * weight + priorMean * (1 - weight) : priorMean;
    const spread = Math.max(1.2, Number.isFinite(prior?.sd) ? prior.sd * 1.28 : 1.8);
    const value = round(clamp(point, 1, 10), 1);
    return {
      target,
      label: target === 'overall' ? CATEGORY_LABELS.overall : CATEGORY_LABELS[target],
      available: true,
      value,
      low: round(clamp(value - spread, 1, 10), 1),
      high: round(clamp(value + spread, 1, 10), 1),
      last: latest === null ? null : round(latest, 1),
      trend: latest === null ? null : round(value - latest, 1),
      n,
      method: 'cold-start',
      methodLabel: methodLabel('cold-start'),
      confidence: confidenceFor('cold-start', null, n, 0),
      drivers: [
        {
          key: 'prior',
          label: prior ? 'Популяционный ориентир и ваше среднее' : 'Нейтральный стартовый ориентир',
          contribution: 0,
          note: 'Данных для персональной модели пока мало'
        }
      ],
      validation: buildValidation(null, 'cold-start', target),
      horizon
    };
  }

  const evaluation = evaluateFolds(rows, spec, 10);
  const chosen = evaluation ? chooseModel(evaluation.models) : 'mean';
  const medians = featureMedians(rows, spec);
  const trainX = rows.map((row) => impute(row.values, medians, spec));
  const trainY = rows.map((row) => row.y);
  const lastY = trainY[trainY.length - 1];
  const meanY = mean(trainY);

  let model = null;
  if (chosen === 'ridge') model = fitRidge(trainX, trainY, 3);
  if (chosen === 'gbdt') model = fitGBDT(trainX, trainY);

  const nextValues = rawFeatures(series, horizon, target, spec);
  let point;
  if (chosen === 'naive') point = latest;
  else if (chosen === 'mean') point = meanY;
  else point = model.predict(impute(nextValues, medians, spec));

  if (!Number.isFinite(point)) {
    point = latest ?? meanY ?? 5.5;
  }

  const chosenErrors = evaluation
    ? evaluation.folds.map((fold) => fold.actual - fold[chosen])
    : [];
  const fallbackSd = sd(values);
  const interval = predictionInterval(chosenErrors, clamp(point, 1, 10), fallbackSd);
  const validation = buildValidation(evaluation, chosen, target);
  const confidence = capConfidence(
    confidenceFor(
      chosen,
      evaluation?.models?.[chosen]?.mae,
      n,
      evaluation?.folds.length || 0
    ),
    validation
  );
  const drivers = driversFor(chosen, model, nextValues, medians, spec, {
    n,
    last: latest,
    mean: meanY,
    horizon
  });
  const value = round(clamp(point, 1, 10), 1);

  return {
    target,
    label: target === 'overall' ? CATEGORY_LABELS.overall : CATEGORY_LABELS[target],
    available: true,
    value,
    low: interval.low,
    high: interval.high,
    last: latest === null ? null : round(latest, 1),
    trend: latest === null ? null : round(value - latest, 1),
    n,
    samples: rows.length,
    method: chosen,
    methodLabel: methodLabel(chosen),
    confidence,
    drivers,
    validation,
    horizon
  };
}

// ---------------------------------------------------------------------------
// Паттерны, корреляции, сводка
// ---------------------------------------------------------------------------

function effectTest(series, cat, mode, lag = 1) {
  const group = [];
  const rest = [];
  series.entries.forEach((entry) => {
    const value = entry.ratings?.[cat];
    if (!Number.isFinite(value)) return;
    const future = valueAt(series, addDays(entry.date, lag), 'overall');
    if (!Number.isFinite(future)) return;
    const isGroup = mode === 'low' ? value <= 4 : value >= 8;
    (isGroup ? group : rest).push(future);
  });
  if (group.length < 3 || rest.length < 4) return null;
  const diff = mean(group) - mean(rest);
  const d = cohenD(group, rest);
  const test = welchTTest(group, rest);
  return {
    type: mode,
    category: cat,
    lag,
    diff,
    d,
    p: test.p,
    nGroup: group.length,
    nRest: rest.length,
    groupMean: mean(group),
    restMean: mean(rest)
  };
}

function correlationRows(series) {
  const rows = [];
  for (let lag = 1; lag <= 3; lag++) {
    CATEGORIES.forEach((cat) => {
      const xs = [];
      const ys = [];
      series.entries.forEach((entry) => {
        const value = entry.ratings?.[cat];
        const future = valueAt(series, addDays(entry.date, lag), 'overall');
        if (Number.isFinite(value) && Number.isFinite(future)) {
          xs.push(value);
          ys.push(future);
        }
      });
      const result = pearson(xs, ys);
      if (result.n >= 6 && result.r !== null) {
        rows.push({ category: cat, lag, r: result.r, p: result.p, n: result.n });
      }
    });
  }
  return rows;
}

function summarize(series) {
  const entries = series.entries;
  const overalls = entries.map((entry) => entry.overall).filter((value) => Number.isFinite(value));
  const last = entries[entries.length - 1] || null;
  const first = entries[0] || null;
  const now = todayKey();
  const streak = (() => {
    let cursor = series.byDate.has(now) ? now : addDays(now, -1);
    let count = 0;
    while (cursor && series.byDate.has(cursor)) {
      count++;
      cursor = addDays(cursor, -1);
    }
    return count;
  })();

  const recentCutoff = addDays(now, -29);
  const previousCutoff = addDays(now, -59);
  const recent = entries.filter((entry) => entry.date >= recentCutoff);
  const previous = entries.filter(
    (entry) => entry.date >= previousCutoff && entry.date < recentCutoff
  );
  const recentAvg = mean(recent.map((entry) => entry.overall));
  const previousAvg = mean(previous.map((entry) => entry.overall));

  const weekdayMeans = Array.from({ length: 7 }, (_, index) => {
    const values = entries
      .filter((entry) => weekdayIndex(entry.date) === index)
      .map((entry) => entry.overall)
      .filter((value) => Number.isFinite(value));
    return {
      index,
      name: WEEKDAY_NAMES[index],
      mean: values.length ? mean(values) : null,
      n: values.length
    };
  });

  const trend = linearTrend(
    entries.map((entry) => daysBetween(first?.date || entry.date, entry.date)),
    entries.map((entry) => entry.overall)
  );

  const avgByCategory = {};
  CATEGORIES.forEach((cat) => {
    const values = entries.map((entry) => entry.ratings?.[cat]).filter((value) => Number.isFinite(value));
    avgByCategory[cat] = {
      mean: values.length ? mean(values) : null,
      sd: values.length >= 2 ? sd(values) : null,
      n: values.length
    };
  });

  const sortedByOverall = [...entries]
    .filter((entry) => Number.isFinite(entry.overall))
    .sort((a, b) => b.overall - a.overall);

  const daysSpan = first && last ? daysBetween(first.date, last.date) + 1 : 0;

  return {
    totalEntries: entries.length,
    daysSpan,
    coverage: daysSpan > 0 ? entries.length / daysSpan : 0,
    firstDate: first?.date || null,
    lastDate: last?.date || null,
    avgOverall: overalls.length ? mean(overalls) : null,
    avgByCategory,
    bestDay: sortedByOverall[0]
      ? { date: sortedByOverall[0].date, overall: sortedByOverall[0].overall }
      : null,
    worstDay: sortedByOverall.length
      ? {
          date: sortedByOverall[sortedByOverall.length - 1].date,
          overall: sortedByOverall[sortedByOverall.length - 1].overall
        }
      : null,
    weekdayMeans,
    trend: {
      slopePerDay: trend.slope,
      slopePerWeek: trend.slope === null ? null : trend.slope * 7,
      p: trend.p,
      n: trend.n
    },
    streak,
    last30: {
      avg: recentAvg,
      delta: recentAvg !== null && previousAvg !== null ? recentAvg - previousAvg : null,
      n: recent.length
    }
  };
}

/** Паттерны и корреляции: только предварительные связи, без причинных утверждений. */
export function analyzeState(state, options = {}) {
  const series = options.series || buildSeries(state);
  if (!series.entries.length) {
    return {
      available: false,
      summary: null,
      correlations: [],
      effects: [],
      patterns: [],
      message: 'Пока нет записей. Добавьте первый день — и здесь появятся связи.'
    };
  }

  const summary = summarize(series);
  const correlations = correlationRows(series);
  const effects = [];
  CATEGORIES.forEach((cat) => {
    ['low', 'high'].forEach((mode) => {
      const result = effectTest(series, cat, mode, 1);
      if (result) effects.push(result);
    });
  });

  const allP = [...correlations.map((row) => row.p), ...effects.map((row) => row.p)];
  const qValues = benjaminiHochberg(allP);
  correlations.forEach((row, index) => {
    row.q = qValues[index];
  });
  effects.forEach((row, index) => {
    row.q = qValues[correlations.length + index];
  });

  const patterns = [];

  effects.forEach((effect) => {
    const label = CATEGORY_LABELS[effect.category];
    const direction = effect.diff >= 0 ? 'выше' : 'ниже';
    patterns.push({
      kind: effect.type === 'low' ? 'low' : 'high',
      category: effect.category,
      title:
        effect.type === 'low'
          ? `Если «${label}» ≤ 4`
          : `Если «${label}» ≥ 8`,
      effect: effect.diff,
      d: effect.d,
      p: effect.p,
      q: effect.q,
      n: effect.nGroup + effect.nRest,
      text:
        effect.type === 'low'
          ? `После дней, когда оценка «${label}» была ≤ 4, следующий день оказывался в среднем на ${round(Math.abs(effect.diff), 1)} балла ${direction}, чем после остальных (${round(effect.groupMean, 1)} против ${round(effect.restMean, 1)}, n = ${effect.nGroup}/${effect.nRest}, p = ${round(effect.p, 3)}).`
          : `После дней, когда оценка «${label}» была ≥ 8, следующий день оказывался в среднем на ${round(Math.abs(effect.diff), 1)} балла ${direction} (${round(effect.groupMean, 1)} против ${round(effect.restMean, 1)}, n = ${effect.nGroup}/${effect.nRest}, p = ${round(effect.p, 3)}).`
    });
  });

  correlations
    .filter((row) => Math.abs(row.r) >= 0.2)
    .forEach((row) => {
      const label = CATEGORY_LABELS[row.category];
      const direction = row.r > 0 ? 'выше' : 'ниже';
      patterns.push({
        kind: 'correlation',
        category: row.category,
        lag: row.lag,
        title: `«${label}» и оценка через ${row.lag} дн.`,
        effect: row.r,
        r: row.r,
        p: row.p,
        q: row.q,
        n: row.n,
        text: `Чем выше «${label}» сегодня, тем ${direction} общая оценка через ${row.lag} дн. (r = ${round(row.r, 2)}, n = ${row.n}, p = ${round(row.p, 3)}). Это связь, а не доказанная причина.`
      });
    });

  patterns.sort((a, b) => {
    const aScore = Math.abs(a.kind === 'correlation' ? a.r * 2 : a.effect);
    const bScore = Math.abs(b.kind === 'correlation' ? b.r * 2 : b.effect);
    return bScore - aScore;
  });

  return {
    available: true,
    summary,
    correlations: correlations.sort((a, b) => Math.abs(b.r) - Math.abs(a.r)),
    effects: effects.sort((a, b) => Math.abs(b.d || 0) - Math.abs(a.d || 0)),
    patterns: patterns.slice(0, 8),
    multipleComparisons: { tests: allP.length, method: 'Benjamini–Hochberg' },
    message: patterns.length
      ? 'Это предварительные связи в ваших данных. Они не доказывают причинность.'
      : 'Пока устойчивых связей не видно. Это тоже результат: продолжайте отмечать дни.'
  };
}

// ---------------------------------------------------------------------------
// Полный прогноз
// ---------------------------------------------------------------------------

/**
 * Прогноз по всем активным категориям и общей оценке.
 * @param {object} state
 * @param {object} options — { prior }
 */
export function forecastAll(state, options = {}) {
  const series = buildSeries(state);
  const enabled = activeCategories(series.state);
  const categories = {};
  const items = [];

  enabled.forEach((cat) => {
    const forecast = forecastTarget(series, cat, options);
    categories[cat] = forecast;
    if (forecast.n > 0) items.push({ cat, forecast });
  });

  const lastOverall = series.entries.length
    ? series.entries[series.entries.length - 1].overall
    : null;

  const weightOf = (cat) => {
    const index = CATEGORIES.indexOf(cat);
    const weight = series.state.settings.weights[index];
    return Number.isFinite(weight) && weight > 0 ? weight : 0;
  };

  let overall = null;
  if (items.length) {
    const totalWeight = items.reduce((acc, item) => acc + weightOf(item.cat), 0) || items.length;
    const effective = (item) => (weightOf(item.cat) || 1) / totalWeight;
    const value = items.reduce((acc, item) => acc + item.forecast.value * effective(item), 0);
    const low = items.reduce((acc, item) => acc + item.forecast.low * effective(item), 0);
    const high = items.reduce((acc, item) => acc + item.forecast.high * effective(item), 0);
    const confidenceScore = items.reduce(
      (acc, item) => acc + item.forecast.confidence.score * effective(item),
      0
    );
    const direct = forecastTarget(series, 'overall', options);
    const overallConfidence = capConfidence(
      confidenceFor(
        direct.method,
        direct.validation?.models?.[direct.method]?.mae,
        series.entries.length,
        direct.validation?.folds || 0
      ),
      direct.validation
    );

    const driverContributions = items.map((item) => {
      const lastValue = item.forecast.last;
      const contribution =
        Number.isFinite(lastValue) ? effective(item) * (item.forecast.value - lastValue) : 0;
      return {
        key: item.cat,
        label: CATEGORY_LABELS[item.cat],
        contribution: round(contribution, 2),
        note:
          contribution > 0
            ? 'тянет общую оценку вверх'
            : contribution < 0
              ? 'тянет общую оценку вниз'
              : 'без заметного изменения'
      };
    });
    driverContributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    overall = {
      target: 'overall',
      label: CATEGORY_LABELS.overall,
      value: round(clamp(value, 1, 10), 1),
      low: round(clamp(low, 1, 10), 1),
      high: round(clamp(high, 1, 10), 1),
      last: lastOverall === null ? null : round(lastOverall, 1),
      trend: lastOverall === null ? null : round(value - lastOverall, 1),
      n: series.entries.length,
      method: 'composition',
      methodLabel: 'Взвешенная композиция покритериальных прогнозов',
      confidence: overallConfidence,
      confidenceScore,
      drivers: driverContributions.slice(0, 4),
      validation: direct.validation,
      contextValidation: Object.fromEntries(
        Object.entries(categories).map(([cat, forecast]) => [cat, forecast.validation])
      ),
      horizon: direct.horizon
    };
  }

  const analysis = analyzeState(state, { series });
  const generatedAt = new Date().toISOString();
  const lastDate = series.entries.length
    ? series.entries[series.entries.length - 1].date
    : todayKey();

  return {
    generatedAt,
    available: series.entries.length > 0,
    nEntries: series.entries.length,
    horizon: addDays(lastDate, 1),
    lastEntryDate: series.entries.length ? lastDate : null,
    enabled,
    categories,
    overall,
    analysis,
    priorUsed: Boolean(options.prior),
    disclaimer:
      'Это гипотезы на основе ваших прошлых записей, а не предсказание будущего и не медицинская рекомендация.',
    limitations: [
      'Данных мало: выводы предварительные и могут измениться после новых записей.',
      'Связи в дневнике не доказывают причинность — это корреляции и различия групп.',
      'Модель не знает о событиях, которых нет в записях.',
      'Интервалы отражают ошибку на прошлых днях, но не гарантируют будущую точность.'
    ]
  };
}

// ---------------------------------------------------------------------------
// Вспомогательные экспорты для тестов и интерфейса
// ---------------------------------------------------------------------------

export { buildSeries, featureSpec, featureLabel, methodLabel };
