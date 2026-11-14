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

// ── Cálculo exacto de cuotas y pagos (research R3) ──────────────────────────
// La API es la autoridad: recalcula todo al aceptar. La web usa estas mismas funciones solo para
// mostrar un pago estimado antes de confirmar.

/** Cuota de una selección anulada dentro de una combinada (constitución V). */
export const VOID_ODDS = 100;

const HUNDRED = BigInt(100);

function assertOdds(odds: readonly number[]): void {
  if (odds.length === 0) throw new RangeError('Se necesita al menos una cuota');
  for (const o of odds)
    if (!Number.isSafeInteger(o) || (o < MIN_ODDS && o !== VOID_ODDS))
      throw new RangeError(`Cuota inválida: ${o}`);
}

/** Producto exacto de las cuotas en centésimas^n. */
export function totalOddsX(odds: readonly number[]): bigint {
  assertOdds(odds);
  return odds.reduce((acc, o) => acc * BigInt(o), BigInt(1));
}

/** Cuota total para mostrar, en centésimas truncadas (1.33 × 1.33 = 1.7689 → 176). */
export function displayTotalOdds(odds: readonly number[]): number {
  return Number(totalOddsX(odds) / HUNDRED ** BigInt(odds.length - 1));
}

/** Pago bruto en centavos: floor(stake × Π cuotas). Incluye el monto apostado. */
export function potentialPayout(stake: number, odds: readonly number[]): number {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new RangeError(`Monto inválido: ${stake}`);
  const payout = (BigInt(stake) * totalOddsX(odds)) / HUNDRED ** BigInt(odds.length);
  if (payout > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Pago fuera de rango');
  return Number(payout);
}

/**
 * Cuota aumentada por un cupón: odds + floor(odds × pct / 100), con el aumento limitado a
 * `capHundredths` si se indica.
 */
export function applyBoost(odds: number, pct: number, capHundredths?: number): number {
  assertOdds([odds]);
  if (!Number.isSafeInteger(pct) || pct <= 0 || pct > 100)
    throw new RangeError(`Porcentaje de aumento inválido: ${pct}`);
  const increase = Math.floor((odds * pct) / 100);
  return odds + (capHundredths === undefined ? increase : Math.min(increase, capHundredths));
}
