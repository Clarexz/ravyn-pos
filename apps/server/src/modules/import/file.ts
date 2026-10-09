import { IMPORT_HEADERS } from '@pos/core';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { badRequest } from '../../errors.js';

export type FileFormat = 'csv' | 'xlsx';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const CSV_MIME = 'text/csv';

/** Marca de orden de bytes: Excel la necesita para abrir un CSV en UTF-8 con acentos. */
const BOM = String.fromCharCode(0xfeff);

export function formatFromContentType(contentType: string | undefined): FileFormat {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (type === XLSX_MIME) return 'xlsx';
  if (type === CSV_MIME) return 'csv';
  throw badRequest('unsupported_format', 'Formato no compatible. Usa un archivo .xlsx o .csv.');
}

/** Lee el archivo como tabla de texto. Excel en español suele guardar CSV con ";". */
export async function readTable(buffer: Buffer, format: FileFormat): Promise<string[][]> {
  if (format === 'csv') {
    const raw = buffer.toString('utf8');
    const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
    return parsed.data.map((row) => row.map((c) => String(c ?? '')));
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest('invalid_file', 'No se pudo leer el archivo de Excel.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw badRequest('invalid_file', 'El archivo de Excel no tiene hojas.');

  const table: string[][] = [];
  const columns = Math.max(sheet.columnCount, IMPORT_HEADERS.length);
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= columns; c++) cells.push(row.getCell(c).text ?? '');
    table[rowNumber - 1] = cells;
  });
  // eachRow puede dejar huecos en filas totalmente vacías.
  return Array.from(table, (row) => row ?? []);
}

const EXAMPLE_ROWS: string[][] = [
  ['Cuaderno Scribe', 'Rayado', '7501000000011', '45.00', '30.00', '12', 'Cuadernos'],
  ['Cuaderno Scribe', 'Cuadro', '7501000000028', '48.00', '32.00', '8', 'Cuadernos'],
  ['Lápiz HB', '', '7501000000035', '5.00', '2.50', '100', 'Escritura'],
];

const COLUMN_TITLES = ['Producto', 'Variante', 'Código', 'Precio', 'Costo', 'Stock', 'Categoría'];

export async function buildTemplate(format: FileFormat): Promise<Buffer> {
  if (format === 'csv') {
    const csv = Papa.unparse([COLUMN_TITLES, ...EXAMPLE_ROWS]);
    return Buffer.from(`${BOM}${csv}\r\n`, 'utf8');
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Inventario');
  sheet.addRow(COLUMN_TITLES).font = { bold: true };
  [28, 18, 18, 12, 12, 10, 20].forEach((width, i) => (sheet.getColumn(i + 1).width = width));
  // Los códigos van como texto para que Excel no les quite ceros ni los pase a notación científica.
  sheet.getColumn(3).numFmt = '@';
  for (const example of EXAMPLE_ROWS) sheet.addRow(example);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
