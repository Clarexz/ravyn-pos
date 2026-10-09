/** Dinero SIEMPRE en centavos enteros. Nunca float. */
export type Cents = number;

export const IVA_RATE_PERCENT = 16;

function assertCents(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Monto inválido (se esperaban centavos enteros): ${value}`);
  }
}

/** Redondeo comercial: .5 hacia arriba (para positivos). */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/** "$1,234.50" -> 123450. Acepta hasta 2 decimales. */
export function parsePesos(input: string): Cents {
  const clean = input.trim().replace(/[$,\s]/g, '');
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) throw new Error(`Monto inválido: "${input}"`);
  const [, sign, whole, frac = ''] = match;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  assertCents(cents);
  return sign ? -cents : cents;
}

const mxn = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
});

export function formatMXN(cents: Cents): string {
  assertCents(cents);
  const text = mxn.format(Math.abs(cents) / 100);
  return cents < 0 ? `-${text}` : text;
}

/** Porcentaje de un monto, redondeado al centavo. */
export function applyPercent(cents: Cents, percent: number): Cents {
  assertCents(cents);
  return roundHalfUp((cents * percent) / 100);
}

export interface IvaBreakdown {
  subtotal: Cents;
  iva: Cents;
  total: Cents;
}

/** Desglosa IVA de un total con IVA incluido. subtotal + iva === total siempre. */
export function splitIva(totalCents: Cents, ratePercent = IVA_RATE_PERCENT): IvaBreakdown {
  assertCents(totalCents);
  const subtotal = roundHalfUp((totalCents * 100) / (100 + ratePercent));
  return { subtotal, iva: totalCents - subtotal, total: totalCents };
}
