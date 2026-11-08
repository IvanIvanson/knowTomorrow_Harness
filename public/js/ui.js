/** Мелкие UI-помощники. */

import { svgIcon } from './icons.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatScore(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(digits);
}

export function pluralRu(number, one, few, many) {
  const n = Math.abs(Math.round(number)) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 === 1) return one;
  if (n1 >= 2 && n1 <= 4) return few;
  return many;
}

export function formatP(p) {
  if (p === null || p === undefined || Number.isNaN(Number(p))) return '—';
  if (p < 0.001) return '< 0.001';
  if (p < 0.01) return p.toFixed(3);
  return p.toFixed(2);
}

export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const sign = Number(value) > 0 ? '+' : '';
  return `${sign}${Number(value).toFixed(digits)}%`;
}

export function toast(message, type = 'info', timeout = 3800) {
  let stack = document.getElementById('toastStack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.className = 'toast-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const element = document.createElement('div');
  element.className = `toast${type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : ''}`;
  element.setAttribute('role', type === 'error' ? 'alert' : 'status');
  element.innerHTML = `<span>${escapeHtml(message)}</span>`;
  stack.appendChild(element);
  window.setTimeout(() => {
    element.style.opacity = '0';
    element.style.transform = 'translateY(8px)';
    element.style.transition = 'opacity .2s ease, transform .2s ease';
    window.setTimeout(() => element.remove(), 220);
  }, timeout);
}

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

export function downloadFile(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function confidenceBadge(confidence) {
  const label = confidence?.label || 'низкая';
  const cls = label === 'высокая' ? 'badge--green' : label === 'средняя' ? 'badge--teal' : 'badge--amber';
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

export function confidenceDots(score) {
  const filled = Math.max(1, Math.min(5, Math.round((score || 0.2) * 5)));
  return `<span class="confidence-dots" title="Уверенность: ${Math.round((score || 0) * 100)}%">${Array.from(
    { length: 5 },
    (_, index) => `<i class="${index < filled ? 'is-on' : ''}"></i>`
  ).join('')}</span>`;
}

export function trendChip(trend, { suffix = '' } = {}) {
  if (trend === null || trend === undefined || Number.isNaN(Number(trend))) {
    return '<span class="pill">без тренда</span>';
  }
  const value = Number(trend);
  const direction = value > 0.05 ? 'up' : value < -0.05 ? 'down' : 'flat';
  const icon = direction === 'up' ? 'arrowUp' : direction === 'down' ? 'arrowDown' : 'check';
  const label = `${value > 0 ? '+' : ''}${value.toFixed(1)}${suffix}`;
  return `<span class="trend trend--${direction}">${svgIcon(icon, 'trend-icon')}${label}</span>`;
}

export function methodShort(method) {
  return {
    'cold-start': 'холодный старт',
    naive: 'наивная',
    mean: 'среднее',
    ridge: 'Ridge',
    gbdt: 'бустинг',
    composition: 'композиция'
  }[method] || method;
}

export function setButtonLoading(button, loading, text = 'Подождите…') {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${escapeHtml(text)}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) {
      button.innerHTML = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.userAgentData?.platform?.toLowerCase() || navigator.platform?.toLowerCase() || '';
  if (/iphone|ipad|ipod/.test(ua) || (platform === 'macintel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/android/.test(ua)) return 'android';
  if (/win/.test(platform) || /windows/.test(ua)) return 'windows';
  if (/mac/.test(platform) || /mac os/.test(ua)) return 'macos';
  if (/linux/.test(platform) || /linux/.test(ua)) return 'linux';
  return 'web';
}

export function platformLabel(platform) {
  return {
    ios: 'iPhone / iPad',
    android: 'Android',
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
    web: 'веб-браузер'
  }[platform] || 'веб-браузер';
}

export function formatDateRu(key) {
  if (!key) return '';
  const date = new Date(`${key}T12:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateShort(key) {
  if (!key) return '';
  const date = new Date(`${key}T12:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function weekdayRu(key) {
  if (!key) return '';
  const date = new Date(`${key}T12:00:00`);
  return ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'][
    date.getDay()
  ];
}

export function scrollToElement(element, offset = 84) {
  if (!element) return;
  const top = element.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: 'smooth' });
}
