/** Набор инлайновых SVG-иконок (без спрайта и внешних запросов). */

const PATHS = {
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  home:
    '<path d="M3 11l9-7.5 9 7.5M5.5 9.5V21h13V9.5M10 21v-6h4v6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  briefcase:
    '<rect x="3" y="7" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7M3 12h18" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  users:
    '<circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 20c0-3.3 2.4-5.5 5.5-5.5s5.5 2.2 5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M16 5.2a3 3 0 010 5.6M17.5 14.8c2 .6 3.5 2.4 3.5 5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  cloud:
    '<path d="M7 18a4.2 4.2 0 01-.4-8.4A6 6 0 0118.3 11 3.5 3.5 0 0117.5 18z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  tool:
    '<path d="M14.5 6.2a4.2 4.2 0 00-5.3 5.3L4 16.7 7.3 20l5.2-5.2a4.2 4.2 0 005.3-5.3l-2.4 2.4-2.9-2.9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  leaf:
    '<path d="M20 4C12 4 5 8 5 15c0 2.1.8 3.9 2.2 5.2C10.5 12 15 9.7 18.5 8.6 15 12 12.3 15 10.5 20.2c.9.3 1.9.5 3 .5 7 0 9-7 9-16.7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  chart:
    '<path d="M4 19V5M4 19h16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M7 15l3.5-4 3 2.4L18 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  spark:
    '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  shield:
    '<path d="M12 3l7 3v5.2c0 4.5-3 7.8-7 9.8-4-2-7-5.3-7-9.8V6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  lock:
    '<rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 10V7a4 4 0 018 0v3" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  download:
    '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  clock:
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  check:
    '<path d="M5 12.5l4.2 4L19 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  edit:
    '<path d="M4 20h4l11-11-4-4L4 16zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  trash:
    '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  chevron:
    '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowRight:
    '<path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  sync:
    '<path d="M20 7a8 8 0 00-13.7-1M4 17a8 8 0 0013.7 1M20 3v4h-4M4 21v-4h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  user:
    '<circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.5 20.5c0-4 3.2-6.5 7.5-6.5s7.5 2.5 7.5 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  sun:
    '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  moon:
    '<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  info:
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 11v6M12 7.5v.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  alert:
    '<path d="M12 3l9.5 17h-19z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v5M12 17.5v.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  settings:
    '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6v.2h-4v-.2a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H2.8v-4H3a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 001.9.3 1.7 1.7 0 001-1.6v-.2h4V3a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 00-.3 1.9 1.7 1.7 0 001.6 1h.2v4H21a1.7 1.7 0 00-1.6 1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 3v4M16 3v4M3.5 10h17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  list:
    '<path d="M8 6h13M8 12h13M8 18h13M3 6h.2M3 12h.2M3 18h.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  target:
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  logout:
    '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  external:
    '<path d="M14 4h6v6M20 4l-8 8M18 14v5H5V6h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  sliders:
    '<path d="M4 7h10M18 7h2M4 17h4M12 17h8M4 12h16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  eye:
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/>'
};

export function svgIcon(name, className = 'icon') {
  const inner = PATHS[name] || PATHS.info;
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>`;
}

export const CATEGORY_ICON = {
  wellbeing: 'heart',
  home: 'home',
  work: 'briefcase',
  street: 'users',
  weather: 'cloud',
  inanimate: 'tool',
  living: 'leaf'
};
