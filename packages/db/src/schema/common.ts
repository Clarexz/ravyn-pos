import { integer, text } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';

/** Columnas comunes: todas las tablas llevan id, tenant_id, store_id y marcas de tiempo. */
export const commonColumns = () => ({
  id: text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  tenantId: text('tenant_id').notNull(),
  storeId: text('store_id').notNull(),
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});
