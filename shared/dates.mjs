/** Работа с календарными датами без часовых поясов и DST-сюрпризов. */

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function isValidDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = parseDateKey(value);
  return !!d && dateKey(d) === value;
}

export function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseDateKey(key) {
  if (typeof key !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function todayKey(now = new Date()) {
  return dateKey(now);
}

export function addDays(key, days) {
  const d = parseDateKey(key);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/** Разница в календарных днях: b - a. */
export function daysBetween(a, b) {
  const da = parseDateKey(a);
  const db = parseDateKey(b);
  if (!da || !db) return NaN;
  return Math.round((db - da) / 86400000);
}

/** 0 — понедельник, 6 — воскресенье. */
export function weekdayIndex(key) {
  const d = parseDateKey(key);
  if (!d) return 0;
  return (d.getDay() + 6) % 7;
}

export const WEEKDAY_NAMES = [
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
  'воскресенье'
];

export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function formatDateRu(key, { withWeekday = false } = {}) {
  const d = parseDateKey(key);
  if (!d) return key;
  const base = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  if (!withWeekday) return base;
  const wd = WEEKDAY_NAMES[weekdayIndex(key)];
  return `${base}, ${wd}`;
}

export function formatShortRu(key) {
  const d = parseDateKey(key);
  if (!d) return key;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
