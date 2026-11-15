/**
 * Обезличенные метрики: просмотры страниц и клики по кнопкам скачивания.
 * Сервер хранит только дневные счётчики, без IP, cookie и идентификаторов.
 */

let viewSent = false;

const ALLOWED = {
  view: new Set(['landing', 'app']),
  download: new Set(['windows', 'macos-linux', 'android', 'ios', 'pwa']),
  install: new Set(['pwa'])
};

export function trackEvent(type, target) {
  try {
    if (navigator.webdriver) return;
    if (type === 'view' && viewSent) return;
    if (!ALLOWED[type]?.has(target)) return;
    if (type === 'view') viewSent = true;

    const body = JSON.stringify({ type, target });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/metrics/event', blob)) return;
    }
    fetch('/api/metrics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin'
    }).catch(() => {});
  } catch {
    // Метрики не должны мешать интерфейсу.
  }
}
