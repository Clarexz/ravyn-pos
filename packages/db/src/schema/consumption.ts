import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { commonColumns } from './common.js';
import { productVariants } from './catalog.js';

/** Precio por página según color y tamaño. */
export const printPrices = sqliteTable(
  'print_prices',
  {
    ...commonColumns(),
    color: text('color', { enum: ['bw', 'color'] }).notNull(),
    size: text('size', { enum: ['letter', 'legal'] }).notNull(),
    priceCents: integer('price_cents').notNull(),
  },
  (t) => [uniqueIndex('print_prices_store_kind_idx').on(t.storeId, t.color, t.size)],
);

/**
 * Receta de consumo: un destino (tipo de impresión o variante de servicio) descuenta insumos.
 * Exactamente uno de printPriceId / serviceVariantId.
 */
export const recipes = sqliteTable(
  'recipes',
  {
    ...commonColumns(),
    printPriceId: text('print_price_id').references(() => printPrices.id),
    serviceVariantId: text('service_variant_id').references(() => productVariants.id),
    inputVariantId: text('input_variant_id')
      .notNull()
      .references(() => productVariants.id),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    index('recipes_print_idx').on(t.printPriceId),
    index('recipes_service_idx').on(t.serviceVariantId),
    check(
      'recipes_one_target',
      sql`(${t.printPriceId} IS NULL) <> (${t.serviceVariantId} IS NULL)`,
    ),
    check('recipes_quantity_positive', sql`${t.quantity} > 0`),
  ],
);
