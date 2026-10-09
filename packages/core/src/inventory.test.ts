import { expect, it } from 'vitest';
import { stockFromQuantities } from './inventory.js';

it('el stock es la suma de los movimientos', () => {
  expect(stockFromQuantities([])).toBe(0);
  expect(stockFromQuantities([100, -3, -2, 5, -10])).toBe(90);
  expect(stockFromQuantities([-1])).toBe(-1);
});
