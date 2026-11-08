import http from 'node:http';
import { pathToFileURL } from 'node:url';

import { RateLimiter } from './auth.mjs';
import { cleanupExpired, openDatabase } from './db.mjs';
import { createApi } from './api.mjs';
import { loadConfig } from './config.mjs';
import { createStaticHandler } from './static.mjs';
import { sendJson } from './http-utils.mjs';

export function createApp(config = loadConfig()) {
  const db = openDatabase(config.dataDir);
  const limiter = new RateLimiter();
  const api = createApi({ db, config, limiter });
  const staticHandler = createStaticHandler({
    publicDir: config.publicDir,
    sharedDir: config.sharedDir,
    config
  });

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || 'localhost';
      const url = new URL(req.url || '/', `http://${host}`);
      if (await api(req, res, url)) return;
      if (await staticHandler(req, res, url)) return;
      sendJson(res, 404, { error: 'Не найдено' });
    } catch (error) {
      console.error('[server]', error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
      } else {
        res.end();
      }
    }
  });

  server.requestTimeout = 30_000;
  server.headersTimeout = 35_000;

  const cleanupTimer = setInterval(() => {
    try {
      cleanupExpired(db);
    } catch (error) {
      console.error('[cleanup]', error);
    }
  }, 6 * 60 * 60 * 1000);
  cleanupTimer.unref();

  function close() {
    return new Promise((resolve) => {
      clearInterval(cleanupTimer);
      server.close(() => {
        try {
          db.close();
        } catch {
          // ignore
        }
        resolve();
      });
    });
  }

  return { server, db, config, close };
}

export async function startServer(config = loadConfig()) {
  const app = createApp(config);
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(config.port, config.host, () => {
      app.server.off('error', reject);
      resolve();
    });
  });
  const address = app.server.address();
  const actualPort = typeof address === 'object' && address ? address.port : config.port;
  const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`KnowTomorrow server: http://${displayHost}:${actualPort}`);
  console.log(`Данные: ${config.dataDir}`);
  return { ...app, port: actualPort };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const app = await startServer();
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`\n${signal}: останавливаю сервер...`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
