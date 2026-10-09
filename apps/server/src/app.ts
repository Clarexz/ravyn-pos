import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PosDb } from '@pos/db';
import { DomainError } from './errors.js';
import type { Adapters } from './adapters/index.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { AuthService } from './modules/auth/service.js';
import { registerCatalogRoutes } from './modules/catalog/routes.js';
import { CatalogService } from './modules/catalog/service.js';
import { registerConsumptionRoutes } from './modules/consumption/routes.js';
import { ConsumptionService } from './modules/consumption/service.js';
import { registerImportRoutes } from './modules/import/routes.js';
import { ImportService } from './modules/import/service.js';
import { registerInventoryRoutes } from './modules/inventory/routes.js';
import { InventoryService } from './modules/inventory/service.js';

export interface AppOptions {
  /** Carpeta con la SPA compilada (apps/pos/dist). Si no existe, solo se sirve la API. */
  posDistDir?: string;
  logger?: boolean;
  adapters?: Adapters;
  db?: PosDb;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(fastifyWebsocket);

  app.get('/api/health', async () => ({ ok: true, service: 'pos-server', time: Date.now() }));

  // Errores de negocio conocidos -> respuesta HTTP con mensaje en español.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof DomainError) {
      return reply.code(err.status).send({ error: err.message, code: err.code });
    }
    return reply.send(err);
  });

  if (options.db) {
    const auth = new AuthService(options.db);
    app.decorate('auth', auth);
    registerAuthRoutes(app, auth);
    registerCatalogRoutes(app, auth, new CatalogService(options.db));
    registerInventoryRoutes(app, auth, new InventoryService(options.db));
    registerConsumptionRoutes(app, auth, new ConsumptionService(options.db));
    registerImportRoutes(app, auth, new ImportService(options.db));
  }

  const { adapters } = options;
  const broadcast = (message: unknown) => {
    const data = JSON.stringify(message);
    for (const client of app.websocketServer.clients) {
      if (client.readyState === client.OPEN) client.send(data);
    }
  };

  if (adapters) {
    await adapters.printWatcher.start((job) => broadcast({ type: 'print_job', job }));
    app.addHook('onClose', async () => adapters.printWatcher.stop());

    // Solo en simulación: permite probar comprobantes y trabajos sin hardware.
    if (adapters.mode === 'simulated') {
      app.post('/api/dev/receipt', async () => {
        await adapters.receiptPrinter.print({
          title: 'PAPELERIA LAS FUENTES',
          folio: 'F-000001',
          lines: ['Engargolado             $35.00', 'Total                   $35.00'],
        });
        return { ok: true };
      });
    }
  }

  // Canal de eventos hacia la interfaz. "ping" -> "pong" sirve de prueba de vida.
  app.get('/ws', { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: 'hello' }));
    socket.on('message', (raw: Buffer) => {
      if (raw.toString() === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
    });
  });

  const dist = options.posDistDir;
  if (dist && fs.existsSync(path.join(dist, 'index.html'))) {
    await app.register(fastifyStatic, { root: dist });
    // Fallback de SPA: cualquier ruta que no sea /api ni /ws devuelve index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'No encontrado' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
