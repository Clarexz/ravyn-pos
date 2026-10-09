import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';
import { commonColumns } from './common.js';

const now = () => Date.now();

// tenants y stores son la raíz: su propio id es el tenant_id / store_id del resto.
export const tenants = sqliteTable('tenants', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
});

export const stores = sqliteTable('stores', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
});

export const settings = sqliteTable(
  'settings',
  {
    ...commonColumns(),
    key: text('key').notNull(),
    /** JSON serializado. */
    value: text('value').notNull(),
  },
  (t) => [uniqueIndex('settings_store_key_idx').on(t.storeId, t.key)],
);

export const users = sqliteTable(
  'users',
  {
    ...commonColumns(),
    name: text('name').notNull(),
    role: text('role', { enum: ['admin', 'employee'] }).notNull(),
    pinHash: text('pin_hash').notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: integer('locked_until'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('users_store_idx').on(t.storeId)],
);

/** Inmutable: solo se inserta. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    ...commonColumns(),
    userId: text('user_id').references(() => users.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    reason: text('reason'),
    /** JSON serializado con detalle antes/después. */
    detail: text('detail'),
  },
  (t) => [index('audit_store_created_idx').on(t.storeId, t.createdAt)],
);
export * from './catalog.js';
