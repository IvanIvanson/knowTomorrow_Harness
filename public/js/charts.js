/** Лёгкие SVG-графики без внешних библиотек. */

import { escapeHtml, formatScore } from './ui.js';

let gradientCounter = 0;

function empty(container, text) {
  container.innerHTML = `<div class="chart-empty">${escapeHtml(text)}</div>`;
}

function niceStep(count) {
  return Math.max(1, Math.ceil(count / 7));
}

export function lineChart(container, { labels, values, label, target = null }) {
  const points = values
    .map((value, index) => ({ value: Number(value), label: labels[index], index }))
    .filter((point) => Number.isFinite(point.value));
  if (points.length < 1) {
    empty(container, 'Пока нет данных для графика.');
    return;
  }

  const width = 840;
  const height = 300;
  const pad = { left: 42, right: 18, top: 22, bottom: 38 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (index) =>
    labels.length <= 1
      ? pad.left + plotW / 2
      : pad.left + (index / (labels.length - 1)) * plotW;
  const y = (value) => pad.top + ((10 - value) / 9) * plotH;

  const gridLines = [2, 4, 6, 8, 10]
    .map(
      (value) => `<g>
        <line class="chart-grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}" />
        <text class="chart-axis-label" x="${pad.left - 9}" y="${y(value) + 3}" text-anchor="end">${value}</text>
      </g>`
    )
    .join('');

  const xStep = niceStep(labels.length);
  const xLabels = labels
    .map((item, index) =>
      index % xStep === 0 || index === labels.length - 1
        ? `<text class="chart-axis-label" x="${x(index)}" y="${height - 14}" text-anchor="middle">${escapeHtml(
            item
          )}</text>`
        : ''
    )
    .join('');

  const segments = [];
  let current = [];
  labels.forEach((_, index) => {
    const point = points.find((item) => item.index === index);
    if (point) {
      current.push(point);
    } else if (current.length) {
      segments.push(current);
      current = [];
    }
  });
  if (current.length) segments.push(current);

  const linePaths = segments
    .map((segment) => {
      const d = segment
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`)
        .join(' ');
      return `<path class="chart-line" d="${d}" />`;
    })
    .join('');

  const first = segments[0];
  const last = segments[segments.length - 1];
  const areaD =
    first && first.length
      ? `M${x(first[0].index)},${y(1)} ${first
          .map((point) => `L${x(point.index)},${y(point.value)}`)
          .join(' ')} L${x(last[last.length - 1].index)},${y(1)} Z`
      : '';

  const pointsHtml = points
    .map(
      (point) => `<g>
        <circle class="chart-point" cx="${x(point.index)}" cy="${y(point.value)}" r="4">
          <title>${escapeHtml(point.label)}: ${formatScore(point.value)}</title>
        </circle>
      </g>`
    )
    .join('');

  const targetLine = Number.isFinite(target)
    ? `<g>
        <line class="chart-target-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(target)}" y2="${y(target)}" />
        <text class="chart-target-label" x="${width - pad.right}" y="${y(target) - 6}" text-anchor="end">гипотеза ${formatScore(target)}</text>
      </g>`
    : '';

  const gradientId = `areaGradient${++gradientCounter}`;
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="График: ${escapeHtml(
    label || 'оценка'
  )}">
    <defs>
      <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="var(--teal)" stop-opacity="0.28" />
        <stop offset="100%" stop-color="var(--teal)" stop-opacity="0" />
      </linearGradient>
    </defs>
    <rect class="chart-zone-good" x="${pad.left}" y="${y(10)}" width="${plotW}" height="${y(7) - y(10)}" />
    <rect class="chart-zone-bad" x="${pad.left}" y="${y(4)}" width="${plotW}" height="${y(1) - y(4)}" />
    ${gridLines}
    <path class="chart-area" fill="url(#${gradientId})" d="${areaD}" />
    ${linePaths}
    ${pointsHtml}
    ${targetLine}
    ${xLabels}
  </svg>`;
}

export function radarChart(container, { labels, values, previous = null }) {
  const items = values
    .map((value, index) => ({ value: Number(value), label: labels[index] }))
    .filter((item) => Number.isFinite(item.value));
  if (items.length < 3) {
    empty(container, 'Нужно минимум три заполненные сферы.');
    return;
  }

  const width = 460;
  const height = 380;
  const cx = width / 2;
  const cy = height / 2 + 8;
  const radius = 128;
  const count = items.length;

  const pointAt = (index, value) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    const r = (value / 10) * radius;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };

  const rings = [2, 4, 6, 8, 10]
    .map((value) => {
      const path = items
        .map((_, index) => {
          const [x, y] = pointAt(index, value);
          return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ') + ' Z';
      return `<path class="radar-ring" d="${path}" />`;
    })
    .join('');

  const axes = items
    .map((_, index) => {
      const [x, y] = pointAt(index, 10);
      return `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" />`;
    })
    .join('');

  const shape = (data, className) => {
    const path =
      data
        .map((item, index) => {
          const [x, y] = pointAt(index, item.value);
          return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ') + ' Z';
    return `<path class="${className}" d="${path}" />`;
  };

  const dots = items
    .map((item, index) => {
      const [x, y] = pointAt(index, item.value);
      return `<circle class="radar-dot" cx="${x}" cy="${y}" r="3.4"><title>${escapeHtml(
        item.label
      )}: ${formatScore(item.value)}</title></circle>`;
    })
    .join('');

  const labelNodes = items
    .map((item, index) => {
      const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
      const lx = cx + Math.cos(angle) * (radius + 26);
      const ly = cy + Math.sin(angle) * (radius + 26);
      const anchor = Math.abs(Math.cos(angle)) < 0.25 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
      return `<text class="radar-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle">${escapeHtml(
        item.label
      )}</text>`;
    })
    .join('');

  const previousShape =
    previous && previous.length === items.length
      ? shape(
          previous.map((value) => ({ value: Number(value), label: '' })),
          'radar-shape--previous'
        )
      : '';

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Профиль средних оценок по сферам">
    ${rings}
    ${axes}
    ${previousShape}
    ${shape(items, 'radar-shape')}
    ${dots}
    ${labelNodes}
  </svg>`;
}

export function weekdayBars(container, { items }) {
  const valid = items.filter((item) => Number.isFinite(item.mean));
  if (!valid.length) {
    empty(container, 'Пока мало данных по дням недели.');
    return;
  }
  const shortNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const width = 460;
  const height = 240;
  const pad = { left: 34, right: 12, top: 22, bottom: 32 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const barW = Math.min(34, (plotW / items.length) * 0.58);
  const y = (value) => pad.top + ((10 - value) / 9) * plotH;
  const maxIndex = valid.reduce((best, item, index) =>
    item.mean > (valid[best]?.mean ?? 0) ? index : best
  , 0);

  const bars = items
    .map((item, index) => {
      const cx = pad.left + (index + 0.5) * (plotW / items.length);
      if (!Number.isFinite(item.mean)) {
        return `<text class="bar-value" x="${cx}" y="${height - 12}" text-anchor="middle">—</text>`;
      }
      const barHeight = ((item.mean - 1) / 9) * plotH;
      const isMax = index === maxIndex;
      return `<g>
        <rect x="${cx - barW / 2}" y="${y(item.mean)}" width="${barW}" height="${barHeight}" rx="6" fill="${
          isMax ? 'var(--teal)' : 'var(--teal-soft)'
        }">
          <title>${escapeHtml(item.name)}: ${formatScore(item.mean)} (n=${item.n})</title>
        </rect>
        <text class="bar-value" x="${cx}" y="${y(item.mean) - 6}" text-anchor="middle">${formatScore(
          item.mean
        )}</text>
        <text class="bar-label" x="${cx}" y="${height - 12}" text-anchor="middle">${escapeHtml(
          shortNames[item.index] || item.name.slice(0, 2)
        )}</text>
      </g>`;
    })
    .join('');

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Средняя оценка по дням недели">
    <line class="chart-grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(1)}" y2="${y(1)}" />
    <line class="chart-grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(5.5)}" y2="${y(5.5)}" />
    <line class="chart-grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(10)}" y2="${y(10)}" />
    ${bars}
  </svg>`;
}

export function intervalBar({ low, value, high, min = 1, max = 10 }) {
  const width = 220;
  const height = 22;
  const span = max - min;
  const pct = (v) => ((Number(v) - min) / span) * (width - 20) + 10;
  return `<svg class="interval-visual" viewBox="0 0 ${width} ${height}" role="img" aria-label="Интервал от ${formatScore(
    low
  )} до ${formatScore(high)}">
    <line x1="10" y1="11" x2="${width - 10}" y2="11" stroke="var(--line)" stroke-width="4" stroke-linecap="round" />
    <line x1="${pct(low).toFixed(1)}" y1="11" x2="${pct(high).toFixed(1)}" y2="11" stroke="var(--teal)" stroke-width="4" stroke-linecap="round" opacity="0.5" />
    <circle cx="${pct(value).toFixed(1)}" cy="11" r="5.4" fill="var(--surface)" stroke="var(--teal)" stroke-width="2.4" />
    <title>Интервал ${formatScore(low)}–${formatScore(high)}, гипотеза ${formatScore(value)}</title>
  </svg>`;
}
