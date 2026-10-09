import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.js';

export type PosDb = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: PosDb;
  sqlite: Database.Database;
}

/** Abre SQLite en modo WAL con llaves foráneas activas. Usa ':memory:' en pruebas. */
export function createDb(file: string): DbHandle {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
