import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createDb, runMigrations } from '@pos/db';
import { createAdapters } from './adapters/index.js';
import { buildApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.POS_PORT ?? 3000);

const dataDir = process.env.POS_DATA_DIR ?? path.join(process.cwd(), 'data');

fs.mkdirSync(dataDir, { recursive: true });
const { db } = createDb(process.env.POS_DB_PATH ?? path.join(dataDir, 'pos.db'));
runMigrations(db);

const app = await buildApp({
  db,
  logger: true,
  adapters: createAdapters({
    POS_ADAPTERS: process.env.POS_ADAPTERS,
    dataDir,
    simPrintIntervalMs: Number(process.env.POS_SIM_PRINT_INTERVAL_MS ?? 0),
  }),
  posDistDir: process.env.POS_DIST_DIR ?? path.join(here, '..', '..', 'pos', 'dist'),
});

// Solo localhost: el POS no se expone a la red.
await app.listen({ host: '127.0.0.1', port });
