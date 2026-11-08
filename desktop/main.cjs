/**
 * Electron-оболочка KnowTomorrow.
 *
 * Это именно оболочка: она открывает задеплоенную веб-версию, чтобы аккаунт,
 * синхронизация и обновления работали одинаково на всех устройствах.
 * Для локальной разработки укажите http://localhost:8080 в config.json.
 */

const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, 'config.json');
let config = { appUrl: 'http://localhost:8080' };
try {
  if (fs.existsSync(configPath)) config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
} catch (error) {
  console.error('Не удалось прочитать config.json', error);
}

const APP_URL = process.env.KT_APP_URL || config.appUrl || 'http://localhost:8080';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 380,
    minHeight: 620,
    backgroundColor: '#f6f4ef',
    title: 'KnowTomorrow',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  Menu.setApplicationMenu(null);

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' || target.protocol === 'http:') shell.openExternal(url);
    } catch {
      // ignore
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url);
      const allowed = new URL(APP_URL);
      const sameApp =
        target.origin === allowed.origin ||
        target.hostname === 'localhost' ||
        target.hostname === '127.0.0.1';
      if (!sameApp) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (code === -3) return; // ERR_ABORTED при обычной навигации
    dialog.showMessageBox(window, {
      type: 'error',
      title: 'Не удалось открыть KnowTomorrow',
      message: 'Сервер приложения недоступен.',
      detail: `${description}\n${url}\n\nПроверьте интернет или адрес в desktop/config.json. Для локального запуска: npm start в корне проекта, затем откройте http://localhost:8080.`
    });
  });

  window.loadURL(APP_URL);
  return window;
}

app.whenReady().then(() => {
  app.setAppUserModelId('ru.knowtomorrow.app');
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
