import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

// Ładowane przez getBuiltinModule, bo bundler Angulara (esbuild) gubi prefiks "node:" dla node:sqlite
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

/**
 * Warstwa trwałości oparta na wbudowanym w Node.js module node:sqlite (Node >= 22.13).
 * Brak natywnych zależności do kompilowania — działa tak samo w LXC, na RPi i w testach.
 */
export class Db {
  readonly sql: DatabaseSyncType;

  constructor(path: string) {
    this.sql = new DatabaseSync(path);
    this.sql.exec('PRAGMA journal_mode = WAL;');
    this.sql.exec('PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  private migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS samples (
        device TEXT NOT NULL,
        key TEXT NOT NULL,
        ts INTEGER NOT NULL,
        value REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS samples_device_ts ON samples (device, ts);
      CREATE TABLE IF NOT EXISTS hourly (
        device TEXT NOT NULL,
        key TEXT NOT NULL,
        hour INTEGER NOT NULL,
        sum REAL NOT NULL,
        min REAL NOT NULL,
        max REAL NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (device, key, hour)
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        device TEXT,
        type TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT,
        acknowledged INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        action TEXT NOT NULL,
        device TEXT,
        device_name TEXT,
        message TEXT NOT NULL
      );
    `);
  }

  // --- ustawienia (JSON) ---
  getSetting<T>(key: string, fallback: T): T {
    const row = this.sql.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  setSetting(key: string, value: unknown): void {
    this.sql
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  close(): void {
    this.sql.close();
  }
}
