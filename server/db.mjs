import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    pass_salt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    consent_research INTEGER NOT NULL DEFAULT 0,
    consent_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS states (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    entry_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    meta TEXT
  );

  CREATE TABLE IF NOT EXISTS metrics_daily (
    day TEXT NOT NULL,
    type TEXT NOT NULL,
    target TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (day, type, target)
  );
  CREATE INDEX IF NOT EXISTS metrics_day_idx ON metrics_daily(day);
`;

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'knowtomorrow.db'));
  db.exec(SCHEMA);
  return db;
}

export function recordEvent(db, type, meta = null) {
  try {
    db.prepare('INSERT INTO events (type, created_at, meta) VALUES (?, ?, ?)').run(
      type,
      new Date().toISOString(),
      meta ? JSON.stringify(meta) : null
    );
  } catch {
    // События не должны ломать основной запрос.
  }
}

/**
 * Обезличенный счётчик: только день, тип и цель. Без IP, cookie и user id.
 */
export function recordMetric(db, type, target, date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO metrics_daily (day, type, target, count, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(day, type, target)
     DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`
  ).run(day, type, target, now);
}

export function cleanupExpired(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  const cutoff = new Date(Date.now() - 180 * 86400000).toISOString();
  db.prepare('DELETE FROM events WHERE created_at < ?').run(cutoff);
}
