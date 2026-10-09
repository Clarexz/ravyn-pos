import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import {
  createAdapters,
  SimulatedPrintWatcher,
  SimulatedReceiptPrinter,
} from './adapters/index.js';
import { buildApp } from './app.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('server', () => {
  it('responde /api/health', async () => {
    app = await buildApp();
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('sirve la SPA y hace fallback a index.html, sin tapar /api', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-dist-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html>POS</html>');
    app = await buildApp({ posDistDir: dir });
    expect((await app.inject('/')).body).toContain('POS');
    expect((await app.inject('/venta/123')).body).toContain('POS');
    expect((await app.inject('/api/nada')).statusCode).toBe(404);
  });

  it('WebSocket responde pong a ping', async () => {
    app = await buildApp();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as { port: number };
    const messages: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('message', (m) => messages.push(m.toString()));
    await new Promise((r) => ws.once('open', r));
    ws.send('ping');
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
    expect(messages.map((m) => JSON.parse(m).type)).toEqual(['hello', 'pong']);
  });

  it('transmite trabajos de impresión simulados por WebSocket', async () => {
    const adapters = createAdapters({ platform: 'darwin' });
    app = await buildApp({ adapters });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as { port: number };
    const messages: { type: string; job?: { pages: number } }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('message', (m) => messages.push(JSON.parse(m.toString())));
    await new Promise((r) => ws.once('open', r));
    (adapters.printWatcher as SimulatedPrintWatcher).emit({ pages: 4 });
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
    expect(messages.find((m) => m.type === 'print_job')?.job?.pages).toBe(4);
  });

  it('genera comprobante de texto en modo simulado', async () => {
    const adapters = createAdapters({ platform: 'darwin' });
    app = await buildApp({ adapters });
    expect((await app.inject({ method: 'POST', url: '/api/dev/receipt' })).statusCode).toBe(200);
    expect((adapters.receiptPrinter as SimulatedReceiptPrinter).printed[0]).toContain('F-000001');
  });
});
