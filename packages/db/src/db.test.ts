import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { auditLog, stores, tenants, users } from './schema/index.js';

function setup() {
  const { db, sqlite } = createDb(':memory:');
  runMigrations(db);
  return { db, sqlite };
}

describe('db inicial', () => {
  it('migra y permite leer/escribir', () => {
    const { db } = setup();
    const [tenant] = db.insert(tenants).values({ name: 'Ravyn' }).returning().all();
    const [store] = db
      .insert(stores)
      .values({ tenantId: tenant!.id, name: 'Las Fuentes' })
      .returning()
      .all();
    const [user] = db
      .insert(users)
      .values({
        tenantId: tenant!.id,
        storeId: store!.id,
        name: 'Admin',
        role: 'admin',
        pinHash: 'x',
      })
      .returning()
      .all();
    db.insert(auditLog)
      .values({
        tenantId: tenant!.id,
        storeId: store!.id,
        userId: user!.id,
        action: 'test',
        entity: 'user',
      })
      .run();

    expect(db.select().from(users).where(eq(users.id, user!.id)).all()).toHaveLength(1);
    expect(user!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // UUIDv7
    expect(user!.active).toBe(true);
  });

  it('respeta llaves foráneas', () => {
    const { db } = setup();
    expect(() => db.insert(stores).values({ tenantId: 'no-existe', name: 'x' }).run()).toThrow();
  });
});

describe('inmutabilidad', () => {
  it('audit_log e inventory_movements no se pueden editar ni borrar', async () => {
    const { inventoryMovements, productVariants, products } = await import('./schema/index.js');
    const { db } = setup();
    const [tenant] = db.insert(tenants).values({ name: 'T' }).returning().all();
    const [store] = db.insert(stores).values({ tenantId: tenant!.id, name: 'S' }).returning().all();
    const scope = { tenantId: tenant!.id, storeId: store!.id };
    const [product] = db
      .insert(products)
      .values({ ...scope, name: 'P', priceCents: 100 })
      .returning()
      .all();
    const [variant] = db
      .insert(productVariants)
      .values({ ...scope, productId: product!.id })
      .returning()
      .all();
    const [movement] = db
      .insert(inventoryMovements)
      .values({ ...scope, variantId: variant!.id, type: 'entry', quantity: 5 })
      .returning()
      .all();
    const [log] = db
      .insert(auditLog)
      .values({ ...scope, action: 'a', entity: 'e' })
      .returning()
      .all();

    expect(() =>
      db
        .update(inventoryMovements)
        .set({ quantity: 99 })
        .where(eq(inventoryMovements.id, movement!.id))
        .run(),
    ).toThrow(/inmutable/);
    expect(() =>
      db.delete(inventoryMovements).where(eq(inventoryMovements.id, movement!.id)).run(),
    ).toThrow(/inmutable/);
    expect(() =>
      db.update(auditLog).set({ action: 'x' }).where(eq(auditLog.id, log!.id)).run(),
    ).toThrow(/inmutable/);
    expect(() => db.delete(auditLog).where(eq(auditLog.id, log!.id)).run()).toThrow(/inmutable/);
  });
});
