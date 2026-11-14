import type { Odds } from './types';

const ODDS_PATTERN = /^([1-9]\d{0,3})(\.\d{1,2})?$/;

/** Cuota mínima admitida: 1.01 (una cuota de 1.00 solo existe para selecciones anuladas). */
export const MIN_ODDS = 101;

/**
 * "2.10" → 210 (centésimas). Acepta de 1.01 a 9999.99 con hasta 2 decimales; lanza RangeError si no.
 */
export function parseOdds(value: Odds): number {
  const match = ODDS_PATTERN.exec(value);
  if (!match) throw new RangeError(`Cuota inválida: "${value}"`);
  const [units = '0', decimals = ''] = value.split('.');
  const hundredths = Number(units) * 100 + Number(decimals.padEnd(2, '0'));
  if (hundredths < MIN_ODDS) throw new RangeError(`Cuota inválida: "${value}"`);
  return hundredths;
}

/** 210 → "2.10". */
export function oddsToString(hundredths: number): Odds {
  if (!Number.isSafeInteger(hundredths) || hundredths < 100)
    throw new RangeError(`Cuota inválida: ${hundredths}`);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}
