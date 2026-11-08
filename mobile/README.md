# Мобильные сборки KnowTomorrow

Основной способ установки на телефон — PWA: Chrome/Android и Safari/iOS
поддерживают «Добавить на главный экран» без магазинов приложений.

Для APK используется Capacitor. Он открывает тот же задеплоенный сайт и
добавляет нативную оболочку.

## Android вручную

```bash
cd mobile
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
# укажите свой HTTPS-домен в capacitor.config.json -> server.url
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug
```

APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

Workflow `.github/workflows/android.yml` делает то же самое в CI и загружает APK
как артефакт. Перед сборкой он подставляет URL из repository variable
`KNOWTOMORROW_APP_URL`.

## iOS

Требуется macOS, Xcode и Apple Developer account:

```bash
cd mobile
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap add ios
npx cap sync ios
npx cap open ios
```

Дальше — стандартная подпись и сборка в Xcode. Без Apple Developer account
приложение можно собрать только для симулятора.

## Ограничения

- Нативные оболочки требуют интернета для входа и синхронизации; гостевой режим
  с локальными данными работает и офлайн.
- Для публикации в Google Play нужен подписанный release APK/AAB, политика
  конфиденциальности и заполнение Data Safety.
- Для App Store — Apple Review и объяснение, что приложение не медицинское.
