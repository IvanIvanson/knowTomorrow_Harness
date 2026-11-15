/** Агрегированная статистика просмотров и скачиваний. */

const TYPE_LABELS = {
  view: 'Просмотры',
  download: 'Скачивания',
  install: 'Установки PWA'
};

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDays(key, days) {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dayKey(date);
}

function emptyPeriod() {
  return { views: 0, downloads: 0, installs: 0 };
}

function addTo(period, type, count) {
  if (type === 'view') period.views += count;
  if (type === 'download') period.downloads += count;
  if (type === 'install') period.installs += count;
}

export function getMetricsStats(db) {
  const rows = db
    .prepare('SELECT day, type, target, count FROM metrics_daily ORDER BY day, type, target')
    .all();
  const lastRow = db
    .prepare('SELECT MAX(updated_at) AS last_event_at FROM metrics_daily')
    .get();

  const totals = emptyPeriod();
  const byTarget = new Map();
  const byDay = new Map();
  let firstDay = null;

  for (const row of rows) {
    const count = Number(row.count) || 0;
    if (!count) continue;
    if (!firstDay || row.day < firstDay) firstDay = row.day;
    addTo(totals, row.type, count);

    const targetKey = `${row.type}:${row.target}`;
    byTarget.set(targetKey, (byTarget.get(targetKey) || 0) + count);

    if (!byDay.has(row.day)) {
      byDay.set(row.day, emptyPeriod());
    }
    addTo(byDay.get(row.day), row.type, count);
  }

  const today = dayKey(new Date());
  const daily = [];
  for (let offset = 29; offset >= 0; offset--) {
    const day = shiftDays(today, -offset);
    const period = byDay.get(day) || emptyPeriod();
    daily.push({ day, ...period });
  }

  const sumRange = (days) => {
    const start = shiftDays(today, -(days - 1));
    const summary = emptyPeriod();
    for (const [day, period] of byDay) {
      if (day < start || day > today) continue;
      summary.views += period.views;
      summary.downloads += period.downloads;
      summary.installs += period.installs;
    }
    return summary;
  };

  const targetList = [...byTarget.entries()]
    .map(([key, count]) => {
      const [type, target] = key.split(':');
      return { type, target, count, typeLabel: TYPE_LABELS[type] || type };
    })
    .sort((a, b) => b.count - a.count || a.target.localeCompare(b.target));

  return {
    generatedAt: new Date().toISOString(),
    totals,
    today: byDay.get(today) || emptyPeriod(),
    last7: sumRange(7),
    last30: sumRange(30),
    byTarget: targetList,
    daily,
    firstDay,
    lastEventAt: lastRow?.last_event_at || null,
    labels: TYPE_LABELS
  };
}
