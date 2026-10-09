import type { Cents } from './money.js';

/** El precio de una variante es el suyo, o el del producto si no define uno. */
export function effectivePriceCents(variantPrice: Cents | null, productPrice: Cents): Cents {
  return variantPrice ?? productPrice;
}
