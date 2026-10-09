import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, type PosDb } from './client.js';

export const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

export function runMigrations(db: PosDb): void {
  migrate(db, { migrationsFolder });
}

// CLI: pnpm db:migrate  (usa POS_DB_PATH o ./data/pos.db)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.env.POS_DB_PATH ?? path.join(process.cwd(), 'data', 'pos.db');
  const { default: fs } = await import('node:fs');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { db, sqlite } = createDb(file);
  runMigrations(db);
  sqlite.close();
  console.log(`Migraciones aplicadas en ${file}`);
}
