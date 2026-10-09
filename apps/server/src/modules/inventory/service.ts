import type { MovementType } from '@pos/core';
import { auditLog, inventoryMovements, productVariants, products, type PosDb } from '@pos/db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { SessionUser } from '../auth/service.js';

export class InventoryError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_tracked' | 'invalid_quantity',
    message: string,
  ) {
    super(message);
  }
}

type Tx = Parameters<Parameters<PosDb['transaction']>[0]>[0];
type Db = PosDb | Tx;

export interface NewMovement {
  variantId: string;
  type: MovementType;
  /** Con signo y distinta de 0. */
  quantity: number;
  reason?: string | null;
  refType?: string | null;
  refId?: string | null;
}

/**
 * Inserta un movimiento dentro de la transacción del llamador (ventas, impresiones, conteos).
 * Las operaciones que tocan dinero e inventario deben compartir UNA transacción.
 */
export function insertMovement(tx: Db, actor: SessionUser, m: NewMovement): void {
  if (!Number.isSafeInteger(m.quantity) || m.quantity === 0) {
    throw new InventoryError('invalid_quantity', 'La cantidad debe ser un entero distinto de 0.');
  }
  tx.insert(inventoryMovements)
    .values({
      tenantId: actor.tenantId,
      storeId: actor.storeId,
      variantId: m.variantId,
      type: m.type,
      quantity: m.quantity,
      reason: m.reason ?? null,
      userId: actor.id,
      refType: m.refType ?? null,
      refId: m.refId ?? null,
    })
    .run();
}

/** Stock de una variante = suma de sus movimientos. */
export function stockOf(db: Db, storeId: string, variantId: string): number {
  const row = db
    .select({ stock: sql<number>`coalesce(sum(${inventoryMovements.quantity}), 0)` })
    .from(inventoryMovements)
    .where(
      and(eq(inventoryMovements.storeId, storeId), eq(inventoryMovements.variantId, variantId)),
    )
    .get();
  return Number(row?.stock ?? 0);
}

export interface StockRow {
  variantId: string;
  productName: string;
  variantName: string | null;
  stock: number;
}

export class InventoryService {
  constructor(private readonly db: PosDb) {}

  getStock(actor: SessionUser, variantId: string): number {
    this.requireTracked(this.db, actor, variantId);
    return stockOf(this.db, actor.storeId, variantId);
  }

  /** Stock de todas las variantes activas de productos que controlan inventario. */
  listStock(actor: SessionUser): StockRow[] {
    return this.db
      .select({
        variantId: productVariants.id,
        productName: products.name,
        variantName: productVariants.name,
        stock: sql<number>`coalesce(sum(${inventoryMovements.quantity}), 0)`.mapWith(Number),
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(inventoryMovements, eq(inventoryMovements.variantId, productVariants.id))
      .where(
        and(
          eq(productVariants.storeId, actor.storeId),
          eq(productVariants.active, true),
          eq(products.active, true),
          eq(products.controlsInventory, true),
        ),
      )
      .groupBy(productVariants.id)
      .orderBy(asc(products.name), asc(productVariants.createdAt))
      .all();
  }

  /** Entrada de mercancía (cantidad positiva). */
  receive(actor: SessionUser, variantId: string, quantity: number, reason?: string | null) {
    return this.db.transaction((tx) => {
      this.requireTracked(tx, actor, variantId);
      insertMovement(tx, actor, { variantId, type: 'entry', quantity, reason });
      return stockOf(tx, actor.storeId, variantId);
    });
  }

  /** Ajuste manual con signo y motivo obligatorio; queda en la bitácora. */
  adjust(actor: SessionUser, variantId: string, delta: number, reason: string) {
    return this.db.transaction((tx) => {
      this.requireTracked(tx, actor, variantId);
      const before = stockOf(tx, actor.storeId, variantId);
      insertMovement(tx, actor, { variantId, type: 'adjustment', quantity: delta, reason });
      tx.insert(auditLog)
        .values({
          tenantId: actor.tenantId,
          storeId: actor.storeId,
          userId: actor.id,
          action: 'inventory.adjust',
          entity: 'variant',
          entityId: variantId,
          reason,
          detail: JSON.stringify({ delta, before, after: before + delta }),
        })
        .run();
      return before + delta;
    });
  }

  history(actor: SessionUser, variantId: string, limit = 100) {
    this.requireTracked(this.db, actor, variantId);
    return this.db
      .select({
        id: inventoryMovements.id,
        type: inventoryMovements.type,
        quantity: inventoryMovements.quantity,
        reason: inventoryMovements.reason,
        userId: inventoryMovements.userId,
        createdAt: inventoryMovements.createdAt,
      })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.storeId, actor.storeId),
          eq(inventoryMovements.variantId, variantId),
        ),
      )
      .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
      .limit(limit)
      .all();
  }

  private requireTracked(db: Db, actor: SessionUser, variantId: string) {
    const row = db
      .select({ controls: products.controlsInventory })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.id, variantId), eq(productVariants.storeId, actor.storeId)))
      .get();
    if (!row) throw new InventoryError('not_found', 'La variante no existe.');
    if (!row.controls) {
      throw new InventoryError('not_tracked', 'Este artículo no controla inventario.');
    }
  }
}
