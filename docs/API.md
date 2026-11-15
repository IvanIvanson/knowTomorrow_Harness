# API KnowTomorrow

Базовый URL: `https://<ваш-домен>`. Все ответы — JSON, кроме статики и экспорта.
Аутентификация — HttpOnly cookie `kt_session`, устанавливаемая при регистрации и
входе. Кросс-доменные запросы не поддерживаются: API рассчитан на same-origin.

## Ошибки

```json
{ "error": "Человекочитаемое сообщение" }
```

| Код | Когда |
|---|---|
| 400 | Некорректный JSON, дата, оценка, пароль, email |
| 401 | Нет сессии или неверный пароль |
| 403 | Чужой Origin, неверный пароль при удалении |
| 404 | Неизвестный маршрут |
| 409 | Email занят или конфликт версий состояния |
| 413 | Слишком большое тело запроса |
| 429 | Превышен rate limit |
| 500 | Внутренняя ошибка |

## Аутентификация

### POST `/api/auth/register`

```json
{
  "name": "Иван",
  "email": "ivan@example.com",
  "password": "password123",
  "acceptTerms": true,
  "consentResearch": false
}
```

- `password` — 8–200 символов.
- `acceptTerms` обязателен.
- `consentResearch` — отдельное необязательное согласие на анонимную агрегацию.

Ответ `201`:

```json
{
  "user": {
    "id": "uuid",
    "email": "ivan@example.com",
    "name": "Иван",
    "createdAt": "2026-11-08T12:00:00.000Z",
    "consentResearch": false,
    "consentAt": null
  }
}
```

Устанавливает `Set-Cookie: kt_session=...; HttpOnly; SameSite=Lax; Path=/; Max-Age=...`
(и `Secure` в production).

### POST `/api/auth/login`

```json
{ "email": "ivan@example.com", "password": "password123" }
```

Ответ `200` с тем же объектом `user`. Неверные данные — `401` с общим сообщением,
чтобы не раскрывать существование аккаунта.

### POST `/api/auth/logout`

Удаляет сессию и очищает cookie. Ответ `200 { "ok": true }`.

### GET `/api/auth/me`

```json
{ "user": { ... } }
```

Если сессии нет — `{ "user": null }`, статус `200`.

## Состояние дневника

### GET `/api/state`

Требует сессию.

```json
{
  "state": { "schema": 2, "settings": {}, "entries": [] },
  "version": 3,
  "updatedAt": "2026-11-08T12:00:00.000Z",
  "entryCount": 42
}
```

Если данных нет: `{ "state": null, "version": 0, "updatedAt": null, "entryCount": 0 }`.

### PUT `/api/state`

Требует сессию. Оптимистическая блокировка по `version`.

```json
{
  "version": 3,
  "state": {
    "schema": 2,
    "settings": {
      "enabled": {
        "wellbeing": true,
        "home": true,
        "work": true,
        "street": true,
        "weather": true,
        "inanimate": true,
        "living": true
      },
      "weights": [0.22, 0.14, 0.18, 0.1, 0.1, 0.14, 0.12],
      "theme": "light",
      "onboardingDone": true,
      "researchConsent": false
    },
    "entries": [
      {
        "date": "2026-11-08",
        "ratings": {
          "wellbeing": 7,
          "home": 8,
          "work": 6,
          "street": 7,
          "weather": 5,
          "inanimate": 8,
          "living": 9
        },
        "note": "Долгая прогулка",
        "updatedAt": "2026-11-08T20:00:00.000Z"
      }
    ]
  }
}
```

Успех:

```json
{ "version": 4, "updatedAt": "...", "entryCount": 42 }
```

Конфликт:

```json
{
  "error": "Конфликт версий: данные были изменены в другом месте",
  "code": "conflict",
  "version": 5,
  "state": { ... },
  "updatedAt": "..."
}
```

Клиент должен объединить записи по датам (побеждает более свежий `updatedAt`) и
повторить запрос с актуальной версией. Максимум 5000 записей и 2 МБ JSON.

### Схема записи

- `date` — `YYYY-MM-DD`, не будущая дата.
- `ratings` — объект из семи ключей; значение `null` или целое 1–10.
- `note` — до 500 символов.
- `updatedAt` — ISO-время; используется для слияния.

## Приоры и статистика

### GET `/api/priors`

Публичный агрегат (не содержит отдельных записей).

Если участников меньше `MIN_PRIOR_USERS`:

```json
{
  "available": false,
  "users": 2,
  "minUsers": 5,
  "reason": "Для популяционных ориентиров нужно не менее 5 участников...",
  "generatedAt": "..."
}
```

Если достаточно:

```json
{
  "available": true,
  "users": 12,
  "entries": 840,
  "minUsers": 5,
  "categories": {
    "wellbeing": { "mean": 6.3, "sd": 1.4, "n": 12 }
  },
  "overall": { "mean": 6.4, "sd": 1.2, "n": 12 },
  "weekdays": [{ "index": 0, "name": "понедельник", "mean": 6.1, "n": 12 }],
  "note": "Анонимные средние по участникам, давшим согласие...",
  "generatedAt": "..."
}
```

Кэшируется на 5 минут. Учитываются только пользователи с
`consent_research = 1` и непустым состоянием.

### GET `/api/stats`

```json
{ "users": 12, "contributors": 5, "states": 9, "entries": 630, "generatedAt": "..." }
```

Без email и содержимого дневников.

## Аккаунт

### GET `/api/account/export`

Требует сессию. Возвращает JSON с `Content-Disposition: attachment`:

```json
{
  "app": "KnowTomorrow",
  "exportedAt": "...",
  "user": { ... },
  "state": { ... }
}
```

### PATCH `/api/account`

Требует сессию.

```json
{ "name": "Новое имя", "consentResearch": true }
```

Меняет имя и/или согласие. При отзыве согласия `consentAt` становится `null`.

### POST `/api/account/delete`

Требует сессию и пароль.

```json
{ "password": "password123" }
```

Удаляет пользователя, состояние и сессии каскадно. Ответ `200 { "ok": true }`.

## Health

### GET `/api/health`

```json
{ "ok": true, "service": "knowtomorrow", "version": "2.0.1", "time": "..." }
```

Используется Docker/Render/Fly healthcheck.

## Безопасность и лимиты

- Пароли: scrypt (N=16384, r=8, p=1), соль 16 байт, сравнение `timingSafeEqual`.
- Сессия: 32 случайных байта, в БД хранится SHA-256; TTL 30 дней.
- Cookie: HttpOnly, SameSite=Lax, Secure при HTTPS.
- CSRF: проверка `Origin` для POST/PUT/PATCH/DELETE; same-origin.
- CSP: `default-src 'self'`, без inline-скриптов, без внешних CDN.
- Rate limit: 12 попыток auth и 120 записей на 15 минут (настраивается).
- Ограничение тела: 2 МБ.
- SQLite: prepared statements, WAL, foreign keys.
- Логи: только типы событий, без содержимого дневника.

## cURL-пример

```bash
# Регистрация
curl -i -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"name":"Иван","email":"ivan@example.com","password":"password123","acceptTerms":true}' \
  https://knowtomorrow.example/api/auth/register

# Состояние
curl -b cookies.txt https://knowtomorrow.example/api/state

# Сохранение (version из предыдущего ответа)
curl -b cookies.txt -X PUT -H 'Content-Type: application/json' \
  -d '{"version":0,"state":{"entries":[]}}' \
  https://knowtomorrow.example/api/state
```
