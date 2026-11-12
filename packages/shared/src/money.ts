import type { Money } from './types';

const MONEY_PATTERN = /^(0|[1-9]\d*)(\.\d{1,2})?$/;

/**
 * "12.34" → 1234. Solo acepta montos positivos con hasta 2 decimales (FR-020); lanza RangeError si no.
 * Los montos negativos solo existen dentro del libro contable, nunca llegan desde el cliente.
 */
export function toCents(value: Money): number {
  if (!MONEY_PATTERN.test(value)) throw new RangeError(`Monto inválido: "${value}"`);
  const [units = '0', decimals = ''] = value.split('.');
  const cents = Number(units) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0)
    throw new RangeError(`Monto inválido: "${value}"`);
  return cents;
}

/** 1234 → "12.34"; -5 → "-0.05". */
export function fromCents(cents: number): Money {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Centavos inválidos: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
