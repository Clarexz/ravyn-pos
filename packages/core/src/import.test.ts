import { describe, expect, it } from 'vitest';
import { parseImportTable } from './import.js';

const H = ['Producto', 'Variante', 'Código', 'Precio', 'Costo', 'Stock', 'Categoría'];

describe('parseImportTable', () => {
  it('lee filas válidas y reconoce encabezados con acentos, mayúsculas y orden distinto', () => {
    const r = parseImportTable([
      ['PRECIO', 'producto', ' Categoría ', 'Código'],
      ['$12.50', 'Lápiz HB', 'Escritura', '750100'],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      {
        row: 2,
        product: 'Lápiz HB',
        variant: null,
        code: '750100',
        priceCents: 1250,
        costCents: null,
        stock: null,
        category: 'Escritura',
      },
    ]);
  });

  it('lee todas las columnas', () => {
    const r = parseImportTable([H, ['Cuaderno', 'Rayado', 'C1', '45', '30.5', '12', 'Cuadernos']]);
    expect(r.rows[0]).toMatchObject({
      variant: 'Rayado',
      priceCents: 4500,
      costCents: 3050,
      stock: 12,
    });
  });

  it('exige las columnas producto y precio', () => {
    const r = parseImportTable([
      ['Producto', 'Stock'],
      ['A', '1'],
    ]);
    expect(r.errors).toEqual([{ row: 1, column: 'precio', message: 'Falta la columna "precio".' }]);
    expect(r.rows).toEqual([]);
  });

  it('reporta todos los errores con su fila y columna, y conserva las filas buenas', () => {
    const r = parseImportTable([
      H,
      ['Bueno', '', '', '10', '', '', ''],
      ['', '', '', '10', '', '', ''], // fila 3: sin producto
      ['Malo', '', 'a b', 'abc', 'x', '-3', ''], // fila 4: código, precio, costo, stock
      ['Otro', '', '', '-5', '', '1.5', ''], // fila 5: precio negativo, stock decimal
    ]);
    expect(r.rows.map((x) => x.product)).toEqual(['Bueno']);
    expect(r.errors.map((e) => [e.row, e.column])).toEqual([
      [3, 'producto'],
      [4, 'codigo'],
      [4, 'precio'],
      [4, 'costo'],
      [4, 'stock'],
      [5, 'precio'],
      [5, 'stock'],
    ]);
    expect(r.totalRows).toBe(4);
  });

  it('omite filas vacías pero conserva la numeración real', () => {
    const r = parseImportTable([H, ['', '', '', '', '', '', ''], ['A', '', '', '1', '', '', '']]);
    expect(r.rows[0]!.row).toBe(3);
    expect(r.totalRows).toBe(1);
  });

  it('archivo vacío', () => {
    expect(parseImportTable([]).errors[0]!.message).toMatch(/vacío/);
  });
});
