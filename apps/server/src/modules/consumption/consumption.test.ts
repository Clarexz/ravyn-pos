import { auditLog, createDb, inventoryMovements, runMigrations } from '@pos/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { SessionUser } from '../auth/service.js';
import { ConsumptionService } from './service.js';

let app: FastifyInstance;
let db: ReturnType<typeof createDb>['db'];
let admin: Record<string, string>;
let employee: Record<string, string>;
let adminUser: SessionUser;
let hojaCarta: string;
let hojaOficio: string;

async function login(userId: string, pin: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { userId, pin },
  });
  return { headers: { authorization: `Bearer ${res.json().token}` }, user: res.json().user };
}
const post = (url: string, payload: unknown, headers = admin) =>
  app.inject({ method: 'POST', url, headers, payload: payload as object });
const put = (url: string, payload: unknown, headers = admin) =>
  app.inject({ method: 'PUT', url, headers, payload: payload as object });
const stockOf = async (id: string) =>
  (await app.inject({ url: `/api/variants/${id}/stock`, headers: admin })).json().stock;

async function newVariant(name: string, controlsInventory = true) {
  const res = await post('/api/products', { name, priceCents: 100, controlsInventory });
  return res.json().variants[0].id as string;
}

beforeEach(async () => {
  ({ db } = createDb(':memory:'));
  runMigrations(db);
  app = await buildApp({ db });
  const setup = await post(
    '/api/setup',
    { tenantName: 'T', storeName: 'S', adminName: 'D', pin: '1234' },
    {},
  );
  const a = await login(setup.json().user.id, '1234');
  admin = a.headers;
  adminUser = a.user;
  const emp = await post('/api/users', { name: 'Ana', role: 'employee', pin: '5678' });
  employee = (await login(emp.json().user.id, '5678')).headers;
  hojaCarta = await newVariant('Hoja carta');
  hojaOficio = await newVariant('Hoja oficio');
  await post(`/api/variants/${hojaCarta}/receive`, { quantity: 1000 });
  await post(`/api/variants/${hojaOficio}/receive`, { quantity: 200 });
});
afterEach(() => app.close());

describe('precios de impresión', () => {
  it('crea, lista y actualiza por color y tamaño, con bitácora al cambiar el precio', async () => {
    await put('/api/print-prices', { color: 'bw', size: 'letter', priceCents: 200 });
    await put('/api/print-prices', { color: 'color', size: 'letter', priceCents: 500 });
    await put('/api/print-prices', { color: 'bw', size: 'letter', priceCents: 250 });
    await put('/api/print-prices', { color: 'bw', size: 'letter', priceCents: 250 }); // sin cambio

    const list = (await app.inject({ url: '/api/print-prices', headers: employee })).json().prices;
    expect(
      list.map((p: { color: string; size: string; priceCents: number }) => [
        p.color,
        p.size,
        p.priceCents,
      ]),
    ).toEqual([
      ['bw', 'letter', 250],
      ['color', 'letter', 500],
    ]);
    const changes = db
      .select()
      .from(auditLog)
      .all()
      .filter((r) => r.action === 'price.change');
    expect(changes.map((r) => r.detail)).toEqual([JSON.stringify({ from: 200, to: 250 })]);
  });

  it('valida entradas y permisos', async () => {
    expect(
      (await put('/api/print-prices', { color: 'rojo', size: 'letter', priceCents: 1 })).statusCode,
    ).toBe(400);
    expect(
      (await put('/api/print-prices', { color: 'bw', size: 'letter', priceCents: 1.5 })).statusCode,
    ).toBe(400);
    expect(
      (await put('/api/print-prices', { color: 'bw', size: 'letter', priceCents: 1 }, employee))
        .statusCode,
    ).toBe(403);
  });
});

describe('recetas y consumo', () => {
  async function setupPrice(color: 'bw' | 'color', size: 'letter' | 'legal', input: string) {
    const price = (await put('/api/print-prices', { color, size, priceCents: 200 })).json();
    const res = await put(`/api/print-prices/${price.id}/recipe`, {
      lines: [{ inputVariantId: input, quantity: 1 }],
    });
    expect(res.statusCode).toBe(200);
    return price.id as string;
  }

  it('imprimir N páginas descuenta N hojas del insumo (prueba de consumo)', async () => {
    await setupPrice('bw', 'letter', hojaCarta);
    await setupPrice('bw', 'legal', hojaOficio);
    const service = new ConsumptionService(db);

    db.transaction((tx) => {
      service.consumePrint(tx, adminUser, { color: 'bw', size: 'letter' }, 5, {
        refType: 'print_job',
        refId: 'job-1',
      });
      service.consumePrint(tx, adminUser, { color: 'bw', size: 'legal' }, 3, {
        refType: 'print_job',
        refId: 'job-2',
        reason: 'ignorada: prueba',
      });
    });

    expect(await stockOf(hojaCarta)).toBe(995);
    expect(await stockOf(hojaOficio)).toBe(197);
    const rows = db
      .select()
      .from(inventoryMovements)
      .all()
      .filter((r) => r.type === 'consumption');
    expect(rows.map((r) => [r.variantId, r.quantity, r.refType, r.refId])).toEqual([
      [hojaCarta, -5, 'print_job', 'job-1'],
      [hojaOficio, -3, 'print_job', 'job-2'],
    ]);
  });

  it('una receta con varios insumos descuenta cada uno por unidad', async () => {
    const toner = await newVariant('Tóner');
    await post(`/api/variants/${toner}/receive`, { quantity: 100 });
    const price = (
      await put('/api/print-prices', { color: 'color', size: 'letter', priceCents: 500 })
    ).json();
    await put(`/api/print-prices/${price.id}/recipe`, {
      lines: [
        { inputVariantId: hojaCarta, quantity: 1 },
        { inputVariantId: toner, quantity: 2 },
      ],
    });
    const service = new ConsumptionService(db);
    db.transaction((tx) =>
      service.consumePrint(tx, adminUser, { color: 'color', size: 'letter' }, 4, {
        refType: 'x',
        refId: 'y',
      }),
    );
    expect(await stockOf(hojaCarta)).toBe(996);
    expect(await stockOf(toner)).toBe(92);
  });

  it('un servicio puede consumir insumos (ej. engargolado usa un arillo)', async () => {
    const service = await newVariant('Engargolado', false);
    const arillo = await newVariant('Arillo');
    await post(`/api/variants/${arillo}/receive`, { quantity: 50 });
    await put(`/api/variants/${service}/recipe`, {
      lines: [{ inputVariantId: arillo, quantity: 1 }],
    });
    const consumption = new ConsumptionService(db);
    db.transaction((tx) =>
      consumption.consume(tx, adminUser, { serviceVariantId: service }, 2, {
        refType: 'sale',
        refId: 's1',
      }),
    );
    expect(await stockOf(arillo)).toBe(48);
  });

  it('sin receta no hay consumo; sin precio de impresión se avisa', async () => {
    await put('/api/print-prices', { color: 'bw', size: 'letter', priceCents: 200 });
    const service = new ConsumptionService(db);
    db.transaction((tx) => {
      expect(
        service.consumePrint(tx, adminUser, { color: 'bw', size: 'letter' }, 5, {
          refType: 'x',
          refId: 'y',
        }),
      ).toEqual([]);
    });
    expect(() =>
      db.transaction((tx) =>
        service.consumePrint(tx, adminUser, { color: 'color', size: 'legal' }, 1, {
          refType: 'x',
          refId: 'y',
        }),
      ),
    ).toThrow(/precio de impresión/);
    expect(await stockOf(hojaCarta)).toBe(1000);
  });

  it('el consumo es atómico: si algo falla en la transacción, no queda nada', async () => {
    await setupPrice('bw', 'letter', hojaCarta);
    const service = new ConsumptionService(db);
    expect(() =>
      db.transaction((tx) => {
        service.consumePrint(tx, adminUser, { color: 'bw', size: 'letter' }, 10, {
          refType: 'x',
          refId: 'y',
        });
        throw new Error('falla a medio cobro');
      }),
    ).toThrow();
    expect(await stockOf(hojaCarta)).toBe(1000);
  });

  it('reemplazar la receta reescribe las líneas y queda en la bitácora; vacía la elimina', async () => {
    const id = await setupPrice('bw', 'letter', hojaCarta);
    const replaced = await put(`/api/print-prices/${id}/recipe`, {
      lines: [{ inputVariantId: hojaOficio, quantity: 2 }],
    });
    expect(replaced.json().lines).toEqual([{ inputVariantId: hojaOficio, quantity: 2 }]);
    const cleared = await put(`/api/print-prices/${id}/recipe`, { lines: [] });
    expect(cleared.json().lines).toEqual([]);
    const log = db
      .select()
      .from(auditLog)
      .all()
      .filter((r) => r.action === 'recipe.change');
    expect(log).toHaveLength(3);
  });

  it('valida insumos: repetidos, inexistentes, sin control de inventario, cantidad inválida', async () => {
    const id = await setupPrice('bw', 'letter', hojaCarta);
    const url = `/api/print-prices/${id}/recipe`;
    const servicio = await newVariant('Servicio', false);
    expect(
      (
        await put(url, {
          lines: [
            { inputVariantId: hojaCarta, quantity: 1 },
            { inputVariantId: hojaCarta, quantity: 2 },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await put(url, { lines: [{ inputVariantId: 'no-existe', quantity: 1 }] })).statusCode,
    ).toBe(404);
    expect(
      (await put(url, { lines: [{ inputVariantId: servicio, quantity: 1 }] })).statusCode,
    ).toBe(400);
    expect(
      (await put(url, { lines: [{ inputVariantId: hojaCarta, quantity: 0 }] })).statusCode,
    ).toBe(400);
    expect((await put('/api/print-prices/no-existe/recipe', { lines: [] })).statusCode).toBe(404);
    // La receta original sigue intacta tras los rechazos.
    expect((await app.inject({ url, headers: admin })).json().lines).toHaveLength(1);
  });

  it('solo admin gestiona recetas', async () => {
    const id = await setupPrice('bw', 'letter', hojaCarta);
    expect(
      (await app.inject({ url: `/api/print-prices/${id}/recipe`, headers: employee })).statusCode,
    ).toBe(403);
    expect((await put(`/api/print-prices/${id}/recipe`, { lines: [] }, employee)).statusCode).toBe(
      403,
    );
  });
});
