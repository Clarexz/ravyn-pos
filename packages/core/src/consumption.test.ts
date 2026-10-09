import { describe, expect, it } from 'vitest';
import { consumptionFor } from './consumption.js';

describe('consumptionFor', () => {
  it('multiplica la receta por las unidades', () => {
    const lines = [
      { inputVariantId: 'hoja', quantity: 1 },
      { inputVariantId: 'toner', quantity: 2 },
    ];
    expect(consumptionFor(lines, 5)).toEqual([
      { inputVariantId: 'hoja', quantity: 5 },
      { inputVariantId: 'toner', quantity: 10 },
    ]);
  });
  it('rechaza unidades inválidas', () => {
    for (const u of [0, -1, 1.5]) expect(() => consumptionFor([], u)).toThrow();
  });
});
