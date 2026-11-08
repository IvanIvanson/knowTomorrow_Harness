# Desktop-оболочка KnowTomorrow

Приложение для Windows, macOS и Linux. Это Electron-оболочка, которая открывает
задеплоенную веб-версию: так аккаунт, синхронизация и обновления совпадают с PWA.

## Локальная разработка

1. Запустите сервер в корне проекта:

   ```bash
   npm start
   ```

2. В `desktop/config.json` оставьте `http://localhost:8080`.

3. Установите зависимости и запустите оболочку:

   ```bash
   cd desktop
   npm install
   npm start
   ```

## Сборка установщиков

Перед сборкой укажите адрес задеплоенного сайта в `config.json` или через
переменную `KT_APP_URL`:

```bash
cd desktop
npm install
KT_APP_URL=https://knowtomorrow.example npm run build
```

Артефакты появятся в `desktop/dist/`. Для Windows это NSIS-установщик и portable
`.exe`, для macOS — DMG/ZIP, для Linux — AppImage/deb.

## Автоматическая сборка

Workflow `.github/workflows/desktop-release.yml` собирает все три платформы и
прикрепляет артефакты к GitHub Release. Задайте repository variable
`KNOWTOMORROW_APP_URL` (Settings → Variables) с HTTPS-адресом приложения.

Подпись кода для Windows и macOS настраивается отдельно; без неё ОС может
показывать предупреждение при первом запуске.

## Почему не встроенный офлайн-сервер

Полноценный локальный сервер внутри Electron потребовал бы отдельного Node с
поддержкой `node:sqlite`, миграций и резервных копий. Основной офлайн-сценарий
закрывает PWA: service worker кэширует оболочку, а данные гостя хранятся в
localStorage. Desktop-оболочка решает задачу «отдельное окно и иконка» без
дублирования серверной логики.
