/**
 * Демонстрационный набор данных.
 * Сгенерирован детерминированно и НЕ является реальными данными пользователей.
 * Нужен для знакомства с приложением и сквозных тестов.
 */

import { CATEGORIES, DEFAULT_WEIGHTS } from './constants.mjs';
import { addDays, todayKey } from './dates.mjs';
import { computeOverall, defaultEnabled, matrixFromWeights, normalizeState } from './app-model.mjs';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNormal(random) {
  return () => {
    const u = Math.max(1e-9, random());
    const v = Math.max(1e-9, random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

const clampRating = (value) => Math.max(1, Math.min(10, Math.round(value)));

/**
 * @param {object} options { days=56, seed=20241108, endDate=today }
 */
export function generateDemoState(options = {}) {
  const days = Math.max(20, Math.min(180, options.days || 56));
  const seed = options.seed || 20241108;
  const endDate = options.endDate || todayKey();
  const random = mulberry32(seed);
  const normal = makeNormal(random);
  const weights = [...DEFAULT_WEIGHTS];
  const enabled = defaultEnabled();

  const entries = [];
  let previous = null;
  let inanimateShock = 0;

  for (let index = days - 1; index >= 0; index--) {
    const date = addDays(endDate, -index);
    const weekday = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;

    // Сломанная техника/транспорт: редкое событие, которое тянет вниз и сегодня, и завтра.
    if (random() < 0.14) inanimateShock = 1;
    const inanimate = inanimateShock
      ? clampRating(3.2 + normal() * 0.7)
      : clampRating(7.4 + normal() * 1.1);
    const living = random() < 0.12
      ? clampRating(3.4 + normal() * 0.8)
      : clampRating(7.2 + normal() * 1.2);

    const weather = clampRating(6.4 - Math.cos((index / 14) * Math.PI) * 0.8 + normal() * 1.3);
    const workBase = 6.4 - (weekday === 0 ? 1.15 : 0) + (weekday === 4 ? 0.45 : 0);
    const work = clampRating(workBase + normal() * 1.25);
    const street = clampRating(6.8 + normal() * 1.3);

    const shockYesterday = Boolean(previous && previous.inanimate <= 4);
    const hangover = shockYesterday ? -1.6 : 0;
    const homeLag = shockYesterday ? -0.8 : 0;
    const workLag = previous && previous.work <= 4 ? -0.8 : 0;
    const wellbeing = clampRating(
      6.7 + Math.sin(index / 5.5) * 0.35 + hangover + workLag + normal() * 1.0
    );
    const home = clampRating(7.2 + homeLag + normal() * 1.05);

    const ratings = {
      wellbeing,
      home,
      work,
      street,
      weather,
      inanimate,
      living
    };
    const overall = computeOverall(ratings, weights, enabled);

    const events = [];
    if (inanimateShock) events.push('техника/транспорт подвели');
    if (living <= 4) events.push('контакт с животными оставил след');
    if (work <= 4) events.push('тяжёлый день на работе');

    entries.push({
      date,
      ratings,
      note: events.length ? `Демо-запись: ${events.join('; ')}.` : '',
      updatedAt: new Date(`${date}T20:00:00`).toISOString(),
      overall
    });

    previous = { ...ratings, overall };
    inanimateShock = 0;
  }

  const state = normalizeState({
    schema: 2,
    settings: {
      enabled,
      weights,
      matrix: matrixFromWeights(weights),
      theme: 'light',
      onboardingDone: true,
      researchConsent: false
    },
    entries
  });

  return state;
}

export function blankState(overrides = {}) {
  return normalizeState({
    schema: 2,
    settings: {
      enabled: defaultEnabled(),
      weights: [...DEFAULT_WEIGHTS],
      matrix: matrixFromWeights(DEFAULT_WEIGHTS),
      onboardingDone: false,
      ...overrides
    },
    entries: []
  });
}

export { CATEGORIES };
