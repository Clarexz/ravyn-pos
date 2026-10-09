import { parsePesos, type Cents } from './money.js';

/** Columnas de la plantilla. `producto` y `precio` son obligatorias. */
export const IMPORT_HEADERS = [
  'producto',
  'variante',
  'codigo',
  'precio',
  'costo',
  'stock',
  'categoria',
] as const;
export type ImportHeader = (typeof IMPORT_HEADERS)[number];

/** Una fila = una variante (un producto sin variantes es un producto con una variante). */
export interface ImportRow {
  /** Número de fila en la hoja (la fila 1 son los encabezados). */
  row: number;
  product: string;
  variant: string | null;
  code: string | null;
  priceCents: Cents;
  costCents: Cents | null;
  /** Existencias deseadas (absolutas), o null para no tocar el inventario. */
  stock: number | null;
  category: string | null;
}

export interface ImportError {
  row: number;
  column?: ImportHeader;
  message: string;
}

export interface ParsedImport {
  rows: ImportRow[];
  errors: ImportError[];
  /** Filas con datos (sin contar encabezados ni filas vacías). */
  totalRows: number;
}

/** "Código", " PRECIO " -> "codigo", "precio". */
function normalizeHeader(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .trim();
}

const CODE_PATTERN = /^\S{1,64}$/;

/**
 * Convierte una tabla (primera fila = encabezados) en filas validadas.
 * Reúne TODOS los errores de formato; la vista previa los muestra juntos.
 */
export function parseImportTable(table: readonly (readonly string[])[]): ParsedImport {
  const errors: ImportError[] = [];
  const headerRow = table[0];
  if (!headerRow) {
    return { rows: [], errors: [{ row: 1, message: 'El archivo está vacío.' }], totalRows: 0 };
  }

  const columnOf = new Map<ImportHeader, number>();
  headerRow.forEach((cell, index) => {
    const name = normalizeHeader(cell);
    const header = IMPORT_HEADERS.find((h) => h === name);
    if (header && !columnOf.has(header)) columnOf.set(header, index);
  });
  for (const required of ['producto', 'precio'] as const) {
    if (!columnOf.has(required)) {
      errors.push({ row: 1, column: required, message: `Falta la columna "${required}".` });
    }
  }
  if (errors.length > 0) return { rows: [], errors, totalRows: 0 };

  const rows: ImportRow[] = [];
  let totalRows = 0;

  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    const get = (h: ImportHeader): string => {
      const col = columnOf.get(h);
      return col === undefined ? '' : (cells[col] ?? '').trim();
    };
    if (cells.every((c) => c.trim() === '')) continue;
    totalRows += 1;

    const row = i + 1;
    const rowErrors: ImportError[] = [];
    const fail = (column: ImportHeader, message: string) =>
      rowErrors.push({ row, column, message });

    const product = get('producto');
    if (!product) fail('producto', 'El producto es obligatorio.');
    else if (product.length > 120) fail('producto', 'El nombre del producto es demasiado largo.');

    const variant = get('variante');
    if (variant.length > 120) fail('variante', 'El nombre de la variante es demasiado largo.');

    const code = get('codigo');
    if (code && !CODE_PATTERN.test(code)) {
      fail('codigo', 'El código no puede tener espacios ni más de 64 caracteres.');
    }

    let priceCents = 0;
    const priceText = get('precio');
    if (!priceText) fail('precio', 'El precio es obligatorio.');
    else {
      const parsed = parseMoney(priceText);
      if (parsed === undefined) fail('precio', `Precio inválido: "${priceText}".`);
      else priceCents = parsed;
    }

    let costCents: Cents | null = null;
    const costText = get('costo');
    if (costText) {
      const parsed = parseMoney(costText);
      if (parsed === undefined) fail('costo', `Costo inválido: "${costText}".`);
      else costCents = parsed;
    }

    let stock: number | null = null;
    const stockText = get('stock');
    if (stockText) {
      if (/^\d+$/.test(stockText) && Number.isSafeInteger(Number(stockText))) {
        stock = Number(stockText);
      } else fail('stock', `Las existencias deben ser un entero de 0 o más: "${stockText}".`);
    }

    const category = get('categoria');
    if (category.length > 120) fail('categoria', 'El nombre de la categoría es demasiado largo.');

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }
    rows.push({
      row,
      product,
      variant: variant || null,
      code: code || null,
      priceCents,
      costCents,
      stock,
      category: category || null,
    });
  }

  return { rows, errors, totalRows };
}

/** Pesos a centavos; undefined si no es un monto válido o es negativo. */
function parseMoney(text: string): Cents | undefined {
  try {
    const cents = parsePesos(text);
    return cents < 0 ? undefined : cents;
  } catch {
    return undefined;
  }
}
