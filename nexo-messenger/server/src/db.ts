import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    db = new DatabaseSync(config.dbFile);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');
    runMigrations(db);
  }
  return db;
}

function runMigrations(database: DatabaseSync): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     );`
  );
  const applied = new Set(
    (database.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map(
      (r) => r.name
    )
  );
  const files = fs
    .readdirSync(config.migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(config.migrationsDir, file), 'utf8');
    database.exec('BEGIN');
    try {
      database.exec(sql);
      database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      database.exec('COMMIT');
      console.log(`[db] applied migration ${file}`);
    } catch (err) {
      database.exec('ROLLBACK');
      throw err;
    }
  }
}

export type SqlValue = string | number | bigint | null | Uint8Array;

export function all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[] {
  return getDb()
    .prepare(sql)
    .all(...params) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T | undefined {
  return getDb()
    .prepare(sql)
    .get(...params) as T | undefined;
}

export function run(sql: string, ...params: SqlValue[]): { changes: number | bigint } {
  return getDb()
    .prepare(sql)
    .run(...params);
}

export function tx<T>(fn: () => T): T {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
