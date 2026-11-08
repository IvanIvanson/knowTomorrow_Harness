/**
 * KnowTomorrow — общие константы домена.
 * Используются и в браузере, и на сервере (ESM, без зависимостей).
 */

export const CATEGORIES = [
  'wellbeing',
  'home',
  'work',
  'street',
  'weather',
  'inanimate',
  'living'
];

export const CATEGORY_LABELS = {
  overall: 'Общая оценка',
  wellbeing: 'Самочувствие',
  home: 'Отношения дома',
  work: 'Отношения на работе',
  street: 'Отношения на улице',
  weather: 'Погода',
  inanimate: 'Неживая природа',
  living: 'Живая природа'
};

export const CATEGORY_SHORT = {
  wellbeing: 'Самочувствие',
  home: 'Дом',
  work: 'Работа',
  street: 'Улица',
  weather: 'Погода',
  inanimate: 'Неживое',
  living: 'Живое'
};

export const CATEGORY_HINTS = {
  wellbeing: 'Сон, энергия, боль, тревога, настроение тела',
  home: 'Семья, быт, атмосфера дома',
  work: 'Коллеги, задачи, нагрузка, руководство',
  street: 'Люди и обстановка вне дома и работы',
  weather: 'Снег, дождь, жара, давление, свет',
  inanimate: 'Техника, транспорт, поломки, деньги, бытовая среда',
  living: 'Животные, растения, насекомые, контакт с природой'
};

export const CATEGORY_ICONS = {
  wellbeing: 'heart',
  home: 'home',
  work: 'briefcase',
  street: 'users',
  weather: 'cloud',
  inanimate: 'tool',
  living: 'leaf'
};

/** Значения индекса случайной согласованности Саати для n = 1..10. */
export const RI = [0, 0, 0.58, 0.9, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49];

export const SCHEMA_VERSION = 2;

/**
 * Сбалансированный профиль по умолчанию.
 * Сумма = 1. Это не «истина», а стартовая гипотеза, которую пользователь может изменить.
 */
export const DEFAULT_WEIGHTS = [0.22, 0.14, 0.18, 0.1, 0.1, 0.14, 0.12];

export const PRESETS = {
  equal: {
    title: 'Равные веса',
    description: 'Все семь сфер влияют одинаково. Хорошая отправная точка.',
    weights: [1 / 7, 1 / 7, 1 / 7, 1 / 7, 1 / 7, 1 / 7, 1 / 7]
  },
  balanced: {
    title: 'Сбалансированный',
    description: 'Самочувствие и работа чуть весомее, погода и улица — чуть меньше.',
    weights: DEFAULT_WEIGHTS
  },
  health: {
    title: 'Здоровье важнее',
    description: 'Акцент на самочувствии; остальные сферы влияют умеренно.',
    weights: [0.34, 0.12, 0.14, 0.07, 0.09, 0.13, 0.11]
  },
  environment: {
    title: 'Среда важнее',
    description: 'Погода, живая и неживая природа, улица — основной фон дня.',
    weights: [0.17, 0.1, 0.13, 0.14, 0.16, 0.16, 0.14]
  }
};

export const RATING_MIN = 1;
export const RATING_MAX = 10;
export const CR_THRESHOLD = 0.1;
export const MAX_ENTRIES = 5000;
export const MAX_STATE_BYTES = 2 * 1024 * 1024;

export const APP_NAME = 'KnowTomorrow';
export const APP_TAGLINE = 'Не гадание. Наблюдение за собой.';
export const CONTACT_EMAIL = 'ghalut@mail.ru';
