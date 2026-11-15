# Деплой KnowTomorrow

## Требования

- Node.js **24+** (встроенный `node:sqlite`).
- Постоянный диск для SQLite.
- HTTPS в production.
- Обратный прокси (Caddy, Nginx, Render, Fly) — рекомендуется.

Внешних npm-зависимостей нет, `npm install` не нужен.

## Локальный запуск

```bash
npm start
# http://localhost:8080
```

Данные появятся в `./data/knowtomorrow.db`.

## Docker

```bash
docker build -t knowtomorrow .
docker run -d \
  --name knowtomorrow \
  -p 8080:8080 \
  -v "$PWD/data:/data" \
  -e COOKIE_SECURE=false \
  knowtomorrow
```

`docker compose up -d --build` делает то же самое. Для production:

```yaml
environment:
  COOKIE_SECURE: "true"
  TRUST_PROXY: "1"
```

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `8080` | Порт |
| `HOST` | `0.0.0.0` | Интерфейс |
| `DATA_DIR` | `./data` | Каталог SQLite |
| `COOKIE_SECURE` | `auto` | `auto`/`true`/`false`; Secure cookie |
| `TRUST_PROXY` | `0` | Доверять `X-Forwarded-*` |
| `APP_ORIGIN` | — | Разрешённый Origin для CSRF за прокси |
| `SESSION_DAYS` | `30` | Срок сессии |
| `MIN_PRIOR_USERS` | `5` | Порог анонимной агрегации |
| `MAX_BODY_BYTES` | `2097152` | Лимит тела |
| `AUTH_RATE_LIMIT` | `12` | Попыток auth / 15 мин |
| `WRITE_RATE_LIMIT` | `120` | Записей / 15 мин |
| `METRICS_RATE_LIMIT` | `300` | Событий метрик / 15 мин |
| `ADMIN_LOGIN_RATE_LIMIT` | `8` | Попыток входа в админку / 15 мин |
| `ADMIN_TOKEN` | — | Токен `/admin`, ≥ 12 символов; без него админка отключена |
| `ADMIN_SESSION_HOURS` | `12` | Срок cookie админки |

## Админка и статистика

Сгенерируйте длинный токен и задайте его только на сервере:

```bash
openssl rand -hex 32
# Render/Fly/VPS: ADMIN_TOKEN=<токен>
```

После перезапуска откройте `/admin`, введите токен. Cookie админки —
HttpOnly, SameSite=Strict. Токен не попадает в URL, логи и localStorage.

Метрики обезличены: дневные счётчики `(day, type, target)` для просмотров
`landing/app`, кликов по кнопкам скачивания и `appinstalled`. IP не
сохраняется. Начальные значения можно посмотреть в админке; сбросить счётчики
можно SQL-запросом `DELETE FROM metrics_daily;` (сделайте бэкап).

В Render задайте `ADMIN_TOKEN` как secret environment variable; в Fly —
`fly secrets set ADMIN_TOKEN=...`. Не коммитьте токен в репозиторий.

## Обратный прокси

### Caddy

```caddyfile
knowtomorrow.example {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy автоматически выпускает HTTPS-сертификат.

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name knowtomorrow.example;

    ssl_certificate     /etc/letsencrypt/live/knowtomorrow.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/knowtomorrow.example/privkey.pem;

    client_max_body_size 3m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Сервер запускайте с:

```bash
TRUST_PROXY=1 COOKIE_SECURE=true APP_ORIGIN=https://knowtomorrow.example npm start
```

`APP_ORIGIN` полезен, если `Host` за прокси отличается от публичного домена.

## Render

`render.yaml` создаёт web-сервис с диском `/var/data`. Проверьте:

- план с persistent disk (на бесплатном диске может не быть);
- `COOKIE_SECURE=true`, `TRUST_PROXY=1`;
- healthcheck `/api/health`;
- переменную `NODE_VERSION=24.0.0`.

## Fly.io

```bash
fly launch --no-deploy
fly volumes create knowtomorrow_data --size 1
fly secrets set COOKIE_SECURE=true TRUST_PROXY=1
fly deploy
```

`fly.toml` уже содержит mount и healthcheck.

## Резервные копии

SQLite в режиме WAL. Безопасный способ:

```bash
# внутри контейнера
docker exec knowtomorrow node --input-type=module -e \
  "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync('/data/knowtomorrow.db'); db.exec(\"VACUUM INTO '/data/backup.db'\");"

# копируем
docker cp knowtomorrow:/data/backup.db ./backup-$(date +%F).db
```

Или остановить сервис и скопировать `knowtomorrow.db`, `-wal`, `-shm` вместе.

Восстановление:

```bash
docker compose stop
cp backup.db data/knowtomorrow.db
rm -f data/knowtomorrow.db-wal data/knowtomorrow.db-shm
docker compose start
```

Рекомендуется ежедневный cron и хранение 30 дней.

## Мониторинг

- `/api/health` — liveness.
- Логи контейнера: ошибки API, без содержимого дневника.
- Размер БД и свободное место на volume.
- 401/429/500 в логах — сигналы атак или проблем.

## Чек-лист production

- [ ] HTTPS и HSTS.
- [ ] `COOKIE_SECURE=true`.
- [ ] `TRUST_PROXY=1` только если прокси действительно trusted.
- [ ] Постоянный диск и бэкапы.
- [ ] Ограниченный доступ к серверу и файлу БД.
- [ ] `APP_ORIGIN` задан.
- [ ] `ADMIN_TOKEN` — длинный случайный секрет, хранится только в env/секретах.
- [ ] Проверены `/`, `/app`, `/admin`, `/manifest.webmanifest`, `/sw.js`.
- [ ] Проверена регистрация и конфликт версий.
- [ ] Политика конфиденциальности доступна по `/privacy.html`.
- [ ] Настроен мониторинг диска.
- [ ] Понятен процесс удаления данных по запросу.

## Ограничения масштабирования

SQLite и in-memory rate limit рассчитаны на один инстанс. Для нескольких
реплик нужны:

- PostgreSQL вместо SQLite;
- общий rate limit (Redis);
- sticky sessions или stateless JWT;
- миграции и бэкапы БД.

Для первых сотен пользователей одного инстанса достаточно.

## GitHub Pages

Pages отдаёт только статику. Лендинг и PWA-оболочку можно захостить, но
`/api/*` работать не будет: регистрация, вход и синхронизация требуют backend.
Если нужен полностью статический вариант — используйте гостевой режим и
экспорт/импорт JSON, но это уже не сайт с аккаунтами.
