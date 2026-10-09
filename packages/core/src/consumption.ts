export const PRINT_COLORS = ['bw', 'color'] as const;
export type PrintColor = (typeof PRINT_COLORS)[number];

export const PRINT_SIZES = ['letter', 'legal'] as const;
export type PrintSize = (typeof PRINT_SIZES)[number];

export interface RecipeLine {
  inputVariantId: string;
  /** Cantidad de insumo por unidad (por página en impresiones). */
  quantity: number;
}

export interface Consumption {
  inputVariantId: string;
  quantity: number;
}

/** Insumos que consume una receta al vender/imprimir `units` unidades. */
export function consumptionFor(lines: readonly RecipeLine[], units: number): Consumption[] {
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new Error('Las unidades deben ser un entero mayor a 0.');
  }
  return lines.map((l) => ({ inputVariantId: l.inputVariantId, quantity: l.quantity * units }));
}
