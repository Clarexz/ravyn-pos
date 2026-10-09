/** Tipos de movimiento. La cantidad se guarda con signo: stock = suma de cantidades. */
export const MOVEMENT_TYPES = [
  'sale', // negativa
  'cancellation', // positiva (reversa de una venta)
  'adjustment', // con signo, siempre con motivo
  'entry', // positiva (mercancía recibida)
  'consumption', // negativa (hojas consumidas por impresiones/servicios)
  'count', // con signo (diferencia de un conteo físico)
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Stock = suma de los movimientos. Nunca se guarda ni se edita directamente. */
export function stockFromQuantities(quantities: readonly number[]): number {
  return quantities.reduce((sum, q) => sum + q, 0);
}
