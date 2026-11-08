# Упаковка и установка

У KnowTomorrow четыре канала доставки:

1. **Веб-версия** — открывается сразу после деплоя.
2. **PWA** — установка на телефон и компьютер, офлайн-оболочка.
3. **Desktop** — Electron-оболочка для Windows/macOS/Linux.
4. **Android APK** — Capacitor-сборка.

PWA — основной и самый быстрый способ. Нативные сборки нужны для отдельных
сценариев (ярлык в меню «Пуск», APK в корпоративной среде, публикация в сторах).

## 1. PWA

Уже реализовано:

- `public/manifest.webmanifest` — имя, иконки, `start_url`, shortcuts;
- `public/sw.js` — precache оболочки, network-first для навигации,
  stale-while-revalidate для статики, API не кэшируется;
- `public/assets/icons/` — 192/512, maskable, apple-touch, favicon;
- регистрация service worker в `public/js/site.js` и `public/js/app.js`;
- кнопка «Установить» и инструкции по платформам.

### Проверка

Откройте DevTools → Application:

- Manifest без ошибок;
- Service Workers: `activated and running`;
- Cache Storage: `knowtomorrow-v2.0.0-shell` и `...-assets`;
- Lighthouse → PWA: установка и офлайн.

В Chrome установка доступна по иконке в адресной строке или меню
«Установить приложение». В Safari на iOS — «Поделиться» → «На экран „Домой“».

### Обновление версии

При изменении статики поднимите `VERSION` в `public/sw.js`
(`knowtomorrow-v2.0.0` → `knowtomorrow-v2.0.1`). Старый кэш удалится в
`activate`, новый service worker возьмёт управление после перезагрузки.

### HTTPS

Service worker, установка и Push требуют HTTPS (кроме `localhost`). Поэтому
деплой на HTTP-IP не даст полноценную PWA.

## 2. Desktop (Electron)

Каталог `desktop/`:

- `main.cjs` — окно, внешние ссылки, запрет навигации на чужие домены,
  обработка недоступного сервера;
- `config.json` — `appUrl` задеплоенного сайта;
- `electron-builder.yml` — NSIS + portable для Windows, DMG/ZIP для macOS,
  AppImage/deb для Linux;
- workflow `.github/workflows/desktop-release.yml`.

### Локальная сборка

```bash
cd desktop
npm install
KT_APP_URL=https://knowtomorrow.example npm run build
```

Windows:

```powershell
$env:KT_APP_URL="https://knowtomorrow.example"
npm run build
```

Артефакты: `desktop/dist/`.

### CI

1. Задайте repository variable `KNOWTOMORROW_APP_URL` = HTTPS-адрес сайта.
2. Запустите workflow вручную или создайте тег `v2.0.0`.
3. На теге workflow соберёт три платформы и прикрепит файлы к GitHub Release.

Без переменной tag-сборка завершится ошибкой — иначе установщик открывал бы
`localhost`.

### Подпись

- Windows: Authenticode-сертификат; иначе SmartScreen предупредит.
- macOS: Apple Developer ID + notarization; иначе Gatekeeper заблокирует.
- Linux: подпись не требуется для AppImage/deb.

## 3. Android (Capacitor)

`mobile/capacitor.config.json` содержит `server.url` — адрес задеплоенного
сайта. CI подставляет его из `KNOWTOMORROW_APP_URL`.

Workflow `.github/workflows/android.yml`:

1. ставит Node, Java 21, Android SDK;
2. устанавливает Capacitor;
3. добавляет Android-платформу и синхронизирует;
4. собирает debug APK;
5. загружает артефакт.

Для release APK/AAB нужен keystore и подпись; добавьте secrets и
`signingConfigs` в Gradle. Для Google Play — Data Safety и политика
конфиденциальности.

## 4. iOS

Вариант A — PWA через Safari (без магазина).

Вариант B — Capacitor:

```bash
cd mobile
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap add ios
npx cap sync ios
npx cap open ios
```

Нужны macOS, Xcode и Apple Developer account. Для App Store важно явно указать,
что приложение не медицинское и не диагностическое.

## 5. Публикация релиза

Сайт ссылается на:

```
https://github.com/IvanIvanson/knowTomorrow_Deepseek/releases/latest
```

Чтобы кнопки «Скачать для Windows», «Скачать APK» и «Открыть Releases» работали:

1. Соберите desktop-workflow (tag `v2.0.0`).
2. Прикрепите APK к релизу (скачайте артефакт android-workflow).
3. Убедитесь, что имена файлов понятны:
   `KnowTomorrow-2.0.0-win-x64.exe`, `...-mac-arm64.dmg`, `...-linux-x86_64.AppImage`.

Если релиза ещё нет, страница честно предлагает PWA.

## 6. Иконки

Иконки генерируются из `public/assets/logo.png`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icons.ps1
```

Скрипт обрезает прозрачные поля, делает обычные и maskable-иконки, favicon и
apple-touch. Windows `.ico` лежит в `desktop/build/icon.ico`.

## 7. Частые проблемы

| Симптом | Причина |
|---|---|
| Кнопка установки не появляется | нет HTTPS, уже установлено, или браузер не поддерживает beforeinstallprompt |
| PWA показывает старую версию | не поднят `VERSION` в `sw.js`; очистите Cache Storage |
| Desktop открывает localhost | в `config.json` не заменён `appUrl` |
| APK показывает белый экран | неверный `server.url` или нет интернета |
| iOS не устанавливается | открыт не Safari или нет HTTPS |
| Офлайн не работает | service worker не активирован; проверьте scope `/` |
