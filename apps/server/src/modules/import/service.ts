import { parseImportTable, type ImportError, type ImportRow } from '@pos/core';
import {
  auditLog,
  barcodes,
  categories,
  inventoryMovements,
  productVariants,
  products,
  type PosDb,
} from '@pos/db';
import { eq, sql } from 'drizzle-orm';
import type { SessionUser } from '../auth/service.js';
import { insertMovement } from '../inventory/service.js';
import { readTable, type FileFormat } from './file.js';

export interface ImportSummary {
  categoriesCreated: number;
  productsCreated: number;
  variantsCreated: number;
  /** Variantes existentes que realmente cambiaron (una reimportación idéntica da 0). */
  variantsUpdated: number;
  barcodesAdded: number;
  stockAdjustments: number;
}

export interface ImportResult {
  /** true si no hubo errores. */
  ok: boolean;
  /** true si los cambios se guardaron (no es vista previa y no hubo errores). */
  applied: boolean;
  totalRows: number;
  errors: ImportError[];
  summary: ImportSummary;
}

/** Se lanza dentro de la transacción para revertirla (vista previa o con errores). */
class Rollback extends Error {}

const norm = (text: string) => text.trim().toLowerCase();

interface ProductState {
  id: string;
  name: string;
  priceCents: number;
  categoryId: string | null;
  controlsInventory: boolean;
}
interface VariantState {
  id: string;
  productId: string;
  name: string | null;
  ownPriceCents: number | null;
  costCents: number | null;
}

export class ImportService {
  constructor(private readonly db: PosDb) {}

  async preview(actor: SessionUser, file: Buffer, format: FileFormat): Promise<ImportResult> {
    return this.run(actor, await readTable(file, format), true);
  }

  /** Todo o nada: si hay un solo error no se guarda nada. */
  async apply(actor: SessionUser, file: Buffer, format: FileFormat): Promise<ImportResult> {
    return this.run(actor, await readTable(file, format), false);
  }

  private run(actor: SessionUser, table: string[][], dryRun: boolean): ImportResult {
    const parsed = parseImportTable(table);
    const errors: ImportError[] = [...parsed.errors];
    const summary: ImportSummary = {
      categoriesCreated: 0,
      productsCreated: 0,
      variantsCreated: 0,
      variantsUpdated: 0,
      barcodesAdded: 0,
      stockAdjustments: 0,
    };

    // Con errores de formato en columnas obligatorias no hay nada que simular.
    const canSimulate = !parsed.errors.some((e) => e.row === 1);
    let applied = false;

    if (canSimulate) {
      try {
        this.db.transaction((tx) => {
          this.process(tx, actor, parsed.rows, errors, summary);
          if (dryRun || errors.length > 0) throw new Rollback();
          tx.insert(auditLog)
            .values({
              tenantId: actor.tenantId,
              storeId: actor.storeId,
              userId: actor.id,
              action: 'import.apply',
              entity: 'catalog',
              detail: JSON.stringify({ totalRows: parsed.totalRows, ...summary }),
            })
            .run();
          applied = true;
        });
      } catch (err) {
        if (!(err instanceof Rollback)) throw err;
      }
    }

    errors.sort((a, b) => a.row - b.row);
    return { ok: errors.length === 0, applied, totalRows: parsed.totalRows, errors, summary };
  }

  private process(
    tx: Parameters<Parameters<PosDb['transaction']>[0]>[0],
    actor: SessionUser,
    rows: ImportRow[],
    errors: ImportError[],
    summary: ImportSummary,
  ): void {
    const scope = { tenantId: actor.tenantId, storeId: actor.storeId };
    const now = Date.now();

    // --- Estado actual en memoria (evita una consulta por fila) ---
    const categoryByName = new Map<string, string>();
    for (const c of tx
      .select()
      .from(categories)
      .where(eq(categories.storeId, actor.storeId))
      .all()) {
      categoryByName.set(norm(c.name), c.id);
    }

    const productByName = new Map<string, ProductState>();
    const productById = new Map<string, ProductState>();
    for (const p of tx.select().from(products).where(eq(products.storeId, actor.storeId)).all()) {
      const state: ProductState = {
        id: p.id,
        name: p.name,
        priceCents: p.priceCents,
        categoryId: p.categoryId,
        controlsInventory: p.controlsInventory,
      };
      productByName.set(norm(p.name), state);
      productById.set(p.id, state);
    }

    const variantById = new Map<string, VariantState>();
    const variantByKey = new Map<string, VariantState>(); // `${productId}|${nombre normalizado}`
    const key = (productId: string, name: string | null) => `${productId}|${norm(name ?? '')}`;
    for (const v of tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.storeId, actor.storeId))
      .all()) {
      const state: VariantState = {
        id: v.id,
        productId: v.productId,
        name: v.name,
        ownPriceCents: v.priceCents,
        costCents: v.costCents,
      };
      variantById.set(v.id, state);
      variantByKey.set(key(v.productId, v.name), state);
    }

    const variantByCode = new Map<string, string>();
    for (const b of tx.select().from(barcodes).where(eq(barcodes.storeId, actor.storeId)).all()) {
      variantByCode.set(b.code, b.variantId);
    }

    const stockByVariant = new Map<string, number>();
    for (const s of tx
      .select({
        variantId: inventoryMovements.variantId,
        stock: sql<number>`sum(${inventoryMovements.quantity})`.mapWith(Number),
      })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.storeId, actor.storeId))
      .groupBy(inventoryMovements.variantId)
      .all()) {
      stockByVariant.set(s.variantId, s.stock);
    }

    const touchedAtRow = new Map<string, number>(); // variantId -> fila que la tocó

    // --- Filas ---
    for (const r of rows) {
      let product: ProductState | undefined;
      let variant: VariantState | undefined;

      // 1) Por código: es la identidad más confiable.
      const codeOwner = r.code ? variantByCode.get(r.code) : undefined;
      if (codeOwner) {
        variant = variantById.get(codeOwner)!;
        product = productById.get(variant.productId)!;
        if (norm(product.name) !== norm(r.product)) {
          errors.push({
            row: r.row,
            column: 'codigo',
            message: `El código ${r.code} ya pertenece a "${product.name}".`,
          });
          continue;
        }
      } else {
        // 2) Por nombre de producto y variante.
        product = productByName.get(norm(r.product));
        if (product) variant = variantByKey.get(key(product.id, r.variant));
      }

      if (variant) {
        const previous = touchedAtRow.get(variant.id);
        if (previous !== undefined) {
          errors.push({
            row: r.row,
            message: `Esta variante ya aparece en la fila ${previous}.`,
          });
          continue;
        }
      }

      let changed = false;

      // Categoría (se crea si no existe)
      let categoryId: string | null | undefined;
      if (r.category) {
        categoryId = categoryByName.get(norm(r.category));
        if (!categoryId) {
          categoryId = tx
            .insert(categories)
            .values({ ...scope, name: r.category })
            .returning({ id: categories.id })
            .get().id;
          categoryByName.set(norm(r.category), categoryId);
          summary.categoriesCreated += 1;
        }
      }

      // Producto
      if (!product) {
        const created = tx
          .insert(products)
          .values({
            ...scope,
            name: r.product,
            categoryId: categoryId ?? null,
            priceCents: r.priceCents,
            controlsInventory: true,
          })
          .returning({ id: products.id })
          .get();
        product = {
          id: created.id,
          name: r.product,
          priceCents: r.priceCents,
          categoryId: categoryId ?? null,
          controlsInventory: true,
        };
        productByName.set(norm(r.product), product);
        productById.set(product.id, product);
        summary.productsCreated += 1;
      } else if (categoryId && product.categoryId !== categoryId) {
        tx.update(products)
          .set({ categoryId, updatedAt: now })
          .where(eq(products.id, product.id))
          .run();
        product.categoryId = categoryId;
        changed = true;
      }

      // Si el precio coincide con el del producto, la variante lo hereda.
      const ownPrice = r.priceCents === product.priceCents ? null : r.priceCents;
      const newVariant = !variant;

      if (!variant) {
        const created = tx
          .insert(productVariants)
          .values({
            ...scope,
            productId: product.id,
            name: r.variant,
            priceCents: ownPrice,
            costCents: r.costCents,
          })
          .returning({ id: productVariants.id })
          .get();
        variant = {
          id: created.id,
          productId: product.id,
          name: r.variant,
          ownPriceCents: ownPrice,
          costCents: r.costCents,
        };
        variantById.set(variant.id, variant);
        variantByKey.set(key(product.id, r.variant), variant);
        summary.variantsCreated += 1;
      } else {
        const set: Partial<typeof productVariants.$inferInsert> = {};
        const oldEffective = variant.ownPriceCents ?? product.priceCents;
        if (variant.ownPriceCents !== ownPrice) set.priceCents = ownPrice;
        if (r.costCents !== null && variant.costCents !== r.costCents) set.costCents = r.costCents;
        if (r.variant && variant.name !== r.variant) set.name = r.variant;
        if (Object.keys(set).length > 0) {
          tx.update(productVariants)
            .set({ ...set, updatedAt: now })
            .where(eq(productVariants.id, variant.id))
            .run();
          if (oldEffective !== r.priceCents) {
            tx.insert(auditLog)
              .values({
                ...scope,
                userId: actor.id,
                action: 'price.change',
                entity: 'variant',
                entityId: variant.id,
                detail: JSON.stringify({ from: oldEffective, to: r.priceCents, source: 'import' }),
              })
              .run();
          }
          variant.ownPriceCents = ownPrice;
          if (r.costCents !== null) variant.costCents = r.costCents;
          if (r.variant) {
            variantByKey.delete(key(product.id, variant.name));
            variant.name = r.variant;
            variantByKey.set(key(product.id, variant.name), variant);
          }
          changed = true;
        }
      }
      touchedAtRow.set(variant.id, r.row);

      // Código de barras nuevo
      if (r.code && !variantByCode.has(r.code)) {
        tx.insert(barcodes)
          .values({ ...scope, variantId: variant.id, code: r.code })
          .run();
        variantByCode.set(r.code, variant.id);
        summary.barcodesAdded += 1;
        changed = true;
      }

      // Existencias deseadas -> movimiento por la diferencia
      if (r.stock !== null && product.controlsInventory) {
        const delta = r.stock - (stockByVariant.get(variant.id) ?? 0);
        if (delta !== 0) {
          insertMovement(tx, actor, {
            variantId: variant.id,
            type: 'adjustment',
            quantity: delta,
            reason: 'Importación de inventario',
          });
          stockByVariant.set(variant.id, r.stock);
          summary.stockAdjustments += 1;
          changed = true;
        }
      }

      if (changed && !newVariant) summary.variantsUpdated += 1;
    }
  }
}
