import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { commonColumns } from './common.js';
import { productVariants } from './catalog.js';
import { users } from './index.js';

/** Inmutable (lo exige un trigger): corregir = movimiento nuevo. */
export const inventoryMovements = sqliteTable(
  'inventory_movements',
  {
    ...commonColumns(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    type: text('type', {
      enum: ['sale', 'cancellation', 'adjustment', 'entry', 'consumption', 'count'],
    }).notNull(),
    /** Con signo: positiva suma al stock, negativa resta. Nunca 0. */
    quantity: integer('quantity').notNull(),
    reason: text('reason'),
    userId: text('user_id').references(() => users.id),
    /** Documento que originó el movimiento (venta, impresión, conteo...). */
    refType: text('ref_type'),
    refId: text('ref_id'),
  },
  (t) => [index('movements_variant_idx').on(t.variantId)],
);
