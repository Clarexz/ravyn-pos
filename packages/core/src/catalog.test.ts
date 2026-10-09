import { expect, it } from 'vitest';
import { effectivePriceCents } from './catalog.js';

it('la variante hereda el precio del producto si no tiene propio', () => {
  expect(effectivePriceCents(null, 2500)).toBe(2500);
  expect(effectivePriceCents(3000, 2500)).toBe(3000);
  expect(effectivePriceCents(0, 2500)).toBe(0); // 0 es un precio válido, no "sin precio"
});
