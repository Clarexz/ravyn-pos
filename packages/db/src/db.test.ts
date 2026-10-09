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
