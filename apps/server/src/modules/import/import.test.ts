import {
  auditLog,
  createDb,
  inventoryMovements,
  productVariants,
  products,
  runMigrations,
} from '@pos/db';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { CSV_MIME, XLSX_MIME } from './file.js';

let app: FastifyInstance;
let db: ReturnType<typeof createDb>['db'];
let admin: Record<string, string>;
let employee: Record<string, string>;

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
const upload = (action: 'preview' | 'apply', csv: string, headers = admin) =>
  app.inject({
    method: 'POST',
    url: `/api/import/${action}`,
    headers: { ...headers, 'content-type': CSV_MIME },
    payload: Buffer.from(csv, 'utf8'),
  });
const count = (table: typeof products | typeof productVariants | typeof inventoryMovements) =>
  db.select().from(table).all().length;

const HEADER = 'Producto,Variante,Código,Precio,Costo,Stock,Categoría';

beforeEach(async () => {
  ({ db } = createDb(':memory:'));
  runMigrations(db);
  app = await buildApp({ db });
  const setup = await post(
    '/api/setup',
    { tenantName: 'T', storeName: 'S', adminName: 'D', pin: '1234' },
    {},
  );
  admin = await login(setup.json().user.id, '1234');
  const emp = await post('/api/users', { name: 'Ana', role: 'employee', pin: '5678' });
  employee = await login(emp.json().user.id, '5678');
});
afterEach(() => app.close());

describe('importación', () => {
  it('2,000 filas con 3 errores: reporta exactamente esos 3 y no guarda nada; reimportar no duplica', async () => {
    const lines = [HEADER];
    for (let i = 1; i <= 2000; i++) {
      lines.push(
        `Producto ${i},,C${String(i).padStart(5, '0')},${(i % 90) + 10}.50,5,${i % 30},Cat ${i % 10}`,
      );
    }
    const good = [...lines];
    // Fila de hoja = índice + 1 (la fila 1 son los encabezados).
    lines[10] = 'Producto 10,,C00010,abc,5,3,Cat 0'; // fila 11: precio inválido
    lines[500] = 'Producto 500,,C00001,10,5,3,Cat 0'; // fila 501: código ya usado por la fila 2
    lines[1999] = 'Producto 1999,,C01999,10,5,-3,Cat 9'; // fila 2000: stock negativo

    const preview = (await upload('preview', lines.join('\n'))).json();
    expect(preview.ok).toBe(false);
    expect(preview.totalRows).toBe(2000);
    expect(preview.errors.map((e: { row: number; column?: string }) => [e.row, e.column])).toEqual([
      [11, 'precio'],
      [501, 'codigo'],
      [2000, 'stock'],
    ]);
    // La vista previa no escribe nada.
    expect(count(products)).toBe(0);

    // Aplicar con errores: 422 y sigue sin escribir nada (todo o nada).
    const rejected = await upload('apply', lines.join('\n'));
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().applied).toBe(false);
    expect(count(products)).toBe(0);
    expect(count(inventoryMovements)).toBe(0);

    // Corregidos los errores, se importa todo.
    const applied = (await upload('apply', good.join('\n'))).json();
    expect(applied).toMatchObject({ ok: true, applied: true, totalRows: 2000 });
    expect(applied.summary).toMatchObject({
      productsCreated: 2000,
      variantsCreated: 2000,
      barcodesAdded: 2000,
      categoriesCreated: 10,
      variantsUpdated: 0,
    });
    expect(count(products)).toBe(2000);
    const movements = count(inventoryMovements);

    // Reimportar el mismo archivo: nada nuevo, nada cambia, no se duplican movimientos.
    const again = (await upload('apply', good.join('\n'))).json();
    expect(again.ok).toBe(true);
    expect(again.summary).toEqual({
      categoriesCreated: 0,
      productsCreated: 0,
      variantsCreated: 0,
      variantsUpdated: 0,
      barcodesAdded: 0,
      stockAdjustments: 0,
    });
    expect(count(products)).toBe(2000);
    expect(count(productVariants)).toBe(2000);
    expect(count(inventoryMovements)).toBe(movements);
  }, 30_000);

  it('reimportar actualiza por código: precio, costo y existencias', async () => {
    await upload('apply', `${HEADER}\nLápiz HB,,L1,5,2,100,Escritura`);
    const res = await upload('apply', `${HEADER}\nLápiz HB,,L1,6.50,3,80,Escritura`);
    expect(res.json().summary).toMatchObject({
      variantsUpdated: 1,
      variantsCreated: 0,
      stockAdjustments: 1,
    });

    const list = (await app.inject({ url: '/api/products', headers: admin })).json().products;
    expect(list).toHaveLength(1);
    expect(list[0].variants[0]).toMatchObject({ priceCents: 650, costCents: 300 });
    const stock = (
      await app.inject({ url: `/api/variants/${list[0].variants[0].id}/stock`, headers: admin })
    ).json();
    expect(stock.stock).toBe(80); // 100 y luego -20: existencias absolutas, no se suman
    const priceChanges = db
      .select()
      .from(auditLog)
      .all()
      .filter((r) => r.action === 'price.change');
    expect(priceChanges.map((r) => JSON.parse(r.detail!))).toEqual([
      { from: 500, to: 650, source: 'import' },
    ]);
  });

  it('agrupa variantes de un mismo producto; las que igualan el precio base lo heredan', async () => {
    const csv = [
      HEADER,
      'Cuaderno Scribe,Rayado,CR,45,30,10,Cuadernos',
      'Cuaderno Scribe,Cuadro,CC,48,32,5,Cuadernos',
      'Cuaderno Scribe,Liso,CL,45,28,,Cuadernos',
    ].join('\n');
    const res = (await upload('apply', csv)).json();
    expect(res.summary).toMatchObject({
      productsCreated: 1,
      variantsCreated: 3,
      categoriesCreated: 1,
    });
    const [product] = (await app.inject({ url: '/api/products', headers: admin })).json().products;
    expect(product.priceCents).toBe(4500);
    expect(
      product.variants.map(
        (v: { name: string; priceCents: number; ownPriceCents: number | null }) => [
          v.name,
          v.priceCents,
          v.ownPriceCents,
        ],
      ),
    ).toEqual([
      ['Rayado', 4500, null],
      ['Cuadro', 4800, 4800],
      ['Liso', 4500, null],
    ]);
  });

  it('una variante nueva en un producto existente se agrega, sin duplicar el producto', async () => {
    await upload('apply', `${HEADER}\nMarcador,Negro,M1,20,10,5,`);
    await upload('apply', `${HEADER}\nmarcador,Rojo,M2,20,10,5,`); // mayúsculas distintas: mismo producto
    expect(count(products)).toBe(1);
    expect(count(productVariants)).toBe(2);
  });

  it('conflictos: código de otro producto, variante repetida en el archivo, código repetido', async () => {
    await upload('apply', `${HEADER}\nA,,X1,10,,,`);
    const csv = [
      HEADER,
      'B,,X1,10,,,', // fila 2: X1 es de "A"
      'C,,X2,10,,,',
      'C,,X3,10,,,', // fila 4: misma variante (C sin nombre) que la fila 3
      'D,,X2,10,,,', // fila 5: X2 ya lo tomó C en este archivo
    ].join('\n');
    const res = (await upload('preview', csv)).json();
    expect(res.errors.map((e: { row: number }) => e.row)).toEqual([2, 4, 5]);
    expect(res.errors[0].message).toContain('"A"');
    expect(res.errors[1].message).toContain('fila 3');
  });

  it('un servicio (sin control de inventario) ignora la columna de existencias', async () => {
    const created = await post('/api/products', {
      name: 'Engargolado',
      priceCents: 3500,
      controlsInventory: false,
    });
    expect(created.statusCode).toBe(201);
    const res = (await upload('apply', `${HEADER}\nEngargolado,,,35,,50,`)).json();
    expect(res.ok).toBe(true);
    expect(res.summary.stockAdjustments).toBe(0);
    expect(count(inventoryMovements)).toBe(0);
  });

  it('acepta CSV con punto y coma (Excel en español), BOM y comillas', async () => {
    const csv =
      '﻿Producto;Variante;Código;Precio;Costo;Stock;Categoría\n"Pegamento, grande";;P1;"$1,250.00";;3;Útiles';
    const res = (await upload('apply', csv)).json();
    expect(res.ok).toBe(true);
    const [p] = (await app.inject({ url: '/api/products', headers: admin })).json().products;
    expect(p).toMatchObject({ name: 'Pegamento, grande', priceCents: 125000 });
  });

  it('faltan columnas obligatorias: error en la fila 1 y no se simula nada', async () => {
    const res = (await upload('preview', 'Producto,Stock\nA,1')).json();
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual([
      { row: 1, column: 'precio', message: 'Falta la columna "precio".' },
    ]);
  });

  it('escribe una entrada de bitácora al aplicar, y ninguna en la vista previa', async () => {
    await upload('preview', `${HEADER}\nA,,,10,,,`);
    expect(
      db
        .select()
        .from(auditLog)
        .all()
        .filter((r) => r.action === 'import.apply'),
    ).toHaveLength(0);
    await upload('apply', `${HEADER}\nA,,,10,,,`);
    expect(
      db
        .select()
        .from(auditLog)
        .all()
        .filter((r) => r.action === 'import.apply'),
    ).toHaveLength(1);
  });

  it('solo admin puede importar; formato no compatible y cuerpo vacío dan 400', async () => {
    expect((await upload('preview', `${HEADER}\nA,,,10,,,`, employee)).statusCode).toBe(403);
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/import/preview',
      headers: { ...admin, 'content-type': 'application/pdf' },
      payload: 'x',
    });
    expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
    expect((await upload('preview', '')).statusCode).toBe(400);
  });
});

describe('plantilla y xlsx', () => {
  it('la plantilla xlsx se descarga y es importable tal cual', async () => {
    const res = await app.inject({ url: '/api/import/template', headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(XLSX_MIME);
    expect(res.headers['content-disposition']).toContain('plantilla-inventario.xlsx');

    const imported = await app.inject({
      method: 'POST',
      url: '/api/import/apply',
      headers: { ...admin, 'content-type': XLSX_MIME },
      payload: res.rawPayload,
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().summary).toMatchObject({ productsCreated: 2, variantsCreated: 3 });
  });

  it('la plantilla csv trae los encabezados y se puede importar', async () => {
    const res = await app.inject({ url: '/api/import/template?format=csv', headers: admin });
    expect(res.body).toContain('Producto,Variante,Código,Precio,Costo,Stock,Categoría');
    expect((await upload('apply', res.body)).json().ok).toBe(true);
  });

  it('lee un xlsx con códigos numéricos y precios como número', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hoja1');
    ws.addRow(['Producto', 'Precio', 'Código', 'Stock']);
    ws.addRow(['Regla 30 cm', 12.5, 7501000000011, 20]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/apply',
      headers: { ...admin, 'content-type': XLSX_MIME },
      payload: buffer,
    });
    expect(res.json().ok).toBe(true);
    const [p] = (await app.inject({ url: '/api/products', headers: admin })).json().products;
    expect(p.variants[0]).toMatchObject({ priceCents: 1250 });
    expect(p.variants[0].barcodes[0].code).toBe('7501000000011');
  });

  it('un xlsx dañado da 400, no 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/preview',
      headers: { ...admin, 'content-type': XLSX_MIME },
      payload: Buffer.from('esto no es un excel'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('solo admin descarga la plantilla y el formato inválido da 400', async () => {
    expect((await app.inject({ url: '/api/import/template', headers: employee })).statusCode).toBe(
      403,
    );
    expect(
      (await app.inject({ url: '/api/import/template?format=pdf', headers: admin })).statusCode,
    ).toBe(400);
  });
});
