import {
  consumptionFor,
  type Consumption,
  type PrintColor,
  type PrintSize,
  type RecipeLine,
} from '@pos/core';
import { auditLog, printPrices, productVariants, products, recipes, type PosDb } from '@pos/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { badRequest, notFound } from '../../errors.js';
import type { SessionUser } from '../auth/service.js';
import { insertMovement } from '../inventory/service.js';

type Tx = Parameters<Parameters<PosDb['transaction']>[0]>[0];
type Db = PosDb | Tx;

/** A qué pertenece una receta: un tipo de impresión o una variante de servicio. */
export type RecipeTarget =
  | { printPriceId: string; serviceVariantId?: undefined }
  | { serviceVariantId: string; printPriceId?: undefined };

export interface PrintPriceInput {
  color: PrintColor;
  size: PrintSize;
  priceCents: number;
}

export interface ConsumptionRef {
  refType: string;
  refId: string;
  reason?: string;
}

export class ConsumptionService {
  constructor(private readonly db: PosDb) {}

  listPrintPrices(actor: SessionUser) {
    return this.db
      .select({
        id: printPrices.id,
        color: printPrices.color,
        size: printPrices.size,
        priceCents: printPrices.priceCents,
      })
      .from(printPrices)
      .where(eq(printPrices.storeId, actor.storeId))
      .orderBy(asc(printPrices.color), asc(printPrices.size))
      .all();
  }

  /** Crea o actualiza el precio por página. Un cambio de precio queda en la bitácora. */
  setPrintPrice(actor: SessionUser, input: PrintPriceInput) {
    return this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(printPrices)
        .where(
          and(
            eq(printPrices.storeId, actor.storeId),
            eq(printPrices.color, input.color),
            eq(printPrices.size, input.size),
          ),
        )
        .get();

      if (!existing) {
        const [row] = tx
          .insert(printPrices)
          .values({ tenantId: actor.tenantId, storeId: actor.storeId, ...input })
          .returning()
          .all();
        return pick(row!);
      }
      if (existing.priceCents !== input.priceCents) {
        tx.update(printPrices)
          .set({ priceCents: input.priceCents, updatedAt: Date.now() })
          .where(eq(printPrices.id, existing.id))
          .run();
        this.audit(tx, actor, 'price.change', 'print_price', existing.id, {
          from: existing.priceCents,
          to: input.priceCents,
        });
      }
      return pick({ ...existing, priceCents: input.priceCents });
    });
  }

  getRecipe(actor: SessionUser, target: RecipeTarget): RecipeLine[] {
    this.requireTarget(this.db, actor, target);
    return this.db
      .select({ inputVariantId: recipes.inputVariantId, quantity: recipes.quantity })
      .from(recipes)
      .where(this.targetFilter(actor, target))
      .orderBy(asc(recipes.createdAt), asc(recipes.id))
      .all();
  }

  /** Reemplaza la receta completa del destino. Una lista vacía la elimina. */
  setRecipe(actor: SessionUser, target: RecipeTarget, lines: RecipeLine[]): RecipeLine[] {
    const ids = lines.map((l) => l.inputVariantId);
    if (new Set(ids).size !== ids.length) {
      throw badRequest('duplicate_input', 'Un insumo no puede repetirse en la receta.');
    }
    for (const l of lines) {
      if (!Number.isSafeInteger(l.quantity) || l.quantity <= 0) {
        throw badRequest(
          'invalid_quantity',
          'La cantidad de cada insumo debe ser un entero mayor a 0.',
        );
      }
    }

    this.db.transaction((tx) => {
      this.requireTarget(tx, actor, target);
      this.requireTrackedInputs(tx, actor, ids);
      if (target.serviceVariantId && ids.includes(target.serviceVariantId)) {
        throw badRequest('self_reference', 'Una receta no puede consumirse a sí misma.');
      }
      const before = tx
        .select({ inputVariantId: recipes.inputVariantId, quantity: recipes.quantity })
        .from(recipes)
        .where(this.targetFilter(actor, target))
        .all();
      tx.delete(recipes).where(this.targetFilter(actor, target)).run();
      for (const l of lines) {
        tx.insert(recipes)
          .values({
            tenantId: actor.tenantId,
            storeId: actor.storeId,
            printPriceId: target.printPriceId ?? null,
            serviceVariantId: target.serviceVariantId ?? null,
            inputVariantId: l.inputVariantId,
            quantity: l.quantity,
          })
          .run();
      }
      this.audit(
        tx,
        actor,
        'recipe.change',
        target.printPriceId ? 'print_price' : 'variant',
        (target.printPriceId ?? target.serviceVariantId)!,
        { before, after: lines },
      );
    });
    return this.getRecipe(actor, target);
  }

  /**
   * Calcula y registra el consumo de insumos para `units` unidades (páginas, piezas).
   * Se ejecuta dentro de la transacción del cobro o del descarte de la impresión.
   */
  consume(
    tx: Db,
    actor: SessionUser,
    target: RecipeTarget,
    units: number,
    ref: ConsumptionRef,
  ): Consumption[] {
    this.requireTarget(tx, actor, target);
    const lines = tx
      .select({ inputVariantId: recipes.inputVariantId, quantity: recipes.quantity })
      .from(recipes)
      .where(this.targetFilter(actor, target))
      .all();
    const consumption = consumptionFor(lines, units);
    for (const c of consumption) {
      insertMovement(tx, actor, {
        variantId: c.inputVariantId,
        type: 'consumption',
        quantity: -c.quantity,
        reason: ref.reason,
        refType: ref.refType,
        refId: ref.refId,
      });
    }
    return consumption;
  }

  /** Atajo: consumo de una impresión según su color y tamaño. */
  consumePrint(
    tx: Db,
    actor: SessionUser,
    kind: { color: PrintColor; size: PrintSize },
    pages: number,
    ref: ConsumptionRef,
  ): Consumption[] {
    const price = tx
      .select({ id: printPrices.id })
      .from(printPrices)
      .where(
        and(
          eq(printPrices.storeId, actor.storeId),
          eq(printPrices.color, kind.color),
          eq(printPrices.size, kind.size),
        ),
      )
      .get();
    if (!price) throw notFound('not_found', 'No hay precio de impresión para ese tipo.');
    return this.consume(tx, actor, { printPriceId: price.id }, pages, ref);
  }

  // --- Internos ---

  private targetFilter(actor: SessionUser, target: RecipeTarget) {
    return and(
      eq(recipes.storeId, actor.storeId),
      target.printPriceId
        ? eq(recipes.printPriceId, target.printPriceId)
        : eq(recipes.serviceVariantId, target.serviceVariantId!),
    );
  }

  private requireTarget(db: Db, actor: SessionUser, target: RecipeTarget) {
    const found = target.printPriceId
      ? db
          .select({ id: printPrices.id })
          .from(printPrices)
          .where(
            and(eq(printPrices.id, target.printPriceId), eq(printPrices.storeId, actor.storeId)),
          )
          .get()
      : db
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(
            and(
              eq(productVariants.id, target.serviceVariantId!),
              eq(productVariants.storeId, actor.storeId),
            ),
          )
          .get();
    if (!found) throw notFound('not_found', 'El destino de la receta no existe.');
  }

  /** Los insumos deben existir y controlar inventario; si no, el consumo no tendría sentido. */
  private requireTrackedInputs(tx: Tx, actor: SessionUser, ids: string[]) {
    if (ids.length === 0) return;
    const rows = tx
      .select({ id: productVariants.id, controls: products.controlsInventory })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.storeId, actor.storeId), inArray(productVariants.id, ids)))
      .all();
    if (rows.length !== ids.length) throw notFound('not_found', 'Un insumo no existe.');
    if (rows.some((r) => !r.controls)) {
      throw badRequest('input_not_tracked', 'Todos los insumos deben controlar inventario.');
    }
  }

  private audit(
    tx: Tx,
    actor: SessionUser,
    action: string,
    entity: string,
    entityId: string,
    detail: unknown,
  ) {
    tx.insert(auditLog)
      .values({
        tenantId: actor.tenantId,
        storeId: actor.storeId,
        userId: actor.id,
        action,
        entity,
        entityId,
        detail: JSON.stringify(detail),
      })
      .run();
  }
}

function pick(row: typeof printPrices.$inferSelect) {
  return { id: row.id, color: row.color, size: row.size, priceCents: row.priceCents };
}
