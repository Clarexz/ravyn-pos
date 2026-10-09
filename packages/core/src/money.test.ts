import { describe, expect, it } from 'vitest';
import { applyPercent, formatMXN, parsePesos, roundHalfUp, splitIva } from './money.js';

describe('roundHalfUp', () => {
  it('redondea .5 hacia arriba', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(1.4999)).toBe(1);
    expect(roundHalfUp(0)).toBe(0);
  });
});

describe('parsePesos', () => {
  it('convierte texto a centavos sin usar float', () => {
    expect(parsePesos('12.50')).toBe(1250);
    expect(parsePesos('$1,234.5')).toBe(123450);
    expect(parsePesos('0.07')).toBe(7);
    expect(parsePesos('19.99')).toBe(1999);
    expect(parsePesos('8')).toBe(800);
  });
  it('rechaza entradas inválidas', () => {
    expect(() => parsePesos('abc')).toThrow();
    expect(() => parsePesos('1.234')).toThrow();
    expect(() => parsePesos('')).toThrow();
  });
});

describe('formatMXN', () => {
  it('formatea centavos como MXN', () => {
    expect(formatMXN(123450)).toBe('$1,234.50');
    expect(formatMXN(5)).toBe('$0.05');
    expect(formatMXN(-1250)).toBe('-$12.50');
  });
  it('rechaza valores no enteros', () => {
    expect(() => formatMXN(1.5)).toThrow();
  });
});

describe('applyPercent', () => {
  it('calcula porcentaje redondeado a centavo', () => {
    expect(applyPercent(1000, 10)).toBe(100);
    expect(applyPercent(999, 10)).toBe(100); // 99.9 -> 100
    expect(applyPercent(1005, 50)).toBe(503); // 502.5 -> 503
  });
});

describe('splitIva', () => {
  it('desglosa IVA 16% de un precio con IVA incluido', () => {
    expect(splitIva(11600)).toEqual({ subtotal: 10000, iva: 1600, total: 11600 });
    expect(splitIva(1000)).toEqual({ subtotal: 862, iva: 138, total: 1000 });
  });
  it('subtotal + iva siempre suma el total', () => {
    for (let t = 0; t <= 5000; t += 7) {
      const r = splitIva(t);
      expect(r.subtotal + r.iva).toBe(t);
    }
  });
  it('tasa 0', () => {
    expect(splitIva(500, 0)).toEqual({ subtotal: 500, iva: 0, total: 500 });
  });
});
