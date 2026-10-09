import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { commonColumns } from './common.js';

export const categories = sqliteTable(
  'categories',
  {
    ...commonColumns(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('categories_store_name_idx').on(t.storeId, t.name)],
);

export const products = sqliteTable(
  'products',
  {
    ...commonColumns(),
    categoryId: text('category_id').references(() => categories.id),
    name: text('name').notNull(),
    /** Precio base en centavos; las variantes sin precio propio lo heredan. */
    priceCents: integer('price_cents').notNull(),
    /** Los servicios no controlan inventario. */
    controlsInventory: integer('controls_inventory', { mode: 'boolean' }).notNull().default(true),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('products_store_idx').on(t.storeId)],
);

/** Un producto sin variantes tiene una sola variante (name = null). */
export const productVariants = sqliteTable(
  'product_variants',
  {
    ...commonColumns(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    name: text('name'),
    /** null = hereda el precio del producto. */
    priceCents: integer('price_cents'),
    costCents: integer('cost_cents'),
    /** Reservado para precio por volumen (JSON). Sin pantalla en el MVP. */
    volumePricing: text('volume_pricing'),
    /** Claves SAT para CFDI 4.0 (después del MVP). */
    satProductKey: text('sat_product_key'),
    satUnitKey: text('sat_unit_key'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('variants_product_idx').on(t.productId)],
);

export const barcodes = sqliteTable(
  'barcodes',
  {
    ...commonColumns(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    code: text('code').notNull(),
  },
  (t) => [
    uniqueIndex('barcodes_store_code_idx').on(t.storeId, t.code),
    index('barcodes_variant_idx').on(t.variantId),
  ],
);
