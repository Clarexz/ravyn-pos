import { effectivePriceCents } from '@pos/core';
import { auditLog, barcodes, categories, productVariants, products, type PosDb } from '@pos/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { conflict, notFound } from '../../errors.js';
import type { SessionUser } from '../auth/service.js';

export interface VariantInput {
  name?: string | null;
  /** null/undefined = hereda el precio del producto. */
  priceCents?: number | null;
  costCents?: number | null;
  barcodes?: string[];
}

export interface ProductInput {
  name: string;
  categoryId?: string | null;
  priceCents: number;
  controlsInventory?: boolean;
  /** Sin variantes se crea una variante única. */
  variants?: VariantInput[];
}

export interface ProductPatch {
  name?: string;
  categoryId?: string | null;
  priceCents?: number;
  controlsInventory?: boolean;
  active?: boolean;
}

export interface VariantPatch {
  name?: string | null;
  priceCents?: number | null;
  costCents?: number | null;
  active?: boolean;
}

export interface VariantView {
  id: string;
  name: string | null;
  /** Precio efectivo (propio o heredado). */
  priceCents: number;
  /** Precio propio, o null si hereda. */
  ownPriceCents: number | null;
  costCents: number | null;
  active: boolean;
  barcodes: { id: string; code: string }[];
}

export interface ProductView {
  id: string;
  name: string;
  categoryId: string | null;
  priceCents: number;
  controlsInventory: boolean;
  active: boolean;
  variants: VariantView[];
}

type Tx = Parameters<Parameters<PosDb['transaction']>[0]>[0];

export class CatalogService {
  constructor(
    private readonly db: PosDb,
    private readonly now: () => number = Date.now,
  ) {}

  // --- Categorías ---

  listCategories(actor: SessionUser) {
    return this.db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.storeId, actor.storeId))
      .orderBy(asc(categories.name))
      .all();
  }

  createCategory(actor: SessionUser, name: string) {
    this.assertCategoryNameFree(actor, name);
    const [row] = this.db
      .insert(categories)
      .values({ tenantId: actor.tenantId, storeId: actor.storeId, name })
      .returning({ id: categories.id, name: categories.name })
      .all();
    return row!;
  }

  renameCategory(actor: SessionUser, id: string, name: string) {
    const existing = this.db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.storeId, actor.storeId)))
      .get();
    if (!existing) throw notFound('not_found', 'La categoría no existe.');
    if (existing.name !== name) this.assertCategoryNameFree(actor, name);
    this.db
      .update(categories)
      .set({ name, updatedAt: this.now() })
      .where(eq(categories.id, id))
      .run();
    return { id, name };
  }

  private assertCategoryNameFree(actor: SessionUser, name: string) {
    const dup = this.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.storeId, actor.storeId), eq(categories.name, name)))
      .get();
    if (dup) throw conflict('duplicate_category', 'Ya existe una categoría con ese nombre.');
  }

  // --- Productos ---

  createProduct(actor: SessionUser, input: ProductInput): ProductView {
    const variants = input.variants?.length ? input.variants : [{}];
    const id = this.db.transaction((tx) => {
      if (input.categoryId) this.assertCategory(tx, actor, input.categoryId);
      const [product] = tx
        .insert(products)
        .values({
          ...this.scope(actor),
          name: input.name,
          categoryId: input.categoryId ?? null,
          priceCents: input.priceCents,
          controlsInventory: input.controlsInventory ?? true,
        })
        .returning({ id: products.id })
        .all();
      for (const variant of variants) this.insertVariant(tx, actor, product!.id, variant);
      return product!.id;
    });
    return this.getProduct(actor, id);
  }

  updateProduct(actor: SessionUser, id: string, patch: ProductPatch): ProductView {
    this.db.transaction((tx) => {
      const current = this.findProduct(tx, actor, id);
      if (patch.categoryId) this.assertCategory(tx, actor, patch.categoryId);
      tx.update(products)
        .set({ ...patch, updatedAt: this.now() })
        .where(eq(products.id, id))
        .run();
      if (patch.priceCents !== undefined && patch.priceCents !== current.priceCents) {
        this.audit(tx, actor, 'price.change', 'product', id, {
          from: current.priceCents,
          to: patch.priceCents,
        });
      }
    });
    return this.getProduct(actor, id);
  }

  getProduct(actor: SessionUser, id: string): ProductView {
    const row = this.findProduct(this.db, actor, id);
    return this.toViews(actor, [row])[0]!;
  }

  listProducts(actor: SessionUser, opts: { categoryId?: string; includeInactive?: boolean } = {}) {
    const rows = this.db
      .select()
      .from(products)
      .where(
        and(
          eq(products.storeId, actor.storeId),
          opts.categoryId ? eq(products.categoryId, opts.categoryId) : undefined,
          opts.includeInactive ? undefined : eq(products.active, true),
        ),
      )
      .orderBy(asc(products.name))
      .all();
    return this.toViews(actor, rows, opts.includeInactive ?? false);
  }

  // --- Variantes y códigos ---

  addVariant(actor: SessionUser, productId: string, input: VariantInput): ProductView {
    this.db.transaction((tx) => {
      this.findProduct(tx, actor, productId);
      this.insertVariant(tx, actor, productId, input);
    });
    return this.getProduct(actor, productId);
  }

  updateVariant(actor: SessionUser, variantId: string, patch: VariantPatch): ProductView {
    const productId = this.db.transaction((tx) => {
      const variant = this.findVariant(tx, actor, variantId);
      tx.update(productVariants)
        .set({ ...patch, updatedAt: this.now() })
        .where(eq(productVariants.id, variantId))
        .run();
      if (patch.priceCents !== undefined && patch.priceCents !== variant.priceCents) {
        this.audit(tx, actor, 'price.change', 'variant', variantId, {
          from: variant.priceCents,
          to: patch.priceCents,
        });
      }
      return variant.productId;
    });
    return this.getProduct(actor, productId);
  }

  addBarcode(actor: SessionUser, variantId: string, code: string): ProductView {
    const productId = this.db.transaction((tx) => {
      const variant = this.findVariant(tx, actor, variantId);
      this.insertBarcode(tx, actor, variantId, code);
      return variant.productId;
    });
    return this.getProduct(actor, productId);
  }

  removeBarcode(actor: SessionUser, barcodeId: string): ProductView {
    const productId = this.db.transaction((tx) => {
      const barcode = tx
        .select()
        .from(barcodes)
        .where(and(eq(barcodes.id, barcodeId), eq(barcodes.storeId, actor.storeId)))
        .get();
      if (!barcode) throw notFound('not_found', 'El código de barras no existe.');
      const variant = this.findVariant(tx, actor, barcode.variantId);
      tx.delete(barcodes).where(eq(barcodes.id, barcodeId)).run();
      return variant.productId;
    });
    return this.getProduct(actor, productId);
  }

  // --- Internos ---

  private scope(actor: SessionUser) {
    return { tenantId: actor.tenantId, storeId: actor.storeId };
  }

  private insertVariant(tx: Tx, actor: SessionUser, productId: string, input: VariantInput) {
    const [variant] = tx
      .insert(productVariants)
      .values({
        ...this.scope(actor),
        productId,
        name: input.name ?? null,
        priceCents: input.priceCents ?? null,
        costCents: input.costCents ?? null,
      })
      .returning({ id: productVariants.id })
      .all();
    for (const code of input.barcodes ?? []) this.insertBarcode(tx, actor, variant!.id, code);
  }

  private insertBarcode(tx: Tx, actor: SessionUser, variantId: string, code: string) {
    const dup = tx
      .select({ id: barcodes.id })
      .from(barcodes)
      .where(and(eq(barcodes.storeId, actor.storeId), eq(barcodes.code, code)))
      .get();
    if (dup) {
      throw conflict('duplicate_barcode', `El código ${code} ya está asignado a otro artículo.`);
    }
    tx.insert(barcodes)
      .values({ ...this.scope(actor), variantId, code })
      .run();
  }

  private findProduct(db: PosDb | Tx, actor: SessionUser, id: string) {
    const row = db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.storeId, actor.storeId)))
      .get();
    if (!row) throw notFound('not_found', 'El producto no existe.');
    return row;
  }

  private findVariant(db: PosDb | Tx, actor: SessionUser, id: string) {
    const row = db
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.id, id), eq(productVariants.storeId, actor.storeId)))
      .get();
    if (!row) throw notFound('not_found', 'La variante no existe.');
    return row;
  }

  private assertCategory(tx: Tx, actor: SessionUser, id: string) {
    const row = tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.storeId, actor.storeId)))
      .get();
    if (!row) throw notFound('not_found', 'La categoría no existe.');
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
        ...this.scope(actor),
        userId: actor.id,
        action,
        entity,
        entityId,
        detail: JSON.stringify(detail),
      })
      .run();
  }

  private toViews(
    actor: SessionUser,
    productRows: (typeof products.$inferSelect)[],
    includeInactiveVariants = true,
  ): ProductView[] {
    if (productRows.length === 0) return [];
    const variantRows = this.db
      .select()
      .from(productVariants)
      .where(
        and(
          inArray(
            productVariants.productId,
            productRows.map((p) => p.id),
          ),
          includeInactiveVariants ? undefined : eq(productVariants.active, true),
        ),
      )
      .orderBy(asc(productVariants.createdAt), asc(productVariants.id))
      .all();
    const barcodeRows = variantRows.length
      ? this.db
          .select()
          .from(barcodes)
          .where(
            and(
              eq(barcodes.storeId, actor.storeId),
              inArray(
                barcodes.variantId,
                variantRows.map((v) => v.id),
              ),
            ),
          )
          .orderBy(asc(barcodes.createdAt), asc(barcodes.id))
          .all()
      : [];

    return productRows.map((p) => ({
      id: p.id,
      name: p.name,
      categoryId: p.categoryId,
      priceCents: p.priceCents,
      controlsInventory: p.controlsInventory,
      active: p.active,
      variants: variantRows
        .filter((v) => v.productId === p.id)
        .map((v) => ({
          id: v.id,
          name: v.name,
          priceCents: effectivePriceCents(v.priceCents, p.priceCents),
          ownPriceCents: v.priceCents,
          costCents: v.costCents,
          active: v.active,
          barcodes: barcodeRows
            .filter((b) => b.variantId === v.id)
            .map((b) => ({ id: b.id, code: b.code })),
        })),
    }));
  }
}
