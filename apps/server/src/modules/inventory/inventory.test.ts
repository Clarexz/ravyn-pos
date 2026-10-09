import { auditLog, createDb, inventoryMovements, runMigrations } from '@pos/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

let app: FastifyInstance;
let db: ReturnType<typeof createDb>['db'];
let admin: Record<string, string>;
let employee: Record<string, string>;
let variantId: string;

async function login(userId: string, pin: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { userId, pin },
  });
  return { authorization: `Bearer ${res.json().token}` };
}
const post = (url: string, payload: unknown, headers = admin) =>
  app.inject({ method: 'POST', url, headers, payload: payload as object });
const stockOf = async (id = variantId) =>
  (await app.inject({ url: `/api/variants/${id}/stock`, headers: admin })).json().stock;

beforeEach(async () => {
  ({ db } = createDb(':memory:'));
  runMigrations(db);
  app = await buildApp({ db });
  const setup = await post(
    '/api/setup',
    {
      tenantName: 'T',
      storeName: 'S',
      adminName: 'Dueño',
      pin: '1234',
    },
    {},
  );
  admin = await login(setup.json().user.id, '1234');
  const emp = await post('/api/users', { name: 'Ana', role: 'employee', pin: '5678' });
  employee = await login(emp.json().user.id, '5678');
  const product = await post('/api/products', { name: 'Hoja carta', priceCents: 100 });
  variantId = product.json().variants[0].id;
});
afterEach(() => app.close());

describe('inventario', () => {
  it('stock = suma de movimientos tras 5 operaciones', async () => {
    expect(await stockOf()).toBe(0);
    await post(`/api/variants/${variantId}/receive`, { quantity: 500, reason: 'Compra' });
    await post(`/api/variants/${variantId}/adjust`, { delta: -12, reason: 'Hojas dañadas' });
    await post(`/api/variants/${variantId}/receive`, { quantity: 100 });
    await post(`/api/variants/${variantId}/adjust`, { delta: 3, reason: 'Se encontraron' });
    const last = await post(`/api/variants/${variantId}/adjust`, { delta: -1, reason: 'Merma' });

    expect(last.json().stock).toBe(590);
    expect(await stockOf()).toBe(590);

    const rows = db.select().from(inventoryMovements).all();
    expect(rows).toHaveLength(5);
    expect(rows.reduce((sum, r) => sum + r.quantity, 0)).toBe(590);
    expect(rows.map((r) => r.type)).toEqual([
      'entry',
      'adjustment',
      'entry',
      'adjustment',
      'adjustment',
    ]);
  });

  it('el historial muestra los movimientos, el más reciente primero', async () => {
    await post(`/api/variants/${variantId}/receive`, { quantity: 10 });
    await post(`/api/variants/${variantId}/adjust`, { delta: -2, reason: 'Merma' });
    const res = await app.inject({ url: `/api/variants/${variantId}/movements`, headers: admin });
    expect(res.json().movements.map((m: { quantity: number }) => m.quantity)).toEqual([-2, 10]);
  });

  it('el ajuste exige motivo y queda en la bitácora con antes y después', async () => {
    await post(`/api/variants/${variantId}/receive`, { quantity: 20 });
    expect((await post(`/api/variants/${variantId}/adjust`, { delta: -5 })).statusCode).toBe(400);
    expect(
      (await post(`/api/variants/${variantId}/adjust`, { delta: -5, reason: '  ' })).statusCode,
    ).toBe(400);
    await post(`/api/variants/${variantId}/adjust`, { delta: -5, reason: 'Merma' });
    const log = db
      .select()
      .from(auditLog)
      .all()
      .filter((r) => r.action === 'inventory.adjust');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ reason: 'Merma', entity: 'variant', entityId: variantId });
    expect(JSON.parse(log[0]!.detail!)).toEqual({ delta: -5, before: 20, after: 15 });
  });

  it('rechaza cantidades inválidas', async () => {
    for (const quantity of [0, -5, 1.5]) {
      expect((await post(`/api/variants/${variantId}/receive`, { quantity })).statusCode).toBe(400);
    }
    expect(
      (await post(`/api/variants/${variantId}/adjust`, { delta: 0, reason: 'x' })).statusCode,
    ).toBe(400);
    expect(await stockOf()).toBe(0);
  });

  it('el stock puede quedar negativo (se puede vender con 0)', async () => {
    const res = await post(`/api/variants/${variantId}/adjust`, {
      delta: -3,
      reason: 'Venta sin registrar',
    });
    expect(res.json().stock).toBe(-3);
  });

  it('los servicios (sin control de inventario) no admiten movimientos', async () => {
    const service = await post('/api/products', {
      name: 'Engargolado',
      priceCents: 3500,
      controlsInventory: false,
    });
    const id = service.json().variants[0].id;
    const res = await post(`/api/variants/${id}/receive`, { quantity: 1 });
    expect(res.statusCode).toBe(409);
    expect(
      (await app.inject({ url: `/api/variants/${id}/stock`, headers: admin })).statusCode,
    ).toBe(409);
  });

  it('el listado de stock incluye solo variantes que controlan inventario', async () => {
    await post('/api/products', {
      name: 'Engargolado',
      priceCents: 3500,
      controlsInventory: false,
    });
    const cuaderno = await post('/api/products', {
      name: 'Cuaderno',
      priceCents: 4500,
      variants: [{ name: 'Rayado' }, { name: 'Cuadro' }],
    });
    await post(`/api/variants/${cuaderno.json().variants[1].id}/receive`, { quantity: 7 });
    const list = (await app.inject({ url: '/api/inventory/stock', headers: employee })).json()
      .stock;
    expect(
      list.map((r: { productName: string; variantName: string | null; stock: number }) => [
        r.productName,
        r.variantName,
        r.stock,
      ]),
    ).toEqual([
      ['Cuaderno', 'Rayado', 0],
      ['Cuaderno', 'Cuadro', 7],
      ['Hoja carta', null, 0],
    ]);
  });

  it('el empleado puede ver el stock pero no ajustar ni recibir', async () => {
    expect(
      (await app.inject({ url: `/api/variants/${variantId}/stock`, headers: employee })).statusCode,
    ).toBe(200);
    expect(
      (await post(`/api/variants/${variantId}/adjust`, { delta: 1, reason: 'x' }, employee))
        .statusCode,
    ).toBe(403);
    expect(
      (await post(`/api/variants/${variantId}/receive`, { quantity: 1 }, employee)).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: `/api/variants/${variantId}/movements`, headers: employee }))
        .statusCode,
    ).toBe(403);
  });

  it('variante inexistente: 404', async () => {
    expect((await post('/api/variants/no-existe/receive', { quantity: 1 })).statusCode).toBe(404);
  });
});
