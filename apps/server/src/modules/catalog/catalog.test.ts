import { auditLog, createDb, runMigrations } from '@pos/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

let app: FastifyInstance;
let adminAuth: Record<string, string>;
let employeeAuth: Record<string, string>;
let db: ReturnType<typeof createDb>['db'];

beforeEach(async () => {
  ({ db } = createDb(':memory:'));
  runMigrations(db);
  app = await buildApp({ db });

  const setup = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { tenantName: 'T', storeName: 'S', adminName: 'Dueño', pin: '1234' },
  });
  const adminLogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { userId: setup.json().user.id, pin: '1234' },
  });
  adminAuth = { authorization: `Bearer ${adminLogin.json().token}` };

  const emp = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: adminAuth,
    payload: { name: 'Ana', role: 'employee', pin: '5678' },
  });
  const empLogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { userId: emp.json().user.id, pin: '5678' },
  });
  employeeAuth = { authorization: `Bearer ${empLogin.json().token}` };
});
afterEach(() => app.close());

const post = (url: string, payload: unknown, headers = adminAuth) =>
  app.inject({ method: 'POST', url, headers, payload: payload as object });
const patch = (url: string, payload: unknown, headers = adminAuth) =>
  app.inject({ method: 'PATCH', url, headers, payload: payload as object });

describe('catálogo', () => {
  it('producto con 2 variantes: precio heredado y propio, cada una con sus códigos', async () => {
    const cat = await post('/api/categories', { name: 'Cuadernos' });
    expect(cat.statusCode).toBe(201);

    const res = await post('/api/products', {
      name: 'Cuaderno Scribe',
      categoryId: cat.json().id,
      priceCents: 4500,
      variants: [
        { name: 'Rayado', barcodes: ['7501000000011', 'SCR-RAY'] },
        { name: 'Cuadro', priceCents: 4800, barcodes: ['7501000000028'] },
      ],
    });
    expect(res.statusCode).toBe(201);
    const product = res.json();
    expect(product.variants).toHaveLength(2);

    const [rayado, cuadro] = product.variants;
    expect(rayado).toMatchObject({ name: 'Rayado', priceCents: 4500, ownPriceCents: null });
    expect(rayado.barcodes.map((b: { code: string }) => b.code)).toEqual([
      '7501000000011',
      'SCR-RAY',
    ]);
    expect(cuadro).toMatchObject({ name: 'Cuadro', priceCents: 4800, ownPriceCents: 4800 });

    // Cambiar el precio del producto afecta a quien hereda, no a quien tiene precio propio.
    const updated = await patch(`/api/products/${product.id}`, { priceCents: 5000 });
    expect(updated.json().variants.map((v: { priceCents: number }) => v.priceCents)).toEqual([
      5000, 4800,
    ]);

    const list = await app.inject({ url: '/api/products', headers: employeeAuth });
    expect(list.json().products).toHaveLength(1);
  });

  it('producto sin variantes crea una variante única', async () => {
    const res = await post('/api/products', { name: 'Lápiz HB', priceCents: 500 });
    const [only, ...rest] = res.json().variants;
    expect(rest).toHaveLength(0);
    expect(only).toMatchObject({ name: null, priceCents: 500, active: true });
    expect(res.json().controlsInventory).toBe(true);
  });

  it('los servicios pueden no controlar inventario', async () => {
    const res = await post('/api/products', {
      name: 'Engargolado',
      priceCents: 3500,
      controlsInventory: false,
    });
    expect(res.json().controlsInventory).toBe(false);
  });

  it('un código de barras no se puede repetir, ni siquiera en otra variante', async () => {
    await post('/api/products', { name: 'A', priceCents: 100, variants: [{ barcodes: ['111'] }] });
    const dup = await post('/api/products', {
      name: 'B',
      priceCents: 100,
      variants: [{ barcodes: ['111'] }],
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('duplicate_barcode');
    // La transacción se revierte: B no quedó creado.
    const list = await app.inject({ url: '/api/products', headers: adminAuth });
    expect(list.json().products.map((p: { name: string }) => p.name)).toEqual(['A']);
  });

  it('agrega y quita códigos de una variante', async () => {
    const product = (await post('/api/products', { name: 'A', priceCents: 100 })).json();
    const variantId = product.variants[0].id;
    const added = await post(`/api/variants/${variantId}/barcodes`, { code: 'XYZ' });
    expect(added.statusCode).toBe(201);
    const barcodeId = added.json().variants[0].barcodes[0].id;

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/barcodes/${barcodeId}`,
      headers: adminAuth,
    });
    expect(removed.json().variants[0].barcodes).toHaveLength(0);
    // Ya liberado: se puede reutilizar.
    expect((await post(`/api/variants/${variantId}/barcodes`, { code: 'XYZ' })).statusCode).toBe(
      201,
    );
  });

  it('agrega variantes después y las puede desactivar', async () => {
    const product = (await post('/api/products', { name: 'Marcador', priceCents: 2000 })).json();
    const withNew = await post(`/api/products/${product.id}/variants`, { name: 'Rojo' });
    expect(withNew.json().variants).toHaveLength(2);
    const redId = withNew.json().variants[1].id;
    const off = await patch(`/api/variants/${redId}`, { active: false });
    expect(off.json().variants[1].active).toBe(false);
    // En el listado de venta no aparece la variante inactiva.
    const list = await app.inject({ url: '/api/products', headers: adminAuth });
    expect(list.json().products[0].variants).toHaveLength(1);
  });

  it('los cambios de precio quedan en la bitácora', async () => {
    const product = (await post('/api/products', { name: 'A', priceCents: 1000 })).json();
    await patch(`/api/products/${product.id}`, { priceCents: 1200 });
    await patch(`/api/variants/${product.variants[0].id}`, { priceCents: 1500 });
    await patch(`/api/products/${product.id}`, { name: 'A2' }); // sin cambio de precio
    const rows = db
      .select()
      .from(auditLog)
      .all()
      .filter((r) => r.action === 'price.change');
    expect(rows.map((r) => [r.entity, r.detail])).toEqual([
      ['product', JSON.stringify({ from: 1000, to: 1200 })],
      ['variant', JSON.stringify({ from: null, to: 1500 })],
    ]);
  });

  it('desactivar un producto lo saca del listado normal', async () => {
    const product = (await post('/api/products', { name: 'A', priceCents: 100 })).json();
    await patch(`/api/products/${product.id}`, { active: false });
    expect(
      (await app.inject({ url: '/api/products', headers: adminAuth })).json().products,
    ).toHaveLength(0);
    const all = await app.inject({ url: '/api/products?includeInactive=true', headers: adminAuth });
    expect(all.json().products).toHaveLength(1);
  });

  it('categorías: nombre único y se pueden renombrar', async () => {
    await post('/api/categories', { name: 'Papel' });
    expect((await post('/api/categories', { name: 'Papel' })).statusCode).toBe(409);
    const other = await post('/api/categories', { name: 'Tinta' });
    const renamed = await patch(`/api/categories/${other.json().id}`, { name: 'Tintas' });
    expect(renamed.json().name).toBe('Tintas');
  });

  it('el empleado puede consultar pero no modificar', async () => {
    const body = { name: 'A', priceCents: 100 };
    const res = await post('/api/products', body, employeeAuth);
    expect(res.statusCode).toBe(403);
    expect((await post('/api/categories', { name: 'X' }, employeeAuth)).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/products', headers: employeeAuth })).statusCode).toBe(
      200,
    );
    expect((await app.inject('/api/products')).statusCode).toBe(401);
  });

  it('valida entradas: precio no entero, nombre vacío, código con espacios, id inexistente', async () => {
    expect((await post('/api/products', { name: 'A', priceCents: 10.5 })).statusCode).toBe(400);
    expect((await post('/api/products', { name: ' ', priceCents: 10 })).statusCode).toBe(400);
    expect(
      (
        await post('/api/products', {
          name: 'A',
          priceCents: 10,
          variants: [{ barcodes: ['a b'] }],
        })
      ).statusCode,
    ).toBe(400);
    expect((await patch('/api/products/no-existe', { name: 'B' })).statusCode).toBe(404);
    expect(
      (await post('/api/products', { name: 'A', priceCents: 10, categoryId: 'no-existe' }))
        .statusCode,
    ).toBe(404);
  });
});
