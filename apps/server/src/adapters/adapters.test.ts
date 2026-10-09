import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAdapters, SimulatedPrintWatcher, SimulatedReceiptPrinter } from './index.js';

describe('createAdapters', () => {
  it('usa simulados fuera de Windows', () => {
    expect(createAdapters({ platform: 'darwin' }).mode).toBe('simulated');
  });
  it('usa simulados en Windows si POS_ADAPTERS=simulated', () => {
    expect(createAdapters({ platform: 'win32', POS_ADAPTERS: 'simulated' }).mode).toBe('simulated');
  });
  it('usa los reales en Windows por defecto', () => {
    expect(createAdapters({ platform: 'win32' }).mode).toBe('windows');
  });
});

describe('simulados', () => {
  it('el watcher emite trabajos con páginas', async () => {
    const watcher = new SimulatedPrintWatcher();
    const jobs: number[] = [];
    await watcher.start((j) => jobs.push(j.pages));
    watcher.emit({ pages: 7 });
    await watcher.stop();
    watcher.emit(); // ya detenido: no llega
    expect(jobs).toEqual([7]);
  });

  it('la impresora genera el comprobante como texto y lo guarda', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-rcpt-'));
    const printer = new SimulatedReceiptPrinter(dir);
    await printer.print({ title: 'Orden', folio: 'F-000123', lines: ['Engargolado  $35.00'] });
    expect(printer.printed[0]).toContain('F-000123');
    expect(printer.printed[0]).toContain('Engargolado');
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });
});
